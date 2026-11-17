namespace Backend.Services.Repair;

/// <summary>
/// Configurable diagnostic sources for the "improved" repair mode.
/// Standardized across both the web UI and the CLI experiment runner.
/// </summary>
public sealed class ImprovedRepairSources
{
    /// <summary>
    /// If true, includes detailed test failure tracebacks, assertion values, and expected outputs.
    /// OFF by default in benchmark evaluations to prevent test-fitting (Req 4).
    /// </summary>
    public bool VisibleTestDetail { get; set; } = false;

    /// <summary>
    /// Re-anchors the model on the task specification and confirmed function interface.
    /// Default true.
    /// </summary>
    public bool PromptOnly { get; set; } = true;

    /// <summary>
    /// Injects static analysis findings from Mypy (type errors), Radon (complexity hotspots),
    /// and Semgrep (security vulnerabilities).
    /// Default true.
    /// </summary>
    public bool StaticAnalysis { get; set; } = true;

    /// <summary>
    /// In Round 2, feeds the previous attempt's critique and unresolved bug history
    /// so the model does not repeat the same failure.
    /// Default true.
    /// </summary>
    public bool History { get; set; } = true;

    /// <summary>
    /// Returns the list of enabled source tags (e.g. "[prompt-only]", "[static-analysis]").
    /// </summary>
    public List<string> GetEnabledTags()
    {
        var tags = new List<string>();
        if (VisibleTestDetail) tags.Add("[visible-test-detail]");
        if (PromptOnly) tags.Add("[prompt-only]");
        if (StaticAnalysis) tags.Add("[static-analysis]");
        if (History) tags.Add("[history]");
        return tags;
    }
}
