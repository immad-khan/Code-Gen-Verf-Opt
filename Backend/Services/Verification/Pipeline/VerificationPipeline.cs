using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Backend.Models;
using Backend.Services.Verification.Context;
using Backend.Services.Verification.Handlers;
using Backend.Services.Verification.Scripts;

namespace Backend.Services.Verification.Pipeline;

/// <summary>
/// Pipeline implementing the Chain of Responsibility design pattern for code verification.
/// Chains together independent handlers for AST parsing, imports, pytest, runtime trace,
/// mypy, radon, and semgrep analysis in a sequential, fail-fast sequence.
/// </summary>
public class VerificationPipeline : IVerificationPipeline
{
    private readonly ILogger<VerificationPipeline> _logger;

    public VerificationPipeline(ILogger<VerificationPipeline> logger)
    {
        _logger = logger;
    }

    public async Task<VerificationResponse> ExecuteAsync(List<GeneratedCodeFile> files)
    {
        var response = new VerificationResponse();
        var sw = Stopwatch.StartNew();
        var tempDir = Path.Combine(Path.GetTempPath(), $"maci_{Guid.NewGuid():N}");

        try
        {
            Directory.CreateDirectory(tempDir);
            foreach (var file in files)
            {
                if (string.IsNullOrWhiteSpace(file.Content)) continue;
                var safePath = file.Path.Replace('/', Path.DirectorySeparatorChar);
                var filePath = Path.Combine(tempDir, safePath);
                var dir = Path.GetDirectoryName(filePath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                await File.WriteAllTextAsync(filePath, file.Content);
            }

            CreateInitFiles(tempDir);

            var python = await FindPythonAsync();
            if (python == null)
            {
                response.Techniques.Add(new VerificationTechnique
                {
                    Id = 0,
                    Name = "Python Check",
                    Status = "ERROR",
                    Details = "Python not found on system. Install Python 3.8+ to enable verification."
                });
                response.OverallVerdict = "ERROR";
                return response;
            }

            _logger.LogInformation("Executing verification pipeline in {TempDir} with {Python}", tempDir, python);

            // 1. Initialize Context
            var context = new VerificationContext(files, tempDir, python, _logger);

            // 2. Assemble Chain of Responsibility
            var syntaxHandler = new SyntaxAstVerificationHandler();
            var importHandler = new ImportVerificationHandler();
            var pytestHandler = new PytestVerificationHandler();
            var runtimeHandler = new RuntimeTraceVerificationHandler();
            var mypyHandler = new MypyVerificationHandler();
            var radonHandler = new RadonVerificationHandler();
            var semgrepHandler = new SemgrepVerificationHandler();

            syntaxHandler
                .SetNext(importHandler)
                .SetNext(pytestHandler)
                .SetNext(runtimeHandler)
                .SetNext(mypyHandler)
                .SetNext(radonHandler)
                .SetNext(semgrepHandler);

            // 3. Execute the Chain
            await syntaxHandler.HandleAsync(context);

            // 4. Populate Results
            response.Techniques = context.Techniques;
            response.TotalPassed = response.Techniques.Count(t => t.Status == "PASS");
            response.TotalFailed = response.Techniques.Count(t => t.Status == "FAIL");
            response.TotalSkipped = response.Techniques.Count(t => t.Status == "SKIP");

            response.OverallVerdict = response.Techniques.Any(t => t.Status == "FAIL")
                ? "FAIL"
                : response.Techniques.All(t => t.Status is "PASS" or "SKIP")
                    ? "PASS" : "PARTIAL";

            // 5. Compute Code Metrics
            var t1 = context.GetTechnique(1);
            var t3 = context.GetTechnique(3);
            var t4 = context.GetTechnique(4);
            var t6 = context.GetTechnique(6);
            var t7 = context.GetTechnique(7);

            response.Metrics = await ComputeMetricsAsync(context, t1, t3, t4, t6, t7);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Verification pipeline execution failed");
            response.OverallVerdict = "ERROR";
        }
        finally
        {
            sw.Stop();
            response.TotalDurationMs = sw.ElapsedMilliseconds;
            try { Directory.Delete(tempDir, true); } catch { }
        }

        return response;
    }

    private async Task<CodeMetrics> ComputeMetricsAsync(
        VerificationContext context,
        VerificationTechnique? t1Ast,
        VerificationTechnique? t3Pytest,
        VerificationTechnique? t4Runtime,
        VerificationTechnique? t6Radon,
        VerificationTechnique? t7Semgrep)
    {
        var metrics = new CodeMetrics();

        try
        {
            var scriptPath = Path.Combine(context.TempDir, "_maci_metrics.py");
            await File.WriteAllTextAsync(scriptPath, VerificationPythonScripts.CodeMetricsScript);
            var (_, stdout, _) = await context.RunCommandAsync(
                context.PythonExecutable, $"\"{scriptPath}\" \"{context.TempDir}\"", 15000);

            if (!string.IsNullOrWhiteSpace(stdout))
            {
                var doc = JsonDocument.Parse(stdout);
                var root = doc.RootElement;
                metrics.TotalLinesOfCode = root.TryGetProperty("total_loc", out var loc) ? loc.GetInt32() : 0;
                metrics.AvgCyclomaticComplexity = root.TryGetProperty("avg_cc", out var acc) ? acc.GetDouble() : 0;
                metrics.MaxCyclomaticComplexity = root.TryGetProperty("max_cc", out var mcc) ? mcc.GetInt32() : 0;
                metrics.TotalApiCount = root.TryGetProperty("api_count", out var api) ? api.GetInt32() : 0;
                metrics.CommentCodeRatio = root.TryGetProperty("comment_ratio", out var ccr) ? ccr.GetDouble() : 0;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Code metrics computation failed: {Msg}", ex.Message);
        }

        if (t3Pytest != null && (t3Pytest.Status == "PASS" || t3Pytest.Status == "FAIL"))
        {
            var pytestDetails = t3Pytest.Details ?? "";
            var passMatch = Regex.Match(pytestDetails, @"(\d+)\s+passed");
            var failMatch = Regex.Match(pytestDetails, @"(\d+)\s+failed");
            metrics.PassedTests = passMatch.Success ? int.Parse(passMatch.Groups[1].Value) : (t3Pytest.Status == "PASS" ? 1 : 0);
            metrics.FailedTests = failMatch.Success ? int.Parse(failMatch.Groups[1].Value) : 0;
            metrics.TotalTests = metrics.PassedTests + metrics.FailedTests;
            metrics.PassRate = metrics.TotalTests > 0
                ? Math.Round((double)metrics.PassedTests / metrics.TotalTests * 100, 1)
                : (t3Pytest.Status == "PASS" ? 100.0 : 0.0);
        }

        metrics.SyntaxBugCount = (t1Ast != null && t1Ast.Status == "FAIL") ? t1Ast.Issues.Count : 0;
        metrics.RuntimeBugCount = (t4Runtime != null && t4Runtime.Status == "FAIL") ? t4Runtime.Issues.Count : 0;
        metrics.FunctionalBugCount = (t3Pytest != null && t3Pytest.Status == "FAIL")
            ? Math.Max(0, t3Pytest.Issues.Count - metrics.RuntimeBugCount)
            : 0;

        if (t6Radon != null && t6Radon.Status is "PASS" or "FAIL")
        {
            try
            {
                var doc = JsonDocument.Parse(t6Radon.Details ?? "{}");
                var root = doc.RootElement;
                if (root.TryGetProperty("avgMi", out var mi) && mi.ValueKind != JsonValueKind.Null)
                    metrics.MaintainabilityIndex = mi.GetDouble();
                if (root.TryGetProperty("complexFunctions", out var cf))
                    metrics.RadonComplexFunctionCount = cf.GetInt32();
            }
            catch { }
        }

        if (t7Semgrep != null && t7Semgrep.Status is "PASS" or "FAIL")
            metrics.SemgrepFindingCount = t7Semgrep.Issues.Count;

        return metrics;
    }

    private async Task<string?> FindPythonAsync()
    {
        foreach (var cmd in new[] { "python", "python3" })
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = cmd,
                    Arguments = "--version",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    var stdout = await proc.StandardOutput.ReadToEndAsync();
                    await proc.WaitForExitAsync();
                    if (proc.ExitCode == 0 && stdout.Contains("Python"))
                    {
                        return cmd;
                    }
                }
            }
            catch { }
        }
        return null;
    }

    private void CreateInitFiles(string rootDir)
    {
        foreach (var dir in Directory.GetDirectories(rootDir, "*", SearchOption.AllDirectories))
        {
            if (Directory.GetFiles(dir, "*.py").Length > 0)
            {
                var initPath = Path.Combine(dir, "__init__.py");
                if (!File.Exists(initPath))
                {
                    File.WriteAllText(initPath, "");
                }
            }
        }
    }
}
