using Backend.Models;

namespace Backend.Services;

/// <summary>
/// Plain-text LLM completion used by the repair loop (Requirement 22.3).
/// Implementations send <paramref name="temperature"/> to the provider unchanged and
/// never request a JSON response mode.
/// </summary>
public interface ILlmClient
{
    /// <summary>
    /// Sends one chat completion and returns the model's raw text.
    /// Throws <see cref="LlmRequestException"/> on provider errors, unexpected responses,
    /// unsupported providers, a missing key, or timeout. Throws
    /// <see cref="OperationCanceledException"/> only when <paramref name="ct"/> is cancelled.
    /// </summary>
    Task<string> CompleteTextAsync(
        string prompt,
        string systemPrompt,
        ApiSettings settings,
        double temperature,
        CancellationToken ct = default);
}

/// <summary>Configuration section <c>Llm</c>.</summary>
public sealed class LlmClientOptions
{
    public const string SectionName = "Llm";

    /// <summary>Per-request timeout in seconds (must be &gt; 0).</summary>
    public double TimeoutSeconds { get; set; } = 120;
}

/// <summary>
/// LLM call failure. The message names the provider and, for HTTP errors, the status code;
/// it never contains the API key.
/// </summary>
public sealed class LlmRequestException : Exception
{
    public string Provider { get; }
    public int? StatusCode { get; }

    public LlmRequestException(string provider, string message, int? statusCode = null)
        : base(message)
    {
        Provider = provider;
        StatusCode = statusCode;
    }
}
