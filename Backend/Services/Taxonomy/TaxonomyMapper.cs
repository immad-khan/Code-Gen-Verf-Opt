namespace Backend.Services.Taxonomy;

/// <summary>
/// Minimal view of a verifier finding needed for taxonomy mapping.
/// <paramref name="Blocking"/> is true for correctness findings and false for
/// advisory ones (mypy, radon, semgrep).
/// </summary>
public sealed record TaxonomyFinding(
    string Technique,
    string Signal,
    string Message,
    bool Blocking = true);

/// <summary>Category assigned to a blocking finding: a category ID or UNMAPPED.</summary>
public sealed record CategoryAssignment(
    string Category,
    string? RuleId = null,
    double? Confidence = null);

/// <summary>A finding plus its assignment; <see cref="Assignment"/> is null for advisory findings.</summary>
public sealed record ClassifiedFinding(TaxonomyFinding Finding, CategoryAssignment? Assignment)
{
    public string? Category => Assignment?.Category;
}

/// <summary>One diagnosis per assigned category (or UNMAPPED), mirroring Python's <c>Diagnosis</c>.</summary>
public sealed record TaxonomyDiagnosis(
    string Category,
    string? Primary,
    string? Secondary,
    int Priority,
    double? Confidence,
    string? RepairHint,
    string EvidenceSummary,
    IReadOnlyList<string> Signals,
    IReadOnlyList<string> RuleIds);

/// <summary>
/// Rule-based mapper from verified findings to Dou et al.'s taxonomy
/// (port of <c>tivr/taxonomy.py</c>):
/// <list type="bullet">
/// <item>advisory findings never carry a category (Req. 20.2);</item>
/// <item>rules are evaluated in definition order, first match wins (Req. 7.4, 8.9);</item>
/// <item>a blocking finding matching no rule is UNMAPPED (Req. 8.8);</item>
/// <item>diagnoses are sorted by priority with UNMAPPED last;</item>
/// <item>primary state is PASS iff the gate passes, otherwise the primary of the
/// highest-priority category; UNMAPPED-only failures are C flagged as unmapped-as-C.</item>
/// </list>
/// </summary>
public sealed class TaxonomyMapper
{
    public const string PassState = "PASS";

    public TaxonomyMapper(TaxonomyDefinition definition)
    {
        Definition = definition ?? throw new ArgumentNullException(nameof(definition));
    }

    public TaxonomyDefinition Definition { get; }

    /// <summary>First matching rule wins; no match → UNMAPPED; advisory → null.</summary>
    public CategoryAssignment? Assign(TaxonomyFinding finding)
    {
        if (!finding.Blocking)
            return null;
        foreach (var rule in Definition.Rules)
        {
            if (rule.Matches(finding.Technique, finding.Signal, finding.Message))
                return new CategoryAssignment(rule.Category, rule.Id, rule.Confidence);
        }
        return new CategoryAssignment(Definition.Unmapped.Id);
    }

    public ClassifiedFinding Map(TaxonomyFinding finding) => new(finding, Assign(finding));

    public IReadOnlyList<ClassifiedFinding> MapAll(IEnumerable<TaxonomyFinding> findings) =>
        findings.Select(Map).ToList().AsReadOnly();

    /// <summary>One diagnosis per category among blocking findings, sorted by priority.</summary>
    public IReadOnlyList<TaxonomyDiagnosis> Diagnose(IEnumerable<ClassifiedFinding> findings)
    {
        var defn = Definition;
        var byCategory = new Dictionary<string, DiagnosisBuilder>(StringComparer.Ordinal);
        var order = new List<DiagnosisBuilder>();
        foreach (var f in findings)
        {
            if (!f.Finding.Blocking || f.Assignment is null)
                continue;
            var a = f.Assignment;
            if (!byCategory.TryGetValue(a.Category, out var d))
            {
                if (a.Category == defn.Unmapped.Id)
                {
                    d = new DiagnosisBuilder(a.Category, null, null, defn.Unmapped.Priority,
                                             null, defn.Unmapped.RepairHint);
                }
                else
                {
                    var cat = defn.Categories[a.Category];
                    d = new DiagnosisBuilder(cat.Id, cat.Primary, cat.Name, cat.Priority,
                                             a.Confidence, cat.RepairHint);
                }
                d.EvidenceSummary = $"{f.Finding.Signal}: {FirstLine(f.Finding.Message)}";
                byCategory[a.Category] = d;
                order.Add(d);
            }
            else if (a.Confidence is double c)
            {
                d.Confidence = d.Confidence is double existing ? Math.Max(existing, c) : c;
            }
            if (!d.Signals.Contains(f.Finding.Signal))
                d.Signals.Add(f.Finding.Signal);
            if (a.RuleId is not null && !d.RuleIds.Contains(a.RuleId))
                d.RuleIds.Add(a.RuleId);
        }
        // OrderBy is stable, like Python's sorted().
        return order.OrderBy(d => d.Priority).Select(d => d.Build()).ToList().AsReadOnly();
    }

    /// <summary>
    /// Return <c>(State, UnmappedAsC)</c>. <c>("PASS", false)</c> iff the correctness
    /// gate passes (zero correctness findings and a complete verification — decided by
    /// the caller). Otherwise the primary type of the highest-priority category among
    /// the blocking findings; a failure with no A/B/C category (UNMAPPED-only, or an
    /// incomplete verification with no findings) is the unmapped primary state (C)
    /// with <c>UnmappedAsC = true</c> (Req. 15.4). Advisory findings never count.
    /// </summary>
    public (string State, bool UnmappedAsC) PrimaryState(IEnumerable<ClassifiedFinding> correctness, bool gatePassed)
    {
        if (gatePassed)
            return (PassState, false);
        var defn = Definition;
        string? best = null;
        foreach (var f in correctness)
        {
            if (!f.Finding.Blocking)
                continue;
            var category = f.Category ?? Assign(f.Finding)!.Category;
            if (category == defn.Unmapped.Id)
                continue;
            if (best is null || defn.Priority(category) < defn.Priority(best))
                best = category;
        }
        if (best is null)
            return (defn.Unmapped.PrimaryState, true);
        return (defn.Categories[best].Primary, false);
    }

    /// <summary>Python <c>text.splitlines()[0] if text else ""</c>.</summary>
    internal static string FirstLine(string text)
    {
        if (string.IsNullOrEmpty(text))
            return "";
        for (int i = 0; i < text.Length; i++)
        {
            switch (text[i])
            {
                case '\n': case '\r': case '\v': case '\f':
                case '\x1c': case '\x1d': case '\x1e':
                case '\x85': case '\u2028': case '\u2029':
                    return text[..i];
            }
        }
        return text;
    }

    private sealed class DiagnosisBuilder(
        string category, string? primary, string? secondary, int priority,
        double? confidence, string? repairHint)
    {
        public int Priority { get; } = priority;
        public double? Confidence { get; set; } = confidence;
        public string EvidenceSummary { get; set; } = "";
        public List<string> Signals { get; } = [];
        public List<string> RuleIds { get; } = [];

        public TaxonomyDiagnosis Build() => new(
            category, primary, secondary, Priority, Confidence, repairHint,
            EvidenceSummary, Signals.AsReadOnly(), RuleIds.AsReadOnly());
    }
}
