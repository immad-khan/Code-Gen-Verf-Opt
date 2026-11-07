using System.Diagnostics;
using System.Text.Json;
using Backend.Models;
using Backend.Services.Verification.Context;
using Backend.Services.Verification.Scripts;

namespace Backend.Services.Verification.Handlers;

/// <summary>
/// Technique 1: Compiles Python files to AST via ast.parse().
/// Catches syntax rule violations, invalid indentation, unclosed brackets, and incomplete structures.
/// </summary>
public class SyntaxAstVerificationHandler : VerificationHandlerBase
{
    private record AstResult(string? file, bool ok, int? line, string? message);

    protected override async Task ExecuteAsync(VerificationContext context)
    {
        var technique = new VerificationTechnique { Id = 1, Name = "Syntax / AST Parsing" };
        var sw = Stopwatch.StartNew();

        try
        {
            var scriptPath = Path.Combine(context.TempDir, "_maci_ast_check.py");
            await File.WriteAllTextAsync(scriptPath, VerificationPythonScripts.AstParseScript);

            var (exitCode, stdout, stderr) = await context.RunCommandAsync(
                context.PythonExecutable,
                $"\"{scriptPath}\" \"{context.TempDir}\"");

            if (!string.IsNullOrWhiteSpace(stdout))
            {
                var results = JsonSerializer.Deserialize<List<AstResult>>(stdout);
                if (results != null)
                {
                    var failures = results.Where(r => !r.ok).ToList();
                    foreach (var fail in failures)
                    {
                        technique.Issues.Add(new VerificationIssue
                        {
                            File = fail.file ?? "",
                            Line = fail.line,
                            Message = fail.message ?? "Syntax error",
                            Severity = "ERROR",
                            CodeSnippet = context.GetCodeSnippet(fail.file, fail.line)
                        });
                    }

                    var total = results.Count;
                    technique.Status = failures.Count == 0 ? "PASS" : "FAIL";
                    technique.Details = failures.Count == 0
                        ? $"All {total} Python files parsed successfully"
                        : $"{failures.Count}/{total} file(s) have syntax errors";
                }
            }
            else
            {
                technique.Status = "PASS";
                technique.Details = "No Python files to check";
            }
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"AST check error: {ex.Message}";
        }

        sw.Stop();
        technique.DurationMs = sw.ElapsedMilliseconds;
        context.AddTechnique(technique);
    }
}
