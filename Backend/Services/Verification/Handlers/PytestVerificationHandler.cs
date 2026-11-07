using System.Diagnostics;
using System.Text.RegularExpressions;
using Backend.Models;
using Backend.Services.Verification.Context;

namespace Backend.Services.Verification.Handlers;

/// <summary>
/// Technique 3: Executes generated pytest unit test suites inside an isolated test sandbox.
/// </summary>
public class PytestVerificationHandler : VerificationHandlerBase
{
    protected override async Task ExecuteAsync(VerificationContext context)
    {
        var technique = new VerificationTechnique { Id = 3, Name = "Unit Test Execution (pytest)" };
        var sw = Stopwatch.StartNew();

        try
        {
            // Check if pytest is available
            var (checkExit, _, _) = await context.RunCommandAsync(
                context.PythonExecutable, "-m pytest --version", 5000);

            if (checkExit != 0)
            {
                technique.Status = "SKIP";
                technique.Details = "pytest not installed. Run: pip install pytest";
                sw.Stop();
                technique.DurationMs = sw.ElapsedMilliseconds;
                context.AddTechnique(technique);
                return;
            }

            // Run pytest in isolated sandbox
            var (exitCode, stdout, stderr) = await context.RunCommandAsync(
                context.PythonExecutable,
                $"-m pytest \"{context.TempDir}\" --tb=short -q --no-header 2>&1",
                60000);

            var output = $"{stdout}\n{stderr}".Trim();
            technique.Details = output;

            if (exitCode == 0)
            {
                technique.Status = "PASS";
                var passMatch = Regex.Match(output, @"(\d+)\s+passed");
                if (passMatch.Success)
                    technique.Details = $"{passMatch.Groups[1].Value} test(s) passed";
            }
            else if (exitCode == 5)
            {
                technique.Status = "SKIP";
                technique.Details = "No test functions found in generated code";
            }
            else
            {
                technique.Status = "FAIL";
                var failMatch = Regex.Match(output, @"(\d+)\s+failed");
                var passMatch = Regex.Match(output, @"(\d+)\s+passed");
                var failed = failMatch.Success ? failMatch.Groups[1].Value : "?";
                var passed = passMatch.Success ? passMatch.Groups[1].Value : "0";
                technique.Details = $"{failed} test(s) failed, {passed} passed";

                var errorLines = output.Split('\n')
                    .Where(l => l.Contains("FAILED") || l.Contains("ERROR") || l.Contains("assert"))
                    .Take(10)
                    .ToList();

                foreach (var rawLine in errorLines)
                {
                    string? snippetFile = null;
                    int? snippetLineNo = null;
                    var pathMatch = Regex.Match(rawLine, @"([\w/\\][\w./\\]+\.py)(?::(\d+))?");
                    if (pathMatch.Success)
                    {
                        snippetFile = pathMatch.Groups[1].Value;
                        if (pathMatch.Groups[2].Success && int.TryParse(pathMatch.Groups[2].Value, out var ln))
                            snippetLineNo = ln;
                    }

                    technique.Issues.Add(new VerificationIssue
                    {
                        File = snippetFile ?? "",
                        Line = snippetLineNo,
                        Message = rawLine.Trim(),
                        Severity = "ERROR",
                        CodeSnippet = context.GetCodeSnippet(snippetFile, snippetLineNo)
                    });
                }
            }
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"pytest execution error: {ex.Message}";
        }

        sw.Stop();
        technique.DurationMs = sw.ElapsedMilliseconds;
        context.AddTechnique(technique);
    }
}
