namespace Backend.Models;

// ───────────────────────────────────────────────── Request / Response

public class OptimizationRequest
{
    public List<GeneratedCodeFile> Files { get; set; } = new();
    public string OriginalPrompt { get; set; } = "";
    public ApiSettings ApiSettings { get; set; } = new();
    public VerificationResponse? VerificationResult { get; set; }
    public int MaxIterations { get; set; } = 2;
}

public class OptimizationResponse
{
    public List<OptimizationIteration> Iterations { get; set; } = new();
    public BugTaxonomyReport InitialDiagnosis { get; set; } = new();
    public BugTaxonomyReport FinalDiagnosis { get; set; } = new();
    public OptimizationSummary Summary { get; set; } = new();
    public long TotalDurationMs { get; set; }
}

// ───────────────────────────────────────────────── Per-iteration data

public class OptimizationIteration
{
    public int IterationNumber { get; set; }
    public BugTaxonomyReport Diagnosis { get; set; } = new();
    public string CritiquePrompt { get; set; } = "";
    public string LlmCritiqueResponse { get; set; } = "";
    public List<GeneratedCodeFile> RepairedFiles { get; set; } = new();
    public VerificationResponse? ReVerification { get; set; }
    public int BugsFixedThisIteration { get; set; }
    public int BugsRemainingAfter { get; set; }
    public long DurationMs { get; set; }
}

// ───────────────────────────────────────────────── Bug Taxonomy (Dou et al.)

public class BugTaxonomyReport
{
    public List<BugClassification> Bugs { get; set; } = new();
    public int TotalBugs { get; set; }
    public int SyntaxBugs { get; set; }      // Type A
    public int RuntimeBugs { get; set; }     // Type B
    public int FunctionalBugs { get; set; }  // Type C
    public Dictionary<string, int> SecondaryDistribution { get; set; } = new();
}

public class BugClassification
{
    /// <summary>Dou et al. ID: A.1, A.2, A.3, B.1–B.5, C.1–C.4</summary>
    public string TaxonomyId { get; set; } = "";
    /// <summary>e.g. "Syntax Bug", "Runtime Bug", "Functional Bug"</summary>
    public string PrimaryType { get; set; } = "";
    /// <summary>e.g. "Incomplete syntax structure", "API misuse"</summary>
    public string SecondaryType { get; set; } = "";
    public string File { get; set; } = "";
    public int? Line { get; set; }
    public string Message { get; set; } = "";
    public string CompilerFeedback { get; set; } = "";
    public string Severity { get; set; } = "ERROR";
    public string? CodeSnippet { get; set; }
}

// ───────────────────────────────────────────────── Summary

public class OptimizationSummary
{
    public int TotalBugsBefore { get; set; }
    public int TotalBugsAfter { get; set; }
    public int TotalBugsFixed { get; set; }
    public double RepairSuccessRate { get; set; } // (fixed / before) * 100
    public int IterationsPerformed { get; set; }

    // Per-iteration breakdown
    public int BugsFixedIteration1 { get; set; }
    public int BugsFixedIteration2 { get; set; }

    // Per-category repair rates
    public double SyntaxRepairRate { get; set; }
    public double RuntimeRepairRate { get; set; }
    public double FunctionalRepairRate { get; set; }

    // Bug evolution (how bugs transition between types across iterations)
    public List<BugEvolution> BugEvolutions { get; set; } = new();

    // Verification improvement
    public string InitialVerdict { get; set; } = "";
    public string FinalVerdict { get; set; } = "";
    public double InitialPassRate { get; set; }
    public double FinalPassRate { get; set; }
}

public class BugEvolution
{
    public string FromType { get; set; } = "";
    public string ToType { get; set; } = "";
    public int Count { get; set; }
    public int Iteration { get; set; }
}
