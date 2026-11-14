using Backend.Services;
using Xunit;

namespace Backend.Tests;

public class InterfaceDefinitionParserTests
{
    [Fact]
    public void PlainThreeLines_ParsesCorrectly()
    {
        const string raw = """
            NAME: add_two_numbers
            SIGNATURE: def add_two_numbers(a: int, b: int) -> int:
            DOC: Returns the sum of two integers.
            """;

        var iface = InterfaceDefinitionParser.Parse(raw);

        Assert.Equal("add_two_numbers", iface.Name);
        Assert.Equal("def add_two_numbers(a: int, b: int) -> int:", iface.Signature);
        Assert.Equal("Returns the sum of two integers.", iface.Docstring);
    }

    [Fact]
    public void MarkdownFormatting_IsCleanedUp()
    {
        const string raw = """
            **NAME:** `multiply_numbers`
            **SIGNATURE:** `def multiply_numbers(x: float, y: float) -> float:`
            **DOC:** `Multiplies two floating point numbers.`
            """;

        var iface = InterfaceDefinitionParser.Parse(raw);

        Assert.Equal("multiply_numbers", iface.Name);
        Assert.Equal("def multiply_numbers(x: float, y: float) -> float:", iface.Signature);
        Assert.Equal("Multiplies two floating point numbers.", iface.Docstring);
    }

    [Fact]
    public void MissingName_InferredFromSignature()
    {
        const string raw = """
            SIGNATURE: def calculate_area(radius: float) -> float:
            DOC: Calculates area of circle.
            """;

        var iface = InterfaceDefinitionParser.Parse(raw);

        Assert.Equal("calculate_area", iface.Name);
        Assert.Equal("def calculate_area(radius: float) -> float:", iface.Signature);
    }

    [Fact]
    public void MissingSignature_InferredFromName()
    {
        const string raw = """
            NAME: get_user_by_id
            DOC: Fetch user details.
            """;

        var iface = InterfaceDefinitionParser.Parse(raw);

        Assert.Equal("get_user_by_id", iface.Name);
        Assert.Equal("def get_user_by_id():", iface.Signature);
    }

    [Fact]
    public void EmptyOrWhitespace_ProvidesFallback()
    {
        var iface = InterfaceDefinitionParser.Parse("   ");

        Assert.Equal("solution", iface.Name);
        Assert.Equal("def solution():", iface.Signature);
        Assert.False(string.IsNullOrWhiteSpace(iface.Docstring));
    }
}
