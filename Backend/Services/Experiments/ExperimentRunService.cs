using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Backend.Models;

namespace Backend.Services.Experiments;

/// <summary>Settings for <see cref="ExperimentRunService"/> (mapped from configuration by the host).</summary>
public sealed class ExperimentRunOptions
{
    /// <summary>Directory holding prepared datasets and <c>caches/</c>.</summary>
    public string DataDir { get; set; } = "";

    /// <summary>Directory holding Run_Directories and the API's <c>.maci/</c> sidecars.</summary>
    public string RunsRoot { get; set; } = "";

    /// <summary>Repository root: working directory and <c>PYTHONPATH</c> of the runner.</summary>
    public string RepoRoot { get; set; } = "";

    /// <summary>Python executable used to run <c>-m tivr.run_benchmark</c>.</summary>
    public string PythonExecutable { get; set; } = "python";

    /// <summary>How long a cancel waits for the killed process tree to exit (Req. 24.7).</summary>
    public TimeSpan CancelTimeout { get; set; } = TimeSpan.FromSeconds(10);
}

/// <summary>Accepted values, bounds, and defaults of a start-run request (Req. 24.3; mirrors tivr/config.py).</summary>
public static class StartRunFields
{
    public const string Dataset = "dataset";
    public const string RepairMode = "repairMode";
    public const string FeedbackRegime = "feedbackRegime";
    public const string K = "k";
    public const string Temperature = "temperature";
    public const string GenerationPromptStyle = "generationPromptStyle";
    public const string SampleSize = "sampleSize";
    public const string Seed = "seed";
    public const string GenerationCache = "generationCache";
    public const string Mock = "mock";

    public static readonly IReadOnlyList<string> CoreRepairModes =
        ["dou", "dou_no_bt", "generic", "evidence_only", "taxonomy_only", "full"];

    /// <summary>Optional modes; the runner requires <c>--enable-intervenor</c> for them.</summary>
    public static readonly IReadOnlyList<string> OptionalRepairModes = ["intervenor", "dou_intervenor"];

    public static readonly IReadOnlyList<string> RepairModes = [.. CoreRepairModes, .. OptionalRepairModes];
    public static readonly IReadOnlyList<string> FeedbackRegimes = ["dou", "strict"];
    public static readonly IReadOnlyList<string> GenerationPromptStyles = ExperimentValues.GenerationPromptStyles;

    public const string DefaultRepairMode = "dou";
    public const string DefaultFeedbackRegime = "dou";
    public const int DefaultK = 2;
    public const double DefaultTemperature = 0.1;
    public const string DefaultGenerationPromptStyle = "dou";
    public const int DefaultSampleSize = 120;
    public const int DefaultSeed = 0;

    public const int MinK = 1, MaxK = 10;
    public const double MinTemperature = 0.0, MaxTemperature = 2.0;
    public const int MinSampleSize = 1, MaxSampleSize = 10_000;
    public const int MinSeed = 0, MaxSeed = int.MaxValue;
}

/// <summary>A start-run request after validation: defaults applied, paths resolved to full paths.</summary>
public sealed record ValidatedStartRun(
    string DatasetPath,
    string RepairMode,
    string FeedbackRegime,
    int K,
    double Temperature,
    string GenerationPromptStyle,
    int SampleSize,
    int Seed,
    string? GenerationCachePath,
    bool Mock);

public enum StartRunOutcome
{
    /// <summary>The runner was launched (202 with <see cref="StartRunResult.RunId"/>).</summary>
    Started,

    /// <summary>One or more fields are invalid (400 with <see cref="StartRunResult.Errors"/>); nothing launched.</summary>
    Invalid,

    /// <summary>Another run is active (409 with <see cref="StartRunResult.ActiveRunId"/>); nothing launched.</summary>
    Conflict,

    /// <summary>
    /// The runner process could not be started. The run is recorded as <c>failed</c> with
    /// <see cref="StartRunResult.LaunchError"/> and remains visible through <see cref="ExperimentRunService.Status"/>.
    /// </summary>
    LaunchFailed,
}

public sealed class StartRunResult
{
    public StartRunOutcome Outcome { get; private init; }
    public string? RunId { get; private init; }
    public string? ActiveRunId { get; private init; }
    public IReadOnlyList<InvalidField> Errors { get; private init; } = [];
    public string? LaunchError { get; private init; }

    internal static StartRunResult Started(string runId) => new() { Outcome = StartRunOutcome.Started, RunId = runId };
    internal static StartRunResult Invalid(IReadOnlyList<InvalidField> errors) => new() { Outcome = StartRunOutcome.Invalid, Errors = errors };
    internal static StartRunResult Conflict(string activeRunId) => new() { Outcome = StartRunOutcome.Conflict, ActiveRunId = activeRunId };
    internal static StartRunResult LaunchFailed(string runId, string error) =>
        new() { Outcome = StartRunOutcome.LaunchFailed, RunId = runId, LaunchError = error };

    /// <summary>400 body <c>{error, invalidFields}</c> naming every invalid field.</summary>
    public ApiValidationErrorBody ToErrorBody() => new()
    {
        Error = $"Invalid run settings: {string.Join(", ", Errors.Select(e => e.Field))}",
        InvalidFields = Errors.ToList(),
    };
}

public enum CancelRunOutcome
{
    /// <summary>The active run was terminated; <see cref="CancelRunResult.Status"/> is its final status.</summary>
    Cancelled,

    /// <summary>The run exists but is not active (409).</summary>
    NotActive,

    /// <summary>No run with this ID (404).</summary>
    NotFound,
}

/// <param name="Status">Final status for <see cref="CancelRunOutcome.Cancelled"/> (normally <c>cancelled</c>), current status for <see cref="CancelRunOutcome.NotActive"/>.</param>
public sealed record CancelRunResult(CancelRunOutcome Outcome, string? RunId, string? Status);

/// <summary>
/// Launches and supervises at most one Benchmark_Runner child process (design D8, "Experiments";
/// Req. 24.2, 24.3, 24.5, 24.6, 24.7, 24.12, 24.14).
///
/// <list type="bullet">
/// <item>Start: validates every field and bound, resolves dataset and cache paths under the data
/// directory, rejects while another run is active, generates a run ID unique across Run_Directories
/// and sidecars, and launches <c>python -m tivr.run_benchmark</c> via
/// <see cref="ProcessStartInfo.ArgumentList"/> (no shell string) with <c>--run-id</c> and
/// <c>--runs-root</c>.</item>
/// <item>Output: combined stdout/stderr lines go to a 200-line ring buffer and to
/// <c>&lt;runs_root&gt;/.maci/&lt;run_id&gt;.log</c>.</item>
/// <item>End: exit, cancel, or launch failure writes <c>.maci/&lt;run_id&gt;.status.json</c>
/// (<see cref="RunStatusSidecar"/>) before the run stops being active. A completed run's
/// <c>generation_cache.json</c> is copied to <c>&lt;data&gt;/caches/&lt;run_id&gt;.generation_cache.json</c>.</item>
/// </list>
///
/// The runner inherits <c>TIVR_API_KEY</c>, <c>TIVR_API_BASE</c>, and <c>TIVR_MODEL</c> from this
/// process's environment; they are never logged, and the key is redacted from captured output.
/// </summary>
public sealed class ExperimentRunService : IActiveRunProvider, IDisposable
{
    public const string RunnerModule = "tivr.run_benchmark";
    public const string ApiKeyVariable = "TIVR_API_KEY";
    private const string Redacted = "[REDACTED]";
    private const int MinRedactedSecretLength = 8;

    private readonly ExperimentRunOptions _options;
    private readonly IProcessLauncher _launcher;
    private readonly object _gate = new();
    private volatile ActiveRun? _active;
    private bool _disposed;

    public ExperimentRunService(ExperimentRunOptions options, IProcessLauncher launcher)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(launcher);
        if (string.IsNullOrWhiteSpace(options.RepoRoot))
            throw new ArgumentException("repository root is required", nameof(options));
        if (string.IsNullOrWhiteSpace(options.PythonExecutable))
            throw new ArgumentException("python executable is required", nameof(options));
        if (options.CancelTimeout <= TimeSpan.Zero)
            throw new ArgumentException("cancel timeout must be positive", nameof(options));
        _options = options;
        _launcher = launcher;
        RepoRoot = Path.GetFullPath(options.RepoRoot);
        Catalog = new RunCatalog(options.DataDir, options.RunsRoot, this);
    }

    /// <summary>Catalog over the same data directory and runs root, aware of this service's active run.</summary>
    public RunCatalog Catalog { get; }

    public string RepoRoot { get; }

    /// <inheritdoc />
    public string? ActiveRunId => _active?.RunId;

    // ─────────────────────────────────────────────────────────────
    // Start
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Validate <paramref name="request"/> and, if valid and no run is active, launch the runner.
    /// Returns as soon as the process has started (the run ID is known before the runner creates
    /// its directory).
    /// </summary>
    public StartRunResult Start(StartRunRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new List<InvalidField>();
        var config = Validate(request, errors);
        if (config is null)
            return StartRunResult.Invalid(errors);

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_active is { } current)
                return StartRunResult.Conflict(current.RunId);

            var runId = NewRunId(config);
            var startInfo = BuildStartInfo(config, runId);
            var secret = startInfo.Environment.TryGetValue(ApiKeyVariable, out var key) ? key?.Trim() : null;
            var run = new ActiveRun(runId, secret is { Length: >= MinRedactedSecretLength } ? secret : null);
            try
            {
                Directory.CreateDirectory(Catalog.SidecarDirectory);
                run.Log = OpenLog(runId);
                run.Process = _launcher.Start(startInfo, line => AppendOutput(run, line));
            }
            catch (Exception ex)
            {
                var message = string.IsNullOrWhiteSpace(ex.Message) ? ex.GetType().Name : ex.Message;
                message = run.Redact(message);
                run.CloseLog();
                TryWriteStatusSidecar(runId, new RunStatusSidecar
                {
                    Status = ExperimentValues.StatusFailed,
                    ExitCode = null,
                    LaunchError = message,
                    EndedAt = Now(),
                });
                return StartRunResult.LaunchFailed(runId, message);
            }

            _active = run;
            _ = MonitorAsync(run);
            return StartRunResult.Started(runId);
        }
    }

    /// <summary>
    /// Validate every start-run field (Req. 24.3, 24.4, 24.12). Returns null and fills
    /// <paramref name="errors"/> with one entry per invalid field otherwise. Omitted or JSON-null
    /// optional fields take the runner defaults; values are never coerced across JSON types.
    /// </summary>
    public ValidatedStartRun? Validate(StartRunRequest request, List<InvalidField> errors)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(errors);
        var before = errors.Count;

        var dataset = ValidateDataFile(request.Dataset, StartRunFields.Dataset, required: true, errors);
        var mode = ValidateChoice(request.RepairMode, StartRunFields.RepairMode, StartRunFields.RepairModes,
            StartRunFields.DefaultRepairMode, errors);
        var regime = ValidateChoice(request.FeedbackRegime, StartRunFields.FeedbackRegime, StartRunFields.FeedbackRegimes,
            StartRunFields.DefaultFeedbackRegime, errors);
        var k = ValidateInt(request.K, StartRunFields.K, StartRunFields.MinK, StartRunFields.MaxK,
            StartRunFields.DefaultK, errors);
        var temperature = ValidateTemperature(request.Temperature, errors);
        var style = ValidateChoice(request.GenerationPromptStyle, StartRunFields.GenerationPromptStyle,
            StartRunFields.GenerationPromptStyles, StartRunFields.DefaultGenerationPromptStyle, errors);
        var sampleSize = ValidateInt(request.SampleSize, StartRunFields.SampleSize, StartRunFields.MinSampleSize,
            StartRunFields.MaxSampleSize, StartRunFields.DefaultSampleSize, errors);
        var seed = ValidateInt(request.Seed, StartRunFields.Seed, StartRunFields.MinSeed, StartRunFields.MaxSeed,
            StartRunFields.DefaultSeed, errors);
        var cache = ValidateDataFile(request.GenerationCache, StartRunFields.GenerationCache, required: false, errors);
        var mock = ValidateBool(request.Mock, StartRunFields.Mock, errors);

        if (errors.Count > before)
            return null;
        return new ValidatedStartRun(dataset!, mode!, regime!, k!.Value, temperature!.Value, style!,
            sampleSize!.Value, seed!.Value, cache, mock!.Value);
    }

    /// <summary>
    /// Runner arguments after the executable:
    /// <c>-m tivr.run_benchmark DATASET --mode M [--enable-intervenor] --feedback-regime R --k K
    /// --temperature T --generation-prompt-style S --sample-size N --seed S [--generation-cache C]
    /// [--mock] --run-id ID --runs-root ROOT</c>.
    /// </summary>
    public static IReadOnlyList<string> BuildArguments(ValidatedStartRun config, string runId, string runsRoot)
    {
        ArgumentNullException.ThrowIfNull(config);
        var args = new List<string> { "-m", RunnerModule, config.DatasetPath, "--mode", config.RepairMode };
        if (StartRunFields.OptionalRepairModes.Contains(config.RepairMode))
            args.Add("--enable-intervenor");
        args.AddRange([
            "--feedback-regime", config.FeedbackRegime,
            "--k", config.K.ToString(CultureInfo.InvariantCulture),
            "--temperature", config.Temperature.ToString("R", CultureInfo.InvariantCulture),
            "--generation-prompt-style", config.GenerationPromptStyle,
            "--sample-size", config.SampleSize.ToString(CultureInfo.InvariantCulture),
            "--seed", config.Seed.ToString(CultureInfo.InvariantCulture),
        ]);
        if (config.GenerationCachePath is not null)
            args.AddRange(["--generation-cache", config.GenerationCachePath]);
        if (config.Mock)
            args.Add("--mock");
        args.AddRange(["--run-id", runId, "--runs-root", runsRoot]);
        return args;
    }

    private ProcessStartInfo BuildStartInfo(ValidatedStartRun config, string runId)
    {
        var psi = new ProcessStartInfo
        {
            FileName = _options.PythonExecutable,
            WorkingDirectory = RepoRoot,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
        };
        foreach (var arg in BuildArguments(config, runId, Catalog.RunsRoot))
            psi.ArgumentList.Add(arg);
        // Environment starts as a copy of this process's environment (TIVR_* inherited).
        psi.Environment["PYTHONPATH"] = RepoRoot;
        psi.Environment["PYTHONUNBUFFERED"] = "1";
        // Redirected stdio otherwise uses the locale code page on Windows.
        psi.Environment["PYTHONIOENCODING"] = "utf-8";
        return psi;
    }

    /// <summary>
    /// <c>YYYYMMDDTHHMMSSZ-&lt;mode&gt;-&lt;regime&gt;-&lt;6 hex&gt;</c> (the runner's own format), retried
    /// until it names no Run_Directory and no sidecar.
    /// </summary>
    private string NewRunId(ValidatedStartRun config)
    {
        for (var attempt = 0; attempt < 1000; attempt++)
        {
            var stamp = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
            var hex = RandomNumberGenerator.GetHexString(6, lowercase: true);
            var id = $"{stamp}-{config.RepairMode}-{config.FeedbackRegime}-{hex}";
            if (!RunIds.IsValid(id))
                throw new InvalidOperationException("generated run ID does not match the run-ID pattern");
            if (!Directory.Exists(Path.Combine(Catalog.RunsRoot, id))
                && !File.Exists(Catalog.StatusSidecarPath(id))
                && !File.Exists(Catalog.LogSidecarPath(id)))
                return id;
        }
        throw new IOException("could not generate a unique run ID");
    }

    // ─────────────────────────────────────────────────────────────
    // Status and cancel
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Status of a run (Req. 24.6, 24.14): the active run reports <c>running</c>, progress from its
    /// <c>progress.json</c> (once the runner has created its directory), and the live output buffer.
    /// Other runs come from the catalog; a run that ended before creating its directory (launch
    /// failure, invalid runner configuration) is reported from its sidecars. Null if unknown.
    /// </summary>
    public RunStatus? Status(string? runId)
    {
        if (!RunIds.IsValid(runId))
            return null;
        var id = runId!;
        if (_active is { } run && string.Equals(run.RunId, id, StringComparison.Ordinal))
        {
            var progress = Catalog.TryGetRunDirectory(id, out var dir) ? RunCatalog.ReadProgress(dir) : null;
            return new RunStatus
            {
                RunId = id,
                Status = ExperimentValues.StatusRunning,
                Phase = progress?.Phase,
                Completed = progress?.Completed,
                Total = progress?.Total,
                OutputTail = run.SnapshotTail(),
            };
        }
        if (Catalog.GetRunStatus(id) is { } fromCatalog)
            return fromCatalog;
        if (Catalog.ReadStatusSidecar(id) is { } sidecar)
        {
            return new RunStatus
            {
                RunId = id,
                Status = ExperimentValues.TerminalStatuses.Contains(sidecar.Status)
                    ? sidecar.Status
                    : ExperimentValues.StatusFailed,
                OutputTail = Catalog.ReadLogTail(id).ToList(),
                ExitCode = sidecar.ExitCode,
                LaunchError = sidecar.LaunchError,
            };
        }
        return null;
    }

    /// <summary>True if <paramref name="runId"/> is active, has a Run_Directory, or has a status sidecar.</summary>
    public bool RunKnown(string? runId)
    {
        if (!RunIds.IsValid(runId))
            return false;
        return string.Equals(_active?.RunId, runId, StringComparison.Ordinal)
               || Catalog.RunExists(runId)
               || File.Exists(Catalog.StatusSidecarPath(runId!));
    }

    /// <summary>
    /// Cancel the active run (Req. 24.7): kill the runner's whole process tree and wait up to
    /// <see cref="ExperimentRunOptions.CancelTimeout"/> for it to exit. The run is marked
    /// <c>cancelled</c>; files already written to its Run_Directory are left in place.
    /// </summary>
    public async Task<CancelRunResult> CancelAsync(string? runId, CancellationToken cancellationToken = default)
    {
        ActiveRun? run;
        lock (_gate)
        {
            run = _active is { } a && string.Equals(a.RunId, runId, StringComparison.Ordinal) ? a : null;
            if (run is not null)
                run.CancelRequested = true;
        }
        if (run is null)
        {
            return RunKnown(runId)
                ? new CancelRunResult(CancelRunOutcome.NotActive, runId, Status(runId)?.Status)
                : new CancelRunResult(CancelRunOutcome.NotFound, runId, null);
        }

        KillProcess(run);
        try
        {
            await run.Finished.Task.WaitAsync(_options.CancelTimeout, cancellationToken).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            AppendOutput(run, FormattableString.Invariant(
                $"[maci] runner did not exit within {_options.CancelTimeout.TotalSeconds:0.#} s of the kill request"));
            Finish(run, exitCode: null, note: null);
        }
        return new CancelRunResult(CancelRunOutcome.Cancelled, run.RunId, run.FinalStatus ?? ExperimentValues.StatusCancelled);
    }

    // ─────────────────────────────────────────────────────────────
    // Supervision
    // ─────────────────────────────────────────────────────────────

    private async Task MonitorAsync(ActiveRun run)
    {
        int? exitCode = null;
        string? note = null;
        try
        {
            exitCode = await run.Process!.Completion.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            note = "[maci] lost track of the runner process: " + ex.Message;
        }
        Finish(run, exitCode, note);
    }

    /// <summary>
    /// Record the run's end exactly once: final status, sidecar, cache copy, log close, and only
    /// then clear the active run so the catalog never sees an ended run without its sidecar.
    /// </summary>
    private void Finish(ActiveRun run, int? exitCode, string? note)
    {
        if (Interlocked.Exchange(ref run.Finalized, 1) != 0)
            return;
        try
        {
            if (note is not null)
                AppendOutput(run, note);
            var status = run.CancelRequested
                ? ExperimentValues.StatusCancelled
                : exitCode == 0 ? ExperimentValues.StatusCompleted : ExperimentValues.StatusFailed;
            if (status == ExperimentValues.StatusCompleted)
                CopyGenerationCache(run);
            run.FinalStatus = status;
            TryWriteStatusSidecar(run.RunId, new RunStatusSidecar
            {
                Status = status,
                ExitCode = exitCode,
                LaunchError = null,
                EndedAt = Now(),
            });
            run.CloseLog();
        }
        finally
        {
            lock (_gate)
            {
                if (ReferenceEquals(_active, run))
                    _active = null;
            }
            try { run.Process?.Dispose(); } catch (Exception) { /* best effort */ }
            run.Finished.TrySetResult();
        }
    }

    private void KillProcess(ActiveRun run)
    {
        try
        {
            run.Process?.Kill();
        }
        catch (Exception ex)
        {
            AppendOutput(run, "[maci] failed to kill the runner process tree: " + ex.Message);
        }
    }

    /// <summary>Copy a completed run's <c>generation_cache.json</c> into <c>&lt;data&gt;/caches</c> (Req. 24.4).</summary>
    private void CopyGenerationCache(ActiveRun run)
    {
        if (!Catalog.TryGetRunDirectory(run.RunId, out var runDir))
            return;
        var source = Path.Combine(runDir, RunCatalog.GenerationCacheFile);
        if (!File.Exists(source))
            return; // the runner reused a supplied cache
        var target = Path.Combine(Catalog.CachesDirectory, run.RunId + ".generation_cache.json");
        var temp = target + ".tmp";
        try
        {
            Directory.CreateDirectory(Catalog.CachesDirectory);
            File.Copy(source, temp, overwrite: true);
            File.Move(temp, target, overwrite: false);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            AppendOutput(run, "[maci] could not copy the generation cache to the data directory: " + ex.Message);
            try { File.Delete(temp); } catch (Exception) { /* best effort */ }
        }
    }

    private static void AppendOutput(ActiveRun run, string line) => run.Append(run.Redact(line));

    private StreamWriter OpenLog(string runId)
    {
        var stream = new FileStream(Catalog.LogSidecarPath(runId), FileMode.Append, FileAccess.Write,
            FileShare.ReadWrite | FileShare.Delete);
        return new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
    }

    /// <summary>Write <c>.maci/&lt;id&gt;.status.json</c> atomically (temp file + replace).</summary>
    private void TryWriteStatusSidecar(string runId, RunStatusSidecar sidecar)
    {
        var path = Catalog.StatusSidecarPath(runId);
        var temp = path + ".tmp";
        try
        {
            Directory.CreateDirectory(Catalog.SidecarDirectory);
            File.WriteAllBytes(temp, JsonSerializer.SerializeToUtf8Bytes(sidecar));
            File.Move(temp, path, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            try { File.Delete(temp); } catch (Exception) { /* best effort */ }
        }
    }

    private static string Now() =>
        DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    // ─────────────────────────────────────────────────────────────
    // Field validation
    // ─────────────────────────────────────────────────────────────

    private static bool IsAbsent(JsonElement? value) =>
        value is null || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    private string? ValidateDataFile(JsonElement? value, string field, bool required, List<InvalidField> errors)
    {
        if (IsAbsent(value))
        {
            if (required)
                errors.Add(new(field, $"{field} is required."));
            return null;
        }
        if (value!.Value.ValueKind != JsonValueKind.String)
        {
            errors.Add(new(field, $"{field} must be a path relative to the data directory."));
            return null;
        }
        if (!PathGuard.TryResolveExistingFile(Catalog.DataDir, value.Value.GetString(), out var full, out var error))
        {
            errors.Add(new(field, $"{field} {error}."));
            return null;
        }
        return full;
    }

    private static string? ValidateChoice(JsonElement? value, string field, IReadOnlyList<string> accepted,
        string fallback, List<InvalidField> errors)
    {
        if (IsAbsent(value))
            return fallback;
        var allowed = string.Join(", ", accepted);
        if (value!.Value.ValueKind != JsonValueKind.String)
        {
            errors.Add(new(field, $"{field} must be a string, one of: {allowed}."));
            return null;
        }
        var s = value.Value.GetString();
        if (s is null || !accepted.Contains(s, StringComparer.Ordinal))
        {
            errors.Add(new(field, $"{field} '{s}' is not supported; expected one of (case-sensitive): {allowed}."));
            return null;
        }
        return s;
    }

    /// <summary>A JSON number with an integral value in [min, max] (<c>2.0</c> counts as 2; no string coercion).</summary>
    private static int? ValidateInt(JsonElement? value, string field, int min, int max, int fallback,
        List<InvalidField> errors)
    {
        if (IsAbsent(value))
            return fallback;
        var range = FormattableString.Invariant($"an integer from {min} to {max}");
        if (value!.Value.ValueKind != JsonValueKind.Number
            || !value.Value.TryGetDouble(out var d) || !double.IsFinite(d))
        {
            errors.Add(new(field, $"{field} must be {range}."));
            return null;
        }
        if (d != Math.Floor(d) || d < min || d > max)
        {
            errors.Add(new(field, $"{field} must be {range} (got {value.Value.GetRawText()})."));
            return null;
        }
        return (int)d;
    }

    private static double? ValidateTemperature(JsonElement? value, List<InvalidField> errors)
    {
        const string field = StartRunFields.Temperature;
        if (IsAbsent(value))
            return StartRunFields.DefaultTemperature;
        var range = FormattableString.Invariant(
            $"a number from {StartRunFields.MinTemperature:0.0} to {StartRunFields.MaxTemperature:0.0}");
        if (value!.Value.ValueKind != JsonValueKind.Number
            || !value.Value.TryGetDouble(out var t) || !double.IsFinite(t))
        {
            errors.Add(new(field, $"{field} must be {range}."));
            return null;
        }
        if (t < StartRunFields.MinTemperature || t > StartRunFields.MaxTemperature)
        {
            errors.Add(new(field, $"{field} must be {range} (got {value.Value.GetRawText()})."));
            return null;
        }
        return t + 0.0; // normalizes -0.0
    }

    private static bool? ValidateBool(JsonElement? value, string field, List<InvalidField> errors)
    {
        if (IsAbsent(value))
            return false;
        if (value!.Value.ValueKind is JsonValueKind.True or JsonValueKind.False)
            return value.Value.GetBoolean();
        errors.Add(new(field, $"{field} must be true or false."));
        return null;
    }

    // ─────────────────────────────────────────────────────────────
    // Shutdown
    // ─────────────────────────────────────────────────────────────

    /// <summary>Kill an active run on host shutdown so no runner outlives the backend; it is marked <c>cancelled</c>.</summary>
    public void Dispose()
    {
        ActiveRun? run;
        lock (_gate)
        {
            if (_disposed)
                return;
            _disposed = true;
            run = _active;
            if (run is not null)
                run.CancelRequested = true;
        }
        if (run is null)
            return;
        KillProcess(run);
        if (!run.Finished.Task.Wait(_options.CancelTimeout))
            Finish(run, exitCode: null, note: null);
    }

    private sealed class ActiveRun(string runId, string? secret)
    {
        private readonly object _outputGate = new();
        private readonly Queue<string> _tail = new(RunCatalog.OutputTailLines);
        private StreamWriter? _log;

        public string RunId { get; } = runId;
        public IRunnerProcess? Process { get; set; }
        public volatile bool CancelRequested;
        public int Finalized;
        public volatile string? FinalStatus;
        public TaskCompletionSource Finished { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public StreamWriter? Log
        {
            set { lock (_outputGate) _log = value; }
        }

        public string Redact(string line) =>
            secret is null ? line : line.Replace(secret, Redacted, StringComparison.Ordinal);

        public void Append(string line)
        {
            lock (_outputGate)
            {
                if (_tail.Count == RunCatalog.OutputTailLines)
                    _tail.Dequeue();
                _tail.Enqueue(line);
                try
                {
                    _log?.WriteLine(line);
                }
                catch (Exception ex) when (ex is IOException or ObjectDisposedException)
                {
                    // Keep the in-memory tail even if the log file becomes unwritable.
                }
            }
        }

        public List<string> SnapshotTail()
        {
            lock (_outputGate)
                return _tail.ToList();
        }

        public void CloseLog()
        {
            lock (_outputGate)
            {
                try { _log?.Dispose(); } catch (IOException) { /* best effort */ }
                _log = null;
            }
        }
    }
}
