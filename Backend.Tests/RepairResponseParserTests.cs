using Backend.Models;
using Backend.Services.Repair;

namespace Backend.Tests;

/// <summary>Critique/code split and file assignment of web repair responses (Req. 26.3, 26.4).</summary>
public class RepairResponseParserTests
{
    private static readonly RepairResponseParser Parser = new();

    private static GeneratedCodeFile File(string path, string content = "old\n", string category = "main") =>
        new() { Name = Path.GetFileName(path), Path = path, Category = category, Content = content };

    private static List<GeneratedCodeFile> SingleFile() =>
        [File("main.py"), File("test_main.py", "TESTS\n", "test")];

    private static List<GeneratedCodeFile> MultiFile() =>
        [File("main.py"), File("pkg/utils.py"), File("tests/test_main.py", "TESTS\n", "test")];

    [Fact]
    public void SingleEditableFile_UnlabeledBlock_AssignedToIt()
    {
        var parsed = Parser.Parse("The bug is on line 2.\n```python\ndef f():\n    return 2\n```\nDone.", SingleFile());

        Assert.False(parsed.NoExtractableCode);
        Assert.True(parsed.HadCodeBlock);
        Assert.Equal(new Dictionary<string, string> { ["main.py"] = "def f():\n    return 2\n" }, parsed.Files);
        Assert.Equal("The bug is on line 2.\nDone.", parsed.CritiqueText);
    }

    [Fact]
    public void SingleEditableFile_LastPythonBlockWins_OtherTagsSkipped()
    {
        var raw = "```py\nv1\n```\n```json\n{\"a\": 1}\n```\n```\nv2\n```";

        var parsed = Parser.Parse(raw, SingleFile());

        Assert.Equal("v2\n", parsed.Files["main.py"]);
        Assert.Null(parsed.CritiqueText);
    }

    [Fact]
    public void MultipleFileBlocks_AssignedByNearestPrecedingHeader()
    {
        var raw = "Analysis: utils returns the wrong value.\r\n\r\n" +
                  "### File: pkg/utils.py\r\n```python\r\ndef g():\r\n    return 2\r\n```\r\n\r\n" +
                  "### File: `main.py`\r\n```python\r\nfrom pkg.utils import g\r\n```\r\n";

        var parsed = Parser.Parse(raw, MultiFile());

        Assert.Equal(2, parsed.Files.Count);
        Assert.Equal("def g():\n    return 2\n", parsed.Files["pkg/utils.py"]);
        Assert.Equal("from pkg.utils import g\n", parsed.Files["main.py"]);
        Assert.Equal("Analysis: utils returns the wrong value.", parsed.CritiqueText);
        Assert.Empty(parsed.Ignored);
    }

    [Fact]
    public void UnknownPath_IsIgnored()
    {
        var raw = "### File: other.py\n```python\nx = 1\n```\n### File: main.py\n```python\ny = 2\n```";

        var parsed = Parser.Parse(raw, MultiFile());

        Assert.Equal(new[] { "main.py" }, parsed.Files.Keys);
        Assert.Contains(parsed.Ignored, i => i.Path == "other.py");
    }

    [Fact]
    public void TestFileTarget_IsIgnored_AndNeverApplied()
    {
        var files = MultiFile();
        var raw = "### File: tests/test_main.py\n```python\nassert True\n```\n### File: test_new.py\n```python\npass\n```";

        var parsed = Parser.Parse(raw, files);

        Assert.True(parsed.NoExtractableCode);
        Assert.Equal(2, parsed.Ignored.Count);
        Assert.All(parsed.Ignored, i => Assert.Contains("test files", i.Reason));
        Assert.Equal(files.Select(f => f.Content), parsed.Apply(files).Select(f => f.Content));
    }

    [Fact]
    public void SingleEditableFile_NoFencedBlock_FullTextIsCode()
    {
        var parsed = Parser.Parse("\n def f():\n    return 3\n\n", SingleFile());

        Assert.Equal("def f():\n    return 3\n", parsed.Files["main.py"]);
        Assert.False(parsed.HadCodeBlock);
        Assert.Null(parsed.CritiqueText);
    }

    [Fact]
    public void MultipleEditableFiles_NoUsableBlock_IsNoExtractableCode()
    {
        var files = MultiFile();
        var parsed = Parser.Parse("I think the bug is in g.\n```python\ndef g(): return 2\n```", files);

        Assert.True(parsed.NoExtractableCode);
        Assert.False(parsed.HasCode);
        Assert.Equal("I think the bug is in g.", parsed.CritiqueText);
        Assert.Equal(files.Select(f => f.Content), parsed.Apply(files).Select(f => f.Content));
    }

    [Fact]
    public void NoCodeAtAll_IsNoExtractableCode_WithNullCritique()
    {
        var parsed = Parser.Parse("   \r\n ", SingleFile());

        Assert.True(parsed.NoExtractableCode);
        Assert.Null(parsed.CritiqueText);
    }

    [Fact]
    public void CritiqueIsNull_WhenResponseIsOnlyCode()
    {
        var parsed = Parser.Parse("### File: main.py\n```python\nz = 1\n```\n", MultiFile());

        Assert.Equal("z = 1\n", parsed.Files["main.py"]);
        Assert.Null(parsed.CritiqueText);
    }

    [Fact]
    public void UnterminatedFence_RunsToEnd()
    {
        var parsed = Parser.Parse("Fix:\n```python\ndef f():\n    return 4\n", SingleFile());

        Assert.Equal("def f():\n    return 4\n", parsed.Files["main.py"]);
        Assert.Equal("Fix:", parsed.CritiqueText);
    }

    [Fact]
    public void LongerFence_IsNotClosedByShorterInnerFence()
    {
        var parsed = Parser.Parse("### File: main.py\n````python\nX = '''\n```\n'''\n````\nafter", MultiFile());

        Assert.Equal("X = '''\n```\n'''\n", parsed.Files["main.py"]);
        Assert.Equal("after", parsed.CritiqueText);
    }

    [Fact]
    public void Apply_ReplacesOnlyAssignedFiles_WithCopies()
    {
        var files = MultiFile();
        var parsed = Parser.Parse("### File: pkg\\utils.py\n```python\nnew\n```", files);

        var applied = parsed.Apply(files);

        Assert.Equal(new[] { "old\n", "new\n", "TESTS\n" }, applied.Select(f => f.Content));
        Assert.Equal("old\n", files[1].Content);
        Assert.NotSame(files[0], applied[0]);
    }
}
