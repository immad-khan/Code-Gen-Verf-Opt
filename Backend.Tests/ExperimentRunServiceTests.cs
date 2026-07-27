using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Backend.Models;
using Backend.Services.Experiments;

namespace Backend.Tests;

/// <summary>Records launches and hands out controllable fake runner processes.</summary>
public sealed class FakeProcessLauncher : IProcessLauncher
{
    public List<ProcessStartInfo> Launches { get; } = new();
    public List<FakeRunnerProcess> Processes { get; } = new();
    public Exception? ThrowOnStart { get; set; }
    public bool IgnoreKill { get; set; }

    public FakeRunnerProcess Last => Processes[^1];

    public IRunnerProcess Start(ProcessStartInfo startInfo, Action<string> onOutput)
    {
        Launches.Add(startInfo);
        if (ThrowOnStart is { } ex)
            throw ex;
        var process = new FakeRunnerProcess(onOutput, IgnoreKill);
        Processes.Add(process);
        return process;
    }
}

public sealed class FakeRunnerProcess(Action<string> onOutput, bool ignoreKill) : IRunnerProcess
{
    private readonly TaskCompletionSource<int> _exit = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public int KillCount { get; private set; }
    public Task<int> Completion => _exit.Task;

    public void Emit(string line) => onOutput(line);
    public void Exit(int code) => _exit.TrySetResult(code);

    public void Kill()
    {
        KillCount++;
        if (!ignoreKill)
            _exit.TrySetResult(-1);
    }

    public void Dispose() { }
}

public class ExperimentRunServiceTests : IDisposable
{
    private readonly ExperimentsTempDirs _dirs = new();
    private readonly FakeProcessLauncher _launcher = new();
    private readonly string _repo;
    private readonly string _cacheBytes = "{\"dataset_sha256\":\"ab\",\"model\":\"m\",\"llm_mode\":\"mock\",\"generation_prompt_style\":\"dou\",\"entries\":{}}";

    public ExperimentRunServiceTests()
    {
        _repo = Directory.CreateDirectory(Path.Combine(_dirs.Base, "repo")).FullName;
        _dirs.WriteFile(Path.Combine(_dirs.Data, "tasks.jsonl"), "{}\n{}\n");
        _dirs.WriteFile(Path.Combine(_dirs.Data, "caches", "c.json"), _cacheBytes);
        _dirs.WriteFile(Path.Combine(_dirs.Base, "outside.jsonl"), "{}\n");
        _dirs.WriteFile(Path.Combine(_dirs.Base, "outside.json"), "{}");
    }

    public void Dispose() => _dirs.Dispose();

    private ExperimentRunService NewService(TimeSpan? cancelTimeout = null) => new(new ExperimentRunOptions
    {
        DataDir = _dirs.Data,
        RunsRoot = _dirs.Runs,
        RepoRoot = _repo,
        PythonExecutable = "python-test",
        CancelTimeout = cancelTimeout ?? TimeSpan.FromSeconds(10),
    }, _launcher);

    /// <summary><c>{"dataset":"tasks.jsonl"}</c> with <paramref name="overrides"/> applied (JSON object text).</summary>
    private static StartRunRequest Request(string overrides = "{}")
    {
        var body = new JsonObject { ["dataset"] = "tasks.jsonl" };
        foreach (var (key, value) in JsonNode.Parse(overrides)!.AsObject())
            body[key] = value?.DeepClone();
        return JsonSerializer.Deserialize<StartRunRequest>(body.ToJsonString())!;
    }

    private static async Task WaitIdleAsync(ExperimentRunService service)
    {
        var sw = Stopwatch.StartNew();
        while (service.ActiveRunId is not null)
        {
            if (sw.Elapsed > TimeSpan.FromSeconds(10))
                throw new TimeoutException("run did not finish");
            await Task.Delay(10);
        }
    }

    private RunStatusSidecar ReadSidecar(string runId) =>
        JsonSerializer.Deserialize<RunStatusSidecar>(File.ReadAllText(Path.Combine(_dirs.Runs, ".maci", runId + ".status.json")))!;

    // ─────────────────────────── Start ───────────────────────────

    [Fact]
    public void Start_LaunchesRunnerWithArgumentListAndMappedFlags()
    {
        using var service = NewService();
        var result = service.Start(Request("""
            {"repairMode":"full","feedbackRegime":"strict","k":3,"temperature":0.7,
             "generationPromptStyle":"tivr","sampleSize":40,"seed":7,
             "generationCache":"caches/c.json","mock":true}
            """));

        Assert.Equal(StartRunOutcome.Started, result.Outcome);
        var runId = result.RunId!;
        Assert.True(RunIds.IsValid(runId));
        Assert.Matches(@"^\d{8}T\d{6}Z-full-strict-[0-9a-f]{6}$", runId);
        Assert.Equal(runId, service.ActiveRunId);

        var psi = Assert.Single(_launcher.Launches);
        Assert.Equal("python-test", psi.FileName);
        Assert.Equal("", psi.Arguments);
        Assert.Equal(
        [
            "-m", "tivr.run_benchmark", Path.Combine(_dirs.Data, "tasks.jsonl"),
            "--mode", "full",
            "--feedback-regime", "strict",
            "--k", "3",
            "--temperature", "0.7",
            "--generation-prompt-style", "tivr",
            "--sample-size", "40",
            "--seed", "7",
            "--generation-cache", Path.Combine(_dirs.Data, "caches", "c.json"),
            "--mock",
            "--run-id", runId,
            "--runs-root", _dirs.Runs,
        ], psi.ArgumentList);
        Assert.Equal(_repo, psi.WorkingDirectory);
        Assert.False(psi.UseShellExecute);
        Assert.True(psi.RedirectStandardOutput && psi.RedirectStandardError);
        Assert.Equal(_repo, psi.Environment["PYTHONPATH"]);
        Assert.Equal("1", psi.Environment["PYTHONUNBUFFERED"]);
    }

    [Fact]
    public void Start_AppliesRunnerDefaults_WhenOnlyDatasetGiven()
    {
        using var service = NewService();
        var result = service.Start(Request("""{"generationCache":null,"mock":null}"""));

        Assert.Equal(StartRunOutcome.Started, result.Outcome);
        var args = Assert.Single(_launcher.Launches).ArgumentList.ToList();
        Assert.Equal(
        [
            "-m", "tivr.run_benchmark", Path.Combine(_dirs.Data, "tasks.jsonl"),
            "--mode", "dou", "--feedback-regime", "dou", "--k", "2", "--temperature", "0.1",
            "--generation-prompt-style", "dou", "--sample-size", "120", "--seed", "0",
            "--run-id", result.RunId!, "--runs-root", _dirs.Runs,
        ], args);
    }

    [Theory]
    [InlineData("intervenor")]
    [InlineData("dou_intervenor")]
    public void Start_OptionalMode_PassesEnableIntervenor(string mode)
    {
        using var service = NewService();
        Assert.Equal(StartRunOutcome.Started, service.Start(Request($$"""{"repairMode":"{{mode}}"}""")).Outcome);
        var args = Assert.Single(_launcher.Launches).ArgumentList.ToList();
        var at = args.IndexOf("--mode");
        Assert.Equal(mode, args[at + 1]);
        Assert.Equal("--enable-intervenor", args[at + 2]);
    }

    [Theory]
    [InlineData("""{"k":1,"temperature":0,"sampleSize":1,"seed":0}""")]
    [InlineData("""{"k":10,"temperature":2,"sampleSize":10000,"seed":2147483647}""")]
    [InlineData("""{"k":2.0,"temperature":2.0,"mock":false}""")]
    [InlineData("""{"dataset":"./sub/../tasks.jsonl"}""")]
    public void Start_AcceptsBoundaryValues(string overrides)
    {
        using var service = NewService();
        var result = service.Start(Request(overrides));
        Assert.Equal(StartRunOutcome.Started, result.Outcome);
        Assert.Empty(result.Errors);
    }

    [Theory]
    [InlineData("""{"dataset":null}""", "dataset")]
    [InlineData("""{"dataset":5}""", "dataset")]
    [InlineData("""{"dataset":"missing.jsonl"}""", "dataset")]
    [InlineData("""{"dataset":"../outside.jsonl"}""", "dataset")]
    [InlineData("""{"dataset":"sub/../../outside.jsonl"}""", "dataset")]
    [InlineData("""{"repairMode":"Dou"}""", "repairMode")]
    [InlineData("""{"repairMode":"bogus"}""", "repairMode")]
    [InlineData("""{"repairMode":3}""", "repairMode")]
    [InlineData("""{"feedbackRegime":"lenient"}""", "feedbackRegime")]
    [InlineData("""{"k":0}""", "k")]
    [InlineData("""{"k":11}""", "k")]
    [InlineData("""{"k":2.5}""", "k")]
    [InlineData("""{"k":"2"}""", "k")]
    [InlineData("""{"temperature":-0.1}""", "temperature")]
    [InlineData("""{"temperature":2.01}""", "temperature")]
    [InlineData("""{"temperature":"0.5"}""", "temperature")]
    [InlineData("""{"generationPromptStyle":"plain"}""", "generationPromptStyle")]
    [InlineData("""{"sampleSize":0}""", "sampleSize")]
    [InlineData("""{"sampleSize":10001}""", "sampleSize")]
    [InlineData("""{"seed":-1}""", "seed")]
    [InlineData("""{"seed":2147483648}""", "seed")]
    [InlineData("""{"seed":1.5}""", "seed")]
    [InlineData("""{"generationCache":"../outside.json"}""", "generationCache")]
    [InlineData("""{"generationCache":"caches/missing.json"}""", "generationCache")]
    [InlineData("""{"generationCache":""}""", "generationCache")]
    [InlineData("""{"mock":"true"}""", "mock")]
    [InlineData("""{"mock":1}""", "mock")]
    public void Start_RejectsInvalidField_WithoutLaunching(string overrides, string field)
    {
        using var service = NewService();
        var result = service.Start(Request(overrides));

        Assert.Equal(StartRunOutcome.Invalid, result.Outcome);
        var error = Assert.Single(result.Errors);
        Assert.Equal(field, error.Field);
        Assert.Contains(field, error.Message);
        Assert.Empty(_launcher.Launches);
        Assert.Null(service.ActiveRunId);
        Assert.False(Directory.Exists(Path.Combine(_dirs.Runs, ".maci")));
    }

    [Fact]
    public void Start_ReportsEveryInvalidField()
    {
        using var service = NewService();
        var result = service.Start(Request("""
            {"dataset":"../outside.jsonl","repairMode":"x","feedbackRegime":"x","k":0,"temperature":3,
             "generationPromptStyle":"x","sampleSize":0,"seed":-1,"generationCache":"../outside.json","mock":"x"}
            """));

        Assert.Equal(StartRunOutcome.Invalid, result.Outcome);
        string[] expected = ["dataset", "repairMode", "feedbackRegime", "k", "temperature",
            "generationPromptStyle", "sampleSize", "seed", "generationCache", "mock"];
        Assert.Equal(expected, result.Errors.Select(e => e.Field));
        var body = result.ToErrorBody();
        Assert.All(expected, f => Assert.Contains(f, body.Error));
        Assert.Equal(expected.Length, body.InvalidFields.Count);
        Assert.Empty(_launcher.Launches);
    }

    [Fact]
    public void Start_WhileActive_Returns409WithActiveId_AndLeavesRunUnaffected()
    {
        using var service = NewService();
        var first = service.Start(Request());
        var second = service.Start(Request("""{"repairMode":"full"}"""));

        Assert.Equal(StartRunOutcome.Conflict, second.Outcome);
        Assert.Equal(first.RunId, second.ActiveRunId);
        Assert.Single(_launcher.Launches);
        Assert.Equal(0, _launcher.Last.KillCount);
        Assert.Equal(first.RunId, service.ActiveRunId);
    }

    // ─────────────────────────── Output and status ───────────────────────────

    [Fact]
    public async Task Output_RingBufferKeepsLast200_AndLogKeepsEveryLine()
    {
        using var service = NewService();
        var runId = service.Start(Request()).RunId!;
        for (var i = 0; i < 250; i++)
            _launcher.Last.Emit($"line {i}");

        var live = service.Status(runId)!;
        Assert.Equal(ExperimentValues.StatusRunning, live.Status);
        Assert.Equal(Enumerable.Range(50, 200).Select(i => $"line {i}"), live.OutputTail);

        _dirs.RunDir(runId);
        _launcher.Last.Exit(0);
        await WaitIdleAsync(service);

        var log = File.ReadAllLines(Path.Combine(_dirs.Runs, ".maci", runId + ".log"));
        Assert.Equal(250, log.Length);
        Assert.Equal(live.OutputTail, service.Status(runId)!.OutputTail);
    }

    [Fact]
    public void Status_ReportsProgressFromRunDirectory_WhileRunning()
    {
        using var service = NewService();
        var runId = service.Start(Request()).RunId!;

        var early = service.Status(runId)!; // runner has not created its directory yet
        Assert.Equal(ExperimentValues.StatusRunning, early.Status);
        Assert.Null(early.Completed);

        _dirs.WriteFile(Path.Combine(_dirs.RunDir(runId), "progress.json"),
            """{"phase":"repair","completed":3,"total":10}""");
        var status = service.Status(runId)!;
        Assert.Equal(ExperimentValues.StatusRunning, status.Status);
        Assert.Equal("repair", status.Phase);
        Assert.Equal(3, status.Completed);
        Assert.Equal(10, status.Total);
        Assert.Equal(ExperimentValues.StatusRunning, service.Catalog.GetStatusValue(runId));
    }

    [Fact]
    public async Task ExitZero_WritesCompletedSidecar_AndCopiesGenerationCache()
    {
        using var service = NewService();
        var runId = service.Start(Request()).RunId!;
        var runDir = _dirs.RunDir(runId);
        _dirs.WriteFile(Path.Combine(runDir, "manifest.json"), """{"completed":true}""");
        _dirs.WriteFile(Path.Combine(runDir, "generation_cache.json"), _cacheBytes);
        _launcher.Last.Exit(0);
        await WaitIdleAsync(service);

        var sidecar = ReadSidecar(runId);
        Assert.Equal(ExperimentValues.StatusCompleted, sidecar.Status);
        Assert.Equal(0, sidecar.ExitCode);
        Assert.Null(sidecar.LaunchError);
        Assert.NotNull(sidecar.EndedAt);

        var copied = Path.Combine(_dirs.Data, "caches", runId + ".generation_cache.json");
        Assert.Equal(_cacheBytes, File.ReadAllText(copied));
        Assert.Contains(service.Catalog.ListCaches(), c => c.Path == $"caches/{runId}.generation_cache.json");

        var status = service.Status(runId)!;
        Assert.Equal(ExperimentValues.StatusCompleted, status.Status);
        Assert.Equal(0, status.ExitCode);
        Assert.Equal(StartRunOutcome.Started, service.Start(Request()).Outcome); // no longer active
    }

    [Fact]
    public async Task NonZeroExit_MarksFailedWithExitCode_AndKeepsOutput()
    {
        using var service = NewService();
        var runId = service.Start(Request()).RunId!;
        var runDir = _dirs.RunDir(runId);
        _dirs.WriteFile(Path.Combine(runDir, "generation_cache.json"), _cacheBytes);
        _launcher.Last.Emit("Traceback (most recent call last):");
        _launcher.Last.Emit("LLMRequestError: boom");
        _launcher.Last.Exit(3);
        await WaitIdleAsync(service);

        var status = service.Status(runId)!;
        Assert.Equal(ExperimentValues.StatusFailed, status.Status);
        Assert.Equal(3, status.ExitCode);
        Assert.Null(status.LaunchError);
        Assert.Equal(["Traceback (most recent call last):", "LLMRequestError: boom"], status.OutputTail);
        Assert.False(File.Exists(Path.Combine(_dirs.Data, "caches", runId + ".generation_cache.json")));
    }

    [Fact]
    public async Task RunnerExitingBeforeCreatingItsDirectory_IsReportedFromSidecars()
    {
        using var service = NewService();
        var runId = service.Start(Request()).RunId!;
        _launcher.Last.Emit("error: --k: must be an integer >= 1");
        _launcher.Last.Exit(2);
        await WaitIdleAsync(service);

        Assert.False(service.Catalog.RunExists(runId));
        Assert.True(service.RunKnown(runId));
        var status = service.Status(runId)!;
        Assert.Equal(ExperimentValues.StatusFailed, status.Status);
        Assert.Equal(2, status.ExitCode);
        Assert.Equal(["error: --k: must be an integer >= 1"], status.OutputTail);
    }

    [Fact]
    public void LaunchFailure_MarksRunFailedWithLaunchError()
    {
        using var service = NewService();
        _launcher.ThrowOnStart = new InvalidOperationException("python-test was not found");
        var result = service.Start(Request());

        Assert.Equal(StartRunOutcome.LaunchFailed, result.Outcome);
        Assert.Equal("python-test was not found", result.LaunchError);
        Assert.Null(service.ActiveRunId);
        var sidecar = ReadSidecar(result.RunId!);
        Assert.Equal(ExperimentValues.StatusFailed, sidecar.Status);
        Assert.Null(sidecar.ExitCode);
        Assert.Equal("python-test was not found", sidecar.LaunchError);
        var status = service.Status(result.RunId)!;
        Assert.Equal(ExperimentValues.StatusFailed, status.Status);
        Assert.Equal("python-test was not found", status.LaunchError);

        _launcher.ThrowOnStart = null;
        var next = service.Start(Request());
        Assert.Equal(StartRunOutcome.Started, next.Outcome);
        Assert.NotEqual(result.RunId, next.RunId);
    }

    [Fact]
    public void Status_UnknownOrInvalidRunId_ReturnsNull()
    {
        using var service = NewService();
        Assert.Null(service.Status("20260101T000000Z-dou-dou-000000"));
        Assert.Null(service.Status("../runs"));
        Assert.Null(service.Status(null));
    }

    // ─────────────────────────── Cancel ───────────────────────────

    [Fact]
    public async Task Cancel_KillsProcessTree_MarksCancelled_AndKeepsRunDirectory()
    {
        using var service = NewService();
        var runId = service.Start(Request()).RunId!;
        var trajectories = _dirs.WriteFile(Path.Combine(_dirs.RunDir(runId), "trajectories.jsonl"), "{\"a\":1}\n");
        _launcher.Last.Emit("working");

        var result = await service.CancelAsync(runId);

        Assert.Equal(CancelRunOutcome.Cancelled, result.Outcome);
        Assert.Equal(ExperimentValues.StatusCancelled, result.Status);
        Assert.Equal(1, _launcher.Last.KillCount);
        Assert.Null(service.ActiveRunId);
        Assert.True(File.Exists(trajectories));
        Assert.Equal(ExperimentValues.StatusCancelled, ReadSidecar(runId).Status);
        var status = service.Status(runId)!;
        Assert.Equal(ExperimentValues.StatusCancelled, status.Status);
        Assert.Equal(["working"], status.OutputTail);
    }

    [Fact]
    public async Task Cancel_WhenProcessDoesNotExit_FinishesAfterTimeout()
    {
        _launcher.IgnoreKill = true;
        using var service = NewService(TimeSpan.FromMilliseconds(200));
        var runId = service.Start(Request()).RunId!;

        var sw = Stopwatch.StartNew();
        var result = await service.CancelAsync(runId);

        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5));
        Assert.Equal(CancelRunOutcome.Cancelled, result.Outcome);
        Assert.Null(service.ActiveRunId);
        Assert.Equal(ExperimentValues.StatusCancelled, ReadSidecar(runId).Status);
    }

    [Fact]
    public async Task Cancel_UnknownRun_IsNotFound_AndEndedRun_IsNotActive()
    {
        using var service = NewService();
        Assert.Equal(CancelRunOutcome.NotFound, (await service.CancelAsync("nope")).Outcome);

        var runId = service.Start(Request()).RunId!;
        _dirs.RunDir(runId);
        _launcher.Last.Exit(1);
        await WaitIdleAsync(service);

        var result = await service.CancelAsync(runId);
        Assert.Equal(CancelRunOutcome.NotActive, result.Outcome);
        Assert.Equal(ExperimentValues.StatusFailed, result.Status);
        Assert.Equal(ExperimentValues.StatusFailed, ReadSidecar(runId).Status);
    }
}

/// <summary><see cref="SystemProcessLauncher"/> against real OS processes.</summary>
public class SystemProcessLauncherTests
{
    private static ProcessStartInfo Shell(string script)
    {
        var psi = OperatingSystem.IsWindows()
            ? new ProcessStartInfo("cmd.exe") { ArgumentList = { "/d", "/c", script } }
            : new ProcessStartInfo("/bin/sh") { ArgumentList = { "-c", script } };
        return psi;
    }

    [Fact]
    public async Task Start_CapturesStdoutAndStderr_AndReportsExitCode()
    {
        var lines = new List<string>();
        using var process = new SystemProcessLauncher().Start(Shell("echo out&& echo err 1>&2&& exit 3"), l =>
        {
            lock (lines) lines.Add(l.Trim());
        });
        var exit = await process.Completion.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.Equal(3, exit);
        Assert.Contains("out", lines);
        Assert.Contains("err", lines);
    }

    [Fact]
    public async Task Kill_TerminatesProcessTree()
    {
        // The shell starts a long-running child; killing the tree must end both.
        var script = OperatingSystem.IsWindows() ? "ping -n 60 127.0.0.1 >NUL" : "sleep 60; echo done";
        using var process = new SystemProcessLauncher().Start(Shell(script), _ => { });
        await Task.Delay(300);
        var sw = Stopwatch.StartNew();
        process.Kill();
        await process.Completion.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(10));
    }

    [Fact]
    public void Start_MissingExecutable_Throws()
    {
        var psi = new ProcessStartInfo("maci-no-such-executable-" + Guid.NewGuid().ToString("N"));
        Assert.ThrowsAny<Exception>(() => new SystemProcessLauncher().Start(psi, _ => { }));
    }
}
