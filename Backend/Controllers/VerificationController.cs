using Backend.Models;
using Backend.Services;
using Backend.Services.Verification;
using Microsoft.AspNetCore.Mvc;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class VerificationController : ControllerBase
{
    private readonly VerificationService _verificationService;
    private readonly ILockedTestStore _lockedTestStore;
    private readonly IIndependentChecksService? _independentChecksService;

    public VerificationController(
        VerificationService verificationService,
        ILockedTestStore lockedTestStore,
        IIndependentChecksService? independentChecksService = null)
    {
        _verificationService = verificationService;
        _lockedTestStore = lockedTestStore;
        _independentChecksService = independentChecksService;
    }

    [HttpPost]
    public async Task<IActionResult> Verify([FromBody] VerifyRequest request)
    {
        if (request.Files == null || request.Files.Count == 0)
            return BadRequest(new { error = "No files provided for verification" });

        var lockError = LockedSuiteFiles.Apply(_lockedTestStore, request.LockedTestHash, request.Files);
        if (lockError != null) return BadRequest(new { error = lockError });

        var result = await _verificationService.VerifyAsync(request.Files);

        // Run 3 independent checks as advisory warnings (never alters locked tests or verdict)
        if (_independentChecksService != null)
        {
            try
            {
                result.IndependentChecks = await _independentChecksService.ExecuteAsync(
                    request.Files, request.Prompt, request.Interface, request.SecondaryApiSettings);
            }
            catch (Exception ex)
            {
                result.IndependentChecks = new IndependentChecksResult
                {
                    AllWarnings = new List<string> { $"Independent checks notice: {ex.Message}" }
                };
            }
        }

        return Ok(result);
    }
}
