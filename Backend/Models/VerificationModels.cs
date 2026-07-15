namespace Backend.Models;

public class VerifyRequest
{
    public List<GeneratedCodeFile> Files { get; set; } = new();
}

public class VerificationResponse
{
    public List<VerificationTechnique> Techniques { get; set; } = new();
    public int TotalPassed { get; set; }
    public int TotalFailed { get; set; }
    public int TotalSkipped { get; set; }
    public string OverallVerdict { get; set; } = "UNKNOWN";
    public long TotalDurationMs { get; set; }
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
}
