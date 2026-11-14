using System.Text.Json;
using System.Text.Json.Nodes;

namespace Maci.ExperimentRunner.Datasets;

public sealed class HumanEvalPlusDataset : IBenchmarkDataset
{
    public string BenchmarkName => "humaneval_plus";

    public IReadOnlyList<BenchmarkProblem> LoadProblems(string dataDirectory, IEnumerable<string>? subTiers = null)
    {
        var filePath = Path.Combine(dataDirectory, "humaneval_plus.jsonl");
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"HumanEval+ dataset file not found at {filePath}");

        var problems = new List<BenchmarkProblem>();
        foreach (var rawLine in File.ReadLines(filePath))
        {
            if (string.IsNullOrWhiteSpace(rawLine)) continue;
            var line = rawLine.Replace("-Infinity", "null").Replace("Infinity", "null").Replace("NaN", "null");
            var node = JsonNode.Parse(line);
            if (node == null) continue;

            var taskId = node["task_id"]?.GetValue<string>() ?? "";
            var prompt = node["prompt"]?.GetValue<string>() ?? "";
            var entryPoint = node["entry_point"]?.GetValue<string>() ?? "";
            var canonical = node["canonical_solution"]?.GetValue<string>() ?? "";
            var test = node["test"]?.GetValue<string>() ?? "";

            // Compose pytest file content:
            // imports entry_point from solution, defines check(candidate), runs check(entry_point)
            var testCode = $"""
import sys

from solution import {entryPoint}

{test}

def test_{entryPoint}():
    check({entryPoint})
""";

            problems.Add(new BenchmarkProblem
            {
                Benchmark = BenchmarkName,
                ProblemId = taskId,
                SubTier = null,
                Prompt = prompt,
                EntryPoint = entryPoint,
                CanonicalSolution = prompt + canonical,
                TestCode = testCode
            });
        }

        return problems;
    }
}
