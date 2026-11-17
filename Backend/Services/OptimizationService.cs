using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Backend.Models;
using Backend.Services.Repair;
using Backend.Services.Taxonomy;

namespace Backend.Services;

public class OptimizationService
{
    private readonly VerificationService _verificationService;
    private readonly AiService _aiService;
    private readonly ITaxonomyProvider _taxonomyProvider;
    private readonly IConfiguration _configuration;
    private readonly RepairPromptBuilder _promptBuilder;
    private readonly RepairResponseParser _responseParser = new();
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
        ITaxonomyProvider taxonomyProvider,
        IConfiguration configuration,
        ILogger<OptimizationService> logger)
    {
        _verificationService = verificationService;
        _aiService = aiService;
        _taxonomyProvider = taxonomyProvider;
        _configuration = configuration;
        _promptBuilder = new RepairPromptBuilder(taxonomyProvider);
        _logger = logger;
    }

    /// <summary>
    /// Executes the full Dou et al. 2-iteration optimization pipeline:
    /// Initial Diagnosis -> Iteration 1 (Critique + LLM Repair + Re-verify) ->
    /// Iteration 2 (LLM Repair + Re-verify) -> Bug Evolution & Summary
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

        // Requirement 4: If no check fails initially, SKIP repair. Do not call the LLM.
        if (initialDiagnosis.TotalBugs == 0 && (initialVerification.OverallVerdict is "VERIFIED" or "PASS"))
        {
            _logger.LogInformation("All checks verified in Round 0. Skipping repair loop entirely.");
            response.RepairSkipped = true;
            response.FinalDiagnosis = initialDiagnosis;
            response.Summary = BuildSummary(initialDiagnosis, initialDiagnosis, 0, new List<OptimizationIteration>(), initialVerification, initialVerification);
            response.TotalDurationMs = totalSw.ElapsedMilliseconds;
            return response;
        }

        // Step 2: Iterative Repair Loop (up to maxIterations)
        for (int iter = 1; iter <= maxIterations; iter++)
        {
            // If all bugs resolved in previous iteration, break early (Round 2 skipped if Round 1 passed)
            if (iter > 1 && currentDiagnosis.TotalBugs == 0 && (previousVerification?.OverallVerdict is "VERIFIED" or "PASS"))
            {
                _logger.LogInformation("Round {PrevRound} verified all checks. Stopping repair loop early.", iter - 1);
                break;
            }

            var iterSw = Stopwatch.StartNew();
            var iterationData = new OptimizationIteration
            {
                IterationNumber = iter,
                Diagnosis = currentDiagnosis
            };

            // Requirement 8: Episodic memory (history) is NOT part of paper mode "dou".
            // Only pass history if requested and not in pure "dou" mode.
            var historyForPrompt = (request.EnableEpisodicMemory && request.RepairMode != "dou")
                ? episodicHistory
                : new List<string>();

            // Formulate critique & repair prompt
            var critiquePrompt = BuildCritiquePrompt(
                request.OriginalPrompt,
                currentFiles,
                currentDiagnosis,
                previousVerification,
                iter,
                maxIterations,
                historyForPrompt,
                request.RepairMode,
                request.ImprovedSources
            );
            iterationData.CritiquePrompt = critiquePrompt;

            // Call LLM for repair using RESEARCH ENGINE plain-text completion (NO JSON mode!)
            List<GeneratedCodeFile> repairedFiles;
            string rawLlmResponse = "";
            try
            {
                var systemPrompt = _promptBuilder.WebSystemPrompt;
                rawLlmResponse = await _aiService.CompleteTextAsync(
                    critiquePrompt, systemPrompt, request.ApiSettings, 0.1);

                // Parse using RepairResponseParser (extracts Markdown fenced code blocks)
                var parsed = _responseParser.Parse(rawLlmResponse, currentFiles);

                // REJECT and log any attempt to modify test files (Tests are READ-ONLY!)
                if (parsed.Ignored.Count > 0)
                {
                    foreach (var ig in parsed.Ignored)
                    {
                        _logger.LogWarning(
                            "[SECURITY REJECTION] Model attempted to modify read-only file '{Path}': {Reason}",
                            ig.Path, ig.Reason);
                    }
                }

                repairedFiles = parsed.Apply(currentFiles);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error calling LLM for repair iteration {Iteration}", iter);
                rawLlmResponse = $"Repair call error: {ex.Message}";
                repairedFiles = currentFiles;
            }

            iterationData.LlmCritiqueResponse = rawLlmResponse;
            currentFiles = repairedFiles;

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

            // Add episodic memory for next iteration if enabled
            if (nextDiagnosis.TotalBugs > 0 && request.EnableEpisodicMemory && request.RepairMode != "dou")
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

        if (response.RunResult == null && initialVerification != null)
        {
            response.RunResult = BuildRunResult(
                request.OriginalPrompt,
                request.ApiSettings.Model ?? "deepseek-reasoner",
                initialVerification,
                response,
                response.TotalDurationMs
            );
        }
        if (response.RunResult != null)
        {
            response.RunResult.RepairMode = request.RepairMode ?? "dou";
            response.RunResult.EnabledSources = (request.RepairMode == "improved" && request.ImprovedSources != null)
                ? request.ImprovedSources.GetEnabledTags()
                : new List<string>();
        }

        return response;
    }

    /// <summary>
    /// Executes side-by-side comparison between 'dou' baseline and 'improved' mode.
    /// Runs both branches concurrently via Task.WhenAll from the exact same initial code.
    /// </summary>
    public async Task<CompareRepairResponse> CompareAsync(CompareRepairRequest request)
    {
        var totalSw = Stopwatch.StartNew();

        // 1. Initial verification on Round 0 code
        var initialVerification = request.VerificationResult ?? await _verificationService.VerifyAsync(request.Files);

        // 2. Clone initial files for both branches
        var douFiles = request.Files.Select(f => new GeneratedCodeFile
        {
            Name = f.Name,
            Path = f.Path,
            Language = f.Language,
            Category = f.Category,
            Description = f.Description,
            Content = f.Content
        }).ToList();

        var improvedFiles = request.Files.Select(f => new GeneratedCodeFile
        {
            Name = f.Name,
            Path = f.Path,
            Language = f.Language,
            Category = f.Category,
            Description = f.Description,
            Content = f.Content
        }).ToList();

        // 3. Concurrently execute Dou and Improved pipelines (Req 2)
        var douTask = OptimizeAsync(new OptimizationRequest
        {
            Files = douFiles,
            OriginalPrompt = request.OriginalPrompt,
            ApiSettings = request.ApiSettings,
            VerificationResult = initialVerification,
            MaxIterations = request.MaxIterations,
            RepairMode = "dou",
            LockedTestHash = request.LockedTestHash
        });

        var improvedTask = OptimizeAsync(new OptimizationRequest
        {
            Files = improvedFiles,
            OriginalPrompt = request.OriginalPrompt,
            ApiSettings = request.ApiSettings,
            VerificationResult = initialVerification,
            MaxIterations = request.MaxIterations,
            RepairMode = "improved",
            LockedTestHash = request.LockedTestHash,
            ImprovedSources = request.ImprovedSources
        });

        await Task.WhenAll(douTask, improvedTask);

        var douResult = await douTask;
        var improvedResult = await improvedTask;

        // 4. Token totals
        var douTotalTokens = douResult.Iterations.Sum(it => (it.CritiquePrompt.Length + it.LlmCritiqueResponse.Length + 3) / 4);
        var improvedTotalTokens = improvedResult.Iterations.Sum(it => (it.CritiquePrompt.Length + it.LlmCritiqueResponse.Length + 3) / 4);

        // 5. Evaluate outcome per round
        bool douR1Pass = douResult.Iterations.Count >= 1 && douResult.Iterations[0].BugsRemainingAfter == 0 && (douResult.Iterations[0].ReVerification?.OverallVerdict is "PASS" or "VERIFIED");
        bool douR2Pass = !douR1Pass && douResult.Iterations.Count >= 2 && douResult.Iterations[1].BugsRemainingAfter == 0 && (douResult.Iterations[1].ReVerification?.OverallVerdict is "PASS" or "VERIFIED");
        bool douUnresolved = douResult.FinalDiagnosis.TotalBugs > 0 || (douResult.Iterations.LastOrDefault()?.ReVerification?.OverallVerdict is not ("PASS" or "VERIFIED"));

        bool impR1Pass = improvedResult.Iterations.Count >= 1 && improvedResult.Iterations[0].BugsRemainingAfter == 0 && (improvedResult.Iterations[0].ReVerification?.OverallVerdict is "PASS" or "VERIFIED");
        bool impR2Pass = !impR1Pass && improvedResult.Iterations.Count >= 2 && improvedResult.Iterations[1].BugsRemainingAfter == 0 && (improvedResult.Iterations[1].ReVerification?.OverallVerdict is "PASS" or "VERIFIED");
        bool impUnresolved = improvedResult.FinalDiagnosis.TotalBugs > 0 || (improvedResult.Iterations.LastOrDefault()?.ReVerification?.OverallVerdict is not ("PASS" or "VERIFIED"));

        // 6. Winner determination
        string winner;
        string description;

        if (impR1Pass && !douR1Pass)
        {
            winner = "improved";
            description = "Improved mode fixed all bugs in Round 1, whereas Dou required multiple rounds or remained unresolved.";
        }
        else if (douR1Pass && !impR1Pass)
        {
            winner = "dou";
            description = "Dou mode fixed all bugs in Round 1.";
        }
        else if (!impUnresolved && douUnresolved)
        {
            winner = "improved";
            description = "Improved mode resolved all bugs within budget, while Dou mode remained unresolved.";
        }
        else if (!douUnresolved && impUnresolved)
        {
            winner = "dou";
            description = "Dou mode resolved all bugs within budget, while Improved mode remained unresolved.";
        }
        else if (!impUnresolved && !douUnresolved)
        {
            if (improvedTotalTokens < douTotalTokens)
            {
                winner = "improved";
                description = $"Both modes fixed all bugs; Improved consumed fewer tokens ({improvedTotalTokens} vs {douTotalTokens}).";
            }
            else if (douTotalTokens < improvedTotalTokens)
            {
                winner = "dou";
                description = $"Both modes fixed all bugs; Dou consumed fewer tokens ({douTotalTokens} vs {improvedTotalTokens}).";
            }
            else
            {
                winner = "tie";
                description = "Both modes fixed all bugs with identical efficiency.";
            }
        }
        else
        {
            winner = "tie";
            description = "Both modes were unable to resolve all bugs within the 2-iteration budget.";
        }

        var summary = new ComparisonSummary
        {
            DouFixedInRound1 = douR1Pass,
            DouFixedInRound2 = douR2Pass,
            DouUnresolved = douUnresolved,
            DouTotalTokens = douTotalTokens,
            ImprovedFixedInRound1 = impR1Pass,
            ImprovedFixedInRound2 = impR2Pass,
            ImprovedUnresolved = impUnresolved,
            ImprovedTotalTokens = improvedTotalTokens,
            Winner = winner,
            Description = description
        };

        return new CompareRepairResponse
        {
            DouResult = douResult,
            ImprovedResult = improvedResult,
            Summary = summary,
            TotalDurationMs = totalSw.ElapsedMilliseconds
        };
    }

    /// <summary>
    /// Builds the Single Source of Truth RunResult object combining Round 0, Round 1, and Round 2.
    /// </summary>
    public RunResult BuildRunResult(
        string prompt,
        string model,
        VerificationResponse r0Verif,
        OptimizationResponse? optResponse,
        long totalDurationMs)
    {
        var result = new RunResult
        {
            Model = model,
            OriginalPrompt = prompt,
            TotalDurationMs = totalDurationMs,
            BaselineLabel = _configuration["PaperBaseline:Label"] ?? "Paper, GPT-4 (Dou et al.)",
            BaselineComparator = double.TryParse(_configuration["PaperBaseline:RepairSuccessRate"], out var b) ? b : 29.2,
            RepairMode = optResponse?.RunResult?.RepairMode ?? "dou",
            EnabledSources = optResponse?.RunResult?.EnabledSources ?? new List<string>()
        };

        // Round 0
        var r0Round = new RunRoundResult
        {
            RoundIndex = 0,
            TechniqueStatuses = r0Verif.Techniques,
            DurationMs = r0Verif.TotalDurationMs,
            Verdict = r0Verif.OverallVerdict,
            TestsSummary = new TestRunSummary
            {
                Total = r0Verif.Metrics.TotalTests,
                Passed = r0Verif.Metrics.PassedTests,
                Failed = r0Verif.Metrics.FailedTests,
                PassRate = r0Verif.Metrics.PassRate
            }
        };

        if (optResponse != null)
        {
            r0Round.DiagnosedBugs = optResponse.InitialDiagnosis.Bugs;
            result.InitialFailingBugs = optResponse.InitialDiagnosis.TotalBugs;
            result.FixedBugs = optResponse.Summary.TotalBugsFixed;
            result.RepairSuccessRate = optResponse.Summary.RepairSuccessRate;
            result.RepairSkipped = optResponse.RepairSkipped;
            result.OverallVerdict = optResponse.Summary.FinalVerdict;

            // Round 1 and Round 2
            foreach (var iter in optResponse.Iterations)
            {
                var v = iter.ReVerification;
                var inTokens = (iter.CritiquePrompt.Length + 3) / 4;
                var outTokens = (iter.LlmCritiqueResponse.Length + 3) / 4;
                var iterRound = new RunRoundResult
                {
                    RoundIndex = iter.IterationNumber,
                    CodeSnapshot = iter.RepairedFiles,
                    DiagnosedBugs = iter.Diagnosis.Bugs,
                    PromptSent = iter.CritiquePrompt,
                    LlmResponse = iter.LlmCritiqueResponse,
                    DurationMs = iter.DurationMs,
                    Verdict = v?.OverallVerdict ?? "NOT_VERIFIED",
                    TechniqueStatuses = v?.Techniques ?? new List<VerificationTechnique>(),
                    TokenMetrics = new TokenAccounting
                    {
                        InputTokens = inTokens,
                        OutputTokens = outTokens,
                        TotalTokens = inTokens + outTokens
                    }
                };

                if (v != null)
                {
                    iterRound.TestsSummary = new TestRunSummary
                    {
                        Total = v.Metrics.TotalTests,
                        Passed = v.Metrics.PassedTests,
                        Failed = v.Metrics.FailedTests,
                        PassRate = v.Metrics.PassRate
                    };
                }

                result.Rounds.Add(iterRound);
            }
        }
        else
        {
            result.InitialFailingBugs = r0Verif.Techniques.Count(t => t.Status == "FAIL");
            result.OverallVerdict = r0Verif.OverallVerdict;
            result.RepairSkipped = true;
            result.RepairSuccessRate = null;
        }

        result.Rounds.Insert(0, r0Round);
        return result;
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
            // If it's a NameError on standard library (math, json, os, sys, etc.), classify as A.3
            if (Regex.IsMatch(msg, @"name '(math|sys|os|re|json|time|datetime|random|collections|itertools|heapq|bisect)' is not defined"))
                taxonomyId = "A.3";
            else
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
    /// Builds the critique repair prompt following Dou et al. Figure 6 and repository specifications.
    /// </summary>
    private string BuildCritiquePrompt(
        string originalPrompt,
        List<GeneratedCodeFile> files,
        BugTaxonomyReport diagnosis,
        VerificationResponse? verification,
        int iteration,
        int maxIterations,
        List<string> episodicHistory,
        string mode,
        ImprovedRepairSources? improvedSources = null)
    {
        if (mode == "improved")
        {
            var verifResult = verification != null
                ? RepairPromptBuilder.ToVerificationResult(verification, diagnosis)
                : new VerificationResult();

            return _promptBuilder.BuildImproved(
                originalPrompt,
                files,
                verifResult,
                iteration,
                maxIterations,
                episodicHistory,
                improvedSources
            );
        }

        // Editable (non-test) files only! Tests are excluded from the solution.
        var editableFiles = RepairFiles.Editable(files);

        // Format editable code as markdown blocks
        var solutionSb = new StringBuilder();
        foreach (var file in editableFiles)
        {
            solutionSb.AppendLine($"### File: {RepairFiles.PathOf(file)}");
            solutionSb.AppendLine("```python");
            solutionSb.AppendLine(file.Content);
            solutionSb.AppendLine("```");
            solutionSb.AppendLine();
        }

        // Format compiler error log according to Dou et al. rules:
        // Type A / B: interpreter error report
        // Type C: "The functionality of code is incorrect"
        // Timeout: "The execution of the code has exceeded the time limit"
        var errorLogSb = new StringBuilder();
        bool hasTimeout = diagnosis.Bugs.Any(b => b.Message.Contains("timeout", StringComparison.OrdinalIgnoreCase) || (b.TaxonomyId == "B.5" && b.Message.Contains("time limit", StringComparison.OrdinalIgnoreCase)))
            || (verification?.Techniques.Any(t => t.Details.Contains("timeout", StringComparison.OrdinalIgnoreCase)) ?? false);
        bool hasSyntaxOrRuntime = diagnosis.Bugs.Any(b => b.PrimaryType.Contains("Syntax") || b.PrimaryType.Contains("Runtime"));
        bool hasFunctionalBug = diagnosis.Bugs.Any(b => b.PrimaryType.Contains("Functional"));

        if (hasTimeout)
        {
            errorLogSb.AppendLine("The execution of the code has exceeded the time limit");
        }
        else if (hasSyntaxOrRuntime)
        {
            foreach (var bug in diagnosis.Bugs.Where(b => !b.PrimaryType.Contains("Functional")).Take(5))
            {
                if (!string.IsNullOrEmpty(bug.CompilerFeedback))
                    errorLogSb.AppendLine(bug.CompilerFeedback);
                else
                    errorLogSb.AppendLine($"{bug.File}: {bug.Message}");

                if (!string.IsNullOrEmpty(bug.CodeSnippet))
                    errorLogSb.AppendLine($"  {bug.CodeSnippet}");
            }
        }
        else if (hasFunctionalBug)
        {
            errorLogSb.AppendLine("The functionality of code is incorrect");
        }
        else
        {
            errorLogSb.AppendLine("Compilation or execution check failed.");
        }

        if (mode is "dou" or "dou_no_bt")
        {
            // Exact Figure 6 prompt from paper
            return _taxonomyProvider.Renderer.Render("dou_critique", new Dictionary<string, string>
            {
                ["prompt"] = originalPrompt,
                ["solution"] = solutionSb.ToString().Trim(),
                ["error log"] = errorLogSb.ToString().Trim(),
                ["checklist"] = mode == "dou" ? _taxonomyProvider.Definition.ChecklistText() : ""
            });
        }

        // Extended mode ("full") with episodic history and full compiler details
        var fullSb = new StringBuilder();
        fullSb.AppendLine("## Task Specification:");
        fullSb.AppendLine(originalPrompt);
        fullSb.AppendLine();

        fullSb.AppendLine($"## Current Erroneous Code (Iteration {iteration} of {maxIterations}):");
        fullSb.Append(solutionSb);

        fullSb.AppendLine("## Machine-Verified Bug Diagnosis (Dou et al. Taxonomy):");
        foreach (var bug in diagnosis.Bugs.Take(6))
        {
            var loc = !string.IsNullOrEmpty(bug.File) ? $" in `{bug.File}`" : "";
            var line = bug.Line.HasValue ? $":{bug.Line.Value}" : "";
            TaxonomyDefs.TryGetValue(bug.TaxonomyId, out var def);

            fullSb.AppendLine($"- **[{bug.TaxonomyId}] {bug.PrimaryType} -> {bug.SecondaryType}**{loc}{line}");
            fullSb.AppendLine($"  - Issue: {bug.Message}");
            if (def.RepairHint != null)
                fullSb.AppendLine($"  - Guidance: {def.RepairHint}");
        }
        fullSb.AppendLine();

        fullSb.AppendLine("## Compiler / Execution Feedback:");
        fullSb.AppendLine(errorLogSb.ToString().Trim());
        fullSb.AppendLine();

        if (episodicHistory.Count > 0)
        {
            fullSb.AppendLine("## Lessons from Previous Repair Attempts:");
            foreach (var h in episodicHistory)
                fullSb.AppendLine($"- {h}");
            fullSb.AppendLine();
        }

        fullSb.AppendLine("## Repair Instructions:");
        fullSb.AppendLine("1. Fix all diagnosed bugs. Do not output or modify any test files.");
        fullSb.AppendLine("2. For each modified file, write a line '### File: <path>' followed by a ```python ... ``` code block.");
        fullSb.AppendLine("3. Output complete runnable code without placeholders.");

        return fullSb.ToString();
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

        // RSR = fixed_bugs / initial_failing. If initial == 0, null ("N/A")
        summary.RepairSuccessRate = summary.TotalBugsBefore > 0
            ? Math.Round((summary.TotalBugsFixed * 100.0) / summary.TotalBugsBefore, 1)
            : null;

        if (iterations.Count > 0)
            summary.BugsFixedIteration1 = iterations[0].BugsFixedThisIteration;
        if (iterations.Count > 1)
            summary.BugsFixedIteration2 = iterations[1].BugsFixedThisIteration;

        // Per-category repair rates
        int syntaxFixed = Math.Max(0, initial.SyntaxBugs - final.SyntaxBugs);
        summary.SyntaxRepairRate = initial.SyntaxBugs > 0 ? Math.Round((syntaxFixed * 100.0) / initial.SyntaxBugs, 1) : null;

        int runtimeFixed = Math.Max(0, initial.RuntimeBugs - final.RuntimeBugs);
        summary.RuntimeRepairRate = initial.RuntimeBugs > 0 ? Math.Round((runtimeFixed * 100.0) / initial.RuntimeBugs, 1) : null;

        int functionalFixed = Math.Max(0, initial.FunctionalBugs - final.FunctionalBugs);
        summary.FunctionalRepairRate = initial.FunctionalBugs > 0 ? Math.Round((functionalFixed * 100.0) / initial.FunctionalBugs, 1) : null;

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
