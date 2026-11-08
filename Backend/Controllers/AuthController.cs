using System.Collections.Concurrent;
using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
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
    public record GitHubAuthRequest(string Code, string? RedirectUri);
    public record SendOtpRequest(string Channel, string To, string? Code);
    public record VerifyOtpRequest(string To, string Code);

    private static readonly ConcurrentDictionary<string, (string Code, DateTime ExpiresAt, int Attempts)> _otpCache = new();

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

    [HttpPost("github")]
    public async Task<IActionResult> GitHubAuth([FromBody] GitHubAuthRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Code))
            return BadRequest(new { ok = false, error = "Authorization code is required." });

        var clientId = Environment.GetEnvironmentVariable("GITHUB_CLIENT_ID") ?? "Ov23libA6ZxKhurjAojQ";
        var clientSecret = Environment.GetEnvironmentVariable("GITHUB_CLIENT_SECRET") ?? "9c7897fa1022ec278e2aa4ccf9c41d88ca075aa0";

        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            http.DefaultRequestHeaders.Add("User-Agent", "VeriFlow-Auth/1.0");

            // 1. Exchange authorization code for access token
            var tokenPayload = new Dictionary<string, string>
            {
                { "client_id", clientId },
                { "client_secret", clientSecret },
                { "code", req.Code.Trim() }
            };
            if (!string.IsNullOrEmpty(req.RedirectUri))
                tokenPayload["redirect_uri"] = req.RedirectUri;

            var tokenReq = new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/oauth/access_token")
            {
                Content = new FormUrlEncodedContent(tokenPayload)
            };
            tokenReq.Headers.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));

            var tokenRes = await http.SendAsync(tokenReq);
            if (!tokenRes.IsSuccessStatusCode)
            {
                var errContent = await tokenRes.Content.ReadAsStringAsync();
                return StatusCode((int)tokenRes.StatusCode, new { ok = false, error = $"GitHub token exchange failed: {errContent}" });
            }

            var tokenJson = await tokenRes.Content.ReadAsStringAsync();
            using var tokenDoc = JsonDocument.Parse(tokenJson);
            if (!tokenDoc.RootElement.TryGetProperty("access_token", out var tokenProp))
            {
                var errMsg = tokenDoc.RootElement.TryGetProperty("error_description", out var ed)
                    ? ed.GetString()
                    : "No access token in response";
                return BadRequest(new { ok = false, error = errMsg });
            }

            var accessToken = tokenProp.GetString();

            // 2. Fetch GitHub User profile
            var userReq = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/user");
            userReq.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            var userRes = await http.SendAsync(userReq);
            if (!userRes.IsSuccessStatusCode)
                return StatusCode((int)userRes.StatusCode, new { ok = false, error = "Failed to fetch GitHub profile." });

            var userJson = await userRes.Content.ReadAsStringAsync();
            using var userDoc = JsonDocument.Parse(userJson);
            var root = userDoc.RootElement;

            var githubId = root.GetProperty("id").ToString();
            var login = root.TryGetProperty("login", out var lProp) ? lProp.GetString() : "github_user";
            var name = root.TryGetProperty("name", out var nProp) && !string.IsNullOrWhiteSpace(nProp.GetString())
                ? nProp.GetString()
                : login;
            var email = root.TryGetProperty("email", out var eProp) ? eProp.GetString() : null;

            // 3. If primary email is private or null, query /user/emails
            if (string.IsNullOrWhiteSpace(email))
            {
                try
                {
                    var emailsReq = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/user/emails");
                    emailsReq.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
                    var emailsRes = await http.SendAsync(emailsReq);
                    if (emailsRes.IsSuccessStatusCode)
                    {
                        var emailsJson = await emailsRes.Content.ReadAsStringAsync();
                        using var emailsDoc = JsonDocument.Parse(emailsJson);
                        foreach (var el in emailsDoc.RootElement.EnumerateArray())
                        {
                            var isPrimary = el.TryGetProperty("primary", out var p) && p.GetBoolean();
                            var isVerified = el.TryGetProperty("verified", out var v) && v.GetBoolean();
                            if (isPrimary && isVerified && el.TryGetProperty("email", out var em))
                            {
                                email = em.GetString();
                                break;
                            }
                            if (string.IsNullOrEmpty(email) && el.TryGetProperty("email", out var firstEm))
                            {
                                email = firstEm.GetString();
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to fetch GitHub user emails");
                }
            }

            if (string.IsNullOrWhiteSpace(email))
            {
                email = $"{login}@users.noreply.github.com";
            }

            var normalizedEmail = email.Trim().ToLowerInvariant();

            // 4. Upsert into Neon PostgreSQL
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail || (u.Provider == "github" && u.ProviderId == githubId));
            if (user == null)
            {
                user = new UserEntity
                {
                    Name = name ?? "GitHub User",
                    Email = normalizedEmail,
                    PasswordHash = ComputeHash(Guid.NewGuid().ToString("N")),
                    Provider = "github",
                    ProviderId = githubId,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };
                _db.Users.Add(user);
                await _db.SaveChangesAsync();
            }
            else
            {
                user.Provider = "github";
                user.ProviderId = githubId;
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
        catch (Exception ex)
        {
            _logger.LogError(ex, "GitHub authentication error");
            return StatusCode(500, new { ok = false, error = ex.Message });
        }
    }

    [HttpGet("users")]
    public async Task<IActionResult> GetUsers()
    {
        var count = await _db.Users.CountAsync();
        return Ok(new { totalUsers = count });
    }

    [HttpPost("send-otp")]
    public async Task<IActionResult> SendOtp([FromBody] SendOtpRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.To))
            return BadRequest(new { ok = false, error = "Recipient address/number is required." });

        var channel = req.Channel?.Trim().ToLowerInvariant() ?? "email";
        var to = req.To.Trim();
        var code = string.IsNullOrWhiteSpace(req.Code)
            ? RandomNumberGenerator.GetInt32(100000, 999999).ToString()
            : req.Code.Trim();

        var expiresAt = DateTime.UtcNow.AddMinutes(5);
        _otpCache[to.ToLowerInvariant()] = (code, expiresAt, 0);

        if (channel == "sms")
        {
            var deviceId = Environment.GetEnvironmentVariable("TEXTBEE_DEVICE_ID") ?? "6ac0c343cf8e7692e0f415d6";
            var apiKey = Environment.GetEnvironmentVariable("TEXTBEE_API_KEY") ?? "txb_ssl5Q1DZoc3oGpAMWnIKVnX777CFWjML";

            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                client.DefaultRequestHeaders.Add("x-api-key", apiKey);

                var payload = new
                {
                    deviceId = deviceId,
                    recipients = new[] { to },
                    message = $"Your VeriFlow verification code is: {code}. Valid for 5 minutes."
                };

                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                var response = await client.PostAsync("https://api.textbee.dev/api/v1/gateway/send-sms", content);

                if (!response.IsSuccessStatusCode)
                {
                    var errBody = await response.Content.ReadAsStringAsync();
                    _logger.LogWarning("TextBee SMS warning ({StatusCode}): {Error}", response.StatusCode, errBody);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to dispatch SMS via TextBee");
            }
        }
        else // default: email
        {
            var host = Environment.GetEnvironmentVariable("EMAIL_HOST") ?? "smtp.gmail.com";
            var portStr = Environment.GetEnvironmentVariable("EMAIL_PORT") ?? "587";
            int.TryParse(portStr, out var port);
            if (port <= 0) port = 587;

            var user = Environment.GetEnvironmentVariable("EMAIL_HOST_USER") ?? "immadonline702@gmail.com";
            var pass = Environment.GetEnvironmentVariable("EMAIL_HOST_PASSWORD") ?? "cmow ikby ocny giez";
            var fromName = Environment.GetEnvironmentVariable("EMAIL_FROM_NAME") ?? "Veri FLow";

            try
            {
                using var smtp = new SmtpClient(host, port)
                {
                    EnableSsl = true,
                    Credentials = new NetworkCredential(user, pass),
                    Timeout = 15000
                };

                using var mail = new MailMessage
                {
                    From = new MailAddress(user, fromName),
                    Subject = "Your VeriFlow Verification Code",
                    Body = $@"
                        <div style=""font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; border: 1px solid #ede9fe; border-radius: 16px; background: #ffffff;"">
                            <h2 style=""color: #5b21b6; margin-top: 0;"">VeriFlow Verification</h2>
                            <p style=""color: #334155; font-size: 15px; line-height: 1.5;"">Use the code below to complete your authentication. This code expires in 5 minutes.</p>
                            <div style=""margin: 24px 0; text-align: center;"">
                                <span style=""display: inline-block; padding: 12px 28px; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #6d28d9; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 12px; font-family: monospace;"">{code}</span>
                            </div>
                            <p style=""color: #64748b; font-size: 13px;"">If you did not request this verification code, please ignore this email.</p>
                        </div>",
                    IsBodyHtml = true
                };

                mail.To.Add(to);
                await smtp.SendMailAsync(mail);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send email via SMTP");
            }
        }

        return Ok(new
        {
            ok = true,
            channel = channel,
            to = to,
            expiresAt = new DateTimeOffset(expiresAt).ToUnixTimeMilliseconds(),
            message = $"Verification code dispatched via {channel}."
        });
    }

    [HttpPost("verify-otp")]
    public IActionResult VerifyOtp([FromBody] VerifyOtpRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.To) || string.IsNullOrWhiteSpace(req.Code))
            return BadRequest(new { ok = false, error = "Recipient and code are required." });

        var key = req.To.Trim().ToLowerInvariant();
        if (!_otpCache.TryGetValue(key, out var state))
            return BadRequest(new { ok = false, reason = "none", error = "No verification code pending for this recipient." });

        if (DateTime.UtcNow > state.ExpiresAt)
        {
            _otpCache.TryRemove(key, out _);
            return BadRequest(new { ok = false, reason = "expired", error = "Code has expired. Please request a new one." });
        }

        if (state.Attempts >= 5)
        {
            _otpCache.TryRemove(key, out _);
            return BadRequest(new { ok = false, reason = "locked", error = "Too many incorrect attempts. Please request a new code." });
        }

        if (state.Code != req.Code.Trim())
        {
            _otpCache[key] = (state.Code, state.ExpiresAt, state.Attempts + 1);
            var left = 5 - (state.Attempts + 1);
            return BadRequest(new { ok = false, reason = "wrong", attemptsLeft = left, error = "Incorrect code." });
        }

        _otpCache.TryRemove(key, out _);
        return Ok(new { ok = true, message = "Code verified successfully." });
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
