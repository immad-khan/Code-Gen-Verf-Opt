using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Backend.Models;
using Backend.Services.Experiments;

namespace Backend.Tests;

/// <summary>Temp data directory and runs root, deleted on dispose.</summary>
public sealed class ExperimentsTempDirs : IDisposable
{
    public ExperimentsTempDirs()
    {
        Base = Path.Combine(Path.GetTempPath(), "maci-exp-" + Guid.NewGuid().ToString("N"));
        Data = Directory.CreateDirectory(Path.Combine(Base, "data")).FullName;
        Runs = Directory.CreateDirectory(Path.Combine(Base, "runs")).FullName;
    }

    public string Base { get; }
    public string Data { get; }
    public string Runs { get; }

    public string WriteFile(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content, new UTF8Encoding(false));
        return path;
    }

    public string RunDir(string runId) => Directory.CreateDirectory(Path.Combine(Runs, runId)).FullName;

    public void Dispose()
    {
        try { Directory.Delete(Base, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

public sealed class FixedActiveRun(string? id) : IActiveRunProvider
{
    public string? ActiveRunId { get; } = id;
}

public class PathGuardTests : IDisposable
{
    private readonly ExperimentsTempDirs _dirs = new();

    public PathGuardTests()
    {
        _dirs.WriteFile(Path.Combine(_dirs.Data, "tasks.jsonl"), "{}\n");
        _dirs.WriteFile(Path.Combine(_dirs.Data, "sub", "y.jsonl"), "{}\n");
        // Sibling sharing the root's name as a prefix: <base>/data2/x.jsonl.
        _dirs.WriteFile(Path.Combine(_dirs.Base, "data2", "x.jsonl"), "{}\n");
        _dirs.WriteFile(Path.Combine(_dirs.Base, "outside.jsonl"), "{}\n");
    }

    public void Dispose() => _dirs.Dispose();

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(".")]
    [InlineData("sub/..")]
    [InlineData("../outside.jsonl")]
    [InlineData("..\\outside.jsonl")]
    [InlineData("sub/../../outside.jsonl")]
    [InlineData("../data2/x.jsonl")]
    [InlineData("/etc/passwd")]
    [InlineData("\\tasks.jsonl")]
    [InlineData("C:\\Windows\\win.ini")]
    [InlineData("C:tasks.jsonl")]
    [InlineData("\\\\server\\share\\tasks.jsonl")]
    [InlineData("//server/share/tasks.jsonl")]
    [InlineData("\\\\?\\C:\\tasks.jsonl")]
    [InlineData("tasks.jsonl:secret")]
    [InlineData("tasks.jsonl.")]
    [InlineData("tasks.jsonl ")]
    [InlineData("tasks\0.jsonl")]
    [InlineData("tas*.jsonl")]
    public void Rejects_PathsOutsideRootOrMalformed(string? relative)
    {
        Assert.False(PathGuard.TryResolveExistingFile(_dirs.Data, relative, out var full, out var error));
        Assert.Equal("", full);
        Assert.False(string.IsNullOrEmpty(error));
    }

    [Fact]
    public void Rejects_AbsolutePathEvenWhenInsideRoot()
    {
        var absolute = Path.Combine(_dirs.Data, "tasks.jsonl");
        Assert.False(PathGuard.TryResolveExistingFile(_dirs.Data, absolute, out _, out var error));
        Assert.Contains("relative", error);
    }

    [Theory]
    [InlineData("tasks.jsonl", "tasks.jsonl")]
    [InlineData("./tasks.jsonl", "tasks.jsonl")]
    [InlineData("sub/../tasks.jsonl", "tasks.jsonl")]
    [InlineData("sub/y.jsonl", "sub/y.jsonl")]
    [InlineData("sub\\y.jsonl", "sub/y.jsonl")]
    public void Accepts_ExistingFilesInsideRoot(string relative, string expected)
    {
        if (!OperatingSystem.IsWindows() && relative.Contains('\\'))
            return; // '\' is an ordinary file-name character on Unix
        Assert.True(PathGuard.TryResolveExistingFile(_dirs.Data, relative, out var full, out var error), error);
        Assert.Equal(Path.GetFullPath(Path.Combine(_dirs.Data, expected)), full);
    }

    [Fact]
    public void Rejects_MissingFileInsideRoot()
    {
        Assert.False(PathGuard.TryResolveExistingFile(_dirs.Data, "missing.jsonl", out _, out var error));
        Assert.Equal("does not exist", error);
        // A directory is not a file.
        Assert.False(PathGuard.TryResolveExistingFile(_dirs.Data, "sub", out _, out _));
    }

    [Fact]
    public void Rejects_SymlinkEscapingRoot_WhenLinksCanBeCreated()
    {
        var outsideDir = Directory.CreateDirectory(Path.Combine(_dirs.Base, "elsewhere")).FullName;
        _dirs.WriteFile(Path.Combine(outsideDir, "z.jsonl"), "{}\n");
        try
        {
            Directory.CreateSymbolicLink(Path.Combine(_dirs.Data, "link"), outsideDir);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return; // symlink creation needs extra privileges on this machine
        }
        Assert.False(PathGuard.TryResolveExistingFile(_dirs.Data, "link/z.jsonl", out _, out var error));
        Assert.Contains("link", error);
    }
}

public class RunIdsTests
{
    [Theory]
    [InlineData("20260101T120000Z-dou-dou-a1b2c3")]
    [InlineData("pilot_full")]
    [InlineData("a")]
    [InlineData("a.b-c_d")]
    public void Accepts_ValidRunIds(string id) => Assert.True(RunIds.IsValid(id));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(".maci")]
    [InlineData("..")]
    [InlineData("../x")]
    [InlineData("a/b")]
    [InlineData("a\\b")]
    [InlineData("-dash")]
    [InlineData("has space")]
    [InlineData("abc\n")]
    public void Rejects_InvalidRunIds(string? id) => Assert.False(RunIds.IsValid(id));

    [Fact]
    public void Rejects_RunIdsLongerThan100Characters()
    {
        Assert.True(RunIds.IsValid(new string('a', 100)));
        Assert.False(RunIds.IsValid(new string('a', 101)));
    }
}

public class RunCatalogTests : IDisposable
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private readonly ExperimentsTempDirs _dirs = new();

    public void Dispose() => _dirs.Dispose();

    private RunCatalog Catalog(string? activeRunId = null) =>
        new(_dirs.Data, _dirs.Runs, new FixedActiveRun(activeRunId));

    private static string Manifest(string runId, string startTime, bool completed = true, string? cacheSha = null) =>
        JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["schema"] = "tivr.manifest.v1", ["run_id"] = runId,
            ["dataset_path"] = "data/t.jsonl", ["dataset_sha256"] = new string('a', 64), ["task_count"] = 3,
            ["repair_mode"] = "dou", ["feedback_regime"] = "strict", ["k"] = 2, ["model"] = "gpt-4",
            ["api_host"] = "api.example.com:443",
            ["decoding"] = new Dictionary<string, object?> { ["temperature"] = 0.1, ["top_p"] = null, ["max_tokens"] = null },
            ["generation_prompt_style"] = "dou", ["sample_size"] = 120, ["seed"] = 7, ["llm_mode"] = "mock",
            ["generation_cache"] = cacheSha is null
                ? null
                : new Dictionary<string, object?> { ["path"] = "data/caches/x.json", ["sha256"] = cacheSha, ["reused"] = true },
            ["start_time"] = startTime, ["end_time"] = completed ? startTime : null,
            ["completed"] = completed, ["termination"] = completed ? null : "error", ["error"] = null,
        });

    private const string SummaryWithRsr =
        """{"schema":"tivr.run_summary.v1","rsr":[{"iteration":1,"num":29,"den":120,"pct":24.2},{"iteration":2,"num":35,"den":120,"pct":29.2}]}""";

    // ── Datasets and caches ──────────────────────────────────────

    [Fact]
    public void ListDatasets_CountsNonEmptyLinesAndHashesBytes()
    {
        var content = "{\"task_id\":\"a\"}\n\n  \n{\"task_id\":\"b\"}\r\n{\"task_id\":\"c\"}";
        var path = _dirs.WriteFile(Path.Combine(_dirs.Data, "b_tasks.jsonl"), content);
        _dirs.WriteFile(Path.Combine(_dirs.Data, "a_empty.jsonl"), "");
        _dirs.WriteFile(Path.Combine(_dirs.Data, "notes.txt"), "x\n");
        _dirs.WriteFile(Path.Combine(_dirs.Data, "nested", "deep.jsonl"), "{}\n");

        var datasets = Catalog().ListDatasets();

        Assert.Equal(["a_empty.jsonl", "b_tasks.jsonl"], datasets.Select(d => d.FileName));
        var b = datasets[1];
        Assert.Equal(3, b.TaskCount);
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path))), b.Sha256);
        Assert.Matches("^[0-9a-f]{64}$", b.Sha256);
        Assert.Equal(0, datasets[0].TaskCount);
        // SHA-256 of zero bytes.
        Assert.Equal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", datasets[0].Sha256);
    }

    [Fact]
    public void ListDatasets_RecomputesAfterFileChanges()
    {
        var path = _dirs.WriteFile(Path.Combine(_dirs.Data, "t.jsonl"), "{}\n");
        var catalog = Catalog();
        var before = catalog.ListDatasets().Single();

        File.WriteAllText(path, "{}\n{}\n");
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddMinutes(1));
        var after = catalog.ListDatasets().Single();

        Assert.Equal(1, before.TaskCount);
        Assert.Equal(2, after.TaskCount);
        Assert.NotEqual(before.Sha256, after.Sha256);
    }

    [Fact]
    public void ListDatasets_MissingDataDirectoryIsEmpty()
    {
        var catalog = new RunCatalog(Path.Combine(_dirs.Base, "nope"), _dirs.Runs);
        Assert.Empty(catalog.ListDatasets());
        Assert.Empty(catalog.ListCaches());
    }

    [Fact]
    public void ListCaches_ReturnsValidCachesWithDataRelativePaths()
    {
        var caches = Path.Combine(_dirs.Data, "caches");
        _dirs.WriteFile(Path.Combine(caches, "r1.generation_cache.json"),
            """{"schema":"tivr.generation_cache.v1","dataset_sha256":"abc","model":"gpt-4","llm_mode":"live","generation_prompt_style":"tivr","entries":[]}""");
        _dirs.WriteFile(Path.Combine(caches, "broken.json"), "{not json");
        _dirs.WriteFile(Path.Combine(caches, "missing_fields.json"), """{"model":"gpt-4"}""");
        _dirs.WriteFile(Path.Combine(caches, "bad_mode.json"),
            """{"dataset_sha256":"abc","model":"m","llm_mode":"other","generation_prompt_style":"dou"}""");

        var catalog = Catalog();
        var list = catalog.ListCaches();

        var info = Assert.Single(list);
        Assert.Equal("caches/r1.generation_cache.json", info.Path);
        Assert.Equal("abc", info.DatasetSha256);
        Assert.Equal("gpt-4", info.Model);
        Assert.Equal("live", info.LlmMode);
        Assert.Equal("tivr", info.GenerationPromptStyle);
        // The listed path is accepted back as a data-relative reference.
        Assert.True(catalog.TryResolveDataFile(info.Path, out _, out var error), error);

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(info, Web));
        Assert.Equal(["path", "datasetSha256", "model", "llmMode", "generationPromptStyle"],
            doc.RootElement.EnumerateObject().Select(p => p.Name));
    }

    // ── Run listing ──────────────────────────────────────────────

    [Fact]
    public void ListRuns_NewestFirstByManifestStartTime_WithLegacyAndSkippedEntries()
    {
        var older = "20260101T100000Z-dou-dou-aaaaaa";
        var newer = "20260102T100000Z-dou-strict-bbbbbb";
        var middle = "20260101T200000Z-full-dou-cccccc";
        _dirs.WriteFile(Path.Combine(_dirs.RunDir(older), "manifest.json"), Manifest(older, "2026-01-01T10:00:00Z"));
        _dirs.WriteFile(Path.Combine(_dirs.RunDir(newer), "manifest.json"), Manifest(newer, "2026-01-02T10:00:00Z", cacheSha: new string('c', 64)));
        _dirs.WriteFile(Path.Combine(_dirs.RunDir(middle), "manifest.json"), Manifest(middle, "2026-01-01T20:00:00Z", completed: false));
        _dirs.WriteFile(Path.Combine(_dirs.Runs, newer, "summary.json"), SummaryWithRsr);

        // Legacy pilot directory (no manifest), older than every manifest run.
        var legacy = _dirs.RunDir("pilot_full");
        _dirs.WriteFile(Path.Combine(legacy, "summary_full_k2.json"), """{"mode":"full","k":2}""");
        _dirs.WriteFile(Path.Combine(legacy, "trajectories.jsonl"), "{\"task_id\":\"t\"}\n");
        Directory.SetLastWriteTimeUtc(legacy, new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc));

        // Not runs: loose files in the runs root, the sidecar directory, an invalid name.
        _dirs.WriteFile(Path.Combine(_dirs.Runs, "summary_full_k2.json"), "{}");
        _dirs.WriteFile(Path.Combine(_dirs.Runs, "trajectories.jsonl"), "{}\n");
        _dirs.WriteFile(Path.Combine(_dirs.Runs, ".maci", "x.status.json"), "{}");
        _dirs.RunDir("-not-a-run");

        var runs = Catalog().ListRuns();

        Assert.Equal([newer, middle, older, "pilot_full"], runs.Select(r => r.RunId));

        var n = runs[0];
        Assert.Equal("manifest", n.Provenance);
        Assert.Equal("completed", n.Status);
        Assert.Equal("2026-01-02T10:00:00Z", n.StartTime);
        Assert.Equal("dou", n.RepairMode);
        Assert.Equal("strict", n.FeedbackRegime);
        Assert.Equal(2, n.K);
        Assert.Equal("gpt-4", n.Model);
        Assert.Equal(120, n.SampleSize);
        Assert.Equal("mock", n.LlmMode);
        Assert.Equal(new string('a', 64), n.DatasetSha256);
        Assert.Equal(new string('c', 64), n.GenerationCacheSha256);
        Assert.Equal(7, n.Seed);
        Assert.NotNull(n.Rsr);
        Assert.Equal([1, 2], n.Rsr!.Select(r => r.Iteration));
        Assert.Equal(29, n.Rsr[0].Num);
        Assert.Equal(120, n.Rsr[0].Den);
        Assert.Equal(24.2, n.Rsr[0].Pct);

        Assert.Equal("failed", runs[1].Status);   // manifest not completed, no sidecar, not active
        Assert.Null(runs[1].Rsr);                 // no summary: metrics absent
        Assert.Null(runs[2].GenerationCacheSha256);

        var l = runs[3];
        Assert.Equal("legacy", l.Provenance);
        Assert.Equal("completed", l.Status);
        Assert.Null(l.StartTime);
        Assert.Null(l.RepairMode);
        Assert.Null(l.Rsr);
    }

    [Fact]
    public void ListRuns_SerializesCamelCaseWithExplicitNulls()
    {
        _dirs.RunDir("pilot_generic");
        var item = Catalog().ListRuns().Single();

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(item, Web));
        Assert.Equal(
            ["runId", "provenance", "status", "startTime", "repairMode", "feedbackRegime", "k", "model",
             "sampleSize", "llmMode", "datasetSha256", "generationCacheSha256", "seed", "rsr"],
            doc.RootElement.EnumerateObject().Select(p => p.Name));
        Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("rsr").ValueKind);
        Assert.Equal("legacy", doc.RootElement.GetProperty("provenance").GetString());
        Assert.Equal("failed", doc.RootElement.GetProperty("status").GetString()); // no summary file
    }

    [Fact]
    public void ListRuns_MissingRunsRootIsEmpty() =>
        Assert.Empty(new RunCatalog(_dirs.Data, Path.Combine(_dirs.Base, "nope")).ListRuns());

    [Theory]
    [InlineData("""{"rsr":[{"iteration":1,"num":0,"den":0,"pct":null}]}""", 1)]
    [InlineData("""{"rsr":[]}""", 0)]
    public void ExtractRsr_ReadsRateObjects(string json, int count)
    {
        using var doc = JsonDocument.Parse(json);
        var rsr = RunCatalog.ExtractRsr(doc.RootElement);
        Assert.NotNull(rsr);
        Assert.Equal(count, rsr!.Count);
        if (count == 1)
            Assert.Null(rsr[0].Pct);
    }

    [Theory]
    [InlineData("""{"mode":"full","repair_success_rate":0.5}""")]   // legacy summary shape
    [InlineData("""{"rsr":{"1":24.2}}""")]
    [InlineData("""{"rsr":[{"iteration":1,"num":"29","den":120,"pct":24.2}]}""")]
    [InlineData("""{"rsr":[{"iteration":1,"num":29,"den":120}]}""")]
    public void ExtractRsr_MalformedOrLegacyIsAbsent(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(RunCatalog.ExtractRsr(doc.RootElement));
        Assert.Null(RunCatalog.ExtractRsr(null));
    }

    // ── Status ───────────────────────────────────────────────────

    [Fact]
    public void Status_ActiveThenSidecarThenManifest()
    {
        const string id = "20260101T100000Z-dou-dou-aaaaaa";
        _dirs.WriteFile(Path.Combine(_dirs.RunDir(id), "manifest.json"), Manifest(id, "2026-01-01T10:00:00Z", completed: false));

        Assert.Equal("failed", Catalog().GetStatusValue(id));
        Assert.Equal("running", Catalog(activeRunId: id).GetStatusValue(id));

        _dirs.WriteFile(Path.Combine(_dirs.Runs, ".maci", id + ".status.json"),
            """{"status":"cancelled","exitCode":null,"launchError":null,"endedAt":"2026-01-01T10:05:00Z"}""");
        Assert.Equal("cancelled", Catalog().GetStatusValue(id));
        Assert.Equal("cancelled", Catalog().GetRun(id)!.Status);
        Assert.Equal("running", Catalog(activeRunId: id).GetStatusValue(id));
        Assert.Null(Catalog().GetStatusValue("unknown-run"));
    }

    [Fact]
    public void GetRunStatus_CombinesProgressSidecarAndLogTail()
    {
        const string id = "run-1";
        var dir = _dirs.RunDir(id);
        _dirs.WriteFile(Path.Combine(dir, "manifest.json"), Manifest(id, "2026-01-01T10:00:00Z", completed: false));
        _dirs.WriteFile(Path.Combine(dir, "progress.json"),
            """{"schema":"tivr.progress.v1","run_id":"run-1","phase":"repair","completed":37,"total":120,"updated_at":"2026-01-01T12:03:00Z"}""");
        _dirs.WriteFile(Path.Combine(_dirs.Runs, ".maci", id + ".status.json"),
            """{"status":"failed","exitCode":3,"launchError":null,"endedAt":"2026-01-01T12:04:00Z"}""");
        _dirs.WriteFile(Path.Combine(_dirs.Runs, ".maci", id + ".log"),
            string.Join("\n", Enumerable.Range(1, 250).Select(i => $"line {i}")) + "\n");

        var status = Catalog().GetRunStatus(id)!;

        Assert.Equal("failed", status.Status);
        Assert.Equal("repair", status.Phase);
        Assert.Equal(37, status.Completed);
        Assert.Equal(120, status.Total);
        Assert.Equal(3, status.ExitCode);
        Assert.Null(status.LaunchError);
        Assert.Equal(200, status.OutputTail.Count);
        Assert.Equal("line 51", status.OutputTail[0]);
        Assert.Equal("line 250", status.OutputTail[^1]);

        var live = Catalog(activeRunId: id).GetRunStatus(id, ["a", "b"])!;
        Assert.Equal("running", live.Status);
        Assert.Equal(["a", "b"], live.OutputTail);

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(status, Web));
        Assert.Equal(["runId", "status", "phase", "completed", "total", "outputTail", "exitCode", "launchError"],
            doc.RootElement.EnumerateObject().Select(p => p.Name));
        Assert.Null(Catalog().GetRunStatus("missing"));
    }

    // ── Detail ───────────────────────────────────────────────────

    [Fact]
    public void GetRun_PassesManifestAndSummaryThroughUnchanged()
    {
        const string id = "20260101T100000Z-dou-dou-aaaaaa";
        var dir = _dirs.RunDir(id);
        _dirs.WriteFile(Path.Combine(dir, "manifest.json"), Manifest(id, "2026-01-01T10:00:00Z"));
        _dirs.WriteFile(Path.Combine(dir, "summary.json"), SummaryWithRsr);

        var detail = Catalog().GetRun(id)!;
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(detail, Web));
        var root = doc.RootElement;

        Assert.Equal(["runId", "provenance", "status", "manifest", "summary"], root.EnumerateObject().Select(p => p.Name));
        Assert.Equal("manifest", root.GetProperty("provenance").GetString());
        Assert.Equal(id, root.GetProperty("manifest").GetProperty("run_id").GetString());
        Assert.Equal("strict", root.GetProperty("manifest").GetProperty("feedback_regime").GetString());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("manifest").GetProperty("decoding").GetProperty("top_p").ValueKind);
        Assert.Equal(29, root.GetProperty("summary").GetProperty("rsr")[0].GetProperty("num").GetInt32());
    }

    [Fact]
    public void GetRun_LegacyHasNullManifestAndSummary_UnknownIsNull()
    {
        _dirs.WriteFile(Path.Combine(_dirs.RunDir("pilot_taxonomy"), "summary_taxonomy_k2.json"), "{}");

        var detail = Catalog().GetRun("pilot_taxonomy")!;
        Assert.Equal("legacy", detail.Provenance);
        Assert.Equal("completed", detail.Status);
        Assert.Null(detail.Manifest);
        Assert.Null(detail.Summary);

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(detail, Web));
        Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("manifest").ValueKind);
        Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("summary").ValueKind);

        Assert.Null(Catalog().GetRun("missing"));
        Assert.Null(Catalog().GetRun("../runs"));
        Assert.Null(Catalog().GetRun(".maci"));
    }

    // ── Trajectories ─────────────────────────────────────────────

    [Fact]
    public void GetTrajectories_PagesOfFiftyInWriteOrder()
    {
        const string id = "run-traj";
        var dir = _dirs.RunDir(id);
        var lines = Enumerable.Range(0, 120)
            .Select(i => JsonSerializer.Serialize(new { schema = "tivr.trajectory.v1", task_id = $"T/{i}", iteration = 1 }))
            .ToList();
        lines.Insert(60, "");               // blank line: not an entry
        lines.Add("{\"task_id\": \"partial");  // incomplete last line: not an entry
        _dirs.WriteFile(Path.Combine(dir, "trajectories.jsonl"), string.Join("\n", lines));

        var catalog = Catalog();
        var p1 = catalog.GetTrajectories(id, 1)!;
        var p3 = catalog.GetTrajectories(id, 3)!;
        var p4 = catalog.GetTrajectories(id, 4)!;

        Assert.Equal(120, p1.Total);
        Assert.Equal(50, p1.PageSize);
        Assert.Equal(50, p1.Entries.Count);
        Assert.Equal("T/0", p1.Entries[0].GetProperty("task_id").GetString());
        Assert.Equal("T/49", p1.Entries[^1].GetProperty("task_id").GetString());
        Assert.Equal("T/50", catalog.GetTrajectories(id, 2)!.Entries[0].GetProperty("task_id").GetString());
        Assert.Equal(20, p3.Entries.Count);
        Assert.Equal("T/119", p3.Entries[^1].GetProperty("task_id").GetString());
        Assert.Empty(p4.Entries);
        Assert.Equal(120, p4.Total);
        Assert.Equal(4, p4.Page);

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(p1, Web));
        Assert.Equal(["page", "pageSize", "total", "entries"], doc.RootElement.EnumerateObject().Select(p => p.Name));
        Assert.Equal("T/0", doc.RootElement.GetProperty("entries")[0].GetProperty("task_id").GetString());
    }

    [Fact]
    public void GetTrajectories_MissingFileUnknownRunAndInvalidPage()
    {
        _dirs.RunDir("run-empty");
        var empty = Catalog().GetTrajectories("run-empty", 1)!;
        Assert.Equal(0, empty.Total);
        Assert.Empty(empty.Entries);

        Assert.Null(Catalog().GetTrajectories("missing", 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => Catalog().GetTrajectories("run-empty", 0));
    }
}
