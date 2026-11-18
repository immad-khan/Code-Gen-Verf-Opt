using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Backend.Models;
using Microsoft.Extensions.Logging;

namespace Backend.Services.Verification;

public interface IIndependentChecksService
{
    Task<IndependentChecksResult> ExecuteAsync(
        List<GeneratedCodeFile> files,
        string? prompt,
        InterfaceDefinition? iface,
        ApiSettings? secondaryApiSettings,
        CancellationToken ct = default);
}

public class IndependentChecksService : IIndependentChecksService
{
    private readonly PythonToolHealthService _toolHealth;
    private readonly ILlmClient? _llmClient;
    private readonly ILogger<IndependentChecksService> _logger;

    public IndependentChecksService(
        PythonToolHealthService toolHealth,
        ILogger<IndependentChecksService> logger,
        ILlmClient? llmClient = null)
    {
        _toolHealth = toolHealth;
        _logger = logger;
        _llmClient = llmClient;
    }

    public async Task<IndependentChecksResult> ExecuteAsync(
        List<GeneratedCodeFile> files,
        string? prompt,
        InterfaceDefinition? iface,
        ApiSettings? secondaryApiSettings,
        CancellationToken ct = default)
    {
        var result = new IndependentChecksResult();

        // 1. Locate main solution code
        var solFile = files.FirstOrDefault(f => !f.Name.StartsWith("test_", StringComparison.OrdinalIgnoreCase) && f.Name.EndsWith(".py"))
                      ?? files.FirstOrDefault(f => f.Name.EndsWith(".py"));

        if (solFile == null || string.IsNullOrWhiteSpace(solFile.Content))
        {
            _logger.LogWarning("[IndependentChecksService] No solution.py found for independent checks.");
            return result;
        }

        string? solution2Code = null;
        string? secondaryModelName = null;

        // 2. If secondary model setting is configured, generate second solution for differential testing
        if (secondaryApiSettings != null &&
            !string.IsNullOrWhiteSpace(secondaryApiSettings.ApiKey) &&
            !string.IsNullOrWhiteSpace(prompt) &&
            _llmClient != null)
        {
            try
            {
                secondaryModelName = $"{secondaryApiSettings.Provider} ({secondaryApiSettings.Model ?? "default"})";
                _logger.LogInformation("[IndependentChecksService] Generating 2nd solution using secondary model: {Model}", secondaryModelName);

                var promptWithIface = new StringBuilder();
                promptWithIface.AppendLine("TASK:");
                promptWithIface.AppendLine(prompt);
                if (iface != null && !string.IsNullOrWhiteSpace(iface.Signature))
                {
                    promptWithIface.AppendLine();
                    promptWithIface.AppendLine($"TARGET INTERFACE: {iface.Signature}");
                }

                var rawSol2 = await _llmClient.CompleteTextAsync(
                    promptWithIface.ToString(),
                    AiService.GenerationSystemPrompt,
                    secondaryApiSettings,
                    0.2,
                    ct);

                var parsedBlocks = FencedCodeBlockParser.ParseBlocks(rawSol2);
                if (parsedBlocks.Count > 0)
                {
                    solution2Code = parsedBlocks[0].Content;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[IndependentChecksService] Failed to generate 2nd solution with secondary model.");
                result.SecondSolution.Warnings.Add($"Failed to query secondary model: {ex.Message}");
            }
        }

        // 3. Resolve Python executable and script path
        var pythonPath = await _toolHealth.ResolvePythonPathAsync();
        var scriptPath = ResolveScriptPath();

        if (!File.Exists(scriptPath))
        {
            _logger.LogError("[IndependentChecksService] Script not found: {Path}", scriptPath);
            return result;
        }

        // 4. Prepare JSON input configuration
        var configObj = new Dictionary<string, object?>
        {
            ["prompt"] = prompt ?? "",
            ["solutionCode"] = solFile.Content,
            ["solution2Code"] = solution2Code,
            ["signature"] = iface?.Signature,
            ["funcName"] = iface?.Name ?? "solution",
            ["secondaryModel"] = secondaryModelName ?? "Secondary Model"
        };

        var tempConfigFile = Path.GetTempFileName();
        try
        {
            var jsonInput = JsonSerializer.Serialize(configObj, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(tempConfigFile, jsonInput, new UTF8Encoding(false), ct);

            var psi = new ProcessStartInfo
            {
                FileName = pythonPath,
                Arguments = $"\"{scriptPath}\" \"{tempConfigFile}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var proc = new Process { StartInfo = psi };
            proc.Start();

            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
            var stderrTask = proc.StandardError.ReadToEndAsync();

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(25)); // 25s timeout for Hypothesis & evaluation

            var exitTask = proc.WaitForExitAsync(timeoutCts.Token);
            if (await Task.WhenAny(exitTask, Task.Delay(25000, timeoutCts.Token)) == exitTask)
            {
                var stdout = await stdoutTask;
                var stderr = await stderrTask;

                if (!string.IsNullOrWhiteSpace(stdout))
                {
                    try
                    {
                        var parsed = JsonSerializer.Deserialize<IndependentChecksResult>(stdout);
                        if (parsed != null)
                        {
                            return parsed;
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "[IndependentChecksService] Failed to deserialize runner output: {Output}", stdout);
                        result.AllWarnings.Add($"Deserialization error: {ex.Message}");
                    }
                }
                else
                {
                    result.AllWarnings.Add($"Python script stdout was empty. Stderr: {stderr}");
                }

                if (!string.IsNullOrWhiteSpace(stderr))
                {
                    _logger.LogWarning("[IndependentChecksService] Runner stderr: {Error}", stderr);
                }
            }
            else
            {
                try { proc.Kill(); } catch { }
                result.FuzzCheck.Warnings.Add("[fuzz check] Fuzzing timed out after 25s.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[IndependentChecksService] Execution failed.");
        }
        finally
        {
            try { if (File.Exists(tempConfigFile)) File.Delete(tempConfigFile); } catch { }
        }

        return result;
    }

    private static string ResolveScriptPath()
    {
        var dir = AppContext.BaseDirectory;
        while (!string.IsNullOrEmpty(dir))
        {
            var candidate = Path.Combine(dir, "Backend", "Services", "Verification", "Scripts", "independent_checks.py");
            if (File.Exists(candidate)) return Path.GetFullPath(candidate);

            var directCandidate = Path.Combine(dir, "Services", "Verification", "Scripts", "independent_checks.py");
            if (File.Exists(directCandidate)) return Path.GetFullPath(directCandidate);

            var parent = Directory.GetParent(dir);
            dir = parent?.FullName;
        }

        return Path.GetFullPath(Path.Combine("Backend", "Services", "Verification", "Scripts", "independent_checks.py"));
    }
}
