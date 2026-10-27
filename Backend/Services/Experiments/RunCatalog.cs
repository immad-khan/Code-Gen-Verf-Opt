using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Backend.Models;

namespace Backend.Services.Experiments;

/// <summary>Tells the catalog which run (if any) the API is currently executing.</summary>
public interface IActiveRunProvider
{
    /// <summary>ID of the active run, or null when no run is active.</summary>
    string? ActiveRunId { get; }
}

/// <summary>
/// Read-only view of the configured data directory and runs root (design "Experiments",
/// Req. 24.1, 24.8, 24.9, 24.10, 24.13).
///
/// <list type="bullet">
/// <item>Datasets: top-level <c>*.jsonl</c> in the data directory, with non-empty line count and
/// SHA-256 (memoized per file length and modification time).</item>
/// <item>Caches: <c>&lt;data&gt;/caches/*.json</c> Generation_Caches with the fields the start form needs.</item>
/// <item>Runs: every directory under the runs root whose name is a valid run ID (so
/// <c>.maci</c> and loose files are skipped), newest first. Runs without a readable
/// <c>manifest.json</c> are <c>legacy</c>.</item>
/// <item>Status: <c>running</c> for the active run, else the <c>.maci/&lt;id&gt;.status.json</c>
/// sidecar, else the manifest (<c>completed: true</c> → <c>completed</c>, otherwise <c>failed</c>);
/// legacy runs are <c>completed</c> when they hold a <c>summary*.json</c>, otherwise <c>failed</c>.</item>
/// </list>
///
/// Runner files are opened with sharing so the runner can keep appending and replacing them.
/// </summary>
public sealed class RunCatalog
{
    public const int TrajectoryPageSize = 50;
    public const int OutputTailLines = 200;

    public const string SidecarDirectoryName = ".maci";
    public const string CachesDirectoryName = "caches";

    // File names from tivr/rundir.py.
    public const string ManifestFile = "manifest.json";
    public const string ProgressFile = "progress.json";
    public const string GenerationCacheFile = "generation_cache.json";
    public const string TrajectoriesFile = "trajectories.jsonl";
    public const string ProgramsFile = "programs.jsonl";
    public const string SummaryFile = "summary.json";

    private readonly IActiveRunProvider? _activeRuns;
    private readonly ConcurrentDictionary<string, Memo<DatasetInfo>> _datasetMemo = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, Memo<CacheInfo?>> _cacheMemo = new(StringComparer.Ordinal);

    private sealed record Memo<T>(long Length, DateTime LastWriteUtc, T Value);

    public RunCatalog(string dataDir, string runsRoot, IActiveRunProvider? activeRuns = null)
    {
        if (string.IsNullOrWhiteSpace(dataDir)) throw new ArgumentException("data directory is required", nameof(dataDir));
        if (string.IsNullOrWhiteSpace(runsRoot)) throw new ArgumentException("runs root is required", nameof(runsRoot));
        DataDir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dataDir));
        RunsRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(runsRoot));
        _activeRuns = activeRuns;
    }

    public string DataDir { get; }
    public string RunsRoot { get; }
    public string CachesDirectory => Path.Combine(DataDir, CachesDirectoryName);

    /// <summary><c>&lt;runs_root&gt;/.maci</c>: API-owned status and log sidecars.</summary>
    public string SidecarDirectory => Path.Combine(RunsRoot, SidecarDirectoryName);

    public string StatusSidecarPath(string runId) => Path.Combine(SidecarDirectory, runId + ".status.json");
    public string LogSidecarPath(string runId) => Path.Combine(SidecarDirectory, runId + ".log");

    // ─────────────────────────────────────────────────────────────
    // Datasets and caches
    // ─────────────────────────────────────────────────────────────

    /// <summary>Resolve a start-run <c>dataset</c> value to an existing file inside the data directory.</summary>
    public bool TryResolveDataFile(string? relative, out string fullPath, out string error) =>
        PathGuard.TryResolveExistingFile(DataDir, relative, out fullPath, out error);

    /// <summary>Every top-level <c>*.jsonl</c> in the data directory, ordered by file name.</summary>
    public IReadOnlyList<DatasetInfo> ListDatasets()
    {
        if (!Directory.Exists(DataDir))
            return [];
        var result = new List<DatasetInfo>();
        foreach (var file in Directory.EnumerateFiles(DataDir, "*.jsonl", SearchOption.TopDirectoryOnly))
        {
            var name = Path.GetFileName(file);
            if (!string.Equals(Path.GetExtension(name), ".jsonl", StringComparison.OrdinalIgnoreCase))
                continue;
            if (!PathGuard.TryResolveExistingFile(DataDir, name, out var full, out _))
                continue;
            try
            {
                result.Add(Memoized(_datasetMemo, full, () => DescribeDataset(full)));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Unreadable right now (e.g. being written by a preparer): leave it out.
            }
        }
        result.Sort((a, b) => string.CompareOrdinal(a.FileName, b.FileName));
        return result;
    }

    /// <summary>File name, non-empty JSONL line count, and lowercase SHA-256 of one dataset file.</summary>
    public static DatasetInfo DescribeDataset(string fullPath) => new()
    {
        FileName = Path.GetFileName(fullPath),
        TaskCount = CountNonEmptyLines(fullPath),
        Sha256 = Sha256File(fullPath),
    };

    /// <summary>64-character lowercase hexadecimal SHA-256 of the file bytes.</summary>
    public static string Sha256File(string fullPath)
    {
        using var stream = OpenShared(fullPath);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }

    /// <summary>Number of lines containing at least one non-whitespace character.</summary>
    public static int CountNonEmptyLines(string fullPath)
    {
        using var reader = new StreamReader(OpenShared(fullPath));
        var count = 0;
        while (reader.ReadLine() is { } line)
        {
            if (!string.IsNullOrWhiteSpace(line))
                count++;
        }
        return count;
    }

    /// <summary>
    /// Valid Generation_Caches in <c>&lt;data&gt;/caches</c> (top-level <c>*.json</c>), ordered by path.
    /// Files that do not parse or lack a required field are skipped.
    /// </summary>
    public IReadOnlyList<CacheInfo> ListCaches()
    {
        var dir = CachesDirectory;
        if (!Directory.Exists(dir))
            return [];
        var result = new List<CacheInfo>();
        foreach (var file in Directory.EnumerateFiles(dir, "*.json", SearchOption.TopDirectoryOnly))
        {
            var relative = CachesDirectoryName + "/" + Path.GetFileName(file);
            if (!string.Equals(Path.GetExtension(file), ".json", StringComparison.OrdinalIgnoreCase))
                continue;
            if (!PathGuard.TryResolveExistingFile(DataDir, relative, out var full, out _))
                continue;
            try
            {
                var info = Memoized(_cacheMemo, full, () => DescribeCache(full, relative));
                if (info is not null)
                    result.Add(info);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
            }
        }
        result.Sort((a, b) => string.CompareOrdinal(a.Path, b.Path));
        return result;
    }

    private static CacheInfo? DescribeCache(string fullPath, string relative)
    {
        var doc = ReadJsonObject(fullPath);
        if (doc is not { } root)
            return null;
        var sha = GetString(root, "dataset_sha256");
        var model = GetString(root, "model");
        var llmMode = GetString(root, "llm_mode");
        var style = GetString(root, "generation_prompt_style");
        if (sha is null || model is null
            || llmMode is null || !ExperimentValues.LlmModes.Contains(llmMode)
            || style is null || !ExperimentValues.GenerationPromptStyles.Contains(style))
            return null;
        return new CacheInfo
        {
            Path = relative,
            DatasetSha256 = sha,
            Model = model,
            LlmMode = llmMode,
            GenerationPromptStyle = style,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Runs
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// The Run_Directory for <paramref name="runId"/>: the ID must match the run-ID pattern and name
    /// an existing directory inside the runs root (404 otherwise, Req. 24.13).
    /// </summary>
    public bool TryGetRunDirectory(string? runId, out string runDirectory)
    {
        runDirectory = "";
        if (!RunIds.IsValid(runId))
            return false;
        return PathGuard.TryResolveExistingDirectory(RunsRoot, runId, out runDirectory, out _);
    }

    public bool RunExists(string? runId) => TryGetRunDirectory(runId, out _);

    /// <summary>All Run_Directories, newest first (Req. 24.8, 24.10).</summary>
    /// <remarks>
    /// Sort key: the manifest's <c>start_time</c>; runs without one (legacy) use the directory's
    /// last-write time. Ties break on run ID, descending. Legacy items report <c>startTime: null</c>.
    /// </remarks>
    public IReadOnlyList<RunListItem> ListRuns()
    {
        if (!Directory.Exists(RunsRoot))
            return [];
        var rows = new List<(DateTimeOffset Key, RunListItem Item)>();
        foreach (var dir in Directory.EnumerateDirectories(RunsRoot))
        {
            var runId = Path.GetFileName(dir);
            if (string.Equals(runId, SidecarDirectoryName, StringComparison.Ordinal))
                continue;
            if (!TryGetRunDirectory(runId, out var runDir))
                continue;
            var item = BuildListItem(runId, runDir, out var key);
            rows.Add((key, item));
        }
        return rows
            .OrderByDescending(r => r.Key)
            .ThenByDescending(r => r.Item.RunId, StringComparer.Ordinal)
            .Select(r => r.Item)
            .ToList();
    }

    private RunListItem BuildListItem(string runId, string runDir, out DateTimeOffset sortKey)
    {
        var manifest = ReadJsonObject(Path.Combine(runDir, ManifestFile));
        var summary = ReadJsonObject(Path.Combine(runDir, SummaryFile));
        var item = new RunListItem
        {
            RunId = runId,
            Provenance = manifest is null ? ExperimentValues.ProvenanceLegacy : ExperimentValues.ProvenanceManifest,
            Status = ResolveStatus(runId, runDir, manifest),
            Rsr = ExtractRsr(summary),
        };
        DateTimeOffset? started = null;
        if (manifest is { } m)
        {
            item.StartTime = GetString(m, "start_time");
            item.RepairMode = GetString(m, "repair_mode");
            item.FeedbackRegime = GetString(m, "feedback_regime");
            item.K = GetInt(m, "k");
            item.Model = GetString(m, "model");
            item.SampleSize = GetInt(m, "sample_size");
            var llmMode = GetString(m, "llm_mode");
            item.LlmMode = llmMode is not null && ExperimentValues.LlmModes.Contains(llmMode) ? llmMode : null;
            item.DatasetSha256 = GetString(m, "dataset_sha256");
            item.GenerationCacheSha256 = m.TryGetProperty("generation_cache", out var cache)
                                         && cache.ValueKind == JsonValueKind.Object
                ? GetString(cache, "sha256")
                : null;
            item.Seed = GetInt(m, "seed");
            if (item.StartTime is not null
                && DateTimeOffset.TryParse(item.StartTime, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
                started = parsed;
        }
        sortKey = started ?? new DateTimeOffset(Directory.GetLastWriteTimeUtc(runDir), TimeSpan.Zero);
        return item;
    }

    /// <summary>
    /// RSR per iteration from a Run_Summary's <c>rsr</c> array. Null when there is no summary or the
    /// array is missing or malformed (metrics absent, Req. 24.8).
    /// </summary>
    public static List<RateWithIteration>? ExtractRsr(JsonElement? summary)
    {
        if (summary is not { ValueKind: JsonValueKind.Object } s
            || !s.TryGetProperty("rsr", out var rsr)
            || rsr.ValueKind != JsonValueKind.Array)
            return null;
        var result = new List<RateWithIteration>();
        foreach (var e in rsr.EnumerateArray())
        {
            if (e.ValueKind != JsonValueKind.Object)
                return null;
            var iteration = GetInt(e, "iteration");
            var num = GetInt(e, "num");
            var den = GetInt(e, "den");
            if (iteration is null || num is null || den is null || !e.TryGetProperty("pct", out var pct))
                return null;
            double? pctValue;
            if (pct.ValueKind == JsonValueKind.Null)
                pctValue = null;
            else if (pct.ValueKind == JsonValueKind.Number && pct.TryGetDouble(out var d))
                pctValue = d;
            else
                return null;
            result.Add(new RateWithIteration { Iteration = iteration.Value, Num = num.Value, Den = den.Value, Pct = pctValue });
        }
        return result;
    }

    /// <summary>Run detail with manifest and summary passed through unchanged; null if the run does not exist.</summary>
    public RunDetail? GetRun(string? runId)
    {
        if (!TryGetRunDirectory(runId, out var runDir))
            return null;
        var manifest = ReadJsonObject(Path.Combine(runDir, ManifestFile));
        return new RunDetail
        {
            RunId = runId!,
            Provenance = manifest is null ? ExperimentValues.ProvenanceLegacy : ExperimentValues.ProvenanceManifest,
            Status = ResolveStatus(runId!, runDir, manifest),
            Manifest = manifest,
            Summary = ReadJsonObject(Path.Combine(runDir, SummaryFile)),
        };
    }

    /// <summary>Status value of an existing run; null if the run does not exist.</summary>
    public string? GetStatusValue(string? runId)
    {
        if (!TryGetRunDirectory(runId, out var runDir))
            return null;
        return ResolveStatus(runId!, runDir, ReadJsonObject(Path.Combine(runDir, ManifestFile)));
    }

    /// <summary>
    /// Status view of an existing run: status, progress from <c>progress.json</c>, exit code and
    /// launch error from the sidecar, and the output tail (the caller's live buffer when supplied,
    /// otherwise the last lines of <c>.maci/&lt;id&gt;.log</c>). Null if the run does not exist.
    /// </summary>
    public RunStatus? GetRunStatus(string? runId, IReadOnlyList<string>? outputTail = null)
    {
        if (!TryGetRunDirectory(runId, out var runDir))
            return null;
        var id = runId!;
        var progress = ReadProgress(runDir);
        var sidecar = ReadStatusSidecar(id);
        var tail = outputTail ?? ReadLogTail(id);
        return new RunStatus
        {
            RunId = id,
            Status = ResolveStatus(id, runDir, ReadJsonObject(Path.Combine(runDir, ManifestFile))),
            Phase = progress?.Phase,
            Completed = progress?.Completed,
            Total = progress?.Total,
            OutputTail = tail.Skip(Math.Max(0, tail.Count - OutputTailLines)).ToList(),
            ExitCode = sidecar?.ExitCode,
            LaunchError = sidecar?.LaunchError,
        };
    }

    /// <summary><c>progress.json</c> of a Run_Directory; null when absent or unreadable.</summary>
    public static RunProgress? ReadProgress(string runDirectory)
    {
        if (ReadJsonObject(Path.Combine(runDirectory, ProgressFile)) is not { } p)
            return null;
        var phase = GetString(p, "phase");
        return new RunProgress(
            phase is not null && ExperimentValues.Phases.Contains(phase) ? phase : null,
            GetInt(p, "completed"),
            GetInt(p, "total"));
    }

    /// <summary>The run's <c>.maci/&lt;id&gt;.status.json</c> sidecar; null when absent or unreadable.</summary>
    public RunStatusSidecar? ReadStatusSidecar(string? runId)
    {
        if (!RunIds.IsValid(runId))
            return null;
        var path = StatusSidecarPath(runId!);
        if (!File.Exists(path))
            return null;
        try
        {
            using var stream = OpenShared(path);
            return JsonSerializer.Deserialize<RunStatusSidecar>(stream);
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>Last <paramref name="maxLines"/> lines of <c>.maci/&lt;id&gt;.log</c>; empty when absent.</summary>
    public IReadOnlyList<string> ReadLogTail(string? runId, int maxLines = OutputTailLines)
    {
        if (!RunIds.IsValid(runId) || maxLines <= 0)
            return [];
        var path = LogSidecarPath(runId!);
        if (!File.Exists(path))
            return [];
        try
        {
            var tail = new Queue<string>(maxLines);
            using var reader = new StreamReader(OpenShared(path));
            while (reader.ReadLine() is { } line)
            {
                if (tail.Count == maxLines)
                    tail.Dequeue();
                tail.Enqueue(line);
            }
            return tail.ToList();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    private string ResolveStatus(string runId, string runDir, JsonElement? manifest)
    {
        if (string.Equals(_activeRuns?.ActiveRunId, runId, StringComparison.Ordinal))
            return ExperimentValues.StatusRunning;
        if (ReadStatusSidecar(runId) is { } sidecar && ExperimentValues.TerminalStatuses.Contains(sidecar.Status))
            return sidecar.Status;
        if (manifest is { } m)
        {
            return m.TryGetProperty("completed", out var c) && c.ValueKind == JsonValueKind.True
                ? ExperimentValues.StatusCompleted
                : ExperimentValues.StatusFailed;
        }
        // Legacy: a finished pilot run left a summary file (e.g. summary_full_k2.json).
        try
        {
            return Directory.EnumerateFiles(runDir, "summary*.json", SearchOption.TopDirectoryOnly).Any()
                ? ExperimentValues.StatusCompleted
                : ExperimentValues.StatusFailed;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return ExperimentValues.StatusFailed;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Trajectories
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Page <paramref name="page"/> (1-based) of <c>trajectories.jsonl</c>: at most 50 entries in write
    /// order, the total entry count, and an empty list beyond the last page (Req. 24.9). Blank and
    /// unparseable lines (e.g. a line still being written) are not entries. Null if the run does not
    /// exist.
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="page"/> is less than 1.</exception>
    public TrajectoryPage? GetTrajectories(string? runId, int page)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(page, 1);
        if (!TryGetRunDirectory(runId, out var runDir))
            return null;

        var result = new TrajectoryPage { Page = page, PageSize = TrajectoryPageSize };
        var path = Path.Combine(runDir, TrajectoriesFile);
        if (!File.Exists(path))
            return result;

        var first = (long)(page - 1) * TrajectoryPageSize;
        var last = first + TrajectoryPageSize;
        var total = 0;
        try
        {
            using var reader = new StreamReader(OpenShared(path));
            while (reader.ReadLine() is { } line)
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;
                JsonElement entry;
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    entry = total >= first && total < last ? doc.RootElement.Clone() : default;
                }
                catch (JsonException)
                {
                    continue;
                }
                if (total >= first && total < last)
                    result.Entries.Add(entry);
                total++;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Report what was read so far.
        }
        result.Total = total;
        return result;
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    private static FileStream OpenShared(string path) =>
        new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);

    /// <summary>Parse a JSON file whose root is an object; null when absent, unreadable, or not an object.</summary>
    public static JsonElement? ReadJsonObject(string path)
    {
        if (!File.Exists(path))
            return null;
        try
        {
            using var stream = OpenShared(path);
            using var doc = JsonDocument.Parse(stream);
            return doc.RootElement.ValueKind == JsonValueKind.Object ? doc.RootElement.Clone() : null;
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int? GetInt(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i)
            ? i
            : null;

    private static T Memoized<T>(ConcurrentDictionary<string, Memo<T>> memo, string fullPath, Func<T> compute)
    {
        var info = new FileInfo(fullPath);
        var length = info.Length;
        var mtime = info.LastWriteTimeUtc;
        if (memo.TryGetValue(fullPath, out var hit) && hit.Length == length && hit.LastWriteUtc == mtime)
            return hit.Value;
        var value = compute();
        memo[fullPath] = new Memo<T>(length, mtime, value);
        return value;
    }
}
