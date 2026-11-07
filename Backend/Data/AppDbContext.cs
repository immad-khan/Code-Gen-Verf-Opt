using Backend.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Backend.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<UserEntity> Users => Set<UserEntity>();
    public DbSet<AuditGenerationEntity> AuditGenerations => Set<AuditGenerationEntity>();
    public DbSet<VerificationEntity> VerificationRuns => Set<VerificationEntity>();
    public DbSet<OptimizationEntity> OptimizationRuns => Set<OptimizationEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<UserEntity>(entity =>
        {
            entity.HasIndex(u => u.Email).IsUnique();
        });
    }
}
