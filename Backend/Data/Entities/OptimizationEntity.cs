using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Data.Entities;

[Table("optimization_runs")]
public class OptimizationEntity
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string? OriginalPrompt { get; set; }

    [Column(TypeName = "text")]
    public string IterationsJson { get; set; } = "[]";

    public double RepairSuccessRate { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
