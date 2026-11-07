using System.Security.Cryptography;
using System.Text;
using Backend.Data;
using Backend.Data.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILogger<AuthController> _logger;

    public AuthController(AppDbContext db, ILogger<AuthController> logger)
    {
        _db = db;
        _logger = logger;
    }

    public record RegisterRequest(string Name, string Email, string? Phone, string Password, string? Provider, string? ProviderId);
    public record LoginRequest(string Email, string Password);
    public record GoogleAuthRequest(string Email, string Name, string? ProviderId);

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { ok = false, error = "Email and password are required." });

        var normalizedEmail = req.Email.Trim().ToLowerInvariant();

        var exists = await _db.Users.AnyAsync(u => u.Email == normalizedEmail);
        if (exists)
            return Conflict(new { ok = false, field = "email", error = "An account with this email already exists." });

        var user = new UserEntity
        {
            Name = req.Name.Trim(),
            Email = normalizedEmail,
            Phone = req.Phone?.Trim(),
            PasswordHash = ComputeHash(req.Password),
            Provider = req.Provider ?? "local",
            ProviderId = req.ProviderId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            ok = true,
            user = new
            {
                id = user.Id,
                name = user.Name,
                email = user.Email,
                phone = user.Phone
            }
        });
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { ok = false, error = "Email and password are required." });

        var normalizedEmail = req.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail);

        if (user == null)
            return Unauthorized(new { ok = false, error = "No account found with this email." });

        var hash = ComputeHash(req.Password);
        // Also allow comparing if frontend already hashed it
        if (user.PasswordHash != hash && user.PasswordHash != req.Password)
            return Unauthorized(new { ok = false, error = "Incorrect password." });

        return Ok(new
        {
            ok = true,
            user = new
            {
                id = user.Id,
                name = user.Name,
                email = user.Email,
                phone = user.Phone
            }
        });
    }

    [HttpPost("google")]
    public async Task<IActionResult> GoogleAuth([FromBody] GoogleAuthRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Email))
            return BadRequest(new { ok = false, error = "Email is required." });

        var normalizedEmail = req.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail);

        if (user == null)
        {
            user = new UserEntity
            {
                Name = req.Name ?? "Google User",
                Email = normalizedEmail,
                PasswordHash = ComputeHash(Guid.NewGuid().ToString("N")),
                Provider = "google",
                ProviderId = req.ProviderId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _db.Users.Add(user);
            await _db.SaveChangesAsync();
        }
        else
        {
            user.Provider = "google";
            if (!string.IsNullOrEmpty(req.ProviderId))
                user.ProviderId = req.ProviderId;
            user.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        return Ok(new
        {
            ok = true,
            user = new
            {
                id = user.Id,
                name = user.Name,
                email = user.Email,
                phone = user.Phone
            }
        });
    }

    [HttpGet("users")]
    public async Task<IActionResult> GetUsers()
    {
        var count = await _db.Users.CountAsync();
        return Ok(new { totalUsers = count });
    }

    private static string ComputeHash(string password)
    {
        var input = "vf::" + password;
        using var sha256 = SHA256.Create();
        var bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(input));
        var sb = new StringBuilder();
        foreach (var b in bytes)
        {
            sb.Append(b.ToString("x2"));
        }
        return sb.ToString();
    }
}
