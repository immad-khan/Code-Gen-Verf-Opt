using Backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class BenchmarkController : ControllerBase
{
    private readonly IBenchmarkDatasetService _benchmarkService;

    public BenchmarkController(IBenchmarkDatasetService benchmarkService)
    {
        _benchmarkService = benchmarkService;
    }

    /// <summary>
    /// Lists all available problems from HumanEval+, MBPP+, and APPS+.
    /// </summary>
    [HttpGet("problems")]
    public IActionResult ListProblems([FromQuery] string? benchmark = null)
    {
        var problems = _benchmarkService.ListProblems();
        return Ok(string.IsNullOrWhiteSpace(benchmark) ? problems : problems.Where(p => p.Benchmark == benchmark).ToList());
    }

    /// <summary>
    /// Loads a benchmark problem's prompt, interface, and read-only tests.
    /// Tests are automatically locked in the server store and hashed.
    /// Returns the first 5 tests only for preview.
    /// </summary>
    [HttpGet("problem")]
    public IActionResult GetProblem([FromQuery] string benchmark, [FromQuery] string id)
    {
        if (string.IsNullOrWhiteSpace(benchmark) || string.IsNullOrWhiteSpace(id))
        {
            return BadRequest(new { error = "Both 'benchmark' and 'id' query parameters are required." });
        }

        BenchmarkProblemDetail? detail;
        try { detail = _benchmarkService.GetProblem(benchmark, id); }
        catch (FileNotFoundException ex) { return StatusCode(503, new { error = ex.Message }); }
        if (detail == null)
        {
            return NotFound(new { error = $"Problem '{id}' not found in benchmark '{benchmark}'." });
        }

        return Ok(detail);
    }
}
