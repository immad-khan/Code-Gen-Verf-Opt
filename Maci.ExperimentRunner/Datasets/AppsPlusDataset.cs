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

            var inputsNode = node["inputs"] as JsonArray;
            var outputsNode = node["outputs"] as JsonArray;

            var inputsJson = inputsNode?.ToJsonString() ?? "[]";
            var outputsJson = outputsNode?.ToJsonString() ?? "[]";

            // Determine if function call or stdin/stdout
            var isFnCall = false;
            if (inputsNode != null && inputsNode.Count > 0 && inputsNode[0] is JsonArray)
            {
                isFnCall = true;
            }

            string? entryPoint = null;
            if (isFnCall)
            {
                if (!string.IsNullOrEmpty(starter) && starter.Contains("def "))
                {
                    var afterDef = starter[(starter.IndexOf("def ") + 4)..];
                    var paren = afterDef.IndexOf('(');
                    if (paren > 0) entryPoint = afterDef[..paren].Trim();
                }
                if (string.IsNullOrEmpty(entryPoint) && !string.IsNullOrEmpty(canonical) && canonical.Contains("def "))
                {
                    var afterDef = canonical[(canonical.IndexOf("def ") + 4)..];
                    var paren = afterDef.IndexOf('(');
                    if (paren > 0) entryPoint = afterDef[..paren].Trim();
                }
                if (string.IsNullOrEmpty(entryPoint))
                {
                    entryPoint = "solution";
                }
            }

            string testCode;
            if (isFnCall)
            {
                testCode = $"""
import sys
import json
import pytest
import importlib

RAW_INPUTS = json.loads({JsonSerializer.Serialize(inputsJson)})
RAW_OUTPUTS = json.loads({JsonSerializer.Serialize(outputsJson)})
CASES = list(zip(RAW_INPUTS, RAW_OUTPUTS))

@pytest.mark.parametrize("inp, expected", CASES)
def test_case(inp, expected):
    import solution
    importlib.reload(solution)
    fn = getattr(solution, "{entryPoint}", None)
    if fn is None:
        funcs = [getattr(solution, k) for k in dir(solution) if callable(getattr(solution, k)) and not k.startswith("__")]
        if funcs:
            fn = funcs[-1]
    assert fn is not None, "Could not find function in solution"
    parsed_args = [eval(arg) if isinstance(arg, str) else arg for arg in inp]
    res = fn(*parsed_args)
    target = expected[0] if isinstance(expected, list) and len(expected) == 1 else expected
    if isinstance(target, str):
        try:
            target = eval(target)
        except Exception:
            pass
    assert res == target
""";
            }
            else
            {
                testCode = $"""
import sys
import io
import json
import pytest
import importlib

RAW_INPUTS = json.loads({JsonSerializer.Serialize(inputsJson)})
RAW_OUTPUTS = json.loads({JsonSerializer.Serialize(outputsJson)})
CASES = list(zip(RAW_INPUTS, RAW_OUTPUTS))

@pytest.mark.parametrize("inp, expected", CASES)
def test_case(inp, expected):
    import solution
    importlib.reload(solution)
    fn = getattr(solution, "{entryPoint}", None)
    if fn is None:
        funcs = [getattr(solution, k) for k in dir(solution) if callable(getattr(solution, k)) and not k.startswith("__")]
        if funcs:
            fn = funcs[-1]

    text_input = inp if isinstance(inp, str) else "\n".join(map(str, inp)) + "\n"
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = io.StringIO(text_input)
    sys.stdout = io.StringIO()
    try:
        if fn is not None:
            fn()
        else:
            with open("solution.py", "r", encoding="utf-8") as f:
                code = f.read()
            exec(code, dict(__name__='__main__'))
        actual_out = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout

    expected_out = expected if isinstance(expected, str) else "\n".join(map(str, expected))
    assert actual_out.strip() == expected_out.strip()
""";
            }

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
