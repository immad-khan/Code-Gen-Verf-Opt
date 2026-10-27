using Backend.Models;
using Backend.Services.Repair;
using Backend.Services.Taxonomy;

namespace Backend.Tests;

/// <summary>Gate flags, bug counts, transitions, and category sets of the web repair loop (Req. 19, 21).</summary>
public class RepairAccountingTests
{
    private static readonly TaxonomyMapper Mapper = new(TaxonomyProvider.LoadOrThrow(
        Path.Combine(AppContext.BaseDirectory, "shared", "taxonomy.v1.json")).Definition);

    private static readonly RepairResponseParser Parser = new();

    private static MappedFinding F(string category, string signal = "sig", string file = "main.py") => new()
    {
        Technique = "tests",
        Signal = signal,
        Message = "msg",
        Category = category,
        PrimaryType = category.Length > 0 && category != "UNMAPPED" ? category[..1] : null,
        Location = new FindingLocation { File = file, Line = 1 },
    };

    private static VerificationResult V(params MappedFinding[] findings) => new()
    {
        CorrectnessFindings = findings.ToList(),
        Complete = true,
        GatePassed = findings.Length == 0,
    };

    private static VerificationResult Incomplete(params MappedFinding[] findings) => new()
    {
        CorrectnessFindings = findings.ToList(),
        Complete = false,
        IncompleteTechniques = ["tests"],
    };

    private static VerificationResult WithAdvisories(VerificationResult v)
    {
        v.AdvisoryFindings = [new AdvisoryFinding { Technique = "security", Message = "B101", File = "main.py", Line = 3 }];
        return v;
    }

    private static readonly List<GeneratedCodeFile> Files =
        [new GeneratedCodeFile { Name = "main.py", Path = "main.py", Category = "main", Content = "x = 1\n" }];

    private static RepairIteration It(int i, VerificationResult before, VerificationResult after) =>
        RepairAccounting.Iteration(i, "p", "r", Parser.Parse("", Files), Files, Files, before, after, Mapper);

    private static EffectiveRepairConfig Config(int k) => new() { RepairMode = "dou", K = k, Temperature = 0.1 };

    [Fact]
    public void Gate_IgnoresAdvisories_AndFailsWhenIncomplete()
    {
        Assert.True(RepairAccounting.GatePassed(WithAdvisories(V())));
        Assert.False(RepairAccounting.GatePassed(Incomplete()));
        Assert.False(RepairAccounting.GatePassed(V(F("A.1"))));
    }

    [Fact]
    public void PassedByIteration_CarriesOverSkippedIterations()
    {
        Assert.Equal(new[] { false, true, true }, RepairAccounting.PassedByIteration([V(F("A.1")), V()], 3));
        Assert.Equal(new[] { true, true, true }, RepairAccounting.PassedByIteration([V()], 3));
        Assert.Equal(new[] { false, false }, RepairAccounting.PassedByIteration([V(F("A.1")), Incomplete()], 2));
    }

    [Fact]
    public void CountBugs_UsesFingerprintMultisets()
    {
        var initial = V(F("A.1"), F("A.1"), F("B.1", "s2"), F("C.1", file: "a.py"));
        var final = V(F("A.1"), F("C.1", file: "b.py"), F("UNMAPPED", "new"));

        var counts = RepairAccounting.CountBugs(initial, final);

        Assert.Equal(4, counts.FoundInitially);
        Assert.Equal(1, counts.Remaining);
        Assert.Equal(3, counts.Resolved);
        Assert.Equal(2, counts.Introduced);
        Assert.Equal(counts.FoundInitially, counts.Resolved + counts.Remaining);
    }

    [Fact]
    public void Result_InitialPass_IsNotApplicable()
    {
        var result = RepairAccounting.Result(Config(2), WithAdvisories(V()), [], Files, Mapper);

        Assert.Equal(RepairSuccessValues.NotApplicable, result.RepairSuccess);
        Assert.Null(result.PassedByIteration);
        Assert.Empty(result.Iterations);
        Assert.Empty(result.Transitions);
        Assert.Equal(0, result.IterationsPerformed);
        Assert.Equal(new BugCounts(), result.BugCounts, new BugCountsComparer());
        Assert.Equal(Files.Select(f => f.Content), result.FinalFiles.Select(f => f.Content));
    }

    [Fact]
    public void Result_RepairedEarly_ChainsTransitionsToPass()
    {
        var initial = V(F("A.1"));
        var after1 = V(F("C.1"));
        var after2 = WithAdvisories(V());
        List<RepairIteration> its = [It(1, initial, after1), It(2, after1, after2)];

        var result = RepairAccounting.Result(Config(3), initial, its, Files, Mapper);

        Assert.Equal(RepairSuccessValues.Repaired, result.RepairSuccess);
        Assert.Equal(new[] { false, true, true }, result.PassedByIteration);
        Assert.Equal(2, result.IterationsPerformed);
        Assert.Equal(new[] { (1, "A", "C"), (2, "C", "PASS") },
                     result.Transitions.Select(t => (t.Iteration, t.From, t.To!)));
        Assert.All(result.Transitions, t => Assert.Equal(1, t.Count));
        Assert.Empty(result.IncompleteVerifications);
        Assert.Equal(1, result.BugCounts.Resolved);
        Assert.Equal(0, result.BugCounts.Introduced);
    }

    [Fact]
    public void Iteration_RecordsCategorySets()
    {
        var it = It(1, V(F("A.1"), F("B.1")), V(F("B.1"), F("C.1")));

        Assert.True(it.Transition.Available);
        Assert.Equal(new[] { "A.1", "B.1" }, it.CategoriesBefore);
        Assert.Equal(new[] { "B.1", "C.1" }, it.CategoriesAfter);
        Assert.Equal(new[] { "C.1" }, it.Introduced);
        Assert.Equal(new[] { "A.1" }, it.Resolved);
    }

    [Fact]
    public void Iteration_UnmappedOnly_IsCWithNoCategories()
    {
        var it = It(1, V(F("A.1")), V(F("UNMAPPED")));

        Assert.Equal("C", it.Transition.To);
        Assert.Empty(it.CategoriesAfter);
        Assert.Equal(new[] { "A.1" }, it.Resolved);
    }

    [Fact]
    public void IncompleteReverification_MarksTransitionUnavailable_KeepsEarlierOnes()
    {
        var initial = V(F("A.1"));
        var after1 = V(F("B.1"));
        var after2 = Incomplete();
        List<RepairIteration> its = [It(1, initial, after1), It(2, after1, after2)];

        var result = RepairAccounting.Result(Config(3), initial, its, Files, Mapper);

        Assert.Equal(RepairSuccessValues.NotRepaired, result.RepairSuccess);
        Assert.Equal(new[] { false, false, false }, result.PassedByIteration);
        var t1 = result.Transitions[0];
        Assert.True(t1.Available);
        Assert.Equal(("A", "B"), (t1.From, t1.To!));
        var t2 = result.Transitions[1];
        Assert.False(t2.Available);
        Assert.Equal("B", t2.From);
        Assert.Null(t2.To);
        Assert.Equal(new[] { IncompleteVerification.ForIteration(2) }, result.IncompleteVerifications);

        var it2 = result.Iterations[1];
        Assert.False(it2.VerificationComplete);
        Assert.NotNull(it2.Transition.Failure);
        Assert.Contains("tests", it2.Transition.Failure);
        Assert.Empty(it2.CategoriesBefore);
        Assert.Empty(it2.CategoriesAfter);
        Assert.Empty(it2.Introduced);
        Assert.Empty(it2.Resolved);
    }

    [Fact]
    public void IncompleteInitial_IsReported_AndGateFails()
    {
        var initial = Incomplete();
        var result = RepairAccounting.Result(Config(1), initial, [It(1, initial, V())], Files, Mapper);

        Assert.Equal(RepairSuccessValues.Repaired, result.RepairSuccess);
        Assert.Equal(new[] { IncompleteVerification.Initial }, result.IncompleteVerifications);
        Assert.Equal(("C", "PASS"), (result.Transitions[0].From, result.Transitions[0].To!));
    }

    [Fact]
    public void Advisories_DoNotChangeAnyAccountingValue()
    {
        var initial = V(F("A.1"));
        var after = V(F("B.1"));
        var plain = RepairAccounting.Result(Config(2), initial, [It(1, initial, after)], Files, Mapper);

        var initialAdv = WithAdvisories(V(F("A.1")));
        var afterAdv = WithAdvisories(V(F("B.1")));
        var withAdv = RepairAccounting.Result(Config(2), initialAdv, [It(1, initialAdv, afterAdv)], Files, Mapper);

        Assert.Equal(plain.RepairSuccess, withAdv.RepairSuccess);
        Assert.Equal(plain.PassedByIteration, withAdv.PassedByIteration);
        Assert.Equal(plain.BugCounts, withAdv.BugCounts, new BugCountsComparer());
        Assert.Equal(plain.Transitions.Select(t => (t.From, t.To)), withAdv.Transitions.Select(t => (t.From, t.To)));
        Assert.Equal(plain.Iterations[0].Introduced, withAdv.Iterations[0].Introduced);
    }

    private sealed class BugCountsComparer : IEqualityComparer<BugCounts>
    {
        public bool Equals(BugCounts? x, BugCounts? y) =>
            x is not null && y is not null &&
            (x.FoundInitially, x.Resolved, x.Remaining, x.Introduced) == (y.FoundInitially, y.Resolved, y.Remaining, y.Introduced);

        public int GetHashCode(BugCounts b) => HashCode.Combine(b.FoundInitially, b.Resolved, b.Remaining, b.Introduced);
    }
}
