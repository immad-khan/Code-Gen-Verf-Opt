namespace Backend.Models;

public sealed class GenerateTestsRequest
{
    public string Prompt { get; set; } = "";
    public InterfaceDefinition Interface { get; set; } = new();
    public ApiSettings ApiSettings { get; set; } = new();
}

public sealed class ValidateTestsRequest
{
    public string TestCode { get; set; } = "";
    public InterfaceDefinition Interface { get; set; } = new();
}

public sealed class ValidateTestsResponse
{
    public bool Valid { get; set; }
    public int TestCount { get; set; }
    public string? Error { get; set; }
    public List<string> Warnings { get; set; } = [];
}

public sealed class LockTestsRequest
{
    public string TestCode { get; set; } = "";
    public int TestCount { get; set; }
}

public sealed class LockTestsResponse
{
    public string Hash { get; set; } = "";
    public int TestCount { get; set; }
    public string TestCode { get; set; } = "";
}
