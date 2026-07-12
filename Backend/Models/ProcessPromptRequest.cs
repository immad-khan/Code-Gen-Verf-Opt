namespace Backend.Models;

public class ProcessPromptRequest
{
    public string Prompt { get; set; } = "";
    public ApiSettings ApiSettings { get; set; } = new();
}
