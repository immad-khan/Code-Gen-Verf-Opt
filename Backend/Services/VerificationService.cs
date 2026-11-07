using Backend.Models;
using Backend.Services.Verification.Pipeline;

namespace Backend.Services;

/// <summary>
/// Service facade for code verification.
/// Delegates execution to the Chain of Responsibility verification pipeline (<see cref="IVerificationPipeline"/>).
/// </summary>
public class VerificationService
{
    private readonly IVerificationPipeline _pipeline;

    public VerificationService(IVerificationPipeline pipeline)
    {
        _pipeline = pipeline;
    }

    public Task<VerificationResponse> VerifyAsync(List<GeneratedCodeFile> files)
    {
        return _pipeline.ExecuteAsync(files);
    }
}
