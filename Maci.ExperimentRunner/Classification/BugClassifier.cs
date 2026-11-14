using System.Text.RegularExpressions;
using Maci.ExperimentRunner.Sandbox;

namespace Maci.ExperimentRunner.Classification;

public sealed record BugDiagnosis(
    string PrimaryType,       // "A", "B", "C"
    string SubType,           // "A.1", "A.2", "A.3", "B.1", "B.2", "B.3", "B.4", "B.5", "C.1", "C.2", "C.3", "C.4"
    string SubTypeName,       // e.g. "Definition missing"
    string CompilerFeedback,  // Exact paper feedback string
    string RawOutput          // Full compiler / pytest output
);

public static class BugClassifier
{
    private static readonly HashSet<string> KnownLibraries = new(StringComparer.Ordinal)
    {
        "math", "heapq", "sys", "os", "collections", "itertools", "re",
        "bisect", "functools", "copy", "json", "random", "string", "datetime",
        "typing", "queue", "operator", "hashlib", "time", "fractions", "decimal",
        "scipy", "numpy"
    };

    public static BugDiagnosis Classify(SandboxExecutionResult result)
    {
        var combinedOutput = (result.Stdout + "\n" + result.Stderr).Trim();

        // 1. Check for Timeout
        if (result.TimedOut || combinedOutput.Contains("TimeoutExpired") || combinedOutput.Contains("time limit"))
        {
            return new BugDiagnosis(
                PrimaryType: "B",
                SubType: "B.5",
                SubTypeName: "Execution timeout",
                CompilerFeedback: "The execution of the code has exceeded the time limit",
                RawOutput: combinedOutput
            );
        }

        // 2. Check for SyntaxError / IndentationError (Type A)
        if (combinedOutput.Contains("IndentationError") || combinedOutput.Contains("TabError"))
        {
            return new BugDiagnosis(
                PrimaryType: "A",
                SubType: "A.2",
                SubTypeName: "Indentation or formatting error",
                CompilerFeedback: ExtractInterpreterReport(combinedOutput),
                RawOutput: combinedOutput
            );
        }

        if (combinedOutput.Contains("SyntaxError"))
        {
            return new BugDiagnosis(
                PrimaryType: "A",
                SubType: "A.1",
                SubTypeName: "Incomplete syntax structure",
                CompilerFeedback: ExtractInterpreterReport(combinedOutput),
                RawOutput: combinedOutput
            );
        }

        // 3. Check for NameError on standard libraries (A.3) vs user definitions (B.2)
        var nameMatch = Regex.Match(combinedOutput, @"NameError:\s+name\s+'([^']+)'\s+is not defined");
        if (nameMatch.Success)
        {
            var missingName = nameMatch.Groups[1].Value;
            if (KnownLibraries.Contains(missingName))
            {
                return new BugDiagnosis(
                    PrimaryType: "A",
                    SubType: "A.3",
                    SubTypeName: "Missing library import",
                    CompilerFeedback: ExtractInterpreterReport(combinedOutput),
                    RawOutput: combinedOutput
                );
            }

            return new BugDiagnosis(
                PrimaryType: "B",
                SubType: "B.2",
                SubTypeName: "Definition missing",
                CompilerFeedback: ExtractInterpreterReport(combinedOutput),
                RawOutput: combinedOutput
            );
        }

        // 4. Check for Argument mismatch (B.4)
        if (Regex.IsMatch(combinedOutput, @"TypeError:\s+.*(?:takes\s+\d+\s+positional argument|missing\s+\d+\s+required positional argument)"))
        {
            return new BugDiagnosis(
                PrimaryType: "B",
                SubType: "B.4",
                SubTypeName: "Argument mismatch",
                CompilerFeedback: ExtractInterpreterReport(combinedOutput),
                RawOutput: combinedOutput
            );
        }

        // 5. Check for Boundary error (B.3)
        if (combinedOutput.Contains("IndexError") ||
            combinedOutput.Contains("KeyError") ||
            combinedOutput.Contains("ZeroDivisionError") ||
            combinedOutput.Contains("RecursionError") ||
            combinedOutput.Contains("OverflowError"))
        {
            return new BugDiagnosis(
                PrimaryType: "B",
                SubType: "B.3",
                SubTypeName: "Boundary error",
                CompilerFeedback: ExtractInterpreterReport(combinedOutput),
                RawOutput: combinedOutput
            );
        }

        // 6. Check for API usage error (B.1)
        if (combinedOutput.Contains("AttributeError") ||
            combinedOutput.Contains("TypeError") ||
            combinedOutput.Contains("ValueError") ||
            combinedOutput.Contains("ModuleNotFoundError") ||
            combinedOutput.Contains("ImportError"))
        {
            return new BugDiagnosis(
                PrimaryType: "B",
                SubType: "B.1",
                SubTypeName: "API usage error",
                CompilerFeedback: ExtractInterpreterReport(combinedOutput),
                RawOutput: combinedOutput
            );
        }

        // 7. Check for AssertionError / Functional error (Type C)
        // Paper rule: Type C compiler feedback MUST be exactly "The functionality of code is incorrect"
        if (combinedOutput.Contains("AssertionError") || combinedOutput.Contains("assert ") || combinedOutput.Contains("FAILED"))
        {
            return new BugDiagnosis(
                PrimaryType: "C",
                SubType: "C.1", // Default C sub-type; can be refined with LLM classifier
                SubTypeName: "Misunderstanding and logic error",
                CompilerFeedback: "The functionality of code is incorrect",
                RawOutput: combinedOutput
            );
        }

        // Fallback for uncaught runtime exceptions
        if (combinedOutput.Contains("Traceback (most recent call last):"))
        {
            return new BugDiagnosis(
                PrimaryType: "B",
                SubType: "B.1",
                SubTypeName: "API usage error",
                CompilerFeedback: ExtractInterpreterReport(combinedOutput),
                RawOutput: combinedOutput
            );
        }

        // Default to Type C
        return new BugDiagnosis(
            PrimaryType: "C",
            SubType: "C.1",
            SubTypeName: "Misunderstanding and logic error",
            CompilerFeedback: "The functionality of code is incorrect",
            RawOutput: combinedOutput
        );
    }

    private static string ExtractInterpreterReport(string output)
    {
        // Extracts the traceback or syntax error section from pytest output
        var lines = output.Split('\n').Select(l => l.TrimEnd('\r')).ToList();
        var reportLines = new List<string>();
        var capture = false;

        foreach (var line in lines)
        {
            if (line.Contains("Traceback (most recent call last):") ||
                line.Contains("SyntaxError:") ||
                line.Contains("IndentationError:"))
            {
                capture = true;
            }

            if (capture)
            {
                reportLines.Add(line);
                if (line.StartsWith("E   ") && !line.StartsWith("E   assert"))
                {
                    // Pytest error line
                    reportLines.Add(line[4..]);
                }
            }
        }

        if (reportLines.Count > 0)
        {
            return string.Join("\n", reportLines.Distinct()).Trim();
        }

        return output.Length > 500 ? output[..500] : output;
    }
}
