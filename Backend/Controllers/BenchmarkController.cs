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
    public IActionResult ListProblems()
    {
        var problems = _benchmarkService.ListProblems();
        return Ok(problems);
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

        var detail = _benchmarkService.GetProblem(benchmark, id);
        if (detail == null)
        {
            return NotFound(new { error = $"Problem '{id}' not found in benchmark '{benchmark}'." });
        }

        return Ok(detail);
    }
}
