using Backend.Services;
using Xunit;

namespace Backend.Tests;

public class FencedBlockParserTests
{
    [Fact]
    public void SingleBlock_ParsesIntoSolutionPy()
    {
        const string raw = """
            Here is the solution:
            ```python
            def solve(x: int) -> int:
                return x * 2
            ```
            Hope this helps!
            """;

        var files = FencedCodeBlockParser.ParseBlocks(raw);

        var file = Assert.Single(files);
        Assert.Equal("solution.py", file.Path);
        Assert.Equal("solution.py", file.Name);
        Assert.Equal("python", file.Language);
        Assert.Equal("solution", file.Category);
        Assert.Equal("def solve(x: int) -> int:\n    return x * 2", file.Content.Replace("\r\n", "\n"));
    }

    [Fact]
    public void MultiFileBlocks_WithFileHeaders_ParsesCorrectPaths()
    {
        const string raw = """
            ### File: utils/helpers.py
            ```python
            def helper():
                return 42
            ```

            ### File: solution.py
            ```python
            from utils.helpers import helper

            def main():
                return helper()
            ```
            """;

        var files = FencedCodeBlockParser.ParseBlocks(raw);

        Assert.Equal(2, files.Count);
        Assert.Equal("utils/helpers.py", files[0].Path);
        Assert.Equal("helpers.py", files[0].Name);
        Assert.Contains("def helper():", files[0].Content);

        Assert.Equal("solution.py", files[1].Path);
        Assert.Equal("solution.py", files[1].Name);
        Assert.Contains("from utils.helpers import helper", files[1].Content);
    }

    [Fact]
    public void MultiFileBlocks_WithoutFileHeaders_DefaultsToNumberedNames()
    {
        const string raw = """
            ```python
            def part1():
                pass
            ```

            ```python
            def part2():
                pass
            ```
            """;

        var files = FencedCodeBlockParser.ParseBlocks(raw);

        Assert.Equal(2, files.Count);
        Assert.Equal("solution.py", files[0].Path);
        Assert.Equal("file_2.py", files[1].Path);
    }

    [Fact]
    public void NoCodeBlock_ReturnsEmptyList()
    {
        const string raw = "I am sorry, but I cannot write code for that task.";
        var files = FencedCodeBlockParser.ParseBlocks(raw);
        Assert.Empty(files);
    }

    [Fact]
    public void EmptyString_ReturnsEmptyList()
    {
        var files = FencedCodeBlockParser.ParseBlocks("");
        Assert.Empty(files);
    }

    [Fact]
    public void HandlesTildesAndBackticksWithLanguageSpecifier()
    {
        const string raw = """
            ### File: pyproject.toml
            ```toml
            [tool.pytest]
            python_files = ["test_*.py"]
            ```

            ### File: tests/test_main.py
            ~~~python
            def test_example():
                assert True
            ~~~
            """;

        var files = FencedCodeBlockParser.ParseBlocks(raw);

        Assert.Equal(2, files.Count);
        Assert.Equal("pyproject.toml", files[0].Path);
        Assert.Equal("toml", files[0].Language);

        Assert.Equal("tests/test_main.py", files[1].Path);
        Assert.Equal("python", files[1].Language);
        Assert.Equal("test", files[1].Category);
    }
}
