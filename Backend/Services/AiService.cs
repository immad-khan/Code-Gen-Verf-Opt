using System.Text;
using System.Text.Json;
using Backend.Models;

namespace Backend.Services;

public class AiService
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

        5. Return ONLY a valid JSON object with this structure — no markdown fences, no prose:
        {
          "summary": "one-line description of what was built",
          "files": [
            { "name": "filename.py", "path": "relative/path/filename.py", "category": "router|service|model|schema|data|test|config|utils|other", "description": "Plain-English purpose", "content": "# Write the ACTUAL complete Python code here. Do not leave empty! Do not use placeholders." }
          ]
        }

        category must be one of: router | service | model | schema | data | test | config | utils | other.
        Every file's content must contain the ACTUAL FULL PYTHON CODE, not a stub or placeholder. Do not leave the content field empty.
        """;

    private readonly HttpClient _httpClient;

    public AiService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<List<GeneratedCodeFile>> ProcessPromptAsync(string prompt, ApiSettings settings)
    {
        var rawResponse = await CallProviderAsync(prompt, settings, 0.6);
        var parsed = ExtractJson(rawResponse);
        return NormalizeFiles(parsed);
    }

    private async Task<string> CallProviderAsync(string prompt, ApiSettings settings, double temperature)
    {
        return settings.Provider.ToLower() switch
        {
            "openai" => await CallOpenAIAsync(prompt, settings.ApiKey, settings.Model, temperature),
            "groq" => await CallGroqAsync(prompt, settings.ApiKey, settings.Model, temperature),
            "anthropic" => await CallAnthropicAsync(prompt, settings.ApiKey, settings.Model, temperature),
            "gemini" => await CallGeminiAsync(prompt, settings.ApiKey, settings.Model, temperature),
            _ => throw new ArgumentException("Invalid provider")
        };
    }

    private async Task<string> CallOpenAIAsync(string prompt, string apiKey, string model, double temperature)
    {
        var requestBody = new
        {
            model,
            temperature,
            response_format = new { type = "json_object" },
            messages = new[]
            {
                new { role = "system", content = SYSTEM_PROMPT },
                new { role = "user", content = prompt }
            }
        };

        var json = JsonSerializer.Serialize(requestBody);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        _httpClient.DefaultRequestHeaders.Clear();
        _httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");

        var response = await _httpClient.PostAsync("https://api.openai.com/v1/chat/completions", content);
        response.EnsureSuccessStatusCode();

        var responseJson = await response.Content.ReadAsStringAsync();
        var doc = JsonDocument.Parse(responseJson);
        return doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "";
    }

    private async Task<string> CallGroqAsync(string prompt, string apiKey, string model, double temperature)
    {
        var requestBody = new
        {
            model,
            temperature,
            response_format = new { type = "json_object" },
            messages = new[]
            {
                new { role = "system", content = SYSTEM_PROMPT },
                new { role = "user", content = prompt }
            }
        };

        var json = JsonSerializer.Serialize(requestBody);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        _httpClient.DefaultRequestHeaders.Clear();
        _httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");

        try
        {
            var response = await _httpClient.PostAsync("https://api.groq.com/openai/v1/chat/completions", content);
            var responseJson = await response.Content.ReadAsStringAsync();
            
            if (!response.IsSuccessStatusCode)
            {
                return $"Groq {response.StatusCode}: {responseJson}";
            }
            
            var doc = JsonDocument.Parse(responseJson);
            return doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "";
        }
        catch (Exception ex)
        {
            return $"Groq Error: {ex.Message}";
        }
    }

    private async Task<string> CallAnthropicAsync(string prompt, string apiKey, string model, double temperature)
    {
        var requestBody = new
        {
            model,
            temperature,
            max_tokens = 8000,
            system = SYSTEM_PROMPT,
            messages = new[] { new { role = "user", content = prompt } }
        };

        var json = JsonSerializer.Serialize(requestBody);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        _httpClient.DefaultRequestHeaders.Clear();
        _httpClient.DefaultRequestHeaders.Add("x-api-key", apiKey);
        _httpClient.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");

        var response = await _httpClient.PostAsync("https://api.anthropic.com/v1/messages", content);
        response.EnsureSuccessStatusCode();

        var responseJson = await response.Content.ReadAsStringAsync();
        var doc = JsonDocument.Parse(responseJson);
        return doc.RootElement.GetProperty("content")[0].GetProperty("text").GetString() ?? "";
    }

    private async Task<string> CallGeminiAsync(string prompt, string apiKey, string model, double temperature)
    {
        var requestBody = new
        {
            generationConfig = new { temperature, responseMimeType = "application/json" },
            systemInstruction = new { parts = new[] { new { text = SYSTEM_PROMPT } } },
            contents = new[] { new { role = "user", parts = new[] { new { text = prompt } } } }
        };

        var json = JsonSerializer.Serialize(requestBody);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _httpClient.PostAsync(
            $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={Uri.EscapeDataString(apiKey)}", 
            content
        );
        response.EnsureSuccessStatusCode();

        var responseJson = await response.Content.ReadAsStringAsync();
        var doc = JsonDocument.Parse(responseJson);
        return doc.RootElement.GetProperty("candidates")[0].GetProperty("content").GetProperty("parts")[0].GetProperty("text").GetString() ?? "";
    }

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
