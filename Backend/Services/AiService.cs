using System.Globalization;
using System.Text;
using System.Text.Json;
using Backend.Models;
using Microsoft.Extensions.Options;

namespace Backend.Services;

/// <summary>
/// Provider calls for OpenAI, Groq, Anthropic, and Gemini: JSON-mode code generation for the
/// current UI and plain-text completion (<see cref="ILlmClient"/>) for the repair loop.
/// </summary>
public class AiService : ILlmClient
{
    private const string SYSTEM_PROMPT = """
        You are MACI, a Python code generation system used for research purposes.

        TASK: Generate Python code based on the user's description.

        IMPORTANT RULES:
        1. ONLY handle Python code generation requests. If the user's message is NOT a request to create, write, or build Python code (e.g. greetings, general questions, non-code tasks), return EXACTLY this JSON:
           {"error": "I can only generate Python code. Please describe a Python project or program you would like me to create.", "files": []}

        2. SMART FILE GENERATION:
           - For SIMPLE tasks (single function, algorithm, script, utility, class): Generate a SINGLE .py file plus a test file. Do NOT create folders or extra config.
           - For COMPLEX tasks (REST API, management system, multi-component app): Generate multiple files with proper folder structure (routers, models, services, tests, config).
           - Never over-engineer. Match the complexity of the output to the complexity of the request.

        3. Generate CLEAN, production-quality Python code. Write the code exactly as a skilled developer would.

        4. Always include at least one test file with pytest-compatible test functions (def test_...).

        5. Return ONLY a valid JSON object with this structure â€” no markdown fences, no prose:
        {
          "summary": "one-line description of what was built",
          "files": [
            { "name": "filename.py", "path": "relative/path/filename.py", "category": "router|service|model|schema|data|test|config|utils|other", "description": "Plain-English purpose", "content": "# Write the ACTUAL complete Python code here. Do not leave empty! Do not use placeholders." }
          ]
        }

        category must be one of: router | service | model | schema | data | test | config | utils | other.
        Every file's content must contain the ACTUAL FULL PYTHON CODE, not a stub or placeholder. Do not leave the content field empty.
        """;

    // Generation (JSON file list) keeps its historical temperature.
    private const double GenerationTemperature = 0.1;
    private const int AnthropicMaxTokens = 8000;
    private const int MaxErrorDetailLength = 300;

    private readonly HttpClient _httpClient;
    private readonly TimeSpan _timeout;

    public AiService(HttpClient httpClient, IOptions<LlmClientOptions> options)
    {
        _httpClient = httpClient;
        var seconds = options.Value.TimeoutSeconds;
        if (!(seconds > 0) || double.IsInfinity(seconds))
        {
            throw new ArgumentOutOfRangeException(
                nameof(options), seconds, $"{LlmClientOptions.SectionName}:TimeoutSeconds must be a positive number.");
        }
        _timeout = TimeSpan.FromSeconds(seconds);
    }

    /// <summary>Effective per-request timeout (from <c>Llm:TimeoutSeconds</c>).</summary>
    public TimeSpan Timeout => _timeout;

    public async Task<List<GeneratedCodeFile>> ProcessPromptAsync(string prompt, ApiSettings settings, CancellationToken ct = default)
    {
        var rawResponse = await SendAsync(prompt, SYSTEM_PROMPT, settings, GenerationTemperature, jsonMode: true, ct);
        var parsed = ExtractJson(rawResponse);
        return NormalizeFiles(parsed);
    }

    // Legacy JSON-mode repair; replaced by the OptimizationService rewrite (task 12.6).
    public async Task<(List<GeneratedCodeFile> Files, string RawResponse)> RepairCodeAsync(string repairPrompt, ApiSettings settings, string? customSystemPrompt = null)
    {
        var rawResponse = await SendAsync(repairPrompt, customSystemPrompt ?? SYSTEM_PROMPT, settings, GenerationTemperature, jsonMode: true, CancellationToken.None);
        var parsed = ExtractJson(rawResponse);
        var files = NormalizeFiles(parsed);
        return (files, rawResponse);
    }

    /// <inheritdoc />
    public Task<string> CompleteTextAsync(
        string prompt, string systemPrompt, ApiSettings settings, double temperature, CancellationToken ct = default)
        => SendAsync(prompt, systemPrompt, settings, temperature, jsonMode: false, ct);

    private async Task<string> SendAsync(
        string prompt, string systemPrompt, ApiSettings settings, double temperature, bool jsonMode, CancellationToken ct)
    {
        var provider = (settings.Provider ?? "").Trim().ToLowerInvariant();
        if (provider is not ("openai" or "groq" or "anthropic" or "gemini"))
        {
            throw new LlmRequestException(provider, $"LLM request failed: unsupported provider '{settings.Provider}'.");
        }

        var name = DisplayName(provider);
        var apiKey = settings.ApiKey ?? "";
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new LlmRequestException(provider, $"LLM request to {name} failed: no API key configured.");
        }

        using var request = BuildRequest(provider, prompt, systemPrompt, settings.Model ?? "", apiKey, temperature, jsonMode);
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(_timeout);

        try
        {
            using var response = await _httpClient.SendAsync(request, timeoutCts.Token);
            var body = await response.Content.ReadAsStringAsync(timeoutCts.Token);

            if (!response.IsSuccessStatusCode)
            {
                // Groq JSON mode reports invalid JSON as HTTP 400 with "failed_generation";
                // the generation path salvages the files from it (see ExtractJson).
                if (jsonMode && provider == "groq" && (int)response.StatusCode == 400 && body.Contains("failed_generation"))
                {
                    return body;
                }
                throw HttpError(provider, (int)response.StatusCode, response.ReasonPhrase, body, apiKey);
            }

            return ParseText(provider, body);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new LlmRequestException(
                provider, $"LLM request to {name} failed: timed out after {_timeout.TotalSeconds.ToString("0.###", CultureInfo.InvariantCulture)} s.");
        }
        catch (HttpRequestException ex)
        {
            // The inner exception is not attached so nothing provider-supplied escapes unredacted.
            throw new LlmRequestException(
                provider,
                $"LLM request to {name} failed: {ex.GetType().Name}: {Redact(ex.Message, apiKey)}",
                ex.StatusCode is { } status ? (int)status : null);
        }
    }

    /// <summary>
    /// Builds the provider request. Keys travel only in headers (never in the URL), the
    /// temperature is serialized unchanged, and JSON response mode is requested only for generation.
    /// </summary>
    private static HttpRequestMessage BuildRequest(
        string provider, string prompt, string systemPrompt, string model, string apiKey, double temperature, bool jsonMode)
    {
        HttpRequestMessage request;
        object body;

        switch (provider)
        {
            case "openai":
            case "groq":
            {
                var url = provider == "openai"
                    ? "https://api.openai.com/v1/chat/completions"
                    : "https://api.groq.com/openai/v1/chat/completions";
                var payload = new Dictionary<string, object>
                {
                    ["model"] = model,
                    ["temperature"] = temperature,
                    ["messages"] = new[]
                    {
                        new { role = "system", content = systemPrompt },
                        new { role = "user", content = prompt },
                    },
                };
                if (jsonMode)
                {
                    payload["response_format"] = new { type = "json_object" };
                }
                body = payload;
                request = new HttpRequestMessage(HttpMethod.Post, url);
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {apiKey}");
                break;
            }
            case "anthropic":
            {
                // Anthropic has no JSON response mode; the payload is identical in both modes.
                body = new
                {
                    model,
                    temperature,
                    max_tokens = AnthropicMaxTokens,
                    system = systemPrompt,
                    messages = new[] { new { role = "user", content = prompt } },
                };
                request = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
                request.Headers.TryAddWithoutValidation("x-api-key", apiKey);
                request.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");
                break;
            }
            default: // gemini
            {
                var generationConfig = new Dictionary<string, object> { ["temperature"] = temperature };
                if (jsonMode)
                {
                    generationConfig["responseMimeType"] = "application/json";
                }
                body = new
                {
                    generationConfig,
                    systemInstruction = new { parts = new[] { new { text = systemPrompt } } },
                    contents = new[] { new { role = "user", parts = new[] { new { text = prompt } } } },
                };
                var url = $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(model)}:generateContent";
                request = new HttpRequestMessage(HttpMethod.Post, url);
                request.Headers.TryAddWithoutValidation("x-goog-api-key", apiKey);
                break;
            }
        }

        request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        return request;
    }

    private static string ParseText(string provider, string responseJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseJson);
            var root = doc.RootElement;
            switch (provider)
            {
                case "openai":
                case "groq":
                    return root.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "";
                case "anthropic":
                {
                    var sb = new StringBuilder();
                    foreach (var block in root.GetProperty("content").EnumerateArray())
                    {
                        if (block.TryGetProperty("type", out var type) && type.GetString() != "text") continue;
                        if (block.TryGetProperty("text", out var text)) sb.Append(text.GetString());
                    }
                    return sb.ToString();
                }
                default: // gemini
                {
                    var sb = new StringBuilder();
                    foreach (var part in root.GetProperty("candidates")[0].GetProperty("content").GetProperty("parts").EnumerateArray())
                    {
                        if (part.TryGetProperty("text", out var text)) sb.Append(text.GetString());
                    }
                    return sb.ToString();
                }
            }
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or IndexOutOfRangeException)
        {
            throw new LlmRequestException(provider, $"LLM request to {DisplayName(provider)} failed: unexpected response format.");
        }
    }

    private static LlmRequestException HttpError(string provider, int status, string? reason, string body, string apiKey)
    {
        var detail = Redact(ErrorDetail(body), apiKey);
        detail = string.Join(' ', detail.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (detail.Length > MaxErrorDetailLength) detail = detail[..MaxErrorDetailLength] + "...";

        var message = $"LLM request to {DisplayName(provider)} failed: HTTP {status}"
            + (string.IsNullOrWhiteSpace(reason) ? "" : $" {reason}")
            + (detail.Length == 0 ? "." : $": {detail}");
        return new LlmRequestException(provider, message, status);
    }

    /// <summary>Provider error text: <c>error.message</c> when present, else the raw body.</summary>
    private static string ErrorDetail(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("error", out var error))
            {
                if (error.ValueKind == JsonValueKind.Object &&
                    error.TryGetProperty("message", out var msg) && msg.ValueKind == JsonValueKind.String)
                {
                    return msg.GetString() ?? "";
                }
                if (error.ValueKind == JsonValueKind.String) return error.GetString() ?? "";
            }
        }
        catch (JsonException)
        {
            // Not JSON; fall back to the raw body.
        }
        return body;
    }

    private static string Redact(string text, string apiKey)
    {
        if (string.IsNullOrEmpty(text) || apiKey.Length < 4) return text;
        return text.Replace(apiKey, "[redacted]", StringComparison.Ordinal)
                   .Replace(apiKey.Trim(), "[redacted]", StringComparison.Ordinal);
    }

    private static string DisplayName(string provider) => provider switch
    {
        "openai" => "OpenAI",
        "groq" => "Groq",
        "anthropic" => "Anthropic",
        "gemini" => "Gemini",
        _ => provider,
    };

    private JsonElement? ExtractJson(string text)
    {
        // First, strip any prefix like "Groq 400: ", "OpenAI 500: ", etc.
        var processedText = System.Text.RegularExpressions.Regex.Replace(text, @"^(Groq|OpenAI|Anthropic|Gemini)\s+\d+:\s*", "");

        // First try: is processedText already valid JSON with "files" key?
        try
        {
            var firstBracket = processedText.IndexOf('{');
            var matchingBracket = FindMatchingBracket(processedText, firstBracket);
            var jsonStr = processedText.Substring(firstBracket, matchingBracket - firstBracket + 1);
            var doc = JsonDocument.Parse(jsonStr);
            if (doc.RootElement.TryGetProperty("files", out _))
            {
                return doc.RootElement;
            }
        }
        catch
        {
            // Ignore
        }

        // Second try: check for failed_generation
        try
        {
            var firstBracket = processedText.IndexOf('{');
            var matchingBracket = FindMatchingBracket(processedText, firstBracket);
            var jsonStr = processedText.Substring(firstBracket, matchingBracket - firstBracket + 1);
            var outer = JsonDocument.Parse(jsonStr);
            if (outer.RootElement.TryGetProperty("error", out var error) &&
                error.TryGetProperty("failed_generation", out var failedGen))
            {
                var failedGenStr = failedGen.GetString() ?? "";
                // Fix triple quotes
                failedGenStr = System.Text.RegularExpressions.Regex.Replace(
                    failedGenStr,
                    @"""content""\s*:\s*""""""([\s\S]*?)""""""",
                    match =>
                    {
                        var content = match.Groups[1].Value;
                        var escaped = content
                            .Replace("\\", "\\\\")
                            .Replace("\"", "\\\"")
                            .Replace("\n", "\\n")
                            .Replace("\r", "\\r")
                            .Replace("\t", "\\t");
                        return $"\"content\": \"{escaped}\"";
                    }
                );
                // Try to parse failedGen
                try
                {
                    var fgFirstBracket = failedGenStr.IndexOf('{');
                    var fgMatchingBracket = FindMatchingBracket(failedGenStr, fgFirstBracket);
                    var fgJsonStr = failedGenStr.Substring(fgFirstBracket, fgMatchingBracket - fgFirstBracket + 1);
                    var fgDoc = JsonDocument.Parse(fgJsonStr);
                    if (fgDoc.RootElement.TryGetProperty("files", out _))
                    {
                        return fgDoc.RootElement;
                    }
                }
                catch
                {
                    // Ignore
                }
            }
        }
        catch
        {
            // Ignore
        }

        // Third try: check for choices
        try
        {
            var firstBracket = processedText.IndexOf('{');
            var matchingBracket = FindMatchingBracket(processedText, firstBracket);
            var jsonStr = processedText.Substring(firstBracket, matchingBracket - firstBracket + 1);
            var outer = JsonDocument.Parse(jsonStr);
            if (outer.RootElement.TryGetProperty("choices", out var choices) &&
                choices.GetArrayLength() > 0 &&
                choices[0].TryGetProperty("message", out var message) &&
                message.TryGetProperty("content", out var content))
            {
                var contentStr = content.GetString() ?? "";
                // Fix triple quotes
                contentStr = System.Text.RegularExpressions.Regex.Replace(
                    contentStr,
                    @"""content""\s*:\s*""""""([\s\S]*?)""""""",
                    match =>
                    {
                        var c = match.Groups[1].Value;
                        var escaped = c
                            .Replace("\\", "\\\\")
                            .Replace("\"", "\\\"")
                            .Replace("\n", "\\n")
                            .Replace("\r", "\\r")
                            .Replace("\t", "\\t");
                        return $"\"content\": \"{escaped}\"";
                    }
                );
                var contentFirstBracket = contentStr.IndexOf('{');
                var contentMatchingBracket = FindMatchingBracket(contentStr, contentFirstBracket);
                var contentJsonStr = contentStr.Substring(contentFirstBracket, contentMatchingBracket - contentFirstBracket + 1);
                var contentDoc = JsonDocument.Parse(contentJsonStr);
                if (contentDoc.RootElement.TryGetProperty("files", out _))
                {
                    return contentDoc.RootElement;
                }
            }
        }
        catch
        {
            // Ignore
        }

        return null;
    }

    private static int FindMatchingBracket(string str, int startIdx)
    {
        var count = 1;
        for (var i = startIdx + 1; i < str.Length; i++)
        {
            if (str[i] == '{') count++;
            else if (str[i] == '}') count--;
            if (count == 0) return i;
        }
        return str.Length - 1;
    }

    private List<GeneratedCodeFile> NormalizeFiles(JsonElement? parsed)
    {
        var files = new List<GeneratedCodeFile>();
        if (!parsed.HasValue) return files;
        if (!parsed.Value.TryGetProperty("files", out var filesArray)) return files;
        
        var index = 0;
        foreach (var file in filesArray.EnumerateArray())
        {
            var name = file.TryGetProperty("name", out var nameProp) ? nameProp.GetString() ?? $"file_{index + 1}.py" : $"file_{index + 1}.py";
            var path = file.TryGetProperty("path", out var pathProp) ? pathProp.GetString() ?? name : name;
            files.Add(new GeneratedCodeFile
            {
                Name = name,
                Path = path,
                Language = name.EndsWith(".toml") || path.EndsWith(".toml") ? "toml" : "python",
                Category = file.TryGetProperty("category", out var categoryProp) ? categoryProp.GetString() ?? "other" : "other",
                Description = file.TryGetProperty("description", out var descProp) ? descProp.GetString() ?? "Generated file" : "Generated file",
                Content = file.TryGetProperty("content", out var contentProp) ? contentProp.GetString() ?? "" : ""
            });
            index++;
        }
        return files;
    }
}
