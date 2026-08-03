namespace Backend.Models;

/// <summary>
/// Execution metrics and verification statuses for a single round (Round 0, Round 1, Round 2).
/// </summary>
public class RunRoundResult
{
    public int RoundIndex { get; set; } // 0, 1, 2
    public List<GeneratedCodeFile> CodeSnapshot { get; set; } = new();
    public List<VerificationTechnique> TechniqueStatuses { get; set; } = new();
    public List<BugClassification> DiagnosedBugs { get; set; } = new();
    public TestRunSummary TestsSummary { get; set; } = new();
    public string PromptSent { get; set; } = "";
    public string LlmResponse { get; set; } = "";
    public TokenAccounting TokenMetrics { get; set; } = new();
    public long DurationMs { get; set; }
    public string Verdict { get; set; } = "UNKNOWN"; // VERIFIED, FAIL, NOT_VERIFIED, ERROR
}

public class TestRunSummary
{
    public int Total { get; set; }
    public int Passed { get; set; }
    public int Failed { get; set; }
    public int Skipped { get; set; }
    public double PassRate { get; set; }
}

public class TokenAccounting
{
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public int ReasoningTokens { get; set; }
    public int TotalTokens { get; set; }
}

/// <summary>
/// Single Source of Truth for a full synthesis, verification, and repair run.
/// Read by all workbench UI pages (Step 3, Step 4, Step 8) to ensure 100% metric consistency.
/// </summary>
public class RunResult
{
    public string RunId { get; set; } = Guid.NewGuid().ToString("N");
    public string Model { get; set; } = "";
    public string Timestamp { get; set; } = DateTime.UtcNow.ToString("o");
    public string OriginalPrompt { get; set; } = "";
    public Dictionary<string, object> Parameters { get; set; } = new();

    public List<RunRoundResult> Rounds { get; set; } = new();

    public int InitialFailingBugs { get; set; }
    public int FixedBugs { get; set; }
    
    /// <summary>
    /// RSR = fixed_bugs / initial_failing. Null if initial_failing == 0 (UI renders as "N/A").
    /// </summary>
    public double? RepairSuccessRate { get; set; }
    
    /// <summary>
    /// True when Round 0 passed all checks and no repair was executed.
    /// </summary>
    public bool RepairSkipped { get; set; }
    
    /// <summary>
    /// VERIFIED (only if pytest executed and 100% passed) | FAIL | NOT_VERIFIED (amber) | ERROR
    /// </summary>
    public string OverallVerdict { get; set; } = "NOT_VERIFIED";

    public string BaselineLabel { get; set; } = "Paper, GPT-4 (Dou et al.)";
    public double BaselineComparator { get; set; } = 29.2;
    public long TotalDurationMs { get; set; }
}
