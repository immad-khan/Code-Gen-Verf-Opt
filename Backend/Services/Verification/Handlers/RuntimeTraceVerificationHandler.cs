using System.Diagnostics;
using Backend.Models;
using Backend.Services.Verification.Context;

namespace Backend.Services.Verification.Handlers;

/// <summary>
/// Technique 4: Inspects runtime stack traces from execution to isolate real crashes from assertions.
/// </summary>
public class RuntimeTraceVerificationHandler : VerificationHandlerBase
{
    private static readonly string[] RuntimeErrors =
    {
        "ImportError", "ModuleNotFoundError", "TypeError", "NameError",
        "AttributeError", "ValueError", "KeyError", "IndexError", "RuntimeError",
        "FileNotFoundError", "ZeroDivisionError", "RecursionError"
    };

    protected override Task ExecuteAsync(VerificationContext context)
    {
        var technique = new VerificationTechnique { Id = 4, Name = "Runtime Error Detection" };
        var sw = Stopwatch.StartNew();

        var pytestResult = context.GetTechnique(3);

        if (pytestResult != null && !string.IsNullOrEmpty(pytestResult.Details))
        {
            var lines = pytestResult.Details.Split('\n');
            foreach (var line in lines)
            {
                foreach (var errType in RuntimeErrors)
                {
                    if (line.Contains(errType))
                    {
                        technique.Issues.Add(new VerificationIssue
                        {
                            Message = line.Trim(),
                            Severity = "ERROR"
                        });
                        break;
                    }
                }
            }
        }

        technique.Status = technique.Issues.Count == 0 ? "PASS" : "FAIL";
        technique.Details = technique.Issues.Count == 0
            ? "No runtime errors detected during test execution"
            : $"{technique.Issues.Count} runtime error(s) detected";

        if (pytestResult == null || pytestResult.Status == "SKIP")
        {
            technique.Status = "SKIP";
            technique.Details = "Skipped — pytest was not available";
        }

        sw.Stop();
        technique.DurationMs = sw.ElapsedMilliseconds;
        context.AddTechnique(technique);

        return Task.CompletedTask;
    }
}
