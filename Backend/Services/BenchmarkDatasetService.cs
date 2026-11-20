using System.IO;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Backend.Models;

namespace Backend.Services;

public sealed class BenchmarkProblemSummary
{
    public string Benchmark { get; set; } = "";
    public string ProblemId { get; set; } = "";
    public string Title { get; set; } = "";
    public string? SubTier { get; set; }
}

public sealed class BenchmarkProblemDetail
{
    public string Benchmark { get; set; } = "";
    public string ProblemId { get; set; } = "";
    public string Prompt { get; set; } = "";
    public InterfaceDefinition Interface { get; set; } = new();
    public int TestCount { get; set; }
    public string PreviewTests { get; set; } = "";
    public string LockedTestHash { get; set; } = "";
}

public interface IBenchmarkDatasetService
{
    IReadOnlyList<BenchmarkProblemSummary> ListProblems();
    BenchmarkProblemDetail? GetProblem(string benchmark, string problemId);
}

public class BenchmarkDatasetService : IBenchmarkDatasetService
{
    private readonly string _dataDir;
    private readonly ILockedTestStore _lockedTestStore;

    public BenchmarkDatasetService(ILockedTestStore lockedTestStore, string dataDir = "data")
    {
        _lockedTestStore = lockedTestStore;
        _dataDir = ResolveDataDirectory(dataDir);
    }

    private static string ResolveDataDirectory(string preferred)
    {
        if (Directory.Exists(preferred) && File.Exists(Path.Combine(preferred, "humaneval_plus.jsonl")))
            return Path.GetFullPath(preferred);

        var dir = AppContext.BaseDirectory;
        while (!string.IsNullOrEmpty(dir))
        {
            var candidate = Path.Combine(dir, "data");
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "humaneval_plus.jsonl")))
                return candidate;
            var parent = Directory.GetParent(dir);
            dir = parent?.FullName;
        }

        return Path.GetFullPath(preferred);
    }

    public IReadOnlyList<BenchmarkProblemSummary> ListProblems()
    {
        var list = new List<BenchmarkProblemSummary>();

        // HumanEval+
        var hePath = Path.Combine(_dataDir, "humaneval_plus.jsonl");
        if (File.Exists(hePath))
        {
            foreach (var line in File.ReadLines(hePath))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var node = BenchmarkSuite.Metadata(line);
                    if (node == null) continue;
                    var taskId = node["task_id"]?.GetValue<string>() ?? "";
                    var entry = node["entry_point"]?.GetValue<string>() ?? taskId;
                    list.Add(new BenchmarkProblemSummary
                    {
                        Benchmark = "humaneval_plus",
                        ProblemId = taskId,
                        Title = entry
                    });
                }
                catch { }
            }
        }

        // MBPP+
        var mbppPath = Path.Combine(_dataDir, "mbpp_plus.jsonl");
        if (File.Exists(mbppPath))
        {
            foreach (var line in File.ReadLines(mbppPath))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var node = BenchmarkSuite.Metadata(line);
                    if (node == null) continue;
                    var taskId = node["task_id"]?.GetValue<string>() ?? "";
                    var entry = node["entry_point"]?.GetValue<string>() ?? taskId;
                    list.Add(new BenchmarkProblemSummary
                    {
                        Benchmark = "mbpp_plus",
                        ProblemId = taskId,
                        Title = entry
                    });
                }
                catch { }
            }
        }

        // APPS+
        var appsPath = Path.Combine(_dataDir, "apps_plus_selected.jsonl");
        if (File.Exists(appsPath))
        {
            foreach (var line in File.ReadLines(appsPath))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var node = BenchmarkSuite.Metadata(line);
                    if (node == null) continue;
                    var id = node["problem_id"]?.GetValue<string>() ?? node["id"]?.GetValue<string>() ?? "";
                    var difficulty = node["difficulty"]?.GetValue<string>() ?? "introductory";
                    list.Add(new BenchmarkProblemSummary
                    {
                        Benchmark = "apps_plus",
                        ProblemId = id,
                        Title = $"{id} ({difficulty})",
                        SubTier = difficulty
                    });
                }
                catch { }
            }
        }

        return list;
    }

    public BenchmarkProblemDetail? GetProblem(string benchmark, string problemId)
    {
        var normBenchmark = benchmark.ToLowerInvariant().Trim();
        var normId = problemId.Trim();

        if (normBenchmark is "humaneval_plus" or "humaneval")
        {
            return LoadHumanEvalProblem(normId);
        }
        if (normBenchmark is "mbpp_plus" or "mbpp")
        {
            return LoadMbppProblem(normId);
        }
        if (normBenchmark is "apps_plus" or "apps")
        {
            return LoadAppsProblem(normId);
        }

        return null;
    }

    private BenchmarkProblemDetail? LoadHumanEvalProblem(string problemId)
    {
        var path = Path.Combine(_dataDir, "humaneval_plus.jsonl");
        if (!File.Exists(path)) return null;

        foreach (var line in File.ReadLines(path))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var node = BenchmarkSuite.Metadata(line);
            if (node == null) continue;
            var taskId = node["task_id"]?.GetValue<string>() ?? "";
            if (!taskId.Equals(problemId, StringComparison.OrdinalIgnoreCase)) continue;

            var prompt = node["prompt"]?.GetValue<string>() ?? "";
            var entryPoint = node["entry_point"]?.GetValue<string>() ?? "";
            var testCode = BenchmarkSuite.Load(_dataDir, line);
            var iface = ExtractInterfaceFromPrompt(prompt, entryPoint);
            return CreateDetail("humaneval_plus", taskId, prompt, iface, testCode);
        }

        return null;
    }

    private BenchmarkProblemDetail? LoadMbppProblem(string problemId)
    {
        var path = Path.Combine(_dataDir, "mbpp_plus.jsonl");
        if (!File.Exists(path)) return null;

        foreach (var line in File.ReadLines(path))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var node = BenchmarkSuite.Metadata(line);
            if (node == null) continue;
            var taskId = node["task_id"]?.GetValue<string>() ?? "";
            if (!taskId.Equals(problemId, StringComparison.OrdinalIgnoreCase)) continue;

            var prompt = node["prompt"]?.GetValue<string>() ?? "";
            var entryPoint = node["entry_point"]?.GetValue<string>() ?? "";
            var testCode = BenchmarkSuite.Load(_dataDir, line);
            var iface = new InterfaceDefinition
            {
                Name = entryPoint,
                Signature = $"def {entryPoint}(*args, **kwargs):",
                Docstring = prompt.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? ""
            };

            return CreateDetail("mbpp_plus", taskId, prompt, iface, testCode);
        }

        return null;
    }

    private BenchmarkProblemDetail? LoadAppsProblem(string problemId)
    {
        var path = Path.Combine(_dataDir, "apps_plus_selected.jsonl");
        if (!File.Exists(path)) return null;

        foreach (var line in File.ReadLines(path))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var node = BenchmarkSuite.Metadata(line);
            if (node == null) continue;
            var id = node["problem_id"]?.GetValue<string>() ?? node["id"]?.GetValue<string>() ?? "";
            if (!id.Equals(problemId, StringComparison.OrdinalIgnoreCase)) continue;

            var prompt = node["prompt"]?.GetValue<string>() ?? "";
            var testCode = BenchmarkSuite.Load(_dataDir, line);
            var entryPoint = BenchmarkSuite.AppsEntryPoint(node);
            var iface = entryPoint == null ? new InterfaceDefinition { IsStdinStdout = true }
                : ExtractInterfaceFromPrompt(prompt, entryPoint);
            return CreateDetail("apps_plus", id, prompt, iface, testCode);
        }

        return null;
    }

    private BenchmarkProblemDetail CreateDetail(
        string benchmark,
        string problemId,
        string prompt,
        InterfaceDefinition iface,
        string testCode)
    {
        var normalized = TestHashUtility.Normalize(testCode);
        var hash = TestHashUtility.ComputeHash(normalized);

        // Count tests
        var testCount = Regex.Matches(normalized, @"def\s+test_[a-zA-Z0-9_]+\s*\(").Count;
        if (testCount == 0) throw new InvalidDataException("Prepared benchmark suite contains no pytest functions.");

        // Automatically store in locked test store
        _lockedTestStore.Store(hash, normalized, testCount);

        // Preview: first 5 tests only
        var previewTests = ExtractFirstNTests(normalized, 5);

        return new BenchmarkProblemDetail
        {
            Benchmark = benchmark,
            ProblemId = problemId,
            Prompt = prompt,
            Interface = iface,
            TestCount = testCount,
            PreviewTests = previewTests,
            LockedTestHash = hash
        };
    }

    private static string ExtractFirstNTests(string fullTests, int maxTests)
    {
        var lines = fullTests.Split(new[] { '\r', '\n' }, StringSplitOptions.None);
        var sb = new StringBuilder();
        int testsFound = 0;

        foreach (var line in lines)
        {
            if (line.TrimStart().StartsWith("def test_"))
            {
                testsFound++;
                if (testsFound > maxTests) break;
            }
            sb.AppendLine(line.Length <= 500 ? line : line[..500] + " # ... preview truncated");
        }

        if (testsFound > maxTests)
        {
            sb.AppendLine($"# ... [Remaining tests omitted from preview. {testsFound - 1}+ tests verified in sandbox]");
        }

        return sb.ToString().TrimEnd();
    }

    private static InterfaceDefinition ExtractInterfaceFromPrompt(string prompt, string entryPoint)
    {
        var sigMatch = Regex.Match(prompt, @"def\s+" + Regex.Escape(entryPoint) + @"\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*:");
        var sig = sigMatch.Success ? sigMatch.Value : $"def {entryPoint}(*args, **kwargs):";

        var docMatch = Regex.Match(prompt, "\"\"\"([\\s\\S]*?)\"\"\"");
        var doc = docMatch.Success ? docMatch.Groups[1].Value.Trim().Split('\n').FirstOrDefault()?.Trim() ?? "" : "";

        return new InterfaceDefinition
        {
            Name = entryPoint,
            Signature = sig,
            Docstring = doc
        };
    }
}
