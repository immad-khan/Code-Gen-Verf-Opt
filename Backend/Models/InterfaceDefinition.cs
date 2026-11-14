namespace Backend.Models;

/// <summary>
/// Proposes the function interface (NAME, SIGNATURE, DOC) extracted from the prompt
/// before test generation or code generation.
/// For APPS+ problems, the interface is "read stdin, print stdout" with signature fields skipped.
/// </summary>
public sealed class InterfaceDefinition
{
    public string Name { get; set; } = "";
    public string Signature { get; set; } = "";
    public string Docstring { get; set; } = "";

    public bool IsStdinStdout
    {
        get => Name.Equals("stdin_stdout", StringComparison.OrdinalIgnoreCase) ||
               Signature.Contains("read stdin", StringComparison.OrdinalIgnoreCase) ||
               Signature.Contains("stdin", StringComparison.OrdinalIgnoreCase);
        set
        {
            if (value)
            {
                Name = "stdin_stdout";
                Signature = "read stdin, print stdout";
                if (string.IsNullOrWhiteSpace(Docstring))
                {
                    Docstring = "Read input from stdin and write results to stdout.";
                }
            }
        }
    }
}

public sealed class InterfaceRequest
{
    public string Prompt { get; set; } = "";
    public ApiSettings ApiSettings { get; set; } = new();
}
