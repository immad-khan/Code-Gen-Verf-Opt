using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Data.Entities;

[Table("verification_runs")]
public class VerificationEntity
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [MaxLength(50)]
    public string OverallVerdict { get; set; } = "UNKNOWN";

    public double PassRate { get; set; }

    public int TotalPassed { get; set; }

    public int TotalFailed { get; set; }

    public int TotalSkipped { get; set; }

    public long TotalDurationMs { get; set; }

    [Column(TypeName = "text")]
    public string TechniquesJson { get; set; } = "[]";

    [Column(TypeName = "text")]
    public string MetricsJson { get; set; } = "{}";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
