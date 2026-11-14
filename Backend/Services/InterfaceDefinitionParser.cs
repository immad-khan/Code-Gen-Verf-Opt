using System.Text.RegularExpressions;
using Backend.Models;

namespace Backend.Services;

/// <summary>
/// Parses the simple 3-line interface definition:
/// NAME: ...
/// SIGNATURE: ...
/// DOC: ...
/// </summary>
public static class InterfaceDefinitionParser
{
    private static readonly Regex NamePrefixRegex = new(@"^\s*(?:\*{1,2})?NAME:\s*(?:\*{1,2})?\s*(.*)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex SignaturePrefixRegex = new(@"^\s*(?:\*{1,2})?SIGNATURE:\s*(?:\*{1,2})?\s*(.*)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex DocPrefixRegex = new(@"^\s*(?:\*{1,2})?DOC:\s*(?:\*{1,2})?\s*(.*)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex DefFunctionNameRegex = new(@"def\s+([a-zA-Z_][a-zA-Z0-9_]*)", RegexOptions.Compiled);

    public static InterfaceDefinition Parse(string rawText)
    {
        var result = new InterfaceDefinition();
        if (string.IsNullOrWhiteSpace(rawText))
        {
            result.Name = "solution";
            result.Signature = "def solution():";
            result.Docstring = "Python solution.";
            return result;
        }

        var lines = rawText.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);

        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed)) continue;

            var nameMatch = NamePrefixRegex.Match(trimmed);
            if (nameMatch.Success && string.IsNullOrEmpty(result.Name))
            {
                result.Name = CleanValue(nameMatch.Groups[1].Value);
                continue;
            }

            var sigMatch = SignaturePrefixRegex.Match(trimmed);
            if (sigMatch.Success && string.IsNullOrEmpty(result.Signature))
            {
                result.Signature = CleanValue(sigMatch.Groups[1].Value);
                continue;
            }

            var docMatch = DocPrefixRegex.Match(trimmed);
            if (docMatch.Success && string.IsNullOrEmpty(result.Docstring))
            {
                result.Docstring = CleanValue(docMatch.Groups[1].Value);
                continue;
            }
        }

        // If Name was not found or was empty, infer from Signature
        if (string.IsNullOrWhiteSpace(result.Name) && !string.IsNullOrWhiteSpace(result.Signature))
        {
            var defMatch = DefFunctionNameRegex.Match(result.Signature);
            if (defMatch.Success)
            {
                result.Name = defMatch.Groups[1].Value;
            }
        }

        // If Signature was not found, infer from Name
        if (string.IsNullOrWhiteSpace(result.Signature))
        {
            var funcName = string.IsNullOrWhiteSpace(result.Name) ? "solution" : result.Name;
            result.Signature = $"def {funcName}():";
        }

        if (string.IsNullOrWhiteSpace(result.Name))
        {
            result.Name = "solution";
        }

        if (string.IsNullOrWhiteSpace(result.Docstring))
        {
            result.Docstring = "Python solution.";
        }

        return result;
    }

    private static string CleanValue(string val)
    {
        var cleaned = val.Trim();
        // Remove enclosing backticks
        if (cleaned.StartsWith('`') && cleaned.EndsWith('`') && cleaned.Length >= 2)
        {
            cleaned = cleaned.Trim('`').Trim();
        }
        // Remove enclosing quotes
        if ((cleaned.StartsWith('"') && cleaned.EndsWith('"')) || (cleaned.StartsWith('\'') && cleaned.EndsWith('\'')))
        {
            cleaned = cleaned.Substring(1, cleaned.Length - 2).Trim();
        }
        return cleaned;
    }
}
