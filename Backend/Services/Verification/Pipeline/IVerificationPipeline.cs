using Backend.Models;

namespace Backend.Services.Verification.Pipeline;

/// <summary>
/// High-level interface for the Chain of Responsibility verification pipeline.
/// </summary>
public interface IVerificationPipeline
{
    Task<VerificationResponse> ExecuteAsync(List<GeneratedCodeFile> files);
}
