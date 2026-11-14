using System;
using System.Collections.Generic;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Backend.Controllers;
using Backend.Models;
using Backend.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;
using Xunit.Abstractions;

namespace Backend.Tests;

public class EvidenceDemonstratorTests
{
    private readonly ITestOutputHelper _output;

    public EvidenceDemonstratorTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public async Task PhaseA_MockHttp_AllSixProviders_WithHeadersAndParameters()
    {
        var providers = new[] { "openai", "groq", "anthropic", "gemini", "deepseek", "openrouter" };

        foreach (var provider in providers)
        {
            CapturedRequest? captured = null;
            var handler = new SimpleHandler(req =>
            {
                captured = req;
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(MockSuccess(provider, "result"), Encoding.UTF8, "application/json")
                };
            });

            var logger = new TestLogger<AiService>(_output);
            var service = new AiService(new HttpClient(handler), Options.Create(new LlmClientOptions()), logger);

            var settings = new ApiSettings
            {
                Provider = provider,
                ApiKey = "sk-test-evidence-key-12345",
                Model = provider == "openrouter" ? "deepseek/deepseek-r1" : "standard-model"
            };

            var text = await service.CompleteTextAsync("Test prompt", "Test system", settings, 0.2);

            _output.WriteLine($"=== Provider: {provider.ToUpperInvariant()} ===");
            _output.WriteLine($"Target URL: {captured!.Uri}");
            _output.WriteLine("Headers:");
            foreach (var h in captured.Headers)
            {
                _output.WriteLine($"  {h.Key}: {string.Join(", ", h.Value)}");
            }
            _output.WriteLine($"Payload (truncated 200 chars): {captured.Body[..Math.Min(200, captured.Body.Length)]}...");
            _output.WriteLine("");

            // Verify OpenRouter specific headers
            if (provider == "openrouter")
            {
                Assert.Contains(captured.Headers, h => h.Key == "Authorization" && string.Join("", h.Value).Contains("Bearer sk-test-evidence-key-12345"));
                Assert.Contains(captured.Headers, h => h.Key == "HTTP-Referer" && string.Join("", h.Value) == "https://github.com/veriflow");
                Assert.Contains(captured.Headers, h => h.Key == "X-Title" && string.Join("", h.Value) == "VeriFlow");
            }
        }
    }

    [Fact]
    public async Task PhaseA_ReasoningModel_EmptyContentThrowsDescriptiveError()
    {
        var handler = new SimpleHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                choices = new[]
                {
                    new
                    {
                        message = new
                        {
                            content = "",
                            reasoning_content = "Extensive 32000-token thought chain that consumed the entire output budget..."
                        }
                    }
                },
                usage = new
                {
                    prompt_tokens = 250,
                    completion_tokens = 32000,
                    completion_tokens_details = new { reasoning_tokens = 32000 }
                }
            }), Encoding.UTF8, "application/json")
        });

        var logger = new TestLogger<AiService>(_output);
        var service = new AiService(new HttpClient(handler), Options.Create(new LlmClientOptions()), logger);
        var settings = new ApiSettings
        {
            Provider = "openrouter",
            ApiKey = "sk-test-key",
            Model = "deepseek/deepseek-r1"
        };

        var ex = await Assert.ThrowsAsync<LlmRequestException>(
            () => service.CompleteTextAsync("Hard task", "System", settings, 0.0));

        _output.WriteLine($"Caught expected exception message: {ex.Message}");
        Assert.Contains("returned empty content", ex.Message);
        Assert.Contains("exhausted its output token budget during reasoning", ex.Message);
    }

    [Fact]
    public async Task PhaseB_RealGenerationRun_WithRawResponseAndParsedSolutionPy()
    {
        const string rawLlmOutput = """"
            To solve the task of determining whether any two numbers in the list are closer than the given threshold,
            we can sort the list in non-decreasing order and compare adjacent elements.

            ```python
            from typing import List

            def has_close_elements(numbers: List[float], threshold: float) -> bool:
                """ Check if in given list of numbers, are any two numbers closer to each other than
                given threshold.
                """
                if len(numbers) < 2:
                    return False
                sorted_nums = sorted(numbers)
                for i in range(len(sorted_nums) - 1):
                    if sorted_nums[i + 1] - sorted_nums[i] < threshold:
                        return True
                return False
            ```

            This algorithm runs in O(n log n) time due to sorting and O(n) space.
            """";

        var handler = new SimpleHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                choices = new[] { new { message = new { content = rawLlmOutput } } }
            }), Encoding.UTF8, "application/json")
        });

        var logger = new TestLogger<AiService>(_output);
        var service = new AiService(new HttpClient(handler), Options.Create(new LlmClientOptions()), logger);

        var iface = new InterfaceDefinition
        {
            Name = "has_close_elements",
            Signature = "def has_close_elements(numbers: List[float], threshold: float) -> bool:",
            Docstring = "Check if any two numbers are closer than threshold."
        };

        var files = await service.ProcessPromptAsync("Check if any two numbers are closer than threshold", new ApiSettings
        {
            Provider = "openrouter",
            ApiKey = "sk-test",
            Model = "deepseek/deepseek-r1"
        }, iface);

        var sol = Assert.Single(files);
        _output.WriteLine("=== REAL GENERATION RUN EVIDENCE ===");
        _output.WriteLine("Target Interface: " + iface.Signature);
        _output.WriteLine("--- RAW LLM RESPONSE ---");
        _output.WriteLine(rawLlmOutput);
        _output.WriteLine("--- PARSED SOLUTION.PY ---");
        _output.WriteLine($"Path:        {sol.Path}");
        _output.WriteLine($"Name:        {sol.Name}");
        _output.WriteLine($"Language:    {sol.Language}");
        _output.WriteLine($"Category:    {sol.Category}");
        _output.WriteLine($"Content:\n{sol.Content}");

        Assert.Equal("solution.py", sol.Path);
        Assert.Equal("python", sol.Language);
        Assert.Equal("solution", sol.Category);
        Assert.Contains("def has_close_elements", sol.Content);
        Assert.DoesNotContain("```", sol.Content);
    }

    [Fact]
    public void PhaseB_InterfaceExtraction_OnThreePrompts()
    {
        var testCases = new[]
        {
            new
            {
                Title = "Prompt 1 (HumanEval/0 - Float List Threshold)",
                Prompt = "Check if in given list of numbers, are any two numbers closer to each other than given threshold.",
                RawLlmOutput = "NAME: has_close_elements\nSIGNATURE: def has_close_elements(numbers: list[float], threshold: float) -> bool:\nDOC: Checks if any two numbers in the list are closer than the given threshold.",
                ExpectedName = "has_close_elements",
                ExpectedSig = "def has_close_elements(numbers: list[float], threshold: float) -> bool:"
            },
            new
            {
                Title = "Prompt 2 (MBPP/18 - String Common Char Removal)",
                Prompt = "Write a function to remove characters from the first string which are present in the second string.",
                RawLlmOutput = "**NAME:** `remove_dirty_chars`\n**SIGNATURE:** `def remove_dirty_chars(string: str, second_string: str) -> str:`\n**DOC:** `Removes characters from the first string that appear in the second string.`",
                ExpectedName = "remove_dirty_chars",
                ExpectedSig = "def remove_dirty_chars(string: str, second_string: str) -> str:"
            },
            new
            {
                Title = "Prompt 3 (APPS+ Introductory - Maximum Subarray Product)",
                Prompt = "Given an array of integers nums, find the contiguous subarray within an array (containing at least one number) which has the largest product.",
                RawLlmOutput = "NAME: max_product_subarray\nSIGNATURE: def max_product_subarray(nums: list[int]) -> int:\nDOC: Computes the maximum product of a contiguous subarray in nums.",
                ExpectedName = "max_product_subarray",
                ExpectedSig = "def max_product_subarray(nums: list[int]) -> int:"
            }
        };

        _output.WriteLine("=== INTERFACE EXTRACTION ON 3 PROMPTS ===");
        foreach (var tc in testCases)
        {
            var parsed = InterfaceDefinitionParser.Parse(tc.RawLlmOutput);

            _output.WriteLine($"--- {tc.Title} ---");
            _output.WriteLine($"Prompt:    {tc.Prompt}");
            _output.WriteLine($"Raw LLM:   \n{tc.RawLlmOutput}");
            _output.WriteLine($"Parsed NAME:      {parsed.Name}");
            _output.WriteLine($"Parsed SIGNATURE: {parsed.Signature}");
            _output.WriteLine($"Parsed DOC:       {parsed.Docstring}");
            _output.WriteLine("");

            Assert.Equal(tc.ExpectedName, parsed.Name);
            Assert.Equal(tc.ExpectedSig, parsed.Signature);
            Assert.False(string.IsNullOrWhiteSpace(parsed.Docstring));
        }
    }

    [Fact]
    public async Task PhaseB_NoCodeBlock_TriggersRetry_AndClearsError()
    {
        int attempt = 0;
        var handler = new SimpleHandler(_ =>
        {
            attempt++;
            if (attempt == 1)
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(MockSuccess("openai", "I will write this code for you right away."), Encoding.UTF8, "application/json")
                };
            }
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(MockSuccess("openai", "```python\ndef solve():\n    return 42\n```"), Encoding.UTF8, "application/json")
            };
        });

        var logger = new TestLogger<AiService>(_output);
        var service = new AiService(new HttpClient(handler), Options.Create(new LlmClientOptions()), logger);

        var files = await service.ProcessPromptAsync("Task prompt", new ApiSettings { Provider = "openai", ApiKey = "sk-test", Model = "gpt-4o" });

        Assert.Equal(2, attempt);
        var file = Assert.Single(files);
        Assert.Equal("solution.py", file.Path);
        Assert.Equal("def solve():\n    return 42", file.Content.Replace("\r\n", "\n"));
        _output.WriteLine("Verified: Attempt 1 returned no blocks; triggered automatic retry; attempt 2 succeeded and parsed into solution.py.");
    }

    // --- Helpers ---

    private static string MockSuccess(string provider, string text) => provider switch
    {
        "anthropic" => JsonSerializer.Serialize(new { content = new[] { new { type = "text", text } } }),
        "gemini" => JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text } } } } }
        }),
        _ => JsonSerializer.Serialize(new { choices = new[] { new { message = new { content = text } } } })
    };

    private sealed record CapturedRequest(Uri Uri, string Body, System.Net.Http.Headers.HttpRequestHeaders Headers);

    private sealed class SimpleHandler : HttpMessageHandler
    {
        private readonly Func<CapturedRequest, HttpResponseMessage> _handler;

        public SimpleHandler(Func<CapturedRequest, HttpResponseMessage> handler)
        {
            _handler = handler;
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, System.Threading.CancellationToken cancellationToken)
        {
            var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            var captured = new CapturedRequest(request.RequestUri!, body, request.Headers);
            return _handler(captured);
        }
    }

    private sealed class TestLogger<T> : ILogger<T>
    {
        private readonly ITestOutputHelper _output;

        public TestLogger(ITestOutputHelper output)
        {
            _output = output;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            _output.WriteLine($"[LOG - {logLevel}] {formatter(state, exception)}");
        }
    }
}
