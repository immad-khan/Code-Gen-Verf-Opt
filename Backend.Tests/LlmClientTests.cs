using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Backend.Models;
using Backend.Services;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Backend.Tests;

/// <summary>
/// AiService as <see cref="ILlmClient"/> (Requirement 22.3): exact temperature passthrough,
/// text mode without JSON response format, key-free errors, and a configurable timeout.
/// </summary>
public class LlmClientTests
{
    private const string Key = "sk-test-SECRET-1234567890";

    public static readonly TheoryData<string, double> ProviderTemperatures = new()
    {
        { "openai", 0.0 }, { "openai", 0.37 }, { "openai", 1.0 },
        { "groq", 0.0 }, { "groq", 0.37 }, { "groq", 1.0 },
        { "anthropic", 0.0 }, { "anthropic", 0.37 }, { "anthropic", 1.0 },
        { "gemini", 0.0 }, { "gemini", 0.37 }, { "gemini", 1.0 },
    };

    public static readonly TheoryData<string> Providers = new() { "openai", "groq", "anthropic", "gemini" };

    [Theory]
    [MemberData(nameof(ProviderTemperatures))]
    public async Task CompleteText_SendsExactTemperature_AndNoJsonMode(string provider, double temperature)
    {
        var handler = new FakeHandler(_ => Ok(SuccessBody(provider, "```python\nx = 1\n```")));
        var client = CreateClient(handler);

        var text = await client.CompleteTextAsync("fix it", "you repair code", Settings(provider), temperature);

        Assert.Equal("```python\nx = 1\n```", text);
        var req = Assert.Single(handler.Requests);
        using var body = JsonDocument.Parse(req.Body);
        var root = body.RootElement;

        var sent = provider == "gemini"
            ? root.GetProperty("generationConfig").GetProperty("temperature")
            : root.GetProperty("temperature");
        Assert.Equal(temperature, sent.GetDouble());

        Assert.False(root.TryGetProperty("response_format", out _));
        if (provider == "gemini")
        {
            Assert.False(root.GetProperty("generationConfig").TryGetProperty("responseMimeType", out _));
        }
        Assert.Contains("fix it", req.Body);
        Assert.Contains("you repair code", req.Body);
        Assert.DoesNotContain(Key, req.Uri.ToString());
        Assert.Contains(Key, string.Join(";", req.Headers.SelectMany(h => h.Value)));
    }

    [Theory]
    [InlineData("openai")]
    [InlineData("gemini")]
    public async Task Generation_StillUsesJsonMode_AndParsesFiles(string provider)
    {
        const string generated = """{"summary":"s","files":[{"name":"a.py","path":"a.py","category":"service","description":"d","content":"x = 1"}]}""";
        var handler = new FakeHandler(_ => Ok(SuccessBody(provider, generated)));
        var service = CreateClient(handler);

        var files = await service.ProcessPromptAsync("make a", Settings(provider));

        var file = Assert.Single(files);
        Assert.Equal("a.py", file.Path);
        Assert.Equal("x = 1", file.Content);
        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body);
        if (provider == "gemini")
        {
            Assert.Equal("application/json",
                body.RootElement.GetProperty("generationConfig").GetProperty("responseMimeType").GetString());
        }
        else
        {
            Assert.Equal("json_object", body.RootElement.GetProperty("response_format").GetProperty("type").GetString());
        }
    }

    [Theory]
    [MemberData(nameof(Providers))]
    public async Task NonSuccess_ThrowsWithProviderAndStatus_ButNotKey(string provider)
    {
        // Provider echoes the key back in its error body.
        var errorBody = JsonSerializer.Serialize(new
        {
            error = new { message = $"Incorrect API key provided: {Key}", type = "invalid_request_error" },
        });
        var handler = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized)
        {
            Content = new StringContent(errorBody, Encoding.UTF8, "application/json"),
        });
        var client = CreateClient(handler);

        var ex = await Assert.ThrowsAsync<LlmRequestException>(
            () => client.CompleteTextAsync("p", "s", Settings(provider), 0.1));

        Assert.Equal(401, ex.StatusCode);
        Assert.Equal(provider, ex.Provider);
        Assert.Contains("HTTP 401", ex.Message);
        Assert.Contains(ProviderName(provider), ex.Message);
        Assert.Contains("Incorrect API key provided", ex.Message);
        Assert.DoesNotContain(Key, ex.ToString());
    }

    [Fact]
    public async Task NonSuccess_InGenerationMode_Throws()
    {
        var handler = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
        {
            Content = new StringContent("rate limited", Encoding.UTF8, "text/plain"),
        });

        var ex = await Assert.ThrowsAsync<LlmRequestException>(
            () => CreateClient(handler).ProcessPromptAsync("p", Settings("groq")));

        Assert.Equal(429, ex.StatusCode);
        Assert.Contains("Groq", ex.Message);
        Assert.Contains("rate limited", ex.Message);
    }

    [Fact]
    public async Task NetworkFailure_ThrowsLlmRequestException_WithoutKey()
    {
        var handler = new FakeHandler(_ => throw new HttpRequestException($"connection refused ({Key})"));

        var ex = await Assert.ThrowsAsync<LlmRequestException>(
            () => CreateClient(handler).CompleteTextAsync("p", "s", Settings("openai"), 0.1));

        Assert.Contains("OpenAI", ex.Message);
        Assert.Contains("HttpRequestException", ex.Message);
        Assert.DoesNotContain(Key, ex.ToString());
    }

    [Fact]
    public async Task UnexpectedResponseShape_Throws()
    {
        var handler = new FakeHandler(_ => Ok("""{"unexpected":true}"""));

        var ex = await Assert.ThrowsAsync<LlmRequestException>(
            () => CreateClient(handler).CompleteTextAsync("p", "s", Settings("anthropic"), 0.1));

        Assert.Contains("unexpected response format", ex.Message);
    }

    [Fact]
    public async Task MissingKey_OrUnknownProvider_ThrowsWithoutNetworkCall()
    {
        var handler = new FakeHandler(_ => Ok(SuccessBody("openai", "x")));
        var client = CreateClient(handler);

        await Assert.ThrowsAsync<LlmRequestException>(() => client.CompleteTextAsync(
            "p", "s", new ApiSettings { Provider = "openai", ApiKey = " ", Model = "m" }, 0.1));
        await Assert.ThrowsAsync<LlmRequestException>(() => client.CompleteTextAsync(
            "p", "s", new ApiSettings { Provider = "mystery", ApiKey = Key, Model = "m" }, 0.1));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Timeout_IsConfigurable_AndSurfacesAsLlmRequestException()
    {
        var handler = new FakeHandler(async (_, ct) =>
        {
            await Task.Delay(System.Threading.Timeout.InfiniteTimeSpan, ct);
            return Ok("{}");
        });
        var client = CreateClient(handler, timeoutSeconds: 0.2);

        var sw = Stopwatch.StartNew();
        var ex = await Assert.ThrowsAsync<LlmRequestException>(
            () => client.CompleteTextAsync("p", "s", Settings("openai"), 0.1));
        sw.Stop();

        Assert.Contains("timed out after 0.2 s", ex.Message);
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(10), $"took {sw.Elapsed}");
    }

    [Fact]
    public async Task CallerCancellation_PropagatesAsOperationCanceled()
    {
        var handler = new FakeHandler(async (_, ct) =>
        {
            await Task.Delay(System.Threading.Timeout.InfiniteTimeSpan, ct);
            return Ok("{}");
        });
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => CreateClient(handler).CompleteTextAsync("p", "s", Settings("openai"), 0.1, cts.Token));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(double.NaN)]
    public void NonPositiveTimeout_IsRejected(double seconds)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CreateClient(new FakeHandler(_ => Ok("{}")), seconds));
    }

    [Fact]
    public void DependencyInjection_ResolvesILlmClient_WithConfiguredTimeout()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b => b.UseSetting("Llm:TimeoutSeconds", "7"));
        using var scope = factory.Services.CreateScope();

        var llm = scope.ServiceProvider.GetRequiredService<ILlmClient>();

        var service = Assert.IsType<AiService>(llm);
        Assert.Equal(TimeSpan.FromSeconds(7), service.Timeout);
    }

    // ---- helpers ----

    private static AiService CreateClient(FakeHandler handler, double timeoutSeconds = 30) =>
        new(new HttpClient(handler), Options.Create(new LlmClientOptions { TimeoutSeconds = timeoutSeconds }));

    private static ApiSettings Settings(string provider) =>
        new() { Provider = provider, ApiKey = Key, Model = "test-model" };

    private static string ProviderName(string provider) => provider switch
    {
        "openai" => "OpenAI",
        "groq" => "Groq",
        "anthropic" => "Anthropic",
        _ => "Gemini",
    };

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

    private sealed record CapturedRequest(
        Uri Uri, string Body, List<KeyValuePair<string, IEnumerable<string>>> Headers);

    private sealed class FakeHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> _respond;

        public List<CapturedRequest> Requests { get; } = [];

        public FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond)
            : this((r, _) => Task.FromResult(respond(r))) { }

        public FakeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond)
            => _respond = respond;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            Requests.Add(new CapturedRequest(request.RequestUri!, body, request.Headers.ToList()));
            return await _respond(request, ct);
        }
    }
}
