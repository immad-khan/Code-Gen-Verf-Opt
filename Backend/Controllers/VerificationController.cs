using Backend.Models;
using Backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class VerificationController : ControllerBase
{
    private readonly VerificationService _verificationService;

    public VerificationController(VerificationService verificationService)
    {
        _verificationService = verificationService;
    }

    [HttpPost]
    public async Task<IActionResult> Verify([FromBody] VerifyRequest request)
    {
        if (request.Files == null || request.Files.Count == 0)
            return BadRequest(new { error = "No files provided for verification" });

        var result = await _verificationService.VerifyAsync(request.Files);
        return Ok(result);
    }
}
