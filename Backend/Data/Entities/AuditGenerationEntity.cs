using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Data.Entities;

[Table("audit_generations")]
public class AuditGenerationEntity
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public string Prompt { get; set; } = string.Empty;

    [MaxLength(100)]
    public string ModelUsed { get; set; } = string.Empty;

    [MaxLength(50)]
    public string Provider { get; set; } = string.Empty;

    [Column(TypeName = "text")]
    public string GeneratedFilesJson { get; set; } = "[]";

    public int ProcessingTimeMs { get; set; }

    public Guid? UserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
