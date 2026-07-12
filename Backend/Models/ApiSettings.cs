namespace Backend.Models;

public class ApiSettings
{
    public string Provider { get; set; } = "groq";
    public string ApiKey { get; set; } = "";
    public string Model { get; set; } = "llama-3.3-70b-versatile";
    public string? CustomEndpoint { get; set; }
}
