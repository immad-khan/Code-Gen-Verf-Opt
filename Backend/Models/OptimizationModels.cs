using System.Text.Json;
using System.Text.Json.Serialization;

namespace Backend.Models;

// ─────────────────────────────────────────────────────────────────────────────
// Web repair DTOs (design.md "Web verification and repair DTOs").
//
// Every member carries an explicit camelCase JsonPropertyName so the JSON matches
// src/api/types.ts regardless of serializer options. Nullable members are always
// written (as null), never omitted. The pre-rewrite optimization types live in
// LegacyOptimizationModels.cs until task 12.6 deletes them.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>Repair modes accepted by the web repair endpoint (Req. 22.1), case-sensitive.</summary>
public static class RepairModes
{
    public const string Dou = "dou";
    public const string DouNoBt = "dou_no_bt";
    public const string Generic = "generic";
    public const string EvidenceOnly = "evidence_only";
    public const string TaxonomyOnly = "taxonomy_only";
    public const string Full = "full";

    public static readonly IReadOnlyList<string> All = [Dou, DouNoBt, Generic, EvidenceOnly, TaxonomyOnly, Full];
}

/// <summary>Defaults applied when a repair setting is null or omitted (Req. 22.2).</summary>
public static class RepairDefaults
{
    public const string RepairMode = RepairModes.Dou;
    public const int K = 2;
    public const double Temperature = 0.1;
    public const int MinK = 1;
    public const int MaxK = 3;
    public const double MinTemperature = 0.0;
    public const double MaxTemperature = 1.0;
}

/// <summary>Values of <see cref="RepairResult.RepairSuccess"/>.</summary>
public static class RepairSuccessValues
{
    public const string Repaired = "repaired";
    public const string NotRepaired = "not_repaired";
    public const string NotApplicable = "not_applicable";
}

/// <summary>Values of <see cref="RepairSessionView.Status"/>.</summary>
public static class RepairSessionStatus
{
    public const string Running = "running";
    public const string Completed = "completed";
    public const string Failed = "failed";
}

/// <summary>
/// Body of <c>POST /api/optimization/repair-sessions</c>.
/// <c>repairMode</c>, <c>k</c>, and <c>temperature</c> bind as raw JSON so model binding never
/// fails on a wrong type; RepairRequestValidator checks them and reports every invalid field
/// (Req. 22.3, 22.4). Null or omitted → <c>null</c> here → default.
/// </summary>
public class RepairSessionRequest
{
    [JsonPropertyName("files")]
    public List<GeneratedCodeFile> Files { get; set; } = new();

    [JsonPropertyName("originalPrompt")]
    public string OriginalPrompt { get; set; } = "";

    [JsonPropertyName("apiSettings")]
    public ApiSettings ApiSettings { get; set; } = new();

    [JsonPropertyName("repairMode")]
    public JsonElement? RepairMode { get; set; }

    [JsonPropertyName("k")]
    public JsonElement? K { get; set; }

    [JsonPropertyName("temperature")]
    public JsonElement? Temperature { get; set; }
}

/// <summary>The repair settings actually used for a session (Req. 22.7).</summary>
public class EffectiveRepairConfig
{
    [JsonPropertyName("repairMode")]
    public string RepairMode { get; set; } = RepairDefaults.RepairMode;

    [JsonPropertyName("k")]
    public int K { get; set; } = RepairDefaults.K;

    [JsonPropertyName("temperature")]
    public double Temperature { get; set; } = RepairDefaults.Temperature;
}

/// <summary>202 response of <c>POST /api/optimization/repair-sessions</c>.</summary>
public class CreateRepairSessionResponse
{
    [JsonPropertyName("sessionId")]
    public string SessionId { get; set; } = "";

    [JsonPropertyName("effectiveConfig")]
    public EffectiveRepairConfig EffectiveConfig { get; set; } = new();
}

/// <summary>Primary_State transition of one repair iteration (Req. 21.1, 21.7).</summary>
public class IterationTransition
{
    /// <summary>"A" | "B" | "C".</summary>
    [JsonPropertyName("from")]
    public string From { get; set; } = "";

    /// <summary>"A" | "B" | "C" | "PASS"; null when the re-verification was incomplete.</summary>
    [JsonPropertyName("to")]
    public string? To { get; set; }

    [JsonPropertyName("available")]
    public bool Available { get; set; }

    /// <summary>Why the transition is unavailable (incomplete re-verification); null otherwise.</summary>
    [JsonPropertyName("failure")]
    public string? Failure { get; set; }
}

/// <summary>One executed repair iteration (<c>GET .../iterations/{n}</c>).</summary>
public class RepairIteration
{
    /// <summary>1-based iteration number.</summary>
    [JsonPropertyName("iteration")]
    public int Iteration { get; set; }

    [JsonPropertyName("prompt")]
    public string Prompt { get; set; } = "";

    [JsonPropertyName("rawResponse")]
    public string RawResponse { get; set; } = "";

    /// <summary>Text outside code fences; null when empty.</summary>
    [JsonPropertyName("critiqueText")]
    public string? CritiqueText { get; set; }

    [JsonPropertyName("noExtractableCode")]
    public bool NoExtractableCode { get; set; }

    [JsonPropertyName("filesBefore")]
    public List<GeneratedCodeFile> FilesBefore { get; set; } = new();

    [JsonPropertyName("filesAfter")]
    public List<GeneratedCodeFile> FilesAfter { get; set; } = new();

    [JsonPropertyName("verification")]
    public VerificationResult Verification { get; set; } = new();

    [JsonPropertyName("verificationComplete")]
    public bool VerificationComplete { get; set; }

    [JsonPropertyName("transition")]
    public IterationTransition Transition { get; set; } = new();

    [JsonPropertyName("categoriesBefore")]
    public List<string> CategoriesBefore { get; set; } = new();

    [JsonPropertyName("categoriesAfter")]
    public List<string> CategoriesAfter { get; set; } = new();

    /// <summary>categoriesAfter \ categoriesBefore (Req. 21.3).</summary>
    [JsonPropertyName("introduced")]
    public List<string> Introduced { get; set; } = new();

    /// <summary>categoriesBefore \ categoriesAfter (Req. 21.3).</summary>
    [JsonPropertyName("resolved")]
    public List<string> Resolved { get; set; } = new();

    [JsonPropertyName("durationMs")]
    public long DurationMs { get; set; }
}

/// <summary>Correctness-finding counts by fingerprint multiset (Req. 19.4).</summary>
public class BugCounts
{
    [JsonPropertyName("foundInitially")]
    public int FoundInitially { get; set; }

    [JsonPropertyName("resolved")]
    public int Resolved { get; set; }

    [JsonPropertyName("remaining")]
    public int Remaining { get; set; }

    [JsonPropertyName("introduced")]
    public int Introduced { get; set; }
}

/// <summary>One row of the result's transition table (Req. 21.1, 21.4).</summary>
public class RepairTransition
{
    [JsonPropertyName("iteration")]
    public int Iteration { get; set; }

    [JsonPropertyName("from")]
    public string From { get; set; } = "";

    /// <summary>Null when the transition is unavailable.</summary>
    [JsonPropertyName("to")]
    public string? To { get; set; }

    [JsonPropertyName("count")]
    public int Count { get; set; } = 1;

    [JsonPropertyName("available")]
    public bool Available { get; set; }
}

/// <summary>
/// An entry of <see cref="RepairResult.IncompleteVerifications"/>: the initial verification
/// (JSON <c>"initial"</c>) or a repair iteration (JSON number) (Req. 21.8).
/// </summary>
[JsonConverter(typeof(IncompleteVerificationJsonConverter))]
public readonly record struct IncompleteVerification
{
    public const string InitialToken = "initial";

    /// <summary>Null for the initial verification; otherwise the 1-based iteration.</summary>
    public int? IterationNumber { get; }

    public bool IsInitial => IterationNumber is null;

    private IncompleteVerification(int? iteration) => IterationNumber = iteration;

    public static IncompleteVerification Initial { get; } = new(null);

    public static IncompleteVerification ForIteration(int iteration) =>
        iteration >= 1
            ? new(iteration)
            : throw new ArgumentOutOfRangeException(nameof(iteration), iteration, "Iteration numbers start at 1.");

    public override string ToString() => IsInitial ? InitialToken : IterationNumber!.Value.ToString();
}

/// <summary>Writes <c>"initial"</c> or the iteration number; reads the same.</summary>
public sealed class IncompleteVerificationJsonConverter : JsonConverter<IncompleteVerification>
{
    public override IncompleteVerification Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String && reader.ValueTextEquals(IncompleteVerification.InitialToken))
            return IncompleteVerification.Initial;
        if (reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var n) && n >= 1)
            return IncompleteVerification.ForIteration(n);
        throw new JsonException("Expected \"initial\" or a positive integer iteration number.");
    }

    public override void Write(Utf8JsonWriter writer, IncompleteVerification value, JsonSerializerOptions options)
    {
        if (value.IsInitial) writer.WriteStringValue(IncompleteVerification.InitialToken);
        else writer.WriteNumberValue(value.IterationNumber!.Value);
    }
}

/// <summary>Final result of a repair session.</summary>
public class RepairResult
{
    [JsonPropertyName("effectiveConfig")]
    public EffectiveRepairConfig EffectiveConfig { get; set; } = new();

    [JsonPropertyName("iterationsPerformed")]
    public int IterationsPerformed { get; set; }

    [JsonPropertyName("initial")]
    public VerificationResult Initial { get; set; } = new();

    [JsonPropertyName("iterations")]
    public List<RepairIteration> Iterations { get; set; } = new();

    /// <summary>"repaired" | "not_repaired" | "not_applicable" (see <see cref="RepairSuccessValues"/>).</summary>
    [JsonPropertyName("repairSuccess")]
    public string RepairSuccess { get; set; } = RepairSuccessValues.NotApplicable;

    /// <summary>Length k, carried over skipped iterations; null when not applicable (Req. 19.2).</summary>
    [JsonPropertyName("passedByIteration")]
    public List<bool>? PassedByIteration { get; set; }

    [JsonPropertyName("bugCounts")]
    public BugCounts BugCounts { get; set; } = new();

    [JsonPropertyName("transitions")]
    public List<RepairTransition> Transitions { get; set; } = new();

    /// <summary>Verifications that did not complete: "initial" and/or iteration numbers (Req. 21.8).</summary>
    [JsonPropertyName("incompleteVerifications")]
    public List<IncompleteVerification> IncompleteVerifications { get; set; } = new();

    [JsonPropertyName("finalFiles")]
    public List<GeneratedCodeFile> FinalFiles { get; set; } = new();
}

/// <summary>Progress available while a session runs: the initial verification and finished iterations.</summary>
public class RepairPartialResult
{
    [JsonPropertyName("initial")]
    public VerificationResult Initial { get; set; } = new();

    [JsonPropertyName("iterations")]
    public List<RepairIteration> Iterations { get; set; } = new();
}

/// <summary>Failed operation and reason of a failed session (never contains the API key).</summary>
public class RepairSessionError
{
    [JsonPropertyName("operation")]
    public string Operation { get; set; } = "";

    [JsonPropertyName("reason")]
    public string Reason { get; set; } = "";
}

/// <summary>Response of <c>GET /api/optimization/repair-sessions/{id}</c>.</summary>
public class RepairSessionView
{
    [JsonPropertyName("sessionId")]
    public string SessionId { get; set; } = "";

    /// <summary>"running" | "completed" | "failed" (see <see cref="RepairSessionStatus"/>).</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = RepairSessionStatus.Running;

    [JsonPropertyName("effectiveConfig")]
    public EffectiveRepairConfig EffectiveConfig { get; set; } = new();

    [JsonPropertyName("iterationsCompleted")]
    public int IterationsCompleted { get; set; }

    [JsonPropertyName("partial")]
    public RepairPartialResult? Partial { get; set; }

    [JsonPropertyName("result")]
    public RepairResult? Result { get; set; }

    [JsonPropertyName("error")]
    public RepairSessionError? Error { get; set; }
}
