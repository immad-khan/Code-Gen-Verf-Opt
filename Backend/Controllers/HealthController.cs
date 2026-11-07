using Backend.Data;
using Backend.Services.Taxonomy;
using Microsoft.AspNetCore.Mvc;

namespace Backend.Controllers;

[ApiController]
public class HealthController : ControllerBase
{
    private readonly ITaxonomyProvider _taxonomy;
    private readonly AppDbContext _db;

    public HealthController(ITaxonomyProvider taxonomy, AppDbContext db)
    {
        _taxonomy = taxonomy;
        _db = db;
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
}
