using Backend.Models;
using Backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OptimizationController : ControllerBase
{
    private readonly OptimizationService _optimizationService;
    private readonly ILockedTestStore _lockedTestStore;

    public OptimizationController(OptimizationService optimizationService, ILockedTestStore lockedTestStore)
    {
        _optimizationService = optimizationService;
        _lockedTestStore = lockedTestStore;
    }

    [HttpPost("repair")]
    public async Task<IActionResult> Repair([FromBody] OptimizationRequest request)
    {
        if (request.Files == null || request.Files.Count == 0)
            return BadRequest(new { error = "No files provided for optimization" });

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

            // Enforce locked test file
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

        var result = await _optimizationService.OptimizeAsync(request);

        if (request.VerificationResult != null)
        {
            result.RunResult = _optimizationService.BuildRunResult(
                request.OriginalPrompt,
                request.ApiSettings.Model ?? "deepseek-reasoner",
                request.VerificationResult,
                result,
                result.TotalDurationMs
            );
        }

        return Ok(result);
    }

    [HttpPost("run-result")]
    public IActionResult CreateInitialRunResult([FromBody] CreateInitialRunResultRequest request)
    {
        if (request.VerificationResult == null)
            return BadRequest(new { error = "VerificationResult is required" });

        var runResult = _optimizationService.BuildRunResult(
            request.OriginalPrompt,
            request.Model ?? "deepseek-reasoner",
            request.VerificationResult,
            null,
            request.VerificationResult.TotalDurationMs
        );

        return Ok(runResult);
    }
}

public class CreateInitialRunResultRequest
{
    public string OriginalPrompt { get; set; } = "";
    public string? Model { get; set; }
    public VerificationResponse? VerificationResult { get; set; }
}
