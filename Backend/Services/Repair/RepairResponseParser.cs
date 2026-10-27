using System.Text.RegularExpressions;
using Backend.Models;

namespace Backend.Services.Repair;

/// <summary>A response block that was not applied, with the reason (shown for transparency).</summary>
public sealed record IgnoredRepairBlock(string? Path, string Reason);

/// <summary>Result of parsing one raw repair response (Req. 26.3, 26.4).</summary>
public sealed class ParsedRepairResponse
{
    public ParsedRepairResponse(
        string? critiqueText,
        IReadOnlyDictionary<string, string> files,
        bool hadCodeBlock,
        IReadOnlyList<IgnoredRepairBlock> ignored)
    {
        CritiqueText = critiqueText;
        Files = files;
        HadCodeBlock = hadCodeBlock;
        Ignored = ignored;
    }

    /// <summary>Response text outside fenced blocks (trimmed); null when empty.</summary>
    public string? CritiqueText { get; }

    /// <summary>New content keyed by the editable file's path (as given in the request).</summary>
    public IReadOnlyDictionary<string, string> Files { get; }

    /// <summary>The response contained at least one Python fenced block.</summary>
    public bool HadCodeBlock { get; }

    /// <summary>Blocks that targeted test files, unknown paths, or had no target.</summary>
    public IReadOnlyList<IgnoredRepairBlock> Ignored { get; }

    public bool HasCode => Files.Count > 0;

    /// <summary>No file could be extracted; the files stay unchanged.</summary>
    public bool NoExtractableCode => Files.Count == 0;

    /// <summary>Copies of <paramref name="files"/> with the extracted content applied.</summary>
    public List<GeneratedCodeFile> Apply(IEnumerable<GeneratedCodeFile> files) =>
        files.Select(f => new GeneratedCodeFile
        {
            Name = f.Name,
            Path = f.Path,
            Language = f.Language,
            Description = f.Description,
            Category = f.Category,
            Content = !RepairFiles.IsTestFile(f) && Files.TryGetValue(RepairFiles.PathOf(f), out var c) ? c : f.Content,
        }).ToList();
}

/// <summary>
/// Splits a web repair response into critique and per-file code (design §7; fence rules
/// from <c>tivr/extract.py</c>):
/// <list type="bullet">
/// <item>an opening fence is a line starting with 3+ backticks (info string's first word is
/// the tag); a closing fence is a line of only backticks, at least as many; an unterminated
/// fence runs to the end; CRLF/CR accepted, extracted code uses <c>\n</c>;</item>
/// <item>a block is assigned to the path of the nearest preceding <c>### File: &lt;path&gt;</c>
/// header (one header per block); blocks for test files or unknown paths are ignored;</item>
/// <item>with exactly one editable file, an unlabeled Python block (<c>python</c>, <c>py</c>,
/// <c>python3</c>, or untagged) maps to it; with several, unlabeled blocks are ignored;</item>
/// <item>the last block for a file wins (as in <c>extract.py</c>);</item>
/// <item>with exactly one editable file and no Python fenced block, the full stripped text
/// is the new content (Req. 11.14); otherwise no assignment → <c>NoExtractableCode</c>;</item>
/// <item>critique = text outside fenced blocks and their headers, trimmed, null when empty.</item>
/// </list>
/// </summary>
public sealed class RepairResponseParser
{
    private static readonly HashSet<string> PythonTags = new(StringComparer.Ordinal) { "", "python", "py", "python3" };
    private static readonly Regex OpenFence = new(@"^\s*(`{3,})(.*)$", RegexOptions.CultureInvariant);
    private static readonly Regex CloseFence = new(@"^\s*(`{3,})\s*$", RegexOptions.CultureInvariant);
    private static readonly Regex FileHeader = new(
        @"^\s{0,3}#{1,6}[ \t]*File:[ \t]*(.+?)[ \t]*$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private sealed record Block(int Start, int End, string Tag, List<string> Body);

    /// <param name="raw">Raw LLM response.</param>
    /// <param name="files">Project files; test files among them are treated as read-only.</param>
    public ParsedRepairResponse Parse(string? raw, IEnumerable<GeneratedCodeFile> files)
    {
        var editable = RepairFiles.Editable(files).Select(RepairFiles.PathOf).ToList();
        var text = (raw ?? "").Replace("\r\n", "\n").Replace('\r', '\n');
        var lines = text.Split('\n');
        var blocks = ScanBlocks(lines);

        var assigned = new Dictionary<string, string>(StringComparer.Ordinal);
        var ignored = new List<IgnoredRepairBlock>();
        var removed = new bool[lines.Length];
        var hadPythonBlock = blocks.Any(b => PythonTags.Contains(b.Tag));

        var searchFrom = 0;
        foreach (var block in blocks)
        {
            for (var i = block.Start; i < block.End; i++)
                removed[i] = true;

            var headerLine = NearestHeader(lines, searchFrom, block.Start);
            searchFrom = block.End;
            var code = TrimCode(block.Body);

            if (headerLine is int h)
            {
                removed[h] = true;
                var target = CleanHeaderPath(FileHeader.Match(lines[h]).Groups[1].Value);
                if (RepairFiles.IsTestPath(target) || IsTestTarget(target, files))
                {
                    ignored.Add(new(target, "test files are read-only during repair"));
                    continue;
                }
                var path = Resolve(target, editable);
                if (path is null)
                {
                    ignored.Add(new(target, "path is not an editable project file"));
                    continue;
                }
                if (RepairFiles.IsPythonPath(path) && !PythonTags.Contains(block.Tag))
                {
                    ignored.Add(new(path, $"'{block.Tag}' block cannot be Python file content"));
                    continue;
                }
                if (code.Length == 0)
                {
                    ignored.Add(new(path, "empty code block"));
                    continue;
                }
                assigned[path] = code + "\n";
                continue;
            }

            if (!PythonTags.Contains(block.Tag))
                continue;                                     // ```json, ```text, ... are not code
            if (editable.Count != 1)
            {
                ignored.Add(new(null, "unlabeled block needs exactly one editable file"));
                continue;
            }
            if (code.Length == 0)
            {
                ignored.Add(new(editable[0], "empty code block"));
                continue;
            }
            assigned[editable[0]] = code + "\n";
        }

        if (assigned.Count == 0 && !hadPythonBlock && editable.Count == 1 && text.Trim().Length > 0)
        {
            // No Python fenced block: the full stripped text is the code (Req. 11.14).
            assigned[editable[0]] = text.Trim() + "\n";
            return new ParsedRepairResponse(null, assigned, false, ignored);
        }

        var critique = string.Join("\n", lines.Where((_, i) => !removed[i])).Trim();
        return new ParsedRepairResponse(critique.Length > 0 ? critique : null, assigned, hadPythonBlock, ignored);
    }

    private static List<Block> ScanBlocks(string[] lines)
    {
        var blocks = new List<Block>();
        int i = 0, n = lines.Length;
        while (i < n)
        {
            var m = OpenFence.Match(lines[i]);
            if (!m.Success)
            {
                i++;
                continue;
            }
            var ticks = m.Groups[1].Value.Length;
            var info = m.Groups[2].Value.Trim();
            var tag = info.Length > 0 ? info.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)[0].ToLowerInvariant() : "";
            var body = new List<string>();
            var j = i + 1;
            while (j < n)
            {
                var c = CloseFence.Match(lines[j]);
                if (c.Success && c.Groups[1].Value.Length >= ticks)
                    break;
                body.Add(lines[j]);
                j++;
            }
            var end = j < n ? j + 1 : n;
            blocks.Add(new Block(i, end, tag, body));
            i = end;
        }
        return blocks;
    }

    /// <summary>Last <c>File:</c> header line in [from, to) — the one consumed by the next block.</summary>
    private static int? NearestHeader(string[] lines, int from, int to)
    {
        for (var i = to - 1; i >= from; i--)
        {
            if (FileHeader.IsMatch(lines[i]))
                return i;
        }
        return null;
    }

    /// <summary>Drop leading blank lines and trailing whitespace; keep first-line indent.</summary>
    private static string TrimCode(List<string> body)
    {
        var start = 0;
        while (start < body.Count && string.IsNullOrWhiteSpace(body[start]))
            start++;
        return string.Join("\n", body.Skip(start)).TrimEnd();
    }

    private static string CleanHeaderPath(string value) =>
        RepairFiles.NormalizePath(value.Trim().Trim('`', '*', '"', '\'').Trim());

    private static bool IsTestTarget(string target, IEnumerable<GeneratedCodeFile> files) =>
        files.Any(f => RepairFiles.IsTestFile(f) &&
                       string.Equals(RepairFiles.PathOf(f), target, StringComparison.OrdinalIgnoreCase));

    /// <summary>Exact path match first, then a unique case-insensitive match.</summary>
    private static string? Resolve(string target, IReadOnlyList<string> editable)
    {
        if (editable.Contains(target, StringComparer.Ordinal))
            return target;
        var matches = editable.Where(p => string.Equals(p, target, StringComparison.OrdinalIgnoreCase)).ToList();
        return matches.Count == 1 ? matches[0] : null;
    }
}
