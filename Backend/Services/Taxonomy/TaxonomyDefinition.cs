using System.Text.RegularExpressions;

namespace Backend.Services.Taxonomy;

// Immutable model of the shared Taxonomy_Definition (shared/taxonomy.v1.json).
// Mirrors tivr/taxonomy_def.py; instances are only produced by
// TaxonomyDefinitionLoader after every validation step passed (Req. 7.7).

/// <summary>One of Dou's primary bug types A–D.</summary>
public sealed record PrimaryType(
    string Id,
    string Name,
    bool AutoAssignable,
    string? NotAssignedReason = null);

/// <summary>One of the 12 secondary categories A.1–C.4.</summary>
public sealed record TaxonomyCategory(
    string Id,
    string Primary,
    string Name,
    int Priority,
    bool AutoAssignable,
    string RepairHint,
    string? NotAssignedReason = null);

/// <summary>The pseudo-category assigned to blocking findings that match no rule.</summary>
public sealed record UnmappedCategory(
    string Id,
    string Name,
    int Priority,
    string PrimaryState,
    string RepairHint);

/// <summary>A named prompt template with its declared variables.</summary>
public sealed record PromptTemplate(
    string Name,
    IReadOnlyList<string> Variables,
    string Text,
    bool Optional = false);

/// <summary>
/// One declarative mapping rule with its regexes compiled. Every present
/// condition must hold: <c>technique</c> is a set of allowed techniques,
/// <c>signal</c> is a full match (<c>\A(?:p)\z</c>), <c>message</c> is a
/// search (case-insensitive when <see cref="IgnoreCase"/>).
/// </summary>
public sealed class TaxonomyRule
{
    public TaxonomyRule(
        string id,
        string category,
        double confidence,
        IReadOnlyList<string> covers,
        IReadOnlySet<string>? technique,
        string? signal,
        string? message,
        bool ignoreCase,
        Regex? signalRegex,
        Regex? messageRegex)
    {
        Id = id;
        Category = category;
        Confidence = confidence;
        Covers = covers;
        Technique = technique;
        Signal = signal;
        Message = message;
        IgnoreCase = ignoreCase;
        SignalRegex = signalRegex;
        MessageRegex = messageRegex;
    }

    public string Id { get; }
    public string Category { get; }
    public double Confidence { get; }
    public IReadOnlyList<string> Covers { get; }

    /// <summary>Allowed techniques; null when the rule has no technique condition.</summary>
    public IReadOnlySet<string>? Technique { get; }

    /// <summary>Source pattern of the signal condition (null when absent).</summary>
    public string? Signal { get; }

    /// <summary>Source pattern of the message condition (null when absent).</summary>
    public string? Message { get; }

    public bool IgnoreCase { get; }

    /// <summary><c>\A(?:p)\z</c>, CultureInvariant, 100 ms timeout.</summary>
    public Regex? SignalRegex { get; }

    /// <summary>Search pattern, CultureInvariant (+IgnoreCase), 100 ms timeout.</summary>
    public Regex? MessageRegex { get; }

    public bool TechniqueMatches(string technique) =>
        Technique is null || Technique.Contains(technique);

    public bool SignalMatches(string signal) =>
        SignalRegex is null || SafeIsMatch(SignalRegex, signal);

    public bool MessageMatches(string message) =>
        MessageRegex is null || SafeIsMatch(MessageRegex, message);

    /// <summary>True when every present condition holds.</summary>
    public bool Matches(string technique, string signal, string message) =>
        TechniqueMatches(technique) && SignalMatches(signal) && MessageMatches(message);

    // A pathological input that exceeds the match timeout counts as "no match":
    // evaluation continues with the next rule and, at worst, the finding stays
    // visible as UNMAPPED instead of failing the whole verification.
    private static bool SafeIsMatch(Regex regex, string input)
    {
        try
        {
            return regex.IsMatch(input);
        }
        catch (RegexMatchTimeoutException)
        {
            return false;
        }
    }
}

/// <summary>The validated, immutable Taxonomy_Definition.</summary>
public sealed class TaxonomyDefinition
{
    public TaxonomyDefinition(
        string path,
        string schema,
        string version,
        IReadOnlyDictionary<string, PrimaryType> primaryTypes,
        IReadOnlyDictionary<string, TaxonomyCategory> categories,
        IReadOnlyList<string> priorityOrder,
        UnmappedCategory unmapped,
        IReadOnlyList<string> checklist,
        IReadOnlyList<TaxonomyRule> rules,
        IReadOnlyDictionary<string, string> douFeedback,
        IReadOnlyDictionary<string, PromptTemplate> prompts)
    {
        Path = path;
        Schema = schema;
        Version = version;
        PrimaryTypes = primaryTypes;
        Categories = categories;
        PriorityOrder = priorityOrder;
        Unmapped = unmapped;
        Checklist = checklist;
        Rules = rules;
        DouFeedback = douFeedback;
        Prompts = prompts;
    }

    /// <summary>File the definition was loaded from.</summary>
    public string Path { get; }
    public string Schema { get; }
    public string Version { get; }

    /// <summary>Primary types keyed by ID, enumerated in ID order (A, B, C, D).</summary>
    public IReadOnlyDictionary<string, PrimaryType> PrimaryTypes { get; }

    /// <summary>Categories keyed by ID, enumerated in priority order.</summary>
    public IReadOnlyDictionary<string, TaxonomyCategory> Categories { get; }

    /// <summary>Category IDs A.1 … C.4 by priority (UNMAPPED excluded).</summary>
    public IReadOnlyList<string> PriorityOrder { get; }

    public UnmappedCategory Unmapped { get; }
    public IReadOnlyList<string> Checklist { get; }

    /// <summary>Rules in definition order (first match wins).</summary>
    public IReadOnlyList<TaxonomyRule> Rules { get; }

    public IReadOnlyDictionary<string, string> DouFeedback { get; }

    /// <summary>Prompt templates keyed by name, in document order.</summary>
    public IReadOnlyDictionary<string, PromptTemplate> Prompts { get; }

    /// <summary>Priority rank; UNMAPPED ranks below every category.</summary>
    /// <exception cref="KeyNotFoundException">Unknown category ID.</exception>
    public int Priority(string categoryId) =>
        categoryId == Unmapped.Id ? Unmapped.Priority : Categories[categoryId].Priority;

    /// <summary>Checklist joined with "\n" (trailing spaces preserved).</summary>
    public string ChecklistText() => string.Join("\n", Checklist);

    /// <exception cref="KeyNotFoundException">Unknown template name.</exception>
    public PromptTemplate Prompt(string name) => Prompts[name];
}
