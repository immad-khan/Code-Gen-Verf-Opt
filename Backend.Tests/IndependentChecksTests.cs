using System.Collections.Generic;
using System.Threading.Tasks;
using Backend.Models;
using Backend.Services.Verification;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Backend.Tests;

public class IndependentChecksTests
{
    private readonly IndependentChecksService _service;

    public IndependentChecksTests()
    {
        var inMemory = new Dictionary<string, string?>
        {
            ["Python:ExecutablePath"] = @"E:\anaconda\python.exe"
        };
        var config = new ConfigurationBuilder().AddInMemoryCollection(inMemory).Build();
        var health = new PythonToolHealthService(config, NullLogger<PythonToolHealthService>.Instance);
        _service = new IndependentChecksService(health, NullLogger<IndependentChecksService>.Instance);
    }

    [Fact]
    public async Task PromptExamples_RunsDoctestAndEqualityExamples_LabeledFromPrompt()
    {
        var files = new List<GeneratedCodeFile>
        {
            new()
            {
                Name = "solution.py",
                Content = "def multiply(a: int, b: int) -> int:\n    return a * b\n"
            }
        };

        var prompt = """
            Write a function multiply(a: int, b: int) -> int.
            >>> multiply(3, 4)
            12
            >>> multiply(0, 5)
            0
            multiply(2, -3) == -6
            """;

        var iface = new InterfaceDefinition
        {
            Name = "multiply",
            Signature = "def multiply(a: int, b: int) -> int:"
        };

        var result = await _service.ExecuteAsync(files, prompt, iface, secondaryApiSettings: null);

        Assert.True(result.PromptExamples.Executed, string.Join("; ", result.AllWarnings));
        Assert.Equal(3, result.PromptExamples.TotalExamples);
        Assert.Equal(3, result.PromptExamples.PassedExamples);
        Assert.Equal(0, result.PromptExamples.FailedExamples);
        Assert.Empty(result.PromptExamples.Warnings);
    }

    [Fact]
    public async Task PromptExamples_FlagsMismatchAsWarning_DoesNotThrow()
    {
        var files = new List<GeneratedCodeFile>
        {
            new()
            {
                Name = "solution.py",
                // Buggy solution adds instead of multiplies
                Content = "def multiply(a: int, b: int) -> int:\n    return a + b\n"
            }
        };

        var prompt = """
            Write multiply(a: int, b: int).
            >>> multiply(3, 4)
            12
            """;

        var iface = new InterfaceDefinition
        {
            Name = "multiply",
            Signature = "def multiply(a: int, b: int) -> int:"
        };

        var result = await _service.ExecuteAsync(files, prompt, iface, secondaryApiSettings: null);

        Assert.True(result.PromptExamples.Executed, string.Join("; ", result.AllWarnings));
        Assert.Equal(1, result.PromptExamples.TotalExamples);
        Assert.Equal(0, result.PromptExamples.PassedExamples);
        Assert.Equal(1, result.PromptExamples.FailedExamples);
        Assert.NotEmpty(result.PromptExamples.Warnings);
        Assert.Contains("[from prompt]", result.PromptExamples.Warnings[0]);
    }

    [Fact]
    public async Task FuzzCheck_TriesInputs_ReportsCountAndAnomalies()
    {
        var files = new List<GeneratedCodeFile>
        {
            new()
            {
                Name = "solution.py",
                // Crashes on ZeroDivisionError when b == 0
                Content = "def divide(a: int, b: int) -> float:\n    return a / b\n"
            }
        };

        var prompt = "Write a function divide(a: int, b: int) -> float that divides a by b.";
        var iface = new InterfaceDefinition
        {
            Name = "divide",
            Signature = "def divide(a: int, b: int) -> float:"
        };

        var result = await _service.ExecuteAsync(files, prompt, iface, secondaryApiSettings: null);

        Assert.True(result.FuzzCheck.Executed);
        Assert.True(result.FuzzCheck.InputsTried > 0);
        Assert.True(result.FuzzCheck.HasUnexpectedException);
        Assert.NotEmpty(result.FuzzCheck.Warnings);
        Assert.Contains("ZeroDivisionError", result.FuzzCheck.Warnings[0]);
    }

    [Fact]
    public async Task FuzzCheck_FlagsWrongReturnTypeAsWarning()
    {
        var files = new List<GeneratedCodeFile>
        {
            new()
            {
                Name = "solution.py",
                // Signature says int, but returns string
                Content = "def get_len(s: str) -> int:\n    return str(len(s))\n"
            }
        };

        var prompt = "Write get_len(s: str) -> int.";
        var iface = new InterfaceDefinition
        {
            Name = "get_len",
            Signature = "def get_len(s: str) -> int:"
        };

        var result = await _service.ExecuteAsync(files, prompt, iface, secondaryApiSettings: null);

        Assert.True(result.FuzzCheck.Executed);
        Assert.True(result.FuzzCheck.InputsTried > 0);
        Assert.True(result.FuzzCheck.HasWrongReturnType);
        Assert.Contains(result.FuzzCheck.Warnings, w => w.Contains("expected return type 'int'"));
    }
}
