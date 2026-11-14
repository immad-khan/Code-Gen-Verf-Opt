using System.Net;
using System.Text;
using System.Text.Json;
using Backend.Controllers;
using Backend.Models;
using Backend.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Xunit;

namespace Backend.Tests;

public class GenerationPhaseBTests
{
    private const string TestKey = "sk-test-fake-key-123456789";

    [Fact]
    public async Task ExtractInterface_CallsLlmAndParsesInterface()
    {
        const string mockLlmResponse = """
            NAME: calculate_sum
            SIGNATURE: def calculate_sum(numbers: list[int]) -> int:
            DOC: Sums a list of integers.
            """;

        var handler = new TestHandler(_ => Ok(SuccessBody("openrouter", mockLlmResponse)));
        var client = CreateService(handler);

        var iface = await client.ExtractInterfaceAsync("Sum numbers", Settings("openrouter"));

        Assert.Equal("calculate_sum", iface.Name);
        Assert.Equal("def calculate_sum(numbers: list[int]) -> int:", iface.Signature);
        Assert.Equal("Sums a list of integers.", iface.Docstring);

        var req = Assert.Single(handler.Requests);
        using var doc = JsonDocument.Parse(req.Body);
        var sysContent = doc.RootElement.GetProperty("messages")[0].GetProperty("content").GetString() ?? "";
        Assert.Contains("software architect", sysContent);
    }

    [Fact]
    public async Task ProcessPrompt_WithInterface_IncludesInterfaceInPromptAndParsesSolutionPy()
    {
        const string codeResponse = """
            Here is your solution:
            ```python
            def calculate_sum(numbers: list[int]) -> int:
                return sum(numbers)
            ```
            """;

        var handler = new TestHandler(_ => Ok(SuccessBody("openai", codeResponse)));
        var service = CreateService(handler);

        var iface = new InterfaceDefinition
        {
            Name = "calculate_sum",
            Signature = "def calculate_sum(numbers: list[int]) -> int:",
            Docstring = "Sums a list of integers."
        };

        var files = await service.ProcessPromptAsync("Sum numbers", Settings("openai"), iface);

        var file = Assert.Single(files);
        Assert.Equal("solution.py", file.Path);
        Assert.Contains("def calculate_sum", file.Content);

        var req = Assert.Single(handler.Requests);
        using var doc = JsonDocument.Parse(req.Body);
        var userContent = doc.RootElement.GetProperty("messages")[1].GetProperty("content").GetString() ?? "";
        Assert.Contains("TARGET INTERFACE:", userContent);
        Assert.Contains("calculate_sum(numbers: list[int]) -> int:", userContent);
    }

    [Fact]
    public async Task ProcessPrompt_NoCodeBlockOnFirstTry_RetriesOnceAndSucceeds()
    {
        int callCount = 0;
        var handler = new TestHandler(_ =>
        {
            callCount++;
            if (callCount == 1)
            {
                return Ok(SuccessBody("openai", "Sure! I can write that function for you without any code blocks yet."));
            }
            return Ok(SuccessBody("openai", "```python\ndef solve(): return 1\n```"));
        });

        var service = CreateService(handler);
        var files = await service.ProcessPromptAsync("Solve task", Settings("openai"));

        Assert.Equal(2, handler.Requests.Count);
        var file = Assert.Single(files);
        Assert.Equal("solution.py", file.Path);
        Assert.Contains("def solve(): return 1", file.Content);

        using var retryDoc = JsonDocument.Parse(handler.Requests[1].Body);
        var retryContent = retryDoc.RootElement.GetProperty("messages")[1].GetProperty("content").GetString() ?? "";
        Assert.Contains("CRITICAL: Return the complete Python solution enclosed in a ```python block", retryContent);
    }

    [Fact]
    public async Task ProcessPrompt_NoCodeBlockAfterRetry_ThrowsCodeGenerationExceptionWithRawResponse()
    {
        var handler = new TestHandler(_ => Ok(SuccessBody("openai", "I refuse to generate code blocks.")));
        var service = CreateService(handler);

        var ex = await Assert.ThrowsAsync<CodeGenerationException>(
            () => service.ProcessPromptAsync("Solve task", Settings("openai")));

        Assert.Equal(2, handler.Requests.Count);
        Assert.Contains("No code block found", ex.Message);
        Assert.Equal("I refuse to generate code blocks.", ex.RawResponse);
    }

    [Fact]
    public async Task AiController_ExtractInterface_ReturnsOkResult()
    {
        const string mockLlmResponse = """
            NAME: solve
            SIGNATURE: def solve() -> None:
            DOC: Does nothing.
            """;

        var handler = new TestHandler(_ => Ok(SuccessBody("openrouter", mockLlmResponse)));
        var service = CreateService(handler);
        var controller = new AiController(service);

        var actionResult = await controller.ExtractInterface(new InterfaceRequest
        {
            Prompt = "Do nothing",
            ApiSettings = Settings("openrouter")
        });

        var okResult = Assert.IsType<OkObjectResult>(actionResult);
        var iface = Assert.IsType<InterfaceDefinition>(okResult.Value);
        Assert.Equal("solve", iface.Name);
    }

    [Fact]
    public async Task AiController_ProcessPrompt_WhenNoCodeBlockFound_Returns422UnprocessableEntityWithRawResponse()
    {
        var handler = new TestHandler(_ => Ok(SuccessBody("openrouter", "I refuse to provide fences.")));
        var service = CreateService(handler);
        var controller = new AiController(service);

        var actionResult = await controller.ProcessPrompt(new ProcessPromptRequest
        {
            Prompt = "Do task",
            ApiSettings = Settings("openrouter")
        });

        var unprocResult = Assert.IsType<UnprocessableEntityObjectResult>(actionResult);
        Assert.Equal(422, unprocResult.StatusCode);

        // Value contains error and rawResponse
        var json = JsonSerializer.Serialize(unprocResult.Value);
        Assert.Contains("No code block found", json);
        Assert.Contains("I refuse to provide fences.", json);
    }

    // ---- Helpers ----

    private static AiService CreateService(TestHandler handler) =>
        new(new HttpClient(handler), Options.Create(new LlmClientOptions { TimeoutSeconds = 30 }));

    private static ApiSettings Settings(string provider) =>
        new() { Provider = provider, ApiKey = TestKey, Model = "test-model" };

    private static HttpResponseMessage Ok(string json) =>
        new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static string SuccessBody(string provider, string text) => provider switch
    {
        "anthropic" => JsonSerializer.Serialize(new { content = new[] { new { type = "text", text } } }),
        "gemini" => JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text } } } } },
        }),
        _ => JsonSerializer.Serialize(new { choices = new[] { new { message = new { content = text } } } }),
    };

    private sealed record CapturedRequest(Uri Uri, string Body);

    private sealed class TestHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _respond;
        public List<CapturedRequest> Requests { get; } = [];

        public TestHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) => _respond = respond;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            Requests.Add(new CapturedRequest(request.RequestUri!, body));
            return _respond(request);
        }
    }
}
