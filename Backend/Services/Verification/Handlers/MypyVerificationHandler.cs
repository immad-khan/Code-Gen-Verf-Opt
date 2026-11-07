using System.Diagnostics;
using Backend.Models;
using Backend.Services.Verification.Context;

namespace Backend.Services.Verification.Handlers;

/// <summary>
/// Technique 5: Static type checking via mypy.
/// </summary>
public class MypyVerificationHandler : VerificationHandlerBase
{
    protected override async Task ExecuteAsync(VerificationContext context)
    {
        var technique = new VerificationTechnique { Id = 5, Name = "Type Checking (mypy)" };
        var sw = Stopwatch.StartNew();

        try
        {
            var (checkExit, _, _) = await context.RunCommandAsync(
                context.PythonExecutable, "-m mypy --version", 5000);

            if (checkExit != 0)
            {
                technique.Status = "SKIP";
                technique.Details = "mypy not installed. Run: pip install mypy";
                sw.Stop();
                technique.DurationMs = sw.ElapsedMilliseconds;
                context.AddTechnique(technique);
                return;
            }

            var pyFiles = Directory.GetFiles(context.TempDir, "*.py", SearchOption.AllDirectories)
                .Where(f => !Path.GetFileName(f).StartsWith("_maci_"))
                .ToList();

            if (pyFiles.Count == 0)
            {
                technique.Status = "PASS";
                technique.Details = "No Python files to type-check";
                sw.Stop();
                technique.DurationMs = sw.ElapsedMilliseconds;
                context.AddTechnique(technique);
                return;
            }

            var fileArgs = string.Join(" ", pyFiles.Select(f => $"\"{f}\""));
            var (exitCode, stdout, stderr) = await context.RunCommandAsync(
                context.PythonExecutable,
                $"-m mypy --ignore-missing-imports --no-error-summary {fileArgs}",
                30000);

            var output = $"{stdout}\n{stderr}".Trim();
            var errorCount = 0;

            foreach (var line in output.Split('\n'))
            {
                if (line.Contains(": error:"))
                {
                    errorCount++;
                    var relLine = line;
                    if (relLine.Contains(context.TempDir))
                        relLine = relLine.Replace(context.TempDir + Path.DirectorySeparatorChar, "");

                    technique.Issues.Add(new VerificationIssue
                    {
                        Message = relLine.Trim(),
                        Severity = "WARNING"
                    });
                }
            }

            technique.Status = errorCount == 0 ? "PASS" : "FAIL";
            technique.Details = errorCount == 0
                ? $"Type checking passed for {pyFiles.Count} file(s)"
                : $"{errorCount} type error(s) found";
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"mypy check error: {ex.Message}";
        }

        sw.Stop();
        technique.DurationMs = sw.ElapsedMilliseconds;
        context.AddTechnique(technique);
    }
}
