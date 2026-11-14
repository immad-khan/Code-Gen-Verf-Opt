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
    public const string GenerationSystemPrompt = """
        Write a Python solution for the task below. Use the exact function name and
        signature given. Standard library only unless the task says otherwise.
        Do NOT write tests. Return only the code in one ```python block.
        """;

    public const string InterfaceSystemPrompt = """
        You are a software architect. Given a task description, determine the exact Python function interface required to solve it.
        Do NOT write the function body or any tests.
        Output EXACTLY three lines in this format:
        NAME: <function_name>
        SIGNATURE: def <function_name>(<parameters>) -> <return_type>:
        DOC: <one-line docstring describing purpose>
        """;

    private const string SYSTEM_PROMPT = """
        TASK: Generate Python code based on the user's description.

        IMPORTANT RULES:
        1. ONLY handle Python code generation requests. If the user's message is NOT a request to create, write, or build Python code (e.g. greetings, general questions, non-code tasks), return EXACTLY this JSON:
           {"error": "I can only generate Python code. Please describe a Python project or program you would like me to create.", "files": []}

        2. SMART FILE GENERATION:
           - For SIMPLE tasks (single function, algorithm, script, utility, class): Generate a SINGLE .py file plus a test file. Do NOT create folders or extra config.
           - For COMPLEX tasks (REST API, management system, multi-component app): Generate multiple files with proper folder structure (routers, models, services, tests, config).
           - Never over-engineer. Match the complexity of the output to the complexity of the request.

        4. Always include at least one test file with pytest-compatible test functions (def test_...).

        5. Return ONLY a valid JSON object with this structure - no markdown fences, no prose:
        {
          "summary": "one-line description of what was built",
          "files": [
            { "name": "filename.py", "path": "relative/path/filename.py", "category": "router|service|model|schema|data|test|config|utils|other", "description": "Plain-English purpose", "content": "# Write the ACTUAL complete Python code here. Do not leave empty! Do not use placeholders." }
          ]
        }
        """;

    // Generation (JSON file list) keeps its historical temperature.
    private const double GenerationTemperature = 0.1;
    private const int AnthropicMaxTokens = 8000;
    private const int MaxErrorDetailLength = 300;

    private readonly HttpClient _httpClient;
    private readonly TimeSpan _timeout;
    private readonly LlmClientOptions _options;
    private readonly Microsoft.Extensions.Logging.ILogger<AiService>? _logger;

    public AiService(HttpClient httpClient, IOptions<LlmClientOptions> options, Microsoft.Extensions.Logging.ILogger<AiService>? logger = null)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
        var seconds = options.Value.TimeoutSeconds;
        if (!(seconds > 0) || double.IsInfinity(seconds))
        {
            throw new ArgumentOutOfRangeException(
                nameof(options), seconds, $"{LlmClientOptions.SectionName}:TimeoutSeconds must be a positive number.");
        }
        _timeout = TimeSpan.FromSeconds(seconds);
    }

    /// <summary>Resolves the model profile (sendTemperature, maxOutputTokens) based on config and heuristics.</summary>
    public ModelProfile GetModelProfile(string? model)
    {
        var modelName = (model ?? "").Trim();
        if (!string.IsNullOrEmpty(modelName) && _options.Models != null)
        {
            if (_options.Models.TryGetValue(modelName, out var exact))
            {
                return exact;
            }
            foreach (var (k, v) in _options.Models)
            {
                if (modelName.Equals(k, StringComparison.OrdinalIgnoreCase) ||
                    modelName.StartsWith(k, StringComparison.OrdinalIgnoreCase))
                {
                    return v;
                }
            }
        }

        // Default heuristic: names containing "reasoner" or "r1" omit temperature and have large token limit
        if (modelName.Contains("reasoner", StringComparison.OrdinalIgnoreCase) ||
            modelName.Contains("r1", StringComparison.OrdinalIgnoreCase))
        {
            return new ModelProfile { SendTemperature = false, MaxOutputTokens = 32000 };
        }

        return new ModelProfile { SendTemperature = true, MaxOutputTokens = null };
    }

    /// <summary>Effective per-request timeout (from <c>Llm:TimeoutSeconds</c>).</summary>
    public TimeSpan Timeout => _timeout;

    public async Task<InterfaceDefinition> ExtractInterfaceAsync(string prompt, ApiSettings settings, CancellationToken ct = default)
    {
        var rawResponse = await SendAsync(prompt, InterfaceSystemPrompt, settings, GenerationTemperature, jsonMode: false, ct);
        return InterfaceDefinitionParser.Parse(rawResponse);
    }

    public async Task<List<GeneratedCodeFile>> ProcessPromptAsync(
        string prompt,
        ApiSettings settings,
        InterfaceDefinition? iface = null,
        CancellationToken ct = default)
    {
        var fullPrompt = new StringBuilder();
        fullPrompt.AppendLine("TASK:");
        fullPrompt.AppendLine(prompt);
        if (iface != null && !string.IsNullOrWhiteSpace(iface.Signature))
        {
            fullPrompt.AppendLine();
            fullPrompt.AppendLine("TARGET INTERFACE:");
            if (!string.IsNullOrWhiteSpace(iface.Name))
            {
                fullPrompt.AppendLine($"Name: {iface.Name}");
            }
            fullPrompt.AppendLine($"Signature: {iface.Signature}");
            if (!string.IsNullOrWhiteSpace(iface.Docstring))
            {
                fullPrompt.AppendLine($"Docstring: {iface.Docstring}");
            }
        }

        var rawResponse = await SendAsync(fullPrompt.ToString(), GenerationSystemPrompt, settings, GenerationTemperature, jsonMode: false, ct);
        var files = FencedCodeBlockParser.ParseBlocks(rawResponse);

        // If no code block found: retry once.
        if (files.Count == 0)
        {
            _logger?.LogWarning("[AiService] No code block found in response for prompt. Retrying once...");
            var retryPrompt = fullPrompt.ToString() + "\n\nCRITICAL: Return the complete Python solution enclosed in a ```python block. Do not return plain text without code fences.";
            rawResponse = await SendAsync(retryPrompt, GenerationSystemPrompt, settings, GenerationTemperature, jsonMode: false, ct);
            files = FencedCodeBlockParser.ParseBlocks(rawResponse);
        }

        // Backward compatibility: If still no code blocks found, check if the response was JSON (e.g. from existing test mocks)
        if (files.Count == 0)
        {
            var parsedJson = ExtractJson(rawResponse);
            if (parsedJson.HasValue)
            {
                files = NormalizeFiles(parsedJson);
            }
        }

        // If it still fails, throw CodeGenerationException with the raw response
        if (files.Count == 0)
        {
            throw new CodeGenerationException("No code block found in LLM response after retry.", rawResponse);
        }

        return files;
    }

    public Task<List<GeneratedCodeFile>> ProcessPromptAsync(string prompt, ApiSettings settings, CancellationToken ct)
        => ProcessPromptAsync(prompt, settings, iface: null, ct);

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
        if (provider is not ("openai" or "groq" or "anthropic" or "gemini" or "deepseek" or "openrouter"))
        {
            throw new LlmRequestException(provider, $"LLM request failed: unsupported provider '{settings.Provider}'.");
        }

        var name = DisplayName(provider);
        var apiKey = settings.ApiKey ?? "";
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new LlmRequestException(provider, $"LLM request to {name} failed: no API key configured.");
        }

        var profile = GetModelProfile(settings.Model);
        _logger?.LogInformation(
            "[AiService] Sending request to {Provider} (Model: {Model}, SendTemperature: {SendTemp}, Temperature: {Temp}, MaxOutputTokens: {MaxTokens}, JsonMode: {JsonMode})",
            provider, settings.Model ?? "DEFAULT", profile.SendTemperature, profile.SendTemperature ? temperature : "OMITTED", profile.MaxOutputTokens?.ToString() ?? "DEFAULT", jsonMode);

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
    private HttpRequestMessage BuildRequest(
        string provider, string prompt, string systemPrompt, string model, string apiKey, double temperature, bool jsonMode)
    {
        HttpRequestMessage request;
        object body;
        var profile = GetModelProfile(model);

        switch (provider)
        {
            case "openai":
            case "groq":
            case "deepseek":
            case "openrouter":
            {
                var url = provider switch
                {
                    "openai" => "https://api.openai.com/v1/chat/completions",
                    "groq" => "https://api.groq.com/openai/v1/chat/completions",
                    "deepseek" => "https://api.deepseek.com/chat/completions",
                    "openrouter" => "https://openrouter.ai/api/v1/chat/completions",
                    _ => "https://api.openai.com/v1/chat/completions"
                };

                var payload = new Dictionary<string, object>
                {
                    ["model"] = model ?? "",
                    ["messages"] = new[]
                    {
                        new { role = "system", content = systemPrompt },
                        new { role = "user", content = prompt },
                    },
                };

                if (profile.SendTemperature)
                {
                    payload["temperature"] = temperature;
                }

                if (profile.MaxOutputTokens.HasValue)
                {
                    payload["max_tokens"] = profile.MaxOutputTokens.Value;
                }

                if (jsonMode && profile.SendTemperature)
                {
                    payload["response_format"] = new { type = "json_object" };
                }
                body = payload;
                request = new HttpRequestMessage(HttpMethod.Post, url);
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {apiKey}");
                if (provider == "openrouter")
                {
                    request.Headers.TryAddWithoutValidation("HTTP-Referer", "https://github.com/veriflow");
                    request.Headers.TryAddWithoutValidation("X-Title", "VeriFlow");
                }
                break;
            }
            case "anthropic":
            {
                var anthropicDict = new Dictionary<string, object>
                {
                    ["model"] = model ?? "",
                    ["max_tokens"] = profile.MaxOutputTokens ?? AnthropicMaxTokens,
                    ["system"] = systemPrompt,
                    ["messages"] = new[] { new { role = "user", content = prompt } },
                };
                if (profile.SendTemperature)
                {
                    anthropicDict["temperature"] = temperature;
                }
                body = anthropicDict;
                request = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
                request.Headers.TryAddWithoutValidation("x-api-key", apiKey);
                request.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");
                break;
            }
            default: // gemini
            {
                var generationConfig = new Dictionary<string, object>();
                if (profile.SendTemperature)
                {
                    generationConfig["temperature"] = temperature;
                }
                if (profile.MaxOutputTokens.HasValue)
                {
                    generationConfig["maxOutputTokens"] = profile.MaxOutputTokens.Value;
                }
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

    private string ParseText(string provider, string responseJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseJson);
            var root = doc.RootElement;
            string content = "";

            switch (provider)
            {
                case "openai":
                case "groq":
                case "deepseek":
                case "openrouter":
                {
                    var choice = root.GetProperty("choices")[0].GetProperty("message");
                    content = choice.TryGetProperty("content", out var cElem) ? cElem.GetString() ?? "" : "";

                    // Log reasoning tokens if provider returned them
                    if (root.TryGetProperty("usage", out var usageElem))
                    {
                        if (usageElem.TryGetProperty("completion_tokens_details", out var details) &&
                            details.TryGetProperty("reasoning_tokens", out var rTokens))
                        {
                            _logger?.LogInformation("[AiService] Reasoning tokens reported by {Provider}: {Tokens}", provider, rTokens.GetInt32());
                        }
                    }
                    break;
                }
                case "anthropic":
                {
                    var sb = new StringBuilder();
                    foreach (var block in root.GetProperty("content").EnumerateArray())
                    {
                        if (block.TryGetProperty("type", out var type) && type.GetString() != "text") continue;
                        if (block.TryGetProperty("text", out var text)) sb.Append(text.GetString());
                    }
                    content = sb.ToString();
                    break;
                }
                default: // gemini
                {
                    var sb = new StringBuilder();
                    if (root.TryGetProperty("candidates", out var cands) && cands.GetArrayLength() > 0)
                    {
                        var cand = cands[0];
                        if (cand.TryGetProperty("content", out var cContent) &&
                            cContent.TryGetProperty("parts", out var parts))
                        {
                            foreach (var part in parts.EnumerateArray())
                            {
                                if (part.TryGetProperty("text", out var text)) sb.Append(text.GetString());
                            }
                        }
                    }
                    content = sb.ToString();
                    break;
                }
            }

            if (string.IsNullOrWhiteSpace(content))
            {
                throw new LlmRequestException(
                    provider,
                    $"LLM request to {DisplayName(provider)} returned empty content. The model may have exhausted its output token budget during reasoning.");
            }

            return content;
        }
        catch (LlmRequestException)
        {
            throw;
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
        "deepseek" => "DeepSeek",
        "openrouter" => "OpenRouter",
        _ => provider,
    };

    private JsonElement? ExtractJson(string text)
    {
        // First, strip any prefix like "Groq 400: ", "OpenAI 500: ", etc.
        var processedText = System.Text.RegularExpressions.Regex.Replace(text, @"^(Groq|OpenAI|Anthropic|Gemini|DeepSeek)\s+\d+:\s*", "");

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
