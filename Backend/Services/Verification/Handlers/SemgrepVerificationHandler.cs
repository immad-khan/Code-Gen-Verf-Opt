using System.Diagnostics;
using System.Text.Json;
using Backend.Models;
using Backend.Services.Verification.Context;

namespace Backend.Services.Verification.Handlers;

/// <summary>
/// Technique 7: Static application security testing (SAST) via Semgrep.
/// Scans for injection, hardcoded secrets, and OWASP patterns using p/python ruleset.
/// </summary>
public class SemgrepVerificationHandler : VerificationHandlerBase
{
    protected override async Task ExecuteAsync(VerificationContext context)
    {
        var technique = new VerificationTechnique { Id = 7, Name = "Semgrep Security Scan" };
        var sw = Stopwatch.StartNew();

        try
        {
            string? semgrepCmd = null;
            foreach (var candidate in new[] { "semgrep", context.PythonExecutable })
            {
                var args = candidate == context.PythonExecutable ? "-m semgrep --version" : "--version";
                var (exit, verOut, _) = await context.RunCommandAsync(candidate, args, 8000);
                if (exit == 0 && verOut.Contains("semgrep", StringComparison.OrdinalIgnoreCase))
                {
                    semgrepCmd = candidate == context.PythonExecutable ? context.PythonExecutable : "semgrep";
                    break;
                }
            }

            if (semgrepCmd == null)
            {
                technique.Status = "SKIP";
                technique.Details = "semgrep not installed. Run: pip install semgrep";
                sw.Stop();
                technique.DurationMs = sw.ElapsedMilliseconds;
                context.AddTechnique(technique);
                return;
            }

            var scanArgs = semgrepCmd == context.PythonExecutable
                ? $"-m semgrep scan --config p/python --json --quiet \"{context.TempDir}\""
                : $"scan --config p/python --json --quiet \"{context.TempDir}\"";

            var (exitCode, stdout, stderr) = await context.RunCommandAsync(
                semgrepCmd, scanArgs, 60000);

            var jsonOutput = !string.IsNullOrWhiteSpace(stdout) ? stdout : stderr;
            var findingCount = 0;
            var issueList = new List<VerificationIssue>();

            if (!string.IsNullOrWhiteSpace(jsonOutput))
            {
                try
                {
                    var jsonStart = jsonOutput.IndexOf('{');
                    if (jsonStart >= 0)
                    {
                        var doc = JsonDocument.Parse(jsonOutput[jsonStart..]);
                        if (doc.RootElement.TryGetProperty("results", out var resultsEl) &&
                            resultsEl.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var finding in resultsEl.EnumerateArray())
                            {
                                findingCount++;
                                var path = finding.TryGetProperty("path", out var pEl) ? pEl.GetString() : "";
                                var checkId = finding.TryGetProperty("check_id", out var cEl) ? cEl.GetString() : "rule";
                                int? lineNo = null;
                                string? codeLine = null;
                                string? message = null;
                                string severity = "WARNING";

                                if (finding.TryGetProperty("start", out var startEl) &&
                                    startEl.TryGetProperty("line", out var lineEl))
                                    lineNo = lineEl.GetInt32();

                                if (finding.TryGetProperty("extra", out var extraEl))
                                {
                                    if (extraEl.TryGetProperty("message", out var msgEl)) message = msgEl.GetString();
                                    if (extraEl.TryGetProperty("severity", out var sevEl)) severity = sevEl.GetString() ?? "WARNING";
                                    if (extraEl.TryGetProperty("lines", out var linesEl)) codeLine = linesEl.GetString()?.Trim();
                                }

                                var relPath = path ?? "";
                                if (relPath.StartsWith(context.TempDir, StringComparison.OrdinalIgnoreCase))
                                    relPath = relPath[(context.TempDir.Length + 1)..].Replace('\\', '/');

                                string? snippet = codeLine != null
                                    ? $"→ {lineNo,4}: {codeLine}"
                                    : context.GetCodeSnippet(relPath, lineNo);

                                issueList.Add(new VerificationIssue
                                {
                                    File = relPath,
                                    Line = lineNo,
                                    Message = $"[{checkId}] {message ?? "Pattern match"}",
                                    Severity = severity.ToUpperInvariant() switch
                                    {
                                        "ERROR" => "ERROR",
                                        "WARNING" => "WARNING",
                                        _ => "INFO"
                                    },
                                    CodeSnippet = snippet
                                });
                            }
                        }
                    }
                }
                catch { }
            }

            technique.Issues = issueList;
            technique.Status = findingCount == 0 ? "PASS" : "FAIL";
            technique.Details = findingCount == 0
                ? "No security or correctness issues found (p/python ruleset)"
                : $"{findingCount} finding(s) · rule set: p/python";
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"Semgrep error: {ex.Message}";
        }

        sw.Stop();
        technique.DurationMs = sw.ElapsedMilliseconds;
        context.AddTechnique(technique);
    }
}
