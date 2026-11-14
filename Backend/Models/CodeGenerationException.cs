namespace Backend.Models;

/// <summary>
/// Thrown when code generation fails to extract a valid code block from the LLM response after retrying.
/// Carries the raw response so the UI can provide a "show raw response" toggle.
/// </summary>
public class CodeGenerationException : Exception
{
    public string RawResponse { get; }

    public CodeGenerationException(string message, string rawResponse) : base(message)
    {
        RawResponse = rawResponse ?? "";
    }
}
