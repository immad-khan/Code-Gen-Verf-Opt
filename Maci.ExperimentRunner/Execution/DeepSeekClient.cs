using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Maci.ExperimentRunner.Execution;

public sealed record LlmCompletionResult(
    string Content,
    string? ReasoningContent,
    int PromptTokens,
    int CompletionTokens,
    int TotalTokens,
    TimeSpan Duration,
    string Model,
    DateTime Timestamp
);

public sealed class DeepSeekClient
{
    private static readonly HttpClient HttpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(180)
    };

    private readonly string _apiKey;
    private readonly string _model;
    private readonly string _endpoint;

    public DeepSeekClient(string apiKey, string model = "deepseek-reasoner", string? endpoint = null)
    {
        _apiKey = apiKey;
        _model = model;
        _endpoint = !string.IsNullOrEmpty(endpoint)
            ? endpoint
            : (model.Contains("/") || model.Contains("openrouter")
                ? "https://openrouter.ai/api/v1/chat/completions"
                : "https://api.deepseek.com/chat/completions");
    }

    public async Task<LlmCompletionResult> CompleteAsync(string prompt, CancellationToken ct = default)
    {
        var requestPayload = new JsonObject
        {
            ["model"] = _model,
            ["messages"] = new JsonArray
            {
                new JsonObject
                {
                    ["role"] = "user",
                    ["content"] = prompt
                }
            }
        };

        // Note: For deepseek-reasoner (DeepSeek-R1), temperature and top_p are unsupported/ignored by provider.
        // We log actual parameters used in the run record.

        var requestJson = requestPayload.ToJsonString();
        var maxRetries = 5;
        var delay = TimeSpan.FromSeconds(2);

        for (var attempt = 1; attempt <= maxRetries; attempt++)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, _endpoint);
                if (_endpoint.Contains("openrouter.ai", StringComparison.OrdinalIgnoreCase))
                {
                    request.Headers.TryAddWithoutValidation("HTTP-Referer", "https://github.com/veriflow");
                    request.Headers.TryAddWithoutValidation("X-Title", "VeriFlow");
                }
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);
                request.Content = new StringContent(requestJson, Encoding.UTF8, "application/json");

                using var response = await HttpClient.SendAsync(request, ct);
                var responseContent = await response.Content.ReadAsStringAsync(ct);
                sw.Stop();

                if (response.IsSuccessStatusCode)
                {
                    var doc = JsonNode.Parse(responseContent);
                    var choice = doc?["choices"]?[0]?["message"];
                    var content = choice?["content"]?.GetValue<string>() ?? "";
                    var reasoning = choice?["reasoning_content"]?.GetValue<string>();

                    var usage = doc?["usage"];
                    var promptTokens = usage?["prompt_tokens"]?.GetValue<int>() ?? 0;
                    var completionTokens = usage?["completion_tokens"]?.GetValue<int>() ?? 0;
                    var totalTokens = usage?["total_tokens"]?.GetValue<int>() ?? (promptTokens + completionTokens);

                    return new LlmCompletionResult(
                        Content: content,
                        ReasoningContent: reasoning,
                        PromptTokens: promptTokens,
                        CompletionTokens: completionTokens,
                        TotalTokens: totalTokens,
                        Duration: sw.Elapsed,
                        Model: _model,
                        Timestamp: DateTime.UtcNow
                    );
                }

                var statusCode = (int)response.StatusCode;
                if ((statusCode == 429 || statusCode >= 500) && attempt < maxRetries)
                {
                    Console.WriteLine($"[DeepSeekClient] HTTP {statusCode} on attempt {attempt}/{maxRetries}. Retrying in {delay.TotalSeconds}s...");
                    await Task.Delay(delay, ct);
                    delay *= 2;
                    continue;
                }

                throw new InvalidOperationException($"DeepSeek API error: HTTP {statusCode} - {responseContent}");
            }
            catch (Exception ex) when (attempt < maxRetries && (ex is HttpRequestException || ex is TimeoutException))
            {
                Console.WriteLine($"[DeepSeekClient] Request exception '{ex.Message}' on attempt {attempt}/{maxRetries}. Retrying in {delay.TotalSeconds}s...");
                await Task.Delay(delay, ct);
                delay *= 2;
            }
        }

        throw new InvalidOperationException($"DeepSeek API failed after {maxRetries} attempts.");
    }
}
