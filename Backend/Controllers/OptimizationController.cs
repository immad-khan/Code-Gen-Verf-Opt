using Backend.Models;
using Backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OptimizationController : ControllerBase
{
    private readonly OptimizationService _optimizationService;

    public OptimizationController(OptimizationService optimizationService)
    {
        _optimizationService = optimizationService;
    }

    [HttpPost("repair")]
    public async Task<IActionResult> Repair([FromBody] OptimizationRequest request)
    {
        if (request.Files == null || request.Files.Count == 0)
            return BadRequest(new { error = "No files provided for optimization" });

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
