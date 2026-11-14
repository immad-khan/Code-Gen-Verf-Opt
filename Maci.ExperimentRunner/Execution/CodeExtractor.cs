using System.Text.RegularExpressions;

namespace Maci.ExperimentRunner.Execution;

public static class CodeExtractor
{
    private static readonly Regex CodeBlockRegex = new(
        @"```(?:python|py)?\s*\n([\s\S]*?)```",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static string ExtractPythonCode(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";

        var matches = CodeBlockRegex.Matches(text);
        if (matches.Count > 0)
        {
            // Pick the largest block or the one containing function definitions
            var bestMatch = matches[0].Groups[1].Value;
            foreach (Match match in matches)
            {
                var code = match.Groups[1].Value;
                if (code.Contains("def ") && !bestMatch.Contains("def "))
                {
                    bestMatch = code;
                }
                else if (code.Length > bestMatch.Length && code.Contains("def "))
                {
                    bestMatch = code;
                }
            }
            return CleanCode(bestMatch);
        }

        // If no code blocks found, check if raw text looks like code
        return CleanCode(text);
    }

    private static string CleanCode(string code)
    {
        var cleaned = code.Trim();
        // Remove trailing or leading backticks if any remained
        if (cleaned.StartsWith("```python")) cleaned = cleaned[9..].TrimStart();
        if (cleaned.StartsWith("```")) cleaned = cleaned[3..].TrimStart();
        if (cleaned.EndsWith("```")) cleaned = cleaned[..^3].TrimEnd();
        return cleaned.Trim();
    }
}
