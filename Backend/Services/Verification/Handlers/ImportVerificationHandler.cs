using System.Diagnostics;
using System.Text.Json;
using Backend.Models;
using Backend.Services.Verification.Context;
using Backend.Services.Verification.Scripts;

namespace Backend.Services.Verification.Handlers;

/// <summary>
/// Technique 2: Walks imports and tests resolution to catch hallucinated libraries.
/// </summary>
public class ImportVerificationHandler : VerificationHandlerBase
{
    private record ImportResult(string? module, bool ok, string? message, bool? local);

    protected override async Task ExecuteAsync(VerificationContext context)
    {
        var technique = new VerificationTechnique { Id = 2, Name = "Import / API Hallucination Detection" };
        var sw = Stopwatch.StartNew();

        try
        {
            var scriptPath = Path.Combine(context.TempDir, "_maci_import_check.py");
            await File.WriteAllTextAsync(scriptPath, VerificationPythonScripts.ImportCheckScript);

            var (exitCode, stdout, stderr) = await context.RunCommandAsync(
                context.PythonExecutable,
                $"\"{scriptPath}\" \"{context.TempDir}\"");

            if (!string.IsNullOrWhiteSpace(stdout))
            {
                var results = JsonSerializer.Deserialize<List<ImportResult>>(stdout);
                if (results != null)
                {
                    var failures = results.Where(r => !r.ok).ToList();
                    foreach (var fail in failures)
                    {
                        technique.Issues.Add(new VerificationIssue
                        {
                            File = fail.module ?? "",
                            Message = fail.message ?? $"Module '{fail.module}' not found",
                            Severity = "ERROR"
                        });
                    }

                    technique.Status = failures.Count == 0 ? "PASS" : "FAIL";
                    technique.Details = failures.Count == 0
                        ? $"All {results.Count} imports verified"
                        : $"{failures.Count} import(s) could not be resolved: {string.Join(", ", failures.Select(f => f.module))}";
                }
            }
            else
            {
                technique.Status = "PASS";
                technique.Details = "No imports to check";
            }
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"Import check error: {ex.Message}";
        }

        sw.Stop();
        technique.DurationMs = sw.ElapsedMilliseconds;
        context.AddTechnique(technique);
    }
}
