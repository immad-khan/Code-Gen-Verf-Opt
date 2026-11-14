using Microsoft.AspNetCore.Mvc;
using Backend.Models;
using Backend.Services;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AiController : ControllerBase
{
    private readonly AiService _aiService;
    private readonly ITestGenerationService? _testService;

    public AiController(AiService aiService, ITestGenerationService? testService = null)
    {
        _aiService = aiService;
        _testService = testService;
    }

    /// <summary>
    /// Proposes the function interface (NAME, SIGNATURE, DOC) extracted from the prompt
    /// before test generation or code generation.
    /// </summary>
    [HttpPost("interface")]
    public async Task<IActionResult> ExtractInterface([FromBody] InterfaceRequest request)
    {
        try
        {
            var iface = await _aiService.ExtractInterfaceAsync(request.Prompt, request.ApiSettings);
            return Ok(iface);
        }
        catch (LlmRequestException ex)
        {
            return StatusCode(ex.StatusCode ?? 500, new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Generates pytest tests from prompt and confirmed interface.
    /// Does NOT receive any solution code.
    /// </summary>
    [HttpPost("tests")]
    public async Task<IActionResult> GenerateTests([FromBody] GenerateTestsRequest request)
    {
        if (_testService == null)
            return StatusCode(500, new { error = "Test generation service is not available." });

        try
        {
            var testCode = await _testService.GenerateTestsAsync(request.Prompt, request.Interface, request.ApiSettings);
            return Ok(new { testCode });
        }
        catch (CodeGenerationException ex)
        {
            return UnprocessableEntity(new { error = ex.Message, rawResponse = ex.RawResponse });
        }
        catch (LlmRequestException ex)
        {
            return StatusCode(ex.StatusCode ?? 500, new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Pre-lock Docker sanity check: ast.parse, pytest --collect-only, and execution against stub.
    /// Tests that pass on the stub generate warnings.
    /// </summary>
    [HttpPost("tests/validate")]
    public async Task<IActionResult> ValidateTests([FromBody] ValidateTestsRequest request)
    {
        if (_testService == null)
            return StatusCode(500, new { error = "Test generation service is not available." });

        try
        {
            var result = await _testService.ValidateTestsAsync(request.TestCode, request.Interface);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Locks tests: stores normalized tests in server store keyed by SHA-256 hash.
    /// Verify/repair requests send hash only; server re-checks hash before every run.
    /// </summary>
    [HttpPost("tests/lock")]
    public IActionResult LockTests([FromBody] LockTestsRequest request)
    {
        if (_testService == null)
            return StatusCode(500, new { error = "Test generation service is not available." });

        try
        {
            var result = _testService.LockTests(request.TestCode, request.TestCount);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Generates solution code from the prompt and confirmed interface.
    /// Does NOT receive any test code.
    /// </summary>
    [HttpPost("process")]
    public async Task<IActionResult> ProcessPrompt([FromBody] ProcessPromptRequest request)
    {
        try
        {
            var files = await _aiService.ProcessPromptAsync(request.Prompt, request.ApiSettings, request.Interface);
            return Ok(new { files });
        }
        catch (CodeGenerationException ex)
        {
            return UnprocessableEntity(new { error = ex.Message, rawResponse = ex.RawResponse });
        }
        catch (LlmRequestException ex)
        {
            return StatusCode(ex.StatusCode ?? 500, new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }
}
