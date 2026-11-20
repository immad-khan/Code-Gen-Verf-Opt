using Backend.Services;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Maci.ExperimentRunner.Datasets;

public sealed class AppsPlusDataset : IBenchmarkDataset
{
    public string BenchmarkName => "apps_plus";

    public IReadOnlyList<BenchmarkProblem> LoadProblems(string dataDirectory, IEnumerable<string>? subTiers = null)
    {
        var filePath = Path.Combine(dataDirectory, "apps_plus_selected.jsonl");
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"APPS+ dataset file not found at {filePath}");

        var tierFilter = subTiers != null ? new HashSet<string>(subTiers, StringComparer.OrdinalIgnoreCase) : null;
        var problems = new List<BenchmarkProblem>();

        foreach (var line in File.ReadLines(filePath))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var node = JsonNode.Parse(line);
            if (node == null) continue;

            var problemId = node["problem_id"]?.GetValue<string>() ?? "";
            var difficulty = node["difficulty"]?.GetValue<string>() ?? "";
            if (tierFilter != null && !tierFilter.Contains(difficulty))
                continue;

            var prompt = node["prompt"]?.GetValue<string>() ?? "";
            var canonical = node["canonical_solution"]?.GetValue<string>() ?? "";
            var starter = node["starter_code"]?.GetValue<string>() ?? "";

            var entryPoint = BenchmarkSuite.AppsEntryPoint(node);
            var testCode = BenchmarkSuite.Load(dataDirectory, line);

            problems.Add(new BenchmarkProblem
            {
                Benchmark = BenchmarkName,
                ProblemId = problemId,
                SubTier = difficulty,
                Prompt = prompt,
                EntryPoint = entryPoint,
                CanonicalSolution = canonical,
                TestCode = testCode,
                StarterCode = starter
            });
        }

        return problems;
    }
}
