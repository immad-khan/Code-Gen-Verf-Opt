using Microsoft.AspNetCore.Mvc;
using Backend.Services.Taxonomy;

namespace Backend.Controllers;

[ApiController]
public class HealthController : ControllerBase
{
    private readonly ITaxonomyProvider _taxonomy;

    public HealthController(ITaxonomyProvider taxonomy)
    {
        _taxonomy = taxonomy;
    }

    [HttpGet("api/health")]
    [HttpGet("health")]
    public IActionResult GetHealth()
    {
        return Ok(new
        {
            status = "ok",
            taxonomyVersion = _taxonomy?.Definition?.Version ?? "v1",
            time = DateTime.UtcNow.ToString("o")
        });
    }
}
