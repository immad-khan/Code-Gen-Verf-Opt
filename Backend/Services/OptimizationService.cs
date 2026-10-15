using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Backend.Models;

namespace Backend.Services;

public class OptimizationService
{
    private readonly VerificationService _verificationService;
    private readonly AiService _aiService;
    private readonly ILogger<OptimizationService> _logger;

    // Dou et al. Taxonomy Definitions (Section 4.1)
    private static readonly Dictionary<string, (string Primary, string Secondary, string RepairHint)> TaxonomyDefs = new()
    {
        ["A.1"] = ("Type A: Syntax Bug", "A.1 Incomplete syntax structure",
            "Syntax error detected. Unmatched delimiters (parentheses, brackets, braces) or unclosed quotes/blocks. Complete all open code structures and output valid Python syntax."),
        ["A.2"] = ("Type A: Syntax Bug", "A.2 Incorrect indentation",
            "Indentation error detected. Check block nesting (if/for/def/class) and ensure consistent 4-space indentation across all lines."),
        ["A.3"] = ("Type A: Syntax Bug", "A.3 Library import error",
            "Module import failure or invalid import scope. Move valid imports to the top level of the file and eliminate non-existent dependencies."),

        ["B.1"] = ("Type B: Runtime Bug", "B.1 API misuse",
            "AttributeError or invalid method on object. Verify types before calling methods (e.g. dict vs list methods) and replace hallucinated APIs with standard library calls."),
        ["B.2"] = ("Type B: Runtime Bug", "B.2 Definition missing",
            "NameError or UnboundLocalError: a variable, parameter, or helper function is referenced before assignment or misspelled. Check scoping and ensure initialization before use."),
        ["B.3"] = ("Type B: Runtime Bug", "B.3 Incorrect boundary condition check",
            "Boundary execution crash (IndexError, KeyError, ValueError, ZeroDivisionError). Add explicit guards for empty sequences, zero denominators, and index ranges before access."),
        ["B.4"] = ("Type B: Runtime Bug", "B.4 Incorrect argument",
            "TypeError in function invocation: argument count, positional/keyword mismatch, or parameter type error. Adjust the function call arguments to match definition signature."),
        ["B.5"] = ("Type B: Runtime Bug", "B.5 Minors",
            "Runtime exception or execution timeout (RecursionError, unhandled system error, or infinite loop). Add base case checks or loop exit conditions."),

        ["C.1"] = ("Type C: Functional Bug", "C.1 Misunderstanding and logic error",
            "Functional assertion failure: algorithm misinterprets the core problem specification. Re-read task constraints, trace expected vs actual values, and fix the core algorithm logic."),
        ["C.2"] = ("Type C: Functional Bug", "C.2 Hallucination",
            "Code satisfies syntax but strays from problem goals or generates irrelevant logic. Re-align the algorithm strictly with the problem prompt requirements."),
        ["C.3"] = ("Type C: Functional Bug", "C.3 Input/output format error",
            "Return value or data structure mismatch (e.g. returning float instead of int, list instead of tuple, or wrong string formatting). Explicitly cast the return value to expected format."),
        ["C.4"] = ("Type C: Functional Bug", "C.4 Minors",
            "Minor algorithmic flaw, off-by-one boundary, or high complexity. Adjust boundary constants (e.g. < vs <=) and optimize complex code blocks.")
    };

    public OptimizationService(
        VerificationService verificationService,
        AiService aiService,
        ILogger<OptimizationService> logger)
    {
        _verificationService = verificationService;
        _aiService = aiService;
        _logger = logger;
    }

    /// <summary>
    /// Executes the full Dou et al. 2-iteration optimization pipeline:
    /// Initial Diagnosis -> Iteration 1 (Critique + LLM Repair + Re-verify) ->
    /// Iteration 2 (Episodic Feedback + LLM Repair + Re-verify) -> Bug Evolution & Summary
    /// </summary>
    public async Task<OptimizationResponse> OptimizeAsync(OptimizationRequest request)
    {
        var totalSw = Stopwatch.StartNew();
        var response = new OptimizationResponse();
        var maxIterations = Math.Min(Math.Max(request.MaxIterations, 1), 3); // Default 2, clamp 1-3

        // Step 1: Initial Verification & Diagnosis
        var currentFiles = request.Files.Select(f => new GeneratedCodeFile
        {
            Name = f.Name,
            Path = f.Path,
            Language = f.Language,
            Category = f.Category,
            Description = f.Description,
            Content = f.Content
        }).ToList();

        var initialVerification = request.VerificationResult ?? await _verificationService.VerifyAsync(currentFiles);
        var initialDiagnosis = ClassifyVerification(initialVerification, currentFiles);
        response.InitialDiagnosis = initialDiagnosis;

        var currentDiagnosis = initialDiagnosis;
        var previousVerification = initialVerification;
        var episodicHistory = new List<string>();

        // If initially clean, return early with 100% pass
        if (initialDiagnosis.TotalBugs == 0 && initialVerification.OverallVerdict == "PASS")
        {
            response.FinalDiagnosis = initialDiagnosis;
            response.Summary = BuildSummary(initialDiagnosis, initialDiagnosis, 0, new List<OptimizationIteration>(), initialVerification, initialVerification);
            response.TotalDurationMs = totalSw.ElapsedMilliseconds;
            return response;
        }

        // Step 2: Iterative Repair Loop (2 Iterations)
        for (int iter = 1; iter <= maxIterations; iter++)
        {
            // If all bugs resolved in previous iteration, break early
            if (iter > 1 && currentDiagnosis.TotalBugs == 0 && previousVerification?.OverallVerdict == "PASS")
            {
                break;
            }

            var iterSw = Stopwatch.StartNew();
            var iterationData = new OptimizationIteration
            {
                IterationNumber = iter,
                Diagnosis = currentDiagnosis
            };

            // Formulate critique & repair prompt
            var critiquePrompt = BuildCritiquePrompt(
                request.OriginalPrompt,
                currentFiles,
                currentDiagnosis,
                previousVerification,
                iter,
                maxIterations,
                episodicHistory
            );
            iterationData.CritiquePrompt = critiquePrompt;

            // Call LLM for repair
            List<GeneratedCodeFile> repairedFiles;
            string rawLlmResponse = "";
            try
            {
                var repairResult = await _aiService.RepairCodeAsync(critiquePrompt, request.ApiSettings);
                repairedFiles = repairResult.Files;
                rawLlmResponse = repairResult.RawResponse;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error calling LLM for repair iteration {Iteration}", iter);
                rawLlmResponse = $"Repair call error: {ex.Message}";
                repairedFiles = new List<GeneratedCodeFile>();
            }

            iterationData.LlmCritiqueResponse = rawLlmResponse;

            // If files were successfully repaired, update currentFiles
            if (repairedFiles.Count > 0)
            {
                currentFiles = repairedFiles;
            }
            iterationData.RepairedFiles = currentFiles.Select(f => new GeneratedCodeFile
            {
                Name = f.Name,
                Path = f.Path,
                Language = f.Language,
                Category = f.Category,
                Description = f.Description,
                Content = f.Content
            }).ToList();

            // Re-verify repaired code
            var reVerification = await _verificationService.VerifyAsync(currentFiles);
            iterationData.ReVerification = reVerification;

            // Re-diagnose
            var nextDiagnosis = ClassifyVerification(reVerification, currentFiles);
            iterationData.BugsRemainingAfter = nextDiagnosis.TotalBugs;
            iterationData.BugsFixedThisIteration = Math.Max(0, currentDiagnosis.TotalBugs - nextDiagnosis.TotalBugs);
            iterationData.DurationMs = iterSw.ElapsedMilliseconds;

            response.Iterations.Add(iterationData);

            // Add episodic memory for next iteration if needed
            if (nextDiagnosis.TotalBugs > 0)
            {
                var topBug = nextDiagnosis.Bugs.FirstOrDefault();
                var bugDesc = topBug != null ? $"{topBug.TaxonomyId} ({topBug.Message})" : "unresolved errors";
                episodicHistory.Add($"Iteration {iter}: Repair attempt still had {nextDiagnosis.TotalBugs} bug(s) remaining, notably {bugDesc}. A more targeted fix strategy is required.");
            }

            currentDiagnosis = nextDiagnosis;
            previousVerification = reVerification;
        }

        // Step 3: Final Diagnosis and Summary
        response.FinalDiagnosis = currentDiagnosis;
        response.Summary = BuildSummary(
            initialDiagnosis,
            currentDiagnosis,
            response.Iterations.Count,
            response.Iterations,
            initialVerification,
            previousVerification
        );
        response.TotalDurationMs = totalSw.ElapsedMilliseconds;

        return response;
    }

    /// <summary>
    /// Classifies verification technique issues into Dou et al.'s taxonomy (A.1–C.4).
    /// </summary>
    public BugTaxonomyReport ClassifyVerification(VerificationResponse verification, List<GeneratedCodeFile> files)
    {
        var report = new BugTaxonomyReport();
        var classifiedBugs = new List<BugClassification>();

        foreach (var technique in verification.Techniques)
        {
            foreach (var issue in technique.Issues)
            {
                var bug = ClassifySingleIssue(technique, issue, files);
                if (bug != null)
                {
                    classifiedBugs.Add(bug);
                }
            }

            // Also check technique details if issues list is empty but technique failed
            if (technique.Status == "FAIL" && technique.Issues.Count == 0 && !string.IsNullOrWhiteSpace(technique.Details))
            {
                var fallbackBug = ClassifyFromDetails(technique);
                if (fallbackBug != null)
                {
                    classifiedBugs.Add(fallbackBug);
                }
            }
        }

        // Deduplicate similar bugs
        var distinctBugs = classifiedBugs
            .GroupBy(b => $"{b.TaxonomyId}|{b.File}|{b.Line}|{b.Message}")
            .Select(g => g.First())
            .ToList();

        report.Bugs = distinctBugs;
        report.TotalBugs = distinctBugs.Count;
        report.SyntaxBugs = distinctBugs.Count(b => b.PrimaryType.Contains("Syntax"));
        report.RuntimeBugs = distinctBugs.Count(b => b.PrimaryType.Contains("Runtime"));
        report.FunctionalBugs = distinctBugs.Count(b => b.PrimaryType.Contains("Functional"));

        foreach (var bug in distinctBugs)
        {
            if (!report.SecondaryDistribution.ContainsKey(bug.TaxonomyId))
                report.SecondaryDistribution[bug.TaxonomyId] = 0;
            report.SecondaryDistribution[bug.TaxonomyId]++;
        }

        return report;
    }

    private BugClassification? ClassifySingleIssue(VerificationTechnique technique, VerificationIssue issue, List<GeneratedCodeFile> files)
    {
        var msg = issue.Message ?? "";
        string taxonomyId;

        // 1. Syntax Bugs (Type A)
        if (msg.Contains("IndentationError") || msg.Contains("TabError"))
        {
            taxonomyId = "A.2";
        }
        else if (msg.Contains("ModuleNotFoundError") || msg.Contains("ImportError") || technique.Name.Contains("Import"))
        {
            taxonomyId = "A.3";
        }
        else if (msg.Contains("SyntaxError") || technique.Name.Contains("AST") || msg.Contains("unexpected EOF") || msg.Contains("invalid syntax"))
        {
            taxonomyId = "A.1";
        }
        // 2. Runtime Bugs (Type B)
        else if (msg.Contains("NameError") || msg.Contains("UnboundLocalError"))
        {
            taxonomyId = "B.2";
        }
        else if (Regex.IsMatch(msg, @"(IndexError|KeyError|ZeroDivisionError|ValueError|OverflowError)"))
        {
            taxonomyId = "B.3";
        }
        else if (msg.Contains("TypeError") && (msg.Contains("takes") || msg.Contains("positional") || msg.Contains("argument") || msg.Contains("missing required")))
        {
            taxonomyId = "B.4";
        }
        else if (msg.Contains("AttributeError") || msg.Contains("TypeError"))
        {
            taxonomyId = "B.1";
        }
        else if (msg.Contains("Timeout") || msg.Contains("RecursionError") || msg.Contains("RuntimeError"))
        {
            taxonomyId = "B.5";
        }
        // 3. Functional Bugs (Type C)
        else if (msg.Contains("assert") || msg.Contains("AssertionError") || technique.Name.Contains("Pytest"))
        {
            taxonomyId = "C.1";
        }
        else if (msg.Contains("format") || (msg.Contains("expected") && (msg.Contains("tuple") || msg.Contains("list") || msg.Contains("dict") || msg.Contains("str"))))
        {
            taxonomyId = "C.3";
        }
        else if (technique.Name.Contains("Radon") || technique.Name.Contains("Semgrep"))
        {
            taxonomyId = "C.4";
        }
        else
        {
            // Default based on technique
            taxonomyId = technique.Id switch
            {
                1 => "A.1",
                2 => "A.3",
                3 => "C.1",
                4 => "B.1",
                5 => "B.4",
                6 => "C.4",
                7 => "C.4",
                _ => "C.1"
            };
        }

        if (!TaxonomyDefs.TryGetValue(taxonomyId, out var def))
            def = ("Type C: Functional Bug", $"{taxonomyId} Functional Bug", "Address logic inconsistency.");

        // Grab snippet if missing
        var snippet = issue.CodeSnippet;
        if (string.IsNullOrEmpty(snippet) && issue.Line.HasValue && !string.IsNullOrEmpty(issue.File))
        {
            var targetFile = files.FirstOrDefault(f => f.Name == issue.File || f.Path == issue.File);
            if (targetFile != null && !string.IsNullOrEmpty(targetFile.Content))
            {
                var lines = targetFile.Content.Split('\n');
                if (issue.Line.Value > 0 && issue.Line.Value <= lines.Length)
                {
                    snippet = lines[issue.Line.Value - 1].Trim();
                }
            }
        }

        return new BugClassification
        {
            TaxonomyId = taxonomyId,
            PrimaryType = def.Primary,
            SecondaryType = def.Secondary,
            File = issue.File ?? "",
            Line = issue.Line,
            Message = issue.Message ?? "",
            CompilerFeedback = $"{technique.Name}: {issue.Message ?? ""}",
            Severity = issue.Severity ?? "ERROR",
            CodeSnippet = snippet
        };
    }

    private BugClassification? ClassifyFromDetails(VerificationTechnique technique)
    {
        string taxonomyId = technique.Id switch
        {
            1 => "A.1",
            2 => "A.3",
            3 => "C.1",
            4 => "B.1",
            5 => "B.4",
            6 => "C.4",
            7 => "C.4",
            _ => "C.1"
        };

        if (!TaxonomyDefs.TryGetValue(taxonomyId, out var def)) return null;

        return new BugClassification
        {
            TaxonomyId = taxonomyId,
            PrimaryType = def.Primary,
            SecondaryType = def.Secondary,
            File = "project",
            Message = technique.Details,
            CompilerFeedback = technique.Details,
            Severity = "ERROR"
        };
    }

    /// <summary>
    /// Composes the self-critique repair prompt matching Dou et al. Sections 4 & 6 and TIVR feedback.
    /// </summary>
    private string BuildCritiquePrompt(
        string originalPrompt,
        List<GeneratedCodeFile> files,
        BugTaxonomyReport diagnosis,
        VerificationResponse? verification,
        int iteration,
        int maxIterations,
        List<string> episodicHistory)
    {
        var sb = new StringBuilder();

        sb.AppendLine("## Task Specification:");
        sb.AppendLine(originalPrompt);
        sb.AppendLine();

        sb.AppendLine($"## Current Code (Iteration {iteration} of {maxIterations}):");
        foreach (var file in files)
        {
            sb.AppendLine($"### File: `{file.Path}` ({file.Category})");
            sb.AppendLine("```python");
            sb.AppendLine(file.Content);
            sb.AppendLine("```");
            sb.AppendLine();
        }

        sb.AppendLine("## Machine-Verified Bug Diagnosis (Dou et al. Taxonomy):");
        if (diagnosis.Bugs.Count > 0)
        {
            foreach (var bug in diagnosis.Bugs.Take(6))
            {
                var loc = !string.IsNullOrEmpty(bug.File) ? $" in `{bug.File}`" : "";
                var line = bug.Line.HasValue ? $":{bug.Line.Value}" : "";
                TaxonomyDefs.TryGetValue(bug.TaxonomyId, out var def);

                sb.AppendLine($"- **[{bug.TaxonomyId}] {bug.PrimaryType} -> {bug.SecondaryType}**{loc}{line}");
                sb.AppendLine($"  - Issue: {bug.Message}");
                if (!string.IsNullOrEmpty(bug.CodeSnippet))
                    sb.AppendLine($"  - Snippet: `{bug.CodeSnippet}`");
                if (def.RepairHint != null)
                    sb.AppendLine($"  - Guidance: {def.RepairHint}");
            }
        }
        else
        {
            sb.AppendLine("- No syntax or runtime crashes detected, but verification assertions failed.");
        }
        sb.AppendLine();

        if (verification != null)
        {
            sb.AppendLine("## Verification Execution & Compiler Feedback:");
            var failedTechs = verification.Techniques.Where(t => t.Status == "FAIL" || t.Status == "ERROR").ToList();
            foreach (var t in failedTechs)
            {
                sb.AppendLine($"- **{t.Name}**: {t.Details}");
            }
            sb.AppendLine();
        }

        if (episodicHistory.Count > 0)
        {
            sb.AppendLine("## Lessons from Previous Repair Attempts:");
            foreach (var h in episodicHistory)
            {
                sb.AppendLine($"- {h}");
            }
            sb.AppendLine();
        }

        sb.AppendLine("## Repair Instructions:");
        sb.AppendLine("1. Fix ALL the diagnosed bugs according to the taxonomy guidance and compiler evidence.");
        sb.AppendLine("2. Preserve all existing function signatures, module interfaces, and file names.");
        sb.AppendLine("3. Ensure the test file passes all tests.");
        sb.AppendLine("4. Provide the COMPLETE, runnable Python code for every file without placeholders.");
        sb.AppendLine("5. Output ONLY a valid JSON object matching the standard format with summary and files.");

        return sb.ToString();
    }

    /// <summary>
    /// Builds the summary metrics comparing initial diagnosis vs final diagnosis across iterations.
    /// </summary>
    private OptimizationSummary BuildSummary(
        BugTaxonomyReport initial,
        BugTaxonomyReport final,
        int iterationsPerformed,
        List<OptimizationIteration> iterations,
        VerificationResponse initialVerification,
        VerificationResponse? finalVerification)
    {
        var summary = new OptimizationSummary
        {
            TotalBugsBefore = initial.TotalBugs,
            TotalBugsAfter = final.TotalBugs,
            TotalBugsFixed = Math.Max(0, initial.TotalBugs - final.TotalBugs),
            IterationsPerformed = iterationsPerformed,
            InitialVerdict = initialVerification.OverallVerdict,
            FinalVerdict = finalVerification?.OverallVerdict ?? initialVerification.OverallVerdict,
            InitialPassRate = initialVerification.Metrics.PassRate,
            FinalPassRate = finalVerification?.Metrics.PassRate ?? initialVerification.Metrics.PassRate
        };

        summary.RepairSuccessRate = summary.TotalBugsBefore > 0
            ? Math.Round((summary.TotalBugsFixed * 100.0) / summary.TotalBugsBefore, 1)
            : 100.0;

        if (iterations.Count > 0)
            summary.BugsFixedIteration1 = iterations[0].BugsFixedThisIteration;
        if (iterations.Count > 1)
            summary.BugsFixedIteration2 = iterations[1].BugsFixedThisIteration;

        // Per-category repair rates
        int syntaxFixed = Math.Max(0, initial.SyntaxBugs - final.SyntaxBugs);
        summary.SyntaxRepairRate = initial.SyntaxBugs > 0 ? Math.Round((syntaxFixed * 100.0) / initial.SyntaxBugs, 1) : 100.0;

        int runtimeFixed = Math.Max(0, initial.RuntimeBugs - final.RuntimeBugs);
        summary.RuntimeRepairRate = initial.RuntimeBugs > 0 ? Math.Round((runtimeFixed * 100.0) / initial.RuntimeBugs, 1) : 100.0;

        int functionalFixed = Math.Max(0, initial.FunctionalBugs - final.FunctionalBugs);
        summary.FunctionalRepairRate = initial.FunctionalBugs > 0 ? Math.Round((functionalFixed * 100.0) / initial.FunctionalBugs, 1) : 100.0;

        // Bug Evolutions
        for (int i = 0; i < iterations.Count; i++)
        {
            var iter = iterations[i];
            var beforeMap = iter.Diagnosis.SecondaryDistribution;
            var afterMap = (i + 1 < iterations.Count) ? iterations[i + 1].Diagnosis.SecondaryDistribution : final.SecondaryDistribution;

            foreach (var kvp in beforeMap)
            {
                int remaining = afterMap.TryGetValue(kvp.Key, out var rem) ? rem : 0;
                int resolved = Math.Max(0, kvp.Value - remaining);
                if (resolved > 0)
                {
                    summary.BugEvolutions.Add(new BugEvolution
                    {
                        FromType = kvp.Key,
                        ToType = "RESOLVED",
                        Count = resolved,
                        Iteration = i + 1
                    });
                }
            }
        }

        return summary;
    }
}
