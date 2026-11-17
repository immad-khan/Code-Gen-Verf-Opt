using System.Text.Json.Serialization;
using Backend.Services.Repair;

namespace Backend.Models;

/// <summary>
/// Request payload for side-by-side comparison mode (POST /api/optimization/compare).
/// Runs both 'dou' and 'improved' repair branches in parallel from the same Round 0 code.
/// </summary>
public class CompareRepairRequest
{
    [JsonPropertyName("files")]
    public List<GeneratedCodeFile> Files { get; set; } = new();

    [JsonPropertyName("originalPrompt")]
    public string OriginalPrompt { get; set; } = "";

    [JsonPropertyName("apiSettings")]
    public ApiSettings ApiSettings { get; set; } = new();

    [JsonPropertyName("verificationResult")]
    public VerificationResponse? VerificationResult { get; set; }

    [JsonPropertyName("maxIterations")]
    public int MaxIterations { get; set; } = 2;

    [JsonPropertyName("lockedTestHash")]
    public string? LockedTestHash { get; set; }

    [JsonPropertyName("improvedSources")]
    public ImprovedRepairSources ImprovedSources { get; set; } = new();
}

/// <summary>
/// Side-by-side comparison response containing both branch results and an analytical summary.
/// </summary>
public class CompareRepairResponse
{
    [JsonPropertyName("douResult")]
    public OptimizationResponse DouResult { get; set; } = new();

    [JsonPropertyName("improvedResult")]
    public OptimizationResponse ImprovedResult { get; set; } = new();

    [JsonPropertyName("summary")]
    public ComparisonSummary Summary { get; set; } = new();

    [JsonPropertyName("totalDurationMs")]
    public long TotalDurationMs { get; set; }
}

/// <summary>
/// Analytical summary comparing repair efficiency between Dou baseline and Improved mode.
/// </summary>
public class ComparisonSummary
{
    [JsonPropertyName("douFixedInRound1")]
    public bool DouFixedInRound1 { get; set; }

    [JsonPropertyName("douFixedInRound2")]
    public bool DouFixedInRound2 { get; set; }

    [JsonPropertyName("douUnresolved")]
    public bool DouUnresolved { get; set; }

    [JsonPropertyName("douTotalTokens")]
    public int DouTotalTokens { get; set; }

    [JsonPropertyName("improvedFixedInRound1")]
    public bool ImprovedFixedInRound1 { get; set; }

    [JsonPropertyName("improvedFixedInRound2")]
    public bool ImprovedFixedInRound2 { get; set; }

    [JsonPropertyName("improvedUnresolved")]
    public bool ImprovedUnresolved { get; set; }

    [JsonPropertyName("improvedTotalTokens")]
    public int ImprovedTotalTokens { get; set; }

    /// <summary>"improved" | "dou" | "tie"</summary>
    [JsonPropertyName("winner")]
    public string Winner { get; set; } = "tie";

    [JsonPropertyName("description")]
    public string Description { get; set; } = "";
}
