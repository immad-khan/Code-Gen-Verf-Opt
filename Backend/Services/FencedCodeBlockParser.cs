using System.IO;
using System.Text.RegularExpressions;
using Backend.Models;

namespace Backend.Services;

/// <summary>
/// Parses fenced code blocks (```python ... ```) into GeneratedCodeFile objects.
/// Supports single blocks (defaulting to solution.py) and multi-file blocks
/// preceded by "### File: path".
/// </summary>
public static class FencedCodeBlockParser
{
    private static readonly Regex CodeBlockRegex = new(
        @"(?:^|\n)(?:[ \t]*`{3,}|~{3,})(?:[a-zA-Z0-9_\-]+)?\r?\n([\s\S]*?)\r?\n(?:[ \t]*`{3,}|~{3,})",
        RegexOptions.Compiled);

    private static readonly Regex FileHeaderRegex = new(
        @"(?:^|\r?\n)[ \t]*(?:###|##|#)?[ \t]*File:[ \t]*([^\r\n`#]+)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static List<GeneratedCodeFile> ParseBlocks(string rawText)
    {
        var files = new List<GeneratedCodeFile>();
        if (string.IsNullOrWhiteSpace(rawText))
        {
            return files;
        }

        var matches = CodeBlockRegex.Matches(rawText);
        if (matches.Count == 0)
        {
            return files;
        }

        int lastIndex = 0;
        int fileIndex = 1;

        for (int i = 0; i < matches.Count; i++)
        {
            var match = matches[i];
            var codeContent = match.Groups[1].Value.TrimEnd();

            // Look at preceding text between lastIndex and match.Index for "### File: <path>"
            var precedingText = rawText.Substring(lastIndex, match.Index - lastIndex);
            var fileHeaderMatches = FileHeaderRegex.Matches(precedingText);

            string filePath;
            if (fileHeaderMatches.Count > 0)
            {
                var rawPath = fileHeaderMatches[fileHeaderMatches.Count - 1].Groups[1].Value.Trim();
                // Strip backticks or quotes
                filePath = rawPath.Trim('`', '"', '\'').Trim();
            }
            else
            {
                filePath = i == 0 ? "solution.py" : $"file_{fileIndex}.py";
            }

            // Clean path
            filePath = filePath.Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(filePath))
            {
                filePath = i == 0 ? "solution.py" : $"file_{fileIndex}.py";
            }

            var fileName = Path.GetFileName(filePath);
            if (string.IsNullOrWhiteSpace(fileName))
            {
                fileName = filePath;
            }

            var category = filePath.ToLowerInvariant().Contains("test") ? "test" : "solution";
            var language = filePath.EndsWith(".toml", StringComparison.OrdinalIgnoreCase) ? "toml" : "python";

            files.Add(new GeneratedCodeFile
            {
                Name = fileName,
                Path = filePath,
                Language = language,
                Category = category,
                Description = $"File: {fileName}",
                Content = codeContent
            });

            lastIndex = match.Index + match.Length;
            fileIndex++;
        }

        return files;
    }
}
