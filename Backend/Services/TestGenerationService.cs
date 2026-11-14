using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using Backend.Models;

namespace Backend.Services;

public interface ITestGenerationService
{
    Task<string> GenerateTestsAsync(
        string prompt,
        InterfaceDefinition iface,
        ApiSettings settings,
        CancellationToken ct = default);

    Task<ValidateTestsResponse> ValidateTestsAsync(
        string testCode,
        InterfaceDefinition iface,
        CancellationToken ct = default);

    LockTestsResponse LockTests(string testCode, int testCount);
}

public class TestGenerationService : ITestGenerationService
{
    public const string TestGenerationSystemPrompt = """
        Write pytest tests for the task below. You have NOT seen any solution.
        Use the exact function name and signature given.
        Write 5-8 tests: normal cases, edge cases (empty, zero, negative, large),
        and invalid input if the task says so.
        Expected values must come from the task text, not from guessing an implementation.
        Pytest only, no randomness, no network, no file access.
        Return only one ```python block.
        """;

    private readonly ILlmClient _llmClient;
    private readonly IDockerSandbox _sandbox;
    private readonly ILockedTestStore _lockedTestStore;
    private readonly Microsoft.Extensions.Logging.ILogger<TestGenerationService>? _logger;

    public TestGenerationService(
        ILlmClient llmClient,
        IDockerSandbox sandbox,
        ILockedTestStore lockedTestStore,
        Microsoft.Extensions.Logging.ILogger<TestGenerationService>? logger = null)
    {
        _llmClient = llmClient;
        _sandbox = sandbox;
        _lockedTestStore = lockedTestStore;
        _logger = logger;
    }

    public async Task<string> GenerateTestsAsync(
        string prompt,
        InterfaceDefinition iface,
        ApiSettings settings,
        CancellationToken ct = default)
    {
        var sb = new StringBuilder();
        sb.AppendLine("TASK:");
        sb.AppendLine(prompt);
        sb.AppendLine();
        sb.AppendLine("TARGET INTERFACE:");

        if (iface.IsStdinStdout)
        {
            sb.AppendLine("read stdin, print stdout");
            sb.AppendLine("The solution reads from standard input and prints to standard output.");
            sb.AppendLine("Tests must import from module \"solution\" or run via monkeypatch / capsys.");
        }
        else
        {
            sb.AppendLine($"Name: {iface.Name}");
            sb.AppendLine($"Signature: {iface.Signature}");
            if (!string.IsNullOrWhiteSpace(iface.Docstring))
            {
                sb.AppendLine($"Docstring: {iface.Docstring}");
            }
            sb.AppendLine($"Tests must import the function from module \"solution\" (e.g. from solution import {iface.Name}).");
        }

        var fullPrompt = sb.ToString();
        var rawResponse = await _llmClient.CompleteTextAsync(fullPrompt, TestGenerationSystemPrompt, settings, 0.1, ct);
        var files = FencedCodeBlockParser.ParseBlocks(rawResponse);

        if (files.Count == 0)
        {
            _logger?.LogWarning("[TestGenerationService] No code block found in test response. Retrying once...");
            var retryPrompt = fullPrompt + "\n\nCRITICAL: Return the complete pytest tests enclosed in a ```python block. Do not return plain text without code fences.";
            rawResponse = await _llmClient.CompleteTextAsync(retryPrompt, TestGenerationSystemPrompt, settings, 0.1, ct);
            files = FencedCodeBlockParser.ParseBlocks(rawResponse);
        }

        if (files.Count == 0)
        {
            throw new CodeGenerationException("No test code block found in LLM response after retry.", rawResponse);
        }

        return files[0].Content;
    }

    public async Task<ValidateTestsResponse> ValidateTestsAsync(
        string testCode,
        InterfaceDefinition iface,
        CancellationToken ct = default)
    {
        var normalized = TestHashUtility.Normalize(testCode);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return new ValidateTestsResponse
            {
                Valid = false,
                Error = "Test code cannot be empty."
            };
        }

        var tempDir = Path.Combine(Path.GetTempPath(), "veriflow_val_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);

        try
        {
            // Build stub solution.py
            string stubCode;
            if (iface.IsStdinStdout)
            {
                stubCode = """
                    import sys

                    def main():
                        raise NotImplementedError("Stub implementation for stdin/stdout")

                    if __name__ == "__main__":
                        main()
                    """;
            }
            else
            {
                var funcName = string.IsNullOrWhiteSpace(iface.Name) ? "solution" : iface.Name;
                stubCode = $"""
                    def {funcName}(*args, **kwargs):
                        raise NotImplementedError("Stub implementation for test collection")
                    """;
            }

            var solutionPath = Path.Combine(tempDir, "solution.py");
            var testPath = Path.Combine(tempDir, "test_solution.py");

            await File.WriteAllTextAsync(solutionPath, stubCode, Encoding.UTF8, ct);
            await File.WriteAllTextAsync(testPath, normalized, Encoding.UTF8, ct);

            // 1. ast.parse check in Docker
            var astRes = await _sandbox.RunCommandAsync(
                tempDir,
                "python3 -B -c \"import ast; ast.parse(open('test_solution.py').read()); print('AST_OK')\"",
                timeoutSeconds: 15,
                ct: ct);

            if (!astRes.Success || !astRes.Stdout.Contains("AST_OK"))
            {
                return new ValidateTestsResponse
                {
                    Valid = false,
                    Error = string.IsNullOrWhiteSpace(astRes.Stderr) ? astRes.Stdout : astRes.Stderr
                };
            }

            // 2. pytest --collect-only check in Docker
            var collectRes = await _sandbox.RunCommandAsync(
                tempDir,
                "python3 -B -m pytest --collect-only -q test_solution.py",
                timeoutSeconds: 15,
                ct: ct);

            if (!collectRes.Success)
            {
                return new ValidateTestsResponse
                {
                    Valid = false,
                    Error = "Pytest collection failed:\n" + (string.IsNullOrWhiteSpace(collectRes.Stderr) ? collectRes.Stdout : collectRes.Stderr)
                };
            }

            // Extract test count (handles both "collected 2 items" and "2 items collected")
            var countMatch = Regex.Match(collectRes.Stdout, @"(?:collected\s+(\d+)\s+(?:tests?|items?)|(\d+)\s+(?:tests?|items?)\s+collected)", RegexOptions.IgnoreCase);
            var testCount = 0;
            if (countMatch.Success)
            {
                var numStr = !string.IsNullOrEmpty(countMatch.Groups[1].Value) ? countMatch.Groups[1].Value : countMatch.Groups[2].Value;
                int.TryParse(numStr, out testCount);
            }
            if (testCount == 0)
            {
                // Fallback: match pytest test item identifiers (e.g. ::test_func) or def test_
                var nodeMatches = Regex.Matches(collectRes.Stdout, @"::(test_[a-zA-Z0-9_]+)");
                testCount = nodeMatches.Count > 0
                    ? nodeMatches.Count
                    : Regex.Matches(collectRes.Stdout, @"^\s*def\s+(test_[a-zA-Z0-9_]+)", RegexOptions.Multiline).Count;
            }

            if (testCount == 0)
            {
                return new ValidateTestsResponse
                {
                    Valid = false,
                    Error = "No test functions (def test_...) were collected by pytest."
                };
            }

            // 3. Run against stub: each test should fail with NotImplementedError
            var runRes = await _sandbox.RunCommandAsync(
                tempDir,
                "python3 -B -m pytest -v --tb=line test_solution.py",
                timeoutSeconds: 20,
                ct: ct);

            var warnings = new List<string>();
            var lines = runRes.Stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var line in lines)
            {
                if (line.Contains("PASSED", StringComparison.OrdinalIgnoreCase) && line.Contains("test_"))
                {
                    var testNameMatch = Regex.Match(line, @"::(test_[a-zA-Z0-9_]+)");
                    if (!testNameMatch.Success)
                    {
                        testNameMatch = Regex.Match(line, @"\b(test_[a-zA-Z0-9_]+)\b(?!\.py)");
                    }
                    var testName = testNameMatch.Success ? testNameMatch.Groups[1].Value : line.Trim();
                    warnings.Add($"Warning: Test '{testName}' passed on stub without triggering NotImplementedError.");
                }
            }

            return new ValidateTestsResponse
            {
                Valid = true,
                TestCount = testCount,
                Warnings = warnings
            };
        }
        finally
        {
            try { Directory.Delete(tempDir, recursive: true); } catch { }
        }
    }

    public LockTestsResponse LockTests(string testCode, int testCount)
    {
        var normalized = TestHashUtility.Normalize(testCode);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Cannot lock an empty test suite.");
        }

        var hash = TestHashUtility.ComputeHash(normalized);
        _lockedTestStore.Store(hash, normalized, testCount);

        return new LockTestsResponse
        {
            Hash = hash,
            TestCount = testCount,
            TestCode = normalized
        };
    }
}
