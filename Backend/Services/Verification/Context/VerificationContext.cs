using System.Diagnostics;
using Backend.Models;

namespace Backend.Services.Verification.Context;

/// <summary>
/// Execution context passed through the Chain of Responsibility verification pipeline.
/// Carries file representations, environment paths, execution outcomes, and fail-fast control flags.
/// </summary>
public class VerificationContext
{
    public List<GeneratedCodeFile> Files { get; }
    public string TempDir { get; }
    public string PythonExecutable { get; }
    public ILogger Logger { get; }

    public List<VerificationTechnique> Techniques { get; } = new();
    public Dictionary<string, object> SharedState { get; } = new();

    /// <summary>
    /// When set to true by any handler (e.g. fatal syntax failure),
    /// subsequent handlers in the chain can be skipped.
    /// </summary>
    public bool ShouldShortCircuit { get; set; }
    public string? ShortCircuitReason { get; set; }

    public VerificationContext(
        List<GeneratedCodeFile> files,
        string tempDir,
        string pythonExecutable,
        ILogger logger)
    {
        Files = files;
        TempDir = tempDir;
        PythonExecutable = pythonExecutable;
        Logger = logger;
    }

    public void AddTechnique(VerificationTechnique technique)
    {
        Techniques.Add(technique);
    }

    public VerificationTechnique? GetTechnique(int id)
    {
        return Techniques.FirstOrDefault(t => t.Id == id);
    }

    public async Task<(int exitCode, string stdout, string stderr)> RunCommandAsync(
        string command, string arguments, int timeoutMs = 30000)
    {
        var psi = new ProcessStartInfo
        {
            FileName = command,
            Arguments = arguments,
            WorkingDirectory = TempDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = psi };
        process.Start();

        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();

        var completed = process.WaitForExit(timeoutMs);
        if (!completed)
        {
            try { process.Kill(true); } catch { }
            return (-1, await stdoutTask, "Process timed out");
        }

        return (process.ExitCode, await stdoutTask, await stderrTask);
    }

    public string? GetCodeSnippet(string? relativeFile, int? lineNo)
    {
        if (string.IsNullOrEmpty(relativeFile) || lineNo == null) return null;
        try
        {
            var fullPath = Path.Combine(TempDir, relativeFile.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(fullPath)) return null;
            var lines = File.ReadAllLines(fullPath);
            var target = lineNo.Value;
            var from = Math.Max(0, target - 2);
            var to = Math.Min(lines.Length - 1, target);
            var sb = new System.Text.StringBuilder();
            for (var i = from; i <= to; i++)
            {
                var marker = (i + 1 == target) ? "→" : " ";
                sb.AppendLine($"{marker} {i + 1,4}: {lines[i]}");
            }
            return sb.ToString().TrimEnd();
        }
        catch
        {
            return null;
        }
    }
}
