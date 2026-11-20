using Backend.Models;
using Backend.Services.Repair;
using Backend.Services.Taxonomy;
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
        string mode,
        string? originalPrompt = null,
        int round = 1,
        ImprovedRepairSources? sources = null)
    {
        if (mode.Equals("improved", StringComparison.OrdinalIgnoreCase))
        {
            // Req 4: [visible-test-detail] OFF by default
            var src = sources ?? new ImprovedRepairSources { VisibleTestDetail = false };
            var files = new List<GeneratedCodeFile>
            {
                new() { Name = "solution.py", Path = "solution.py", Content = failingCode }
            };

            var verif = new VerificationResult
            {
                GatePassed = false,
                Complete = true,
                CorrectnessFindings = new List<MappedFinding>
                {
                    new()
                    {
                        Technique = diagnosis.PrimaryType.Contains("Functional") ? "tests" : "runtime",
                        Category = diagnosis.PrimaryType switch
                        {
                            "A" => "A.1",
                            "B" => "B.1",
                            _ => "C.1"
                        },
                        PrimaryType = diagnosis.PrimaryType,
                        CategoryName = diagnosis.SubTypeName,
                        Message = diagnosis.CompilerFeedback,
                        Evidence = src.VisibleTestDetail ? diagnosis.CompilerFeedback : "",
                        Location = new FindingLocation { File = "solution.py", Line = null }
                    }
                }
            };

            var promptBuilder = new RepairPromptBuilder(TaxonomyProvider.Default);
            return promptBuilder.BuildImproved(
                originalPrompt ?? "",
                files,
                verif,
                iteration: round,
                budget: 2,
                sources: src
            );
        }

        var taxonomy = TaxonomyProvider.Default;
        return taxonomy.Renderer.Render("dou_critique", new Dictionary<string, string>
        {
            ["prompt"] = originalPrompt ?? throw new ArgumentNullException(nameof(originalPrompt)),
            ["solution"] = failingCode,
            ["error log"] = diagnosis.CompilerFeedback,
            ["checklist"] = mode == "dou_no_bt" ? "" : taxonomy.Definition.ChecklistText()
        });
    }
}
