using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Backend.Models;

/// <summary>
/// Individual prompt example evaluation result (labeled "from prompt").
/// </summary>
public class PromptExampleResult
{
    [JsonPropertyName("example")]
    public string Example { get; set; } = "";

    [JsonPropertyName("input")]
    public string Input { get; set; } = "";

    [JsonPropertyName("expected")]
    public string Expected { get; set; } = "";

    [JsonPropertyName("actual")]
    public string Actual { get; set; } = "";

    [JsonPropertyName("passed")]
    public bool Passed { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

/// <summary>
/// Check 1: Prompt Examples Check (runs examples written in user prompt as extra tests).
/// </summary>
public class PromptExamplesCheckResult
{
    [JsonPropertyName("executed")]
    public bool Executed { get; set; }

    [JsonPropertyName("totalExamples")]
    public int TotalExamples { get; set; }

    [JsonPropertyName("passedExamples")]
    public int PassedExamples { get; set; }

    [JsonPropertyName("failedExamples")]
    public int FailedExamples { get; set; }

    [JsonPropertyName("examples")]
    public List<PromptExampleResult> Examples { get; set; } = new();

    [JsonPropertyName("warnings")]
    public List<string> Warnings { get; set; } = new();
}

/// <summary>
/// Check 2: Fuzz Check via Hypothesis (derives inputs from signature type hints, checks exceptions, return type, timeouts).
/// </summary>
public class FuzzCheckResult
{
    [JsonPropertyName("executed")]
    public bool Executed { get; set; }

    [JsonPropertyName("inputsTried")]
    public int InputsTried { get; set; }

    [JsonPropertyName("hasUnexpectedException")]
    public bool HasUnexpectedException { get; set; }

    [JsonPropertyName("hasWrongReturnType")]
    public bool HasWrongReturnType { get; set; }

    [JsonPropertyName("hasTimeout")]
    public bool HasTimeout { get; set; }

    [JsonPropertyName("failureDetails")]
    public string? FailureDetails { get; set; }

    [JsonPropertyName("warnings")]
    public List<string> Warnings { get; set; } = new();
}

/// <summary>
/// Disagreement item between solution 1 and solution 2.
/// </summary>
public class DisagreementDetail
{
    [JsonPropertyName("input")]
    public string Input { get; set; } = "";

    [JsonPropertyName("solution1Output")]
    public string Solution1Output { get; set; } = "";

    [JsonPropertyName("solution2Output")]
    public string Solution2Output { get; set; } = "";
}

/// <summary>
/// Check 3: Optional Second Solution (Differential Testing / Disagreements).
/// </summary>
public class SecondSolutionCheckResult
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [JsonPropertyName("executed")]
    public bool Executed { get; set; }

    [JsonPropertyName("secondaryModel")]
    public string? SecondaryModel { get; set; }

    [JsonPropertyName("totalInputsTested")]
    public int TotalInputsTested { get; set; }

    [JsonPropertyName("disagreementCount")]
    public int DisagreementCount { get; set; }

    [JsonPropertyName("disagreements")]
    public List<DisagreementDetail> Disagreements { get; set; } = new();

    [JsonPropertyName("warnings")]
    public List<string> Warnings { get; set; } = new();
}

/// <summary>
/// Container for all 3 Independent Checks (shown as warnings, never proof, never altering locked tests or verdict).
/// </summary>
public class IndependentChecksResult
{
    [JsonPropertyName("promptExamples")]
    public PromptExamplesCheckResult PromptExamples { get; set; } = new();

    [JsonPropertyName("fuzzCheck")]
    public FuzzCheckResult FuzzCheck { get; set; } = new();

    [JsonPropertyName("secondSolution")]
    public SecondSolutionCheckResult SecondSolution { get; set; } = new();

    [JsonPropertyName("allWarnings")]
    public List<string> AllWarnings { get; set; } = new();
}
