using Maci.ExperimentRunner.Classification;
using Maci.ExperimentRunner.Datasets;

namespace Maci.ExperimentRunner.Execution;

public static class PromptBuilder
{
    public static string BuildGenerationPrompt(BenchmarkProblem problem)
    {
        return $"""
Please provide a self-contained Python script that solves the following problem in a markdown code block:
```python
{problem.Prompt.Trim()}
```
""";
    }

    public static string BuildRepairPrompt(
        string failingCode,
        BugDiagnosis diagnosis,
        string mode)
    {
        var categoryText = mode.Equals("dou_no_bt", StringComparison.OrdinalIgnoreCase)
            ? ""
            : $"The bug is categorized as: Type {diagnosis.PrimaryType}. {diagnosis.SubTypeName}\n";

        return $"""
I have the following Python code that contains a bug:
```python
{failingCode.Trim()}
```
{categoryText}Compiler feedback: {diagnosis.CompilerFeedback.Trim()}

Please analyze the root causes of the bug, identify the bug locations, and provide the corrected Python code in a markdown code block.
""";
    }
}
