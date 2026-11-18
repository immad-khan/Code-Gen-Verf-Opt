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

        if (!string.IsNullOrWhiteSpace(request.LockedTestHash))
        {
            if (!_lockedTestStore.TryGet(request.LockedTestHash, out var lockedItem))
            {
                return BadRequest(new { error = $"Locked test suite not found for hash: {request.LockedTestHash}" });
            }

            var verifiedHash = TestHashUtility.ComputeHash(lockedItem.TestCode);
            if (!string.Equals(verifiedHash, request.LockedTestHash, StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest(new { error = "Server test hash integrity validation failed." });
            }

            // Enforce locked test file content
            var existingTest = request.Files.FirstOrDefault(f => f.Name.StartsWith("test_", StringComparison.OrdinalIgnoreCase) || f.Path.Contains("test"));
            if (existingTest != null)
            {
                existingTest.Content = lockedItem.TestCode;
            }
            else
            {
                request.Files.Add(new GeneratedCodeFile
                {
                    Name = "test_solution.py",
                    Path = "test_solution.py",
                    Language = "python",
                    Category = "test",
                    Description = "Locked pytest suite",
                    Content = lockedItem.TestCode
                });
            }
        }

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
