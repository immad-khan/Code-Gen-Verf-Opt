using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Maci.ExperimentRunner.Datasets;

public sealed class MbppPlusDataset : IBenchmarkDataset
{
    public string BenchmarkName => "mbpp_plus";

    public IReadOnlyList<BenchmarkProblem> LoadProblems(string dataDirectory, IEnumerable<string>? subTiers = null)
    {
        var filePath = Path.Combine(dataDirectory, "mbpp_plus.jsonl");
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"MBPP+ dataset file not found at {filePath}");

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
            var assertion = node["assertion"]?.GetValue<string>() ?? "";

            // Indent assertions for pytest function
            var sb = new StringBuilder();
            using var reader = new StringReader(assertion);
            string? assertionLine;
            while ((assertionLine = reader.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(assertionLine)) continue;
                sb.AppendLine("    " + assertionLine.Trim());
            }

            var testCode = $"""
import sys

from solution import {entryPoint}

def test_{entryPoint}():
{sb}
""";

            problems.Add(new BenchmarkProblem
            {
                Benchmark = BenchmarkName,
                ProblemId = taskId,
                SubTier = null,
                Prompt = prompt,
                EntryPoint = entryPoint,
                CanonicalSolution = canonical,
                TestCode = testCode
            });
        }

        return problems;
    }
}
