using Microsoft.AspNetCore.Mvc;
using Backend.Models;
using Backend.Services;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AiController : ControllerBase
{
    private readonly AiService _aiService;

    public AiController(AiService aiService)
    {
        _aiService = aiService;
    }

    [HttpPost("process")]
    public async Task<IActionResult> ProcessPrompt([FromBody] ProcessPromptRequest request)
    {
        try
        {
            var files = await _aiService.ProcessPromptAsync(request.Prompt, request.ApiSettings);
            return Ok(new { files });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }
}
