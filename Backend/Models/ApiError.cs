using System.Text.Json.Serialization;

namespace Backend.Models;

/// <summary>Field-level validation error returned with 400 responses (src/api/types.ts <c>InvalidField</c>).</summary>
public class InvalidField
{
    [JsonPropertyName("field")]
    public string Field { get; set; } = "";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    public InvalidField() { }

    public InvalidField(string field, string message)
    {
        Field = field;
        Message = message;
    }
}

/// <summary>
/// Error envelope of 400 validation responses: <c>{error, invalidFields}</c>
/// (src/api/types.ts <c>ApiErrorBody</c>).
/// </summary>
public class ApiValidationErrorBody
{
    [JsonPropertyName("error")]
    public string Error { get; set; } = "";

    [JsonPropertyName("invalidFields")]
    public List<InvalidField> InvalidFields { get; set; } = new();
}
