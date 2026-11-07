using System.Diagnostics;
using System.Text.Json;
using Backend.Models;
using Backend.Services.Verification.Context;
using Backend.Services.Verification.Scripts;

namespace Backend.Services.Verification.Handlers;

/// <summary>
/// Technique 6: Cyclomatic complexity & Maintainability Index via Radon.
/// </summary>
public class RadonVerificationHandler : VerificationHandlerBase
{
    protected override async Task ExecuteAsync(VerificationContext context)
    {
        var technique = new VerificationTechnique { Id = 6, Name = "Radon Complexity & Maintainability" };
        var sw = Stopwatch.StartNew();

        try
        {
            var (checkExit, checkOut, _) = await context.RunCommandAsync(
                context.PythonExecutable, "-c \"import radon; print('ok')\"", 5000);

            if (checkExit != 0 || !checkOut.Contains("ok"))
            {
                technique.Status = "SKIP";
                technique.Details = "radon not installed. Run: pip install radon";
                sw.Stop();
                technique.DurationMs = sw.ElapsedMilliseconds;
                context.AddTechnique(technique);
                return;
            }

            var ccScript = Path.Combine(context.TempDir, "_maci_radon_cc.py");
            await File.WriteAllTextAsync(ccScript, VerificationPythonScripts.RadonCcScript);
            var (_, ccOut, _) = await context.RunCommandAsync(
                context.PythonExecutable, $"\"{ccScript}\" \"{context.TempDir}\"", 20000);

            var miScript = Path.Combine(context.TempDir, "_maci_radon_mi.py");
            await File.WriteAllTextAsync(miScript, VerificationPythonScripts.RadonMiScript);
            var (_, miOut, _) = await context.RunCommandAsync(
                context.PythonExecutable, $"\"{miScript}\" \"{context.TempDir}\"", 20000);

            var complexCount = 0;
            var issueList = new List<VerificationIssue>();
            var miValues = new List<double>();

            if (!string.IsNullOrWhiteSpace(ccOut))
            {
                try
                {
                    var ccDoc = JsonDocument.Parse(ccOut);
                    if (ccDoc.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var block in ccDoc.RootElement.EnumerateArray())
                        {
                            if (!block.TryGetProperty("rank", out var rankProp)) continue;
                            var rank = rankProp.GetString() ?? "A";
                            if (rank is "C" or "D" or "E" or "F")
                            {
                                complexCount++;
                                var fname = block.TryGetProperty("file", out var fp) ? fp.GetString() : "";
                                var name = block.TryGetProperty("name", out var np) ? np.GetString() : "?";
                                var lineno = block.TryGetProperty("lineno", out var lp) ? (int?)lp.GetInt32() : null;
                                var cc = block.TryGetProperty("complexity", out var cp) ? cp.GetInt32() : 0;
                                var btype = block.TryGetProperty("type", out var tp) ? tp.GetString() : "F";
                                var typeLabel = btype == "C" ? "class" : btype == "M" ? "method" : "function";
                                issueList.Add(new VerificationIssue
                                {
                                    File = fname ?? "",
                                    Line = lineno,
                                    Message = $"{typeLabel} '{name}' has cyclomatic complexity {cc} (grade {rank}) — consider refactoring.",
                                    Severity = rank is "E" or "F" ? "ERROR" : "WARNING",
                                    CodeSnippet = context.GetCodeSnippet(fname, lineno)
                                });
                            }
                        }
                    }
                }
                catch { }
            }

            if (!string.IsNullOrWhiteSpace(miOut))
            {
                try
                {
                    var miDoc = JsonDocument.Parse(miOut);
                    if (miDoc.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var file in miDoc.RootElement.EnumerateArray())
                        {
                            if (file.TryGetProperty("mi", out var miVal) &&
                                miVal.ValueKind != JsonValueKind.Null)
                                miValues.Add(miVal.GetDouble());
                        }
                    }
                }
                catch { }
            }

            technique.Issues = issueList;

            var avgMi = miValues.Count > 0 ? Math.Round(miValues.Average(), 1) : -1;
            var miSummary = avgMi >= 0
                ? $"Avg MI {avgMi}/100 · " + (avgMi >= 80 ? "Excellent" : avgMi >= 65 ? "Good" : avgMi >= 20 ? "Moderate" : "Low")
                : "MI unavailable";

            technique.Details = JsonSerializer.Serialize(new
            {
                avgMi,
                complexFunctions = complexCount,
                summary = $"{(complexCount == 0 ? "No" : complexCount.ToString())} complex function(s) (grade ≥ C). {miSummary}."
            });

            technique.Status = complexCount == 0 ? "PASS" : "FAIL";
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"Radon check error: {ex.Message}";
        }

        sw.Stop();
        technique.DurationMs = sw.ElapsedMilliseconds;
        context.AddTechnique(technique);
    }
}
