using Backend.Data;
using Backend.Services.Taxonomy;
using Backend.Services.Verification;
using Microsoft.AspNetCore.Mvc;

namespace Backend.Controllers;

[ApiController]
public class HealthController : ControllerBase
{
    private readonly ITaxonomyProvider _taxonomy;
    private readonly AppDbContext _db;
    private readonly PythonToolHealthService _toolHealth;

    public HealthController(
        ITaxonomyProvider taxonomy,
        AppDbContext db,
        PythonToolHealthService toolHealth)
    {
        _taxonomy = taxonomy;
        _db = db;
        _toolHealth = toolHealth;
    }

    [HttpGet("api/health")]
    [HttpGet("health")]
    public async Task<IActionResult> GetHealth()
    {
        bool dbConnected = false;
        string? dbError = null;

        try
        {
            dbConnected = await _db.Database.CanConnectAsync();
        }
        catch (Exception ex)
        {
            dbError = ex.Message;
        }

        return Ok(new
        {
            status = "ok",
            database = dbConnected ? "connected" : "disconnected",
            databaseHost = "neon.tech (PostgreSQL)",
            databaseError = dbError,
            taxonomyVersion = _taxonomy?.Definition?.Version ?? "v1",
            time = DateTime.UtcNow.ToString("o")
        });
    }

    [HttpGet("api/health/tools")]
    [HttpGet("health/tools")]
    public async Task<IActionResult> GetToolsHealth()
    {
        var report = await _toolHealth.CheckHealthAsync();

        var response = new
        {
            ok = report.Ok,
            python = new
            {
                path = report.PythonPath,
                version = report.PythonVersion,
                ok = !string.IsNullOrEmpty(report.PythonVersion)
            },
            tools = report.Tools.Select(t => new
            {
                name = t.Name,
                version = t.Version,
                ok = t.Ok,
                error = t.Error
            }).ToList(),
            error = report.Error,
            time = DateTime.UtcNow.ToString("o")
        };

        return report.Ok ? Ok(response) : StatusCode(500, response);
    }
}
