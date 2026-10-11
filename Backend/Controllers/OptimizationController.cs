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
        return Ok(result);
    }
}
