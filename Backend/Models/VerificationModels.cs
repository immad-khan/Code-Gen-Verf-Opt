using System.Text.Json.Serialization;

namespace Backend.Models;

// ─────────────────────────────────────────────────────────────────────────────
// Web verification DTOs (design.md "Web verification and repair DTOs").
//
// The web shapes (VerificationResult, TechniqueStatus, MappedFinding, AdvisoryFinding,
// FindingLocation) carry explicit camelCase JsonPropertyName attributes so they match
// src/api/types.ts regardless of serializer options. Nullable members are always
// written (as null), never omitted.
//
// EnrichedFinding / VerifyCliReport mirror the snake_case JSON written by
// `python -m tivr.verify_cli` (tivr/schemas.py Finding, TechniqueStatus).
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>Body of <c>POST /api/verification</c>.</summary>
public class VerifyRequest
{
    [JsonPropertyName("files")]
    public List<GeneratedCodeFile> Files { get; set; } = new();
}

/// <summary>Technique IDs and status values shared by the verifier and the web API.</summary>
public static class VerificationTechniques
{
    public const string Syntax = "syntax";
    public const string Imports = "imports";
    public const string Tests = "tests";
    public const string Runtime = "runtime";
    public const string Types = "types";
    public const string Quality = "quality";
    public const string Security = "security";

    /// <summary>The four correctness techniques that gate the repair loop (Req. 19.5, 19.7).</summary>
    public static readonly IReadOnlyList<string> Correctness = [Syntax, Imports, Tests, Runtime];

    /// <summary>The advisory techniques; never mapped, never gate (Req. 20.1–20.3).</summary>
    public static readonly IReadOnlyList<string> Advisory = [Types, Quality, Security];

    public const string StatusPass = "pass";
    public const string StatusFail = "fail";
    public const string StatusSkippedUpstream = "skipped_upstream";
    public const string StatusNoTests = "no_tests";
    /// <summary>Harness crash / timeout: the technique returned no result (incomplete).</summary>
    public const string StatusError = "error";
}

/// <summary>Result of one verification of a set of files (<c>POST /api/verification</c>).</summary>
public class VerificationResult
{
    [JsonPropertyName("techniques")]
    public List<TechniqueStatus> Techniques { get; set; } = new();

    /// <summary>Blocking findings from syntax/imports/tests/runtime, each mapped to a category.</summary>
    [JsonPropertyName("correctnessFindings")]
    public List<MappedFinding> CorrectnessFindings { get; set; } = new();

    /// <summary>Advisory findings (types/quality/security); empty list when none (Req. 20.4).</summary>
    [JsonPropertyName("advisoryFindings")]
    public List<AdvisoryFinding> AdvisoryFindings { get; set; } = new();

    /// <summary>Zero correctness findings and a complete verification (Req. 19.5, 19.7).</summary>
    [JsonPropertyName("gatePassed")]
    public bool GatePassed { get; set; }

    /// <summary>All four correctness techniques returned a result (Req. 19.7).</summary>
    [JsonPropertyName("complete")]
    public bool Complete { get; set; }

    /// <summary>Correctness techniques that did not return a result.</summary>
    [JsonPropertyName("incompleteTechniques")]
    public List<string> IncompleteTechniques { get; set; } = new();

    /// <summary>"A" | "B" | "C" | "PASS".</summary>
    [JsonPropertyName("primaryState")]
    public string PrimaryState { get; set; } = "C";

    [JsonPropertyName("testsPassed")]
    public int TestsPassed { get; set; }

    [JsonPropertyName("testsFailed")]
    public int TestsFailed { get; set; }

    [JsonPropertyName("durationMs")]
    public long DurationMs { get; set; }
}

/// <summary>Status of one verification technique as shown in the web UI.</summary>
public class TechniqueStatus
{
    /// <summary>Technique ID, e.g. "syntax", "tests", "security".</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    /// <summary>"pass" | "fail" | "skipped_upstream" | "no_tests" | "error".</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = VerificationTechniques.StatusError;

    /// <summary>False when the technique returned no result (status "error").</summary>
    [JsonPropertyName("complete")]
    public bool Complete { get; set; }

    [JsonPropertyName("details")]
    public string Details { get; set; } = "";
}

/// <summary>File and optional line of a finding. Same keys in the web and verify_cli JSON.</summary>
public class FindingLocation
{
    [JsonPropertyName("file")]
    public string File { get; set; } = "";

    [JsonPropertyName("line")]
    public int? Line { get; set; }
}

/// <summary>A correctness finding with its taxonomy assignment (web shape).</summary>
public class MappedFinding
{
    /// <summary>"syntax" | "imports" | "tests" | "runtime".</summary>
    [JsonPropertyName("technique")]
    public string Technique { get; set; } = "";

    [JsonPropertyName("signal")]
    public string Signal { get; set; } = "";

    [JsonPropertyName("exception")]
    public string? Exception { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonPropertyName("evidence")]
    public string Evidence { get; set; } = "";

    [JsonPropertyName("location")]
    public FindingLocation? Location { get; set; }

    /// <summary>"A.1".."C.4" or "UNMAPPED".</summary>
    [JsonPropertyName("category")]
    public string Category { get; set; } = "";

    /// <summary>"A" | "B" | "C"; null for UNMAPPED.</summary>
    [JsonPropertyName("primaryType")]
    public string? PrimaryType { get; set; }

    [JsonPropertyName("categoryName")]
    public string? CategoryName { get; set; }

    [JsonPropertyName("repairHint")]
    public string? RepairHint { get; set; }

    [JsonPropertyName("confidence")]
    public double? Confidence { get; set; }

    [JsonPropertyName("occurrences")]
    public int Occurrences { get; set; } = 1;
}

/// <summary>An advisory finding (mypy/radon/semgrep). Never carries a taxonomy category (Req. 20.2).</summary>
public class AdvisoryFinding
{
    /// <summary>"types" | "quality" | "security".</summary>
    [JsonPropertyName("technique")]
    public string Technique { get; set; } = "";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonPropertyName("file")]
    public string? File { get; set; }

    [JsonPropertyName("line")]
    public int? Line { get; set; }
}

// ─────────────────────────────────────────────────────────────────────────────
// verify_cli JSON (snake_case, tivr/schemas.py)
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>Values of one failing suite assertion as <c>to_source</c> text; null = not extracted.</summary>
public class EnrichedAssertionValues
{
    [JsonPropertyName("input")]
    public string? Input { get; set; }

    [JsonPropertyName("actual")]
    public string? Actual { get; set; }

    [JsonPropertyName("expected")]
    public string? Expected { get; set; }
}

/// <summary>
/// A finding as produced by the TIVR verifier enrichment layer (tivr/schemas.py <c>Finding</c>).
/// The signal is already the canonical enriched signal (e.g. <c>runtime:NameError:stdlib_unbound</c>),
/// so the C# mapper only evaluates the shared rules.
/// </summary>
public class EnrichedFinding
{
    /// <summary>syntax | imports | tests | runtime | types | quality | security.</summary>
    [JsonPropertyName("technique")]
    public string Technique { get; set; } = "";

    /// <summary>"blocking" | "advisory".</summary>
    [JsonPropertyName("severity")]
    public string Severity { get; set; } = Blocking;

    [JsonPropertyName("signal")]
    public string Signal { get; set; } = "";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonPropertyName("evidence")]
    public string Evidence { get; set; } = "";

    [JsonPropertyName("exception")]
    public string? Exception { get; set; }

    [JsonPropertyName("location")]
    public FindingLocation? Location { get; set; }

    [JsonPropertyName("test_id")]
    public string? TestId { get; set; }

    [JsonPropertyName("occurrences")]
    public int Occurrences { get; set; } = 1;

    [JsonPropertyName("values")]
    public List<EnrichedAssertionValues> Values { get; set; } = new();

    public const string Blocking = "blocking";
    public const string Advisory = "advisory";

    [JsonIgnore]
    public bool IsBlocking => Severity == Blocking;
}

/// <summary>One technique status in the verify_cli report (tivr/schemas.py <c>TechniqueStatus</c>).</summary>
public class VerifyCliTechniqueStatus
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = VerificationTechniques.StatusError;

    /// <summary>Null when omitted; derived as <c>status != "error"</c> (see <see cref="IsComplete"/>).</summary>
    [JsonPropertyName("complete")]
    public bool? Complete { get; set; }

    [JsonPropertyName("details")]
    public string Details { get; set; } = "";

    [JsonIgnore]
    public bool IsComplete => Status != VerificationTechniques.StatusError && (Complete ?? true);
}

/// <summary>
/// The file written by <c>python -m tivr.verify_cli --project DIR --out FILE</c>:
/// <c>{"techniques": {...4 statuses...}, "correctness": [Finding...], "tests_passed": n, "tests_failed": n}</c>.
/// </summary>
public class VerifyCliReport
{
    /// <summary>Keyed by correctness technique ID (syntax, imports, tests, runtime).</summary>
    [JsonPropertyName("techniques")]
    public Dictionary<string, VerifyCliTechniqueStatus> Techniques { get; set; } = new();

    [JsonPropertyName("correctness")]
    public List<EnrichedFinding> Correctness { get; set; } = new();

    [JsonPropertyName("tests_passed")]
    public int TestsPassed { get; set; }

    [JsonPropertyName("tests_failed")]
    public int TestsFailed { get; set; }
}
