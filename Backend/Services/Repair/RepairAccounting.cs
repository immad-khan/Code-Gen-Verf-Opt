using Backend.Models;
using Backend.Services.Taxonomy;

namespace Backend.Services.Repair;

/// <summary>
/// Pure accounting for the web repair loop (design §7 "Repair loop"):
/// <list type="bullet">
/// <item>correctness gate and completeness of a verification (Req. 19.5, 19.7);</item>
/// <item>per-iteration pass flags <c>passed[i] = OR_{j ≤ i} gate_j</c>, carried over skipped
/// iterations, and program-level repair success (Req. 19.1, 19.2);</item>
/// <item>bug counts over <c>category|signal|file</c> fingerprint multisets (Req. 19.4);</item>
/// <item>Primary_State transitions chained from the initial state, unavailable when a
/// re-verification is incomplete (Req. 21.1, 21.4–21.8);</item>
/// <item>secondary category sets before/after/introduced/resolved (Req. 21.3).</item>
/// </list>
/// Only <see cref="VerificationResult.CorrectnessFindings"/> are ever read; advisory findings
/// never affect any value computed here (Req. 20.3).
/// </summary>
public static class RepairAccounting
{
    /// <summary>All four correctness techniques returned a result (Req. 19.7).</summary>
    public static bool IsComplete(VerificationResult v) =>
        v.Complete && v.IncompleteTechniques.Count == 0;

    /// <summary>Gate passes iff the verification is complete and has zero correctness findings (Req. 19.5, 19.7).</summary>
    public static bool GatePassed(VerificationResult v) =>
        IsComplete(v) && v.CorrectnessFindings.Count == 0;

    /// <summary>
    /// PASS when the gate passes; otherwise the primary type of the highest-priority category
    /// among the correctness findings; UNMAPPED-only (or unknown) → the unmapped primary state (Req. 21.2).
    /// </summary>
    public static string PrimaryState(VerificationResult v, TaxonomyMapper mapper)
    {
        var defn = mapper.Definition;
        var classified = v.CorrectnessFindings.Select(f => new ClassifiedFinding(
            new TaxonomyFinding(f.Technique, f.Signal, f.Message, Blocking: true),
            new CategoryAssignment(defn.Categories.ContainsKey(f.Category) ? f.Category : defn.Unmapped.Id)));
        return mapper.PrimaryState(classified, GatePassed(v)).State;
    }

    /// <summary>Secondary categories (A.1–C.4) present among the correctness findings, in priority order.</summary>
    public static List<string> Categories(VerificationResult v, TaxonomyDefinition defn)
    {
        var present = v.CorrectnessFindings.Select(f => f.Category).ToHashSet(StringComparer.Ordinal);
        return defn.PriorityOrder.Where(present.Contains).ToList();
    }

    /// <summary>Fingerprint of a correctness finding: <c>category|signal|file</c> (Req. 19.4).</summary>
    public static string Fingerprint(MappedFinding f) =>
        $"{f.Category}|{f.Signal}|{RepairFiles.NormalizePath(f.Location?.File)}";

    /// <summary>
    /// Multiset counts between the initial and final correctness findings (Req. 19.4):
    /// remaining = |I ∩ F|, resolved = |I − F|, introduced = |F − I|, foundInitially = |I|.
    /// </summary>
    public static BugCounts CountBugs(VerificationResult initial, VerificationResult final)
    {
        var before = Multiset(initial.CorrectnessFindings);
        var after = Multiset(final.CorrectnessFindings);
        int remaining = 0, resolved = 0, introduced = 0;
        foreach (var (key, n) in before)
        {
            var m = after.GetValueOrDefault(key);
            remaining += Math.Min(n, m);
            resolved += Math.Max(0, n - m);
        }
        foreach (var (key, m) in after)
            introduced += Math.Max(0, m - before.GetValueOrDefault(key));
        return new BugCounts
        {
            FoundInitially = initial.CorrectnessFindings.Count,
            Resolved = resolved,
            Remaining = remaining,
            Introduced = introduced,
        };
    }

    /// <summary>
    /// One flag per iteration 1..k: true iff some executed iteration j ≤ i passed the gate.
    /// Iterations beyond <paramref name="executed"/> carry the last value (Req. 19.2).
    /// </summary>
    public static List<bool> PassedByIteration(IReadOnlyList<VerificationResult> executed, int k)
    {
        var flags = new List<bool>(k);
        var passed = false;
        for (var i = 0; i < k; i++)
        {
            if (i < executed.Count)
                passed |= GatePassed(executed[i]);
            flags.Add(passed);
        }
        return flags;
    }

    /// <summary>
    /// Transition of one iteration: from = <paramref name="before"/>'s Primary_State; when the
    /// re-verification is incomplete, to = null and the transition is unavailable (Req. 21.7).
    /// </summary>
    public static IterationTransition Transition(VerificationResult before, VerificationResult after, TaxonomyMapper mapper)
    {
        var from = PrimaryState(before, mapper);
        if (!IsComplete(after))
            return new IterationTransition { From = from, To = null, Available = false, Failure = IncompleteReason(after) };
        return new IterationTransition { From = from, To = PrimaryState(after, mapper), Available = true };
    }

    /// <summary>
    /// Chain of transitions ordered by iteration (Req. 21.1, 21.8): from_1 = initial state,
    /// from_i = to_{i−1}. An unavailable transition does not advance the chain.
    /// Zero transitions when the initial verification passes the gate (Req. 21.5).
    /// </summary>
    public static List<RepairTransition> Transitions(
        VerificationResult initial, IReadOnlyList<VerificationResult> executed, TaxonomyMapper mapper)
    {
        var result = new List<RepairTransition>();
        if (GatePassed(initial))
            return result;
        var current = initial;
        for (var i = 0; i < executed.Count; i++)
        {
            var t = Transition(current, executed[i], mapper);
            result.Add(new RepairTransition { Iteration = i + 1, From = t.From, To = t.To, Count = 1, Available = t.Available });
            if (t.Available)
                current = executed[i];
        }
        return result;
    }

    /// <summary>Builds the record of one executed iteration (Req. 21.1, 21.3, 21.7).</summary>
    public static RepairIteration Iteration(
        int iteration,
        string prompt,
        string rawResponse,
        ParsedRepairResponse parsed,
        IReadOnlyList<GeneratedCodeFile> filesBefore,
        IReadOnlyList<GeneratedCodeFile> filesAfter,
        VerificationResult before,
        VerificationResult after,
        TaxonomyMapper mapper,
        long durationMs = 0)
    {
        var complete = IsComplete(after);
        var it = new RepairIteration
        {
            Iteration = iteration,
            Prompt = prompt,
            RawResponse = rawResponse,
            CritiqueText = parsed.CritiqueText,
            NoExtractableCode = parsed.NoExtractableCode,
            FilesBefore = filesBefore.ToList(),
            FilesAfter = filesAfter.ToList(),
            Verification = after,
            VerificationComplete = complete,
            Transition = Transition(before, after, mapper),
            DurationMs = durationMs,
        };
        if (complete)
        {
            var (catBefore, catAfter, introduced, resolved) = CategoryChanges(before, after, mapper.Definition);
            it.CategoriesBefore = catBefore;
            it.CategoriesAfter = catAfter;
            it.Introduced = introduced;
            it.Resolved = resolved;
        }
        return it;
    }

    /// <summary>Categories before/after, introduced (after \ before), resolved (before \ after) (Req. 21.3).</summary>
    public static (List<string> Before, List<string> After, List<string> Introduced, List<string> Resolved) CategoryChanges(
        VerificationResult before, VerificationResult after, TaxonomyDefinition defn)
    {
        var b = Categories(before, defn);
        var a = Categories(after, defn);
        return (b, a, a.Except(b).ToList(), b.Except(a).ToList());
    }

    /// <summary>Result when the initial verification passes: no iterations, code unchanged (Req. 19.3, 21.5).</summary>
    public static RepairResult NotApplicable(
        EffectiveRepairConfig config, VerificationResult initial, IReadOnlyList<GeneratedCodeFile> submittedFiles) => new()
    {
        EffectiveConfig = config,
        IterationsPerformed = 0,
        Initial = initial,
        Iterations = new(),
        RepairSuccess = RepairSuccessValues.NotApplicable,
        PassedByIteration = null,
        BugCounts = CountBugs(initial, initial),
        Transitions = new(),
        IncompleteVerifications = new(),
        FinalFiles = submittedFiles.ToList(),
    };

    /// <summary>
    /// Final result (Req. 19.1, 19.2, 19.4, 21.x). The final verification is the one after the
    /// last executed iteration (the initial one when none ran). <paramref name="finalFiles"/> are
    /// the files after the last executed iteration (the submitted files when not applicable).
    /// </summary>
    public static RepairResult Result(
        EffectiveRepairConfig config,
        VerificationResult initial,
        IReadOnlyList<RepairIteration> iterations,
        IReadOnlyList<GeneratedCodeFile> finalFiles,
        TaxonomyMapper mapper)
    {
        if (GatePassed(initial))
            return NotApplicable(config, initial, finalFiles);

        var ordered = iterations.OrderBy(i => i.Iteration).ToList();
        var executed = ordered.Select(i => i.Verification).ToList();
        var final = executed.Count > 0 ? executed[^1] : initial;

        var incomplete = new List<IncompleteVerification>();
        if (!IsComplete(initial))
            incomplete.Add(IncompleteVerification.Initial);
        incomplete.AddRange(ordered.Where(i => !IsComplete(i.Verification))
                                   .Select(i => IncompleteVerification.ForIteration(i.Iteration)));

        return new RepairResult
        {
            EffectiveConfig = config,
            IterationsPerformed = ordered.Count,
            Initial = initial,
            Iterations = ordered,
            RepairSuccess = GatePassed(final) ? RepairSuccessValues.Repaired : RepairSuccessValues.NotRepaired,
            PassedByIteration = PassedByIteration(executed, config.K),
            BugCounts = CountBugs(initial, final),
            Transitions = Transitions(initial, executed, mapper),
            IncompleteVerifications = incomplete,
            FinalFiles = finalFiles.ToList(),
        };
    }

    private static Dictionary<string, int> Multiset(IEnumerable<MappedFinding> findings)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var f in findings)
        {
            var key = Fingerprint(f);
            counts[key] = counts.GetValueOrDefault(key) + 1;
        }
        return counts;
    }

    private static string IncompleteReason(VerificationResult v) =>
        v.IncompleteTechniques.Count > 0
            ? $"re-verification incomplete: {string.Join(", ", v.IncompleteTechniques)} returned no result"
            : "re-verification incomplete";
}
