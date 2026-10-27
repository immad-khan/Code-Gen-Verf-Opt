namespace Backend.Models;

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY verification models (pre paper-aligned-repair-tool).
//
// Kept only so the old VerificationService / OptimizationService / OptimizationModels
// keep compiling until they are rewritten. The new web DTOs live in
// VerificationModels.cs (VerificationResult, TechniqueStatus, MappedFinding, ...).
//
// Delete this file once nothing references these types:
//   * Task 11.2 rewrites Services/VerificationService.cs onto tivr.verify_cli and returns
//     VerificationResult (removes VerificationTechnique, VerificationIssue, CodeMetrics,
//     and the bug-distribution counters, Req. 20.5).
//   * Task 12.6 rewrites Services/OptimizationService.cs and deletes LegacyOptimizationModels.cs
//     (removes the last VerificationResponse / VerificationTechnique / VerificationIssue uses).
// ─────────────────────────────────────────────────────────────────────────────

public class CodeMetrics
{
    // Core verification metric
    public double PassRate { get; set; }           // % of tests that passed
    public int TotalTests { get; set; }
    public int PassedTests { get; set; }
    public int FailedTests { get; set; }

    // Code quality / complexity metrics
    public int TotalLinesOfCode { get; set; }      // non-blank lines across all files
    public double AvgCyclomaticComplexity { get; set; }  // average CC across functions
    public int MaxCyclomaticComplexity { get; set; }     // highest CC found
    public int TotalApiCount { get; set; }         // distinct imports / API calls
    public double CommentCodeRatio { get; set; }   // comment lines / code lines

    // Radon-specific metrics
    public double MaintainabilityIndex { get; set; }     // average MI score (0–100, higher = better)
    public int RadonComplexFunctionCount { get; set; }   // functions graded C / D / E / F by radon

    // Semgrep-specific metrics
    public int SemgrepFindingCount { get; set; }         // total security/correctness findings (0 = clean)

    // Bug distribution metrics
    public int SyntaxBugCount { get; set; }
    public int RuntimeBugCount { get; set; }
    public int FunctionalBugCount { get; set; }
}

public class VerificationResponse
{
    public List<VerificationTechnique> Techniques { get; set; } = new();
    public int TotalPassed { get; set; }
    public int TotalFailed { get; set; }
    public int TotalSkipped { get; set; }
    public string OverallVerdict { get; set; } = "UNKNOWN";
    public long TotalDurationMs { get; set; }
    public CodeMetrics Metrics { get; set; } = new();
}

public class VerificationTechnique
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Status { get; set; } = "PENDING";
    public string Details { get; set; } = "";
    public List<VerificationIssue> Issues { get; set; } = new();
    public long DurationMs { get; set; }
}

public class VerificationIssue
{
    public string File { get; set; } = "";
    public int? Line { get; set; }
    public string Message { get; set; } = "";
    public string Severity { get; set; } = "INFO";
    /// <summary>The actual source line(s) from the generated file at the reported line number.</summary>
    public string? CodeSnippet { get; set; }
}
