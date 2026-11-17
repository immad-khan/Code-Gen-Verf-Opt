using Backend.Controllers;
using Backend.Models;
using Backend.Services;
using Backend.Services.Repair;
using Backend.Services.Taxonomy;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Backend.Tests;

public class RepairPhaseDTests
{
    private readonly ITaxonomyProvider _taxonomy;
    private readonly RepairPromptBuilder _promptBuilder;

    public RepairPhaseDTests()
    {
        _taxonomy = TaxonomyProvider.Default;
        _promptBuilder = new RepairPromptBuilder(_taxonomy);
    }

    [Fact]
    public void ImprovedRepairSources_DefaultValues_EnforceBenchmarkSafety()
    {
        // Requirement 4: [visible-test-detail] OFF by default
        var sources = new ImprovedRepairSources();

        Assert.False(sources.VisibleTestDetail, "VisibleTestDetail must be OFF by default to prevent test fitting.");
        Assert.True(sources.PromptOnly);
        Assert.True(sources.StaticAnalysis);
        Assert.True(sources.History);

        var tags = sources.GetEnabledTags();
        Assert.Contains("[prompt-only]", tags);
        Assert.Contains("[static-analysis]", tags);
        Assert.Contains("[history]", tags);
        Assert.DoesNotContain("[visible-test-detail]", tags);
    }

    [Fact]
    public void ImprovedRepairSources_EnablingVisibleTestDetail_AddsTag()
    {
        var sources = new ImprovedRepairSources { VisibleTestDetail = true };
        var tags = sources.GetEnabledTags();

        Assert.Contains("[visible-test-detail]", tags);
        Assert.Contains("[prompt-only]", tags);
        Assert.Contains("[static-analysis]", tags);
        Assert.Contains("[history]", tags);
    }

    [Fact]
    public void BuildImproved_WithholdsTestTrace_WhenVisibleTestDetailIsFalse()
    {
        var files = new List<GeneratedCodeFile>
        {
            new() { Name = "solution.py", Path = "solution.py", Content = "def add(a, b):\n    return a - b\n" }
        };

        var verif = new VerificationResult
        {
            GatePassed = false,
            Complete = true,
            CorrectnessFindings = new List<MappedFinding>
            {
                new()
                {
                    Technique = "tests",
                    Signal = "tests:assert",
                    Message = "assert add(1, 2) == 3",
                    Evidence = "FAILED test_solution.py::test_add - assert -1 == 3",
                    Category = "C.1"
                }
            }
        };

        var prompt = _promptBuilder.BuildImproved(
            originalPrompt: "Write a function add(a, b)",
            files: files,
            current: verif,
            iteration: 1,
            budget: 2,
            sources: new ImprovedRepairSources { VisibleTestDetail = false }
        );

        Assert.Contains("## [prompt-only] Problem Specification", prompt);
        Assert.Contains("## [visible-test-detail] Test Verification Summary", prompt);
        Assert.Contains("withheld to prevent test fitting", prompt);
        Assert.DoesNotContain("assert -1 == 3", prompt);
    }

    [Fact]
    public void BuildImproved_IncludesTestTrace_WhenVisibleTestDetailIsTrue()
    {
        var files = new List<GeneratedCodeFile>
        {
            new() { Name = "solution.py", Path = "solution.py", Content = "def add(a, b):\n    return a - b\n" }
        };

        var verif = new VerificationResult
        {
            GatePassed = false,
            Complete = true,
            CorrectnessFindings = new List<MappedFinding>
            {
                new()
                {
                    Technique = "tests",
                    Signal = "tests:assert",
                    Message = "assert add(1, 2) == 3",
                    Evidence = "FAILED test_solution.py::test_add - assert -1 == 3",
                    Category = "C.1",
                    Location = new FindingLocation { File = "test_solution.py", Line = 5 }
                }
            }
        };

        var prompt = _promptBuilder.BuildImproved(
            originalPrompt: "Write a function add(a, b)",
            files: files,
            current: verif,
            iteration: 1,
            budget: 2,
            sources: new ImprovedRepairSources { VisibleTestDetail = true }
        );

        Assert.Contains("## [visible-test-detail] Test Failure Execution Details", prompt);
        Assert.Contains("assert -1 == 3", prompt);
    }

    [Fact]
    public void BuildImproved_IncludesStaticAnalysis_MypyRadonSemgrep()
    {
        var files = new List<GeneratedCodeFile>
        {
            new() { Name = "solution.py", Path = "solution.py", Content = "def f(x: int) -> int:\n    eval(x)\n    return 'not_int'\n" }
        };

        var verif = new VerificationResult
        {
            GatePassed = false,
            Complete = true,
            AdvisoryFindings = new List<AdvisoryFinding>
            {
                new()
                {
                    Technique = "types",
                    Message = "Incompatible return value type (got 'str', expected 'int')",
                    File = "solution.py",
                    Line = 3
                },
                new()
                {
                    Technique = "security",
                    Message = "Use of dangerous function eval() detected",
                    File = "solution.py",
                    Line = 2
                }
            }
        };

        var prompt = _promptBuilder.BuildImproved(
            originalPrompt: "Write f(x)",
            files: files,
            current: verif,
            iteration: 1,
            budget: 2,
            sources: new ImprovedRepairSources { StaticAnalysis = true }
        );

        Assert.Contains("## [static-analysis] Static Type, Quality & Security Diagnostics", prompt);
        Assert.Contains("Incompatible return value type", prompt);
        Assert.Contains("dangerous function eval()", prompt);
    }

    [Fact]
    public void BuildImproved_IncludesHistory_InIteration2_OmittedInIteration1()
    {
        var files = new List<GeneratedCodeFile>
        {
            new() { Name = "solution.py", Path = "solution.py", Content = "def f(): pass\n" }
        };
        var verif = new VerificationResult { GatePassed = false, Complete = true };
        var lessons = new List<string> { "Round 1: Boundary condition check failed on empty input." };

        // Iteration 1: History should be omitted
        var prompt1 = _promptBuilder.BuildImproved(
            originalPrompt: "Task spec",
            files: files,
            current: verif,
            iteration: 1,
            budget: 2,
            lessons: lessons,
            sources: new ImprovedRepairSources { History = true }
        );
        Assert.DoesNotContain("## [history]", prompt1);

        // Iteration 2: History should be included
        var prompt2 = _promptBuilder.BuildImproved(
            originalPrompt: "Task spec",
            files: files,
            current: verif,
            iteration: 2,
            budget: 2,
            lessons: lessons,
            sources: new ImprovedRepairSources { History = true }
        );
        Assert.Contains("## [history] Previous Repair Round Critique & Unresolved Issues", prompt2);
        Assert.Contains("Boundary condition check failed", prompt2);
    }

    [Fact]
    public async Task OptimizationController_Compare_RejectsMissingFiles_AndMismatchedHash()
    {
        var store = new LockedTestStore();
        var testCode = "def test_ok(): assert True";
        var hash = TestHashUtility.ComputeHash(testCode);
        store.Store(hash, testCode, 1);

        var config = new ConfigurationBuilder().Build();
        var optService = new OptimizationService(
            null!, null!, _taxonomy, config, NullLogger<OptimizationService>.Instance);
        var controller = new OptimizationController(optService, store);

        // 1. Missing files
        var emptyReq = new CompareRepairRequest { Files = new List<GeneratedCodeFile>() };
        var res1 = await controller.Compare(emptyReq);
        Assert.IsType<BadRequestObjectResult>(res1);

        // 2. Unknown test hash
        var badHashReq = new CompareRepairRequest
        {
            Files = new List<GeneratedCodeFile> { new() { Name = "solution.py", Content = "pass" } },
            LockedTestHash = "non_existent_hash"
        };
        var res2 = await controller.Compare(badHashReq);
        Assert.IsType<BadRequestObjectResult>(res2);
    }
}
