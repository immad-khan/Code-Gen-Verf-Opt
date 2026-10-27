using System.Text.RegularExpressions;

namespace Backend.Services.Experiments;

/// <summary>Run-ID validation; mirrors <c>RUN_ID_PATTERN</c> in <c>tivr/config.py</c>.</summary>
public static partial class RunIds
{
    /// <summary>
    /// <c>^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$</c> with Python <c>fullmatch</c> semantics
    /// (<c>\z</c>, so a trailing newline is rejected).
    /// </summary>
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\z", RegexOptions.CultureInvariant)]
    private static partial Regex PatternRegex();

    public static Regex Pattern => PatternRegex();

    public static bool IsValid(string? runId) => runId is not null && PatternRegex().IsMatch(runId);
}
