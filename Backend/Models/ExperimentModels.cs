using System.Text.Json;
using System.Text.Json.Serialization;

namespace Backend.Models;

// ─────────────────────────────────────────────────────────────────────────────
// Experiments API DTOs (design.md "Experiments API", Requirement 24).
//
// Envelopes carry explicit camelCase JsonPropertyName attributes so they match
// src/api/types.ts regardless of serializer options. Nullable members are always
// written (as null), never omitted.
//
// manifest.json, summary.json, and trajectories.jsonl entries written by TIVR are
// passed through unchanged as JsonElement, so they keep their snake_case keys.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>Vocabulary shared by the Experiments services and controller.</summary>
public static class ExperimentValues
{
    public const string ProvenanceManifest = "manifest";
    public const string ProvenanceLegacy = "legacy";

    public const string StatusRunning = "running";
    public const string StatusCompleted = "completed";
    public const string StatusFailed = "failed";
    public const string StatusCancelled = "cancelled";

    public static readonly IReadOnlyList<string> Phases = ["generation", "repair", "summary", "done"];
    public static readonly IReadOnlyList<string> LlmModes = ["mock", "live"];
    public static readonly IReadOnlyList<string> GenerationPromptStyles = ["dou", "tivr"];

    /// <summary>Terminal statuses that a <c>.maci/&lt;id&gt;.status.json</c> sidecar may record.</summary>
    public static readonly IReadOnlyList<string> TerminalStatuses = [StatusCompleted, StatusFailed, StatusCancelled];
}

/// <summary>One prepared Task_Record file (<c>GET /api/experiments/datasets</c>, Req. 24.1).</summary>
public sealed class DatasetInfo
{
    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    /// <summary>Number of non-empty JSONL lines.</summary>
    [JsonPropertyName("taskCount")]
    public int TaskCount { get; set; }

    /// <summary>Lowercase hexadecimal SHA-256 of the file bytes.</summary>
    [JsonPropertyName("sha256")]
    public string Sha256 { get; set; } = "";
}

/// <summary>One reusable Generation_Cache in <c>&lt;data&gt;/caches</c> (<c>GET /api/experiments/caches</c>).</summary>
public sealed class CacheInfo
{
    /// <summary>Path relative to the data directory with '/' separators (usable as <c>generationCache</c>).</summary>
    [JsonPropertyName("path")]
    public string Path { get; set; } = "";

    [JsonPropertyName("datasetSha256")]
    public string DatasetSha256 { get; set; } = "";

    [JsonPropertyName("model")]
    public string Model { get; set; } = "";

    [JsonPropertyName("llmMode")]
    public string LlmMode { get; set; } = "";

    [JsonPropertyName("generationPromptStyle")]
    public string GenerationPromptStyle { get; set; } = "";
}

/// <summary>
/// Body of <c>POST /api/experiments/runs</c> (Req. 24.3). Every field binds as
/// <see cref="JsonElement"/> so model binding never fails and the validator can report
/// each invalid field (Req. 24.12).
/// </summary>
public sealed class StartRunRequest
{
    [JsonPropertyName("dataset")]
    public JsonElement? Dataset { get; set; }

    [JsonPropertyName("repairMode")]
    public JsonElement? RepairMode { get; set; }

    [JsonPropertyName("feedbackRegime")]
    public JsonElement? FeedbackRegime { get; set; }

    [JsonPropertyName("k")]
    public JsonElement? K { get; set; }

    [JsonPropertyName("temperature")]
    public JsonElement? Temperature { get; set; }

    [JsonPropertyName("generationPromptStyle")]
    public JsonElement? GenerationPromptStyle { get; set; }

    [JsonPropertyName("sampleSize")]
    public JsonElement? SampleSize { get; set; }

    [JsonPropertyName("seed")]
    public JsonElement? Seed { get; set; }

    [JsonPropertyName("generationCache")]
    public JsonElement? GenerationCache { get; set; }

    [JsonPropertyName("mock")]
    public JsonElement? Mock { get; set; }
}

/// <summary>202 response of <c>POST /api/experiments/runs</c>.</summary>
public sealed class StartRunResponse
{
    [JsonPropertyName("runId")]
    public string RunId { get; set; } = "";
}

/// <summary>Rate object from Run_Summary (<c>pct</c> is null when <c>den == 0</c>).</summary>
public sealed class RateWithIteration
{
    [JsonPropertyName("iteration")]
    public int Iteration { get; set; }

    [JsonPropertyName("num")]
    public int Num { get; set; }

    [JsonPropertyName("den")]
    public int Den { get; set; }

    [JsonPropertyName("pct")]
    public double? Pct { get; set; }
}

/// <summary>One entry of <c>GET /api/experiments/runs</c> (Req. 24.8, 24.10).</summary>
public sealed class RunListItem
{
    [JsonPropertyName("runId")]
    public string RunId { get; set; } = "";

    /// <summary><c>manifest</c> or <c>legacy</c> (no readable manifest).</summary>
    [JsonPropertyName("provenance")]
    public string Provenance { get; set; } = ExperimentValues.ProvenanceLegacy;

    [JsonPropertyName("status")]
    public string Status { get; set; } = ExperimentValues.StatusFailed;

    [JsonPropertyName("startTime")]
    public string? StartTime { get; set; }

    [JsonPropertyName("repairMode")]
    public string? RepairMode { get; set; }

    [JsonPropertyName("feedbackRegime")]
    public string? FeedbackRegime { get; set; }

    [JsonPropertyName("k")]
    public int? K { get; set; }

    [JsonPropertyName("model")]
    public string? Model { get; set; }

    [JsonPropertyName("sampleSize")]
    public int? SampleSize { get; set; }

    [JsonPropertyName("llmMode")]
    public string? LlmMode { get; set; }

    [JsonPropertyName("datasetSha256")]
    public string? DatasetSha256 { get; set; }

    [JsonPropertyName("generationCacheSha256")]
    public string? GenerationCacheSha256 { get; set; }

    [JsonPropertyName("seed")]
    public int? Seed { get; set; }

    /// <summary>RSR per iteration from <c>summary.json</c>; null when the run has no summary.</summary>
    [JsonPropertyName("rsr")]
    public List<RateWithIteration>? Rsr { get; set; }
}

/// <summary><c>GET /api/experiments/runs/{id}</c>. Legacy runs may lack manifest and/or summary.</summary>
public sealed class RunDetail
{
    [JsonPropertyName("runId")]
    public string RunId { get; set; } = "";

    [JsonPropertyName("provenance")]
    public string Provenance { get; set; } = ExperimentValues.ProvenanceLegacy;

    [JsonPropertyName("status")]
    public string Status { get; set; } = ExperimentValues.StatusFailed;

    /// <summary><c>manifest.json</c> passed through unchanged.</summary>
    [JsonPropertyName("manifest")]
    public JsonElement? Manifest { get; set; }

    /// <summary><c>summary.json</c> passed through unchanged.</summary>
    [JsonPropertyName("summary")]
    public JsonElement? Summary { get; set; }
}

/// <summary><c>GET /api/experiments/runs/{id}/status</c> (Req. 24.6, 24.14).</summary>
public sealed class RunStatus
{
    [JsonPropertyName("runId")]
    public string RunId { get; set; } = "";

    [JsonPropertyName("status")]
    public string Status { get; set; } = ExperimentValues.StatusFailed;

    [JsonPropertyName("phase")]
    public string? Phase { get; set; }

    [JsonPropertyName("completed")]
    public int? Completed { get; set; }

    [JsonPropertyName("total")]
    public int? Total { get; set; }

    /// <summary>Last ≤200 lines of combined runner stdout/stderr.</summary>
    [JsonPropertyName("outputTail")]
    public List<string> OutputTail { get; set; } = new();

    [JsonPropertyName("exitCode")]
    public int? ExitCode { get; set; }

    [JsonPropertyName("launchError")]
    public string? LaunchError { get; set; }
}

/// <summary><c>POST /api/experiments/runs/{id}/cancel</c>.</summary>
public sealed class CancelRunResponse
{
    [JsonPropertyName("runId")]
    public string RunId { get; set; } = "";

    [JsonPropertyName("status")]
    public string Status { get; set; } = ExperimentValues.StatusCancelled;
}

/// <summary><c>GET /api/experiments/runs/{id}/trajectories?page=N</c> (Req. 24.9).</summary>
public sealed class TrajectoryPage
{
    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("pageSize")]
    public int PageSize { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }

    /// <summary>trajectories.jsonl entries in write order, passed through unchanged.</summary>
    [JsonPropertyName("entries")]
    public List<JsonElement> Entries { get; set; } = new();
}

/// <summary>Contents of <c>progress.json</c> written by the runner.</summary>
public sealed record RunProgress(string? Phase, int? Completed, int? Total);

/// <summary>
/// <c>&lt;runs_root&gt;/.maci/&lt;run_id&gt;.status.json</c>, written by the Experiments API when a
/// run exits, is cancelled, or fails to launch (Req. 24.14).
/// </summary>
public sealed class RunStatusSidecar
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = ExperimentValues.StatusFailed;

    [JsonPropertyName("exitCode")]
    public int? ExitCode { get; set; }

    [JsonPropertyName("launchError")]
    public string? LaunchError { get; set; }

    [JsonPropertyName("endedAt")]
    public string? EndedAt { get; set; }
}
