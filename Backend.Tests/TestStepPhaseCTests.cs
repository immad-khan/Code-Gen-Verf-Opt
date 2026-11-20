using System.Net;
using System.Text;
using System.Text.Json;
using Backend.Controllers;
using Backend.Models;
using Backend.Services;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Backend.Tests;

public class TestStepPhaseCTests
{
    [Fact]
    public void TestHashUtility_NormalizesCrlfAndComputesDeterministicSha256()
    {
        const string codeLf = "def test_example():\n    assert 1 == 1\n";
        const string codeCrlf = "def test_example():\r\n    assert 1 == 1\r\n\r\n";

        var hash1 = TestHashUtility.ComputeHash(codeLf);
        var hash2 = TestHashUtility.ComputeHash(codeCrlf);

        Assert.Equal(hash1, hash2);
        Assert.Equal(64, hash1.Length);
    }

    [Fact]
    public void LockedTestStore_StoresAndRetrieves_AndRejectsHashMismatch()
    {
        var store = new LockedTestStore();
        const string testCode = "def test_one(): assert True";
        var hash = TestHashUtility.ComputeHash(testCode);

        store.Store(hash, testCode, 1);

        var found = store.TryGet(hash, out var item);
        Assert.True(found);
        Assert.Equal(testCode, item.TestCode);
        Assert.Equal(1, item.TestCount);

        // Attempting to store with a tampered hash throws ArgumentException
        Assert.Throws<ArgumentException>(() => store.Store("wronghash00000000000000000000000000000000000000000000000000000000", testCode, 1));
    }

    [Fact]
    public async Task TestGenerationService_GenerateTests_CallsLlmAndParsesPytestBlock()
    {
        const string mockResponse = """
            Here are tests:
            ```python
            import pytest
            from solution import add_nums

            def test_positive():
                assert add_nums(2, 3) == 5

            def test_zero():
                assert add_nums(0, 0) == 0
            ```
            """;

        var llm = new MockLlmClient(mockResponse);
        var sandbox = new MockSandbox();
        var store = new LockedTestStore();
        var service = new TestGenerationService(llm, sandbox, store);

        var iface = new InterfaceDefinition
        {
            Name = "add_nums",
            Signature = "def add_nums(a: int, b: int) -> int:",
            Docstring = "Adds two numbers."
        };

        var testCode = await service.GenerateTestsAsync("Add numbers", iface, new ApiSettings { Provider = "openrouter" });

        Assert.Contains("def test_positive():", testCode);
        Assert.Contains("from solution import add_nums", testCode);
        Assert.Contains(TestGenerationService.TestGenerationSystemPrompt, llm.LastSystemPrompt);
        Assert.Contains("Pytest only, no randomness, no network, no file access", llm.LastSystemPrompt);
    }

    [Fact]
    public async Task TestGenerationService_ValidateTests_WarnsIfTestPassesOnStub()
    {
        var llm = new MockLlmClient("");
        // Mock sandbox that reports 1 test PASSED on stub
        var sandbox = new MockSandbox
        {
            AstResult = new SandboxRunResult(true, 0, "AST_OK", "", false, TimeSpan.FromMilliseconds(50)),
            CollectResult = new SandboxRunResult(true, 0, "collected 2 items\ntest_solution.py::test_vacuous\ntest_solution.py::test_real", "", false, TimeSpan.FromMilliseconds(50)),
            RunResult = new SandboxRunResult(false, 1, "test_solution.py::test_vacuous PASSED\ntest_solution.py::test_real FAILED", "", false, TimeSpan.FromMilliseconds(100))
        };
        var store = new LockedTestStore();
        var service = new TestGenerationService(llm, sandbox, store);

        var iface = new InterfaceDefinition
        {
            Name = "calc",
            Signature = "def calc():"
        };

        const string testCode = """
            from solution import calc

            def test_vacuous():
                assert 1 == 1

            def test_real():
                assert calc() == 42
            """;

        var res = await service.ValidateTestsAsync(testCode, iface);

        Assert.True(res.Valid);
        Assert.Equal(2, res.TestCount);
        var warning = Assert.Single(res.Warnings);
        Assert.Contains("test_vacuous", warning);
        Assert.Contains("passed on stub", warning);
    }

    [Fact]
    public void AiController_LockTests_ReturnsCanonicalHash()
    {
        var llm = new MockLlmClient("");
        var sandbox = new MockSandbox();
        var store = new LockedTestStore();
        var service = new TestGenerationService(llm, sandbox, store);
        var aiController = new AiController(new AiService(new HttpClient(), Microsoft.Extensions.Options.Options.Create(new LlmClientOptions())), service);

        const string code = "def test_x(): assert True";
        var actionRes = aiController.LockTests(new LockTestsRequest { TestCode = code, TestCount = 1 });

        var ok = Assert.IsType<OkObjectResult>(actionRes);
        var lockRes = Assert.IsType<LockTestsResponse>(ok.Value);
        Assert.Equal(TestHashUtility.ComputeHash(code), lockRes.Hash);
        Assert.Equal(1, lockRes.TestCount);

        // Verify stored in store
        Assert.True(store.TryGet(lockRes.Hash, out _));
    }

    private class DummyPipeline : Backend.Services.Verification.Pipeline.IVerificationPipeline
    {
        public Task<VerificationResponse> ExecuteAsync(List<GeneratedCodeFile> files) =>
            Task.FromResult(new VerificationResponse { OverallVerdict = "PASSED" });
    }

    [Fact]
    public async Task VerificationController_RejectsUnknownOrMismatchedLockedTestHash()
    {
        var store = new LockedTestStore();
        var verifier = new VerificationService(new DummyPipeline());
        var controller = new VerificationController(verifier, store);

        var req = new VerifyRequest
        {
            Files = [new GeneratedCodeFile { Name = "solution.py", Content = "x = 1" }],
            LockedTestHash = "nonexistent_hash_12345"
        };

        var actionRes = await controller.Verify(req);
        var badReq = Assert.IsType<BadRequestObjectResult>(actionRes);
        Assert.Contains("not found", badReq.Value?.ToString() ?? "");
    }

    [Fact]
    public void BenchmarkController_ListAndGetProblem_HumanEvalAndApps()
    {
        var store = new LockedTestStore();
        var datasetService = new BenchmarkDatasetService(store, "data");
        var controller = new BenchmarkController(datasetService);

        // 1. List problems
        var listRes = Assert.IsType<OkObjectResult>(controller.ListProblems());
        var problems = Assert.IsAssignableFrom<IReadOnlyList<BenchmarkProblemSummary>>(listRes.Value);
        Assert.NotEmpty(problems);

        // 2. Load HumanEval/0
        var heRes = Assert.IsType<OkObjectResult>(controller.GetProblem("humaneval_plus", "HumanEval/0"));
        var heDetail = Assert.IsType<BenchmarkProblemDetail>(heRes.Value);
        Assert.Equal("HumanEval/0", heDetail.ProblemId);
        Assert.False(string.IsNullOrWhiteSpace(heDetail.LockedTestHash));
        Assert.True(heDetail.TestCount > 0);
        Assert.Contains("has_close_elements", heDetail.PreviewTests);
        // Verify locked in store
        Assert.True(store.TryGet(heDetail.LockedTestHash, out _));

        // 3. Load APPS+ problem (stdin/stdout)
        var appsRes = Assert.IsType<OkObjectResult>(controller.GetProblem("apps_plus", "apps_plus_0581"));
        var appsDetail = Assert.IsType<BenchmarkProblemDetail>(appsRes.Value);
        Assert.Equal("apps_plus_0581", appsDetail.ProblemId);
        Assert.True(appsDetail.Interface.IsStdinStdout);
        Assert.Equal("read stdin, print stdout", appsDetail.Interface.Signature);
        Assert.False(string.IsNullOrWhiteSpace(appsDetail.LockedTestHash));

        var function = Assert.IsType<OkObjectResult>(controller.GetProblem("apps_plus", "apps_plus_5341"));
        var detail = Assert.IsType<BenchmarkProblemDetail>(function.Value);
        Assert.False(detail.Interface.IsStdinStdout);
        Assert.Equal("series_slices", detail.Interface.Name);
        Assert.Contains("series_slices(*args) == expected", detail.PreviewTests);
    }

    // --- Mock Helpers ---

    private sealed class MockLlmClient : ILlmClient
    {
        private readonly string _response;
        public string LastPrompt { get; private set; } = "";
        public string LastSystemPrompt { get; private set; } = "";

        public MockLlmClient(string response) => _response = response;

        public Task<string> CompleteTextAsync(string prompt, string systemPrompt, ApiSettings settings, double temperature, CancellationToken ct = default)
        {
            LastPrompt = prompt;
            LastSystemPrompt = systemPrompt;
            return Task.FromResult(_response);
        }
    }

    private sealed class MockSandbox : IDockerSandbox
    {
        public SandboxRunResult AstResult { get; set; } = new(true, 0, "AST_OK", "", false, TimeSpan.FromMilliseconds(10));
        public SandboxRunResult CollectResult { get; set; } = new(true, 0, "collected 1 item\ntest_solution.py::test_1", "", false, TimeSpan.FromMilliseconds(10));
        public SandboxRunResult RunResult { get; set; } = new(false, 1, "test_solution.py::test_1 FAILED", "", false, TimeSpan.FromMilliseconds(10));

        public Task<bool> IsDockerAvailableAsync(CancellationToken ct = default) => Task.FromResult(true);

        public Task<SandboxRunResult> RunCommandAsync(string workingDir, string command, int timeoutSeconds = 30, CancellationToken ct = default)
        {
            if (command.Contains("ast.parse")) return Task.FromResult(AstResult);
            if (command.Contains("--collect-only")) return Task.FromResult(CollectResult);
            return Task.FromResult(RunResult);
        }
    }
}
