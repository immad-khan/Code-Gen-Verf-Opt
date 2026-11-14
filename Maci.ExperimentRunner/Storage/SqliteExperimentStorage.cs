using Microsoft.Data.Sqlite;

namespace Maci.ExperimentRunner.Storage;

public sealed class SqliteExperimentStorage : IExperimentStorage
{
    private readonly string _connectionString;

    public SqliteExperimentStorage(string databasePath)
    {
        var dir = Path.GetDirectoryName(databasePath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared
        };
        _connectionString = builder.ToString();
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        var sql = """
            CREATE TABLE IF NOT EXISTS experiment_runs (
                run_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                model TEXT NOT NULL,
                mode TEXT NOT NULL,
                iterations INTEGER NOT NULL,
                seed INTEGER NOT NULL,
                config_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS problem_runs (
                problem_run_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                benchmark TEXT NOT NULL,
                problem_id TEXT NOT NULL,
                sub_tier TEXT,
                passed INTEGER NOT NULL,
                passed_round INTEGER NOT NULL,
                initial_bug_primary TEXT,
                initial_bug_sub TEXT,
                final_bug_primary TEXT,
                final_bug_sub TEXT,
                total_duration_ms INTEGER NOT NULL,
                completed_at TEXT NOT NULL,
                FOREIGN KEY (run_id) REFERENCES experiment_runs(run_id)
            );

            CREATE TABLE IF NOT EXISTS problem_rounds (
                round_id TEXT PRIMARY KEY,
                problem_run_id TEXT NOT NULL,
                round_number INTEGER NOT NULL,
                prompt TEXT NOT NULL,
                response TEXT NOT NULL,
                code_snapshot TEXT NOT NULL,
                passed INTEGER NOT NULL,
                bug_primary TEXT,
                bug_sub TEXT,
                compiler_feedback TEXT,
                token_count INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (problem_run_id) REFERENCES problem_runs(problem_run_id)
            );

            CREATE INDEX IF NOT EXISTS idx_problem_runs_lookup 
            ON problem_runs(run_id, benchmark, problem_id);
        """;

        await using var cmd = new SqliteCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task RegisterRunAsync(string runId, string model, string mode, int iterations, int seed, string configJson, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        var sql = """
            INSERT INTO experiment_runs (run_id, created_at, model, mode, iterations, seed, config_json)
            VALUES (@runId, @createdAt, @model, @mode, @iterations, @seed, @configJson)
            ON CONFLICT(run_id) DO UPDATE SET
                model = excluded.model,
                mode = excluded.mode,
                iterations = excluded.iterations,
                seed = excluded.seed,
                config_json = excluded.config_json;
        """;

        await using var cmd = new SqliteCommand(sql, conn);
        cmd.Parameters.AddWithValue("@runId", runId);
        cmd.Parameters.AddWithValue("@createdAt", DateTime.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("@model", model);
        cmd.Parameters.AddWithValue("@mode", mode);
        cmd.Parameters.AddWithValue("@iterations", iterations);
        cmd.Parameters.AddWithValue("@seed", seed);
        cmd.Parameters.AddWithValue("@configJson", configJson);

        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<string?> GetLatestRunIdAsync(string model, string mode, int seed, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        var sql = "SELECT run_id FROM experiment_runs WHERE model = @model AND mode = @mode AND seed = @seed ORDER BY created_at DESC LIMIT 1;";
        await using var cmd = new SqliteCommand(sql, conn);
        cmd.Parameters.AddWithValue("@model", model);
        cmd.Parameters.AddWithValue("@mode", mode);
        cmd.Parameters.AddWithValue("@seed", seed);

        var result = await cmd.ExecuteScalarAsync(ct);
        return result?.ToString();
    }

    public async Task<bool> IsProblemCompletedAsync(string runId, string benchmark, string problemId, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        var sql = "SELECT COUNT(1) FROM problem_runs WHERE run_id = @runId AND benchmark = @bm AND problem_id = @probId AND completed_at IS NOT NULL;";
        await using var cmd = new SqliteCommand(sql, conn);
        cmd.Parameters.AddWithValue("@runId", runId);
        cmd.Parameters.AddWithValue("@bm", benchmark);
        cmd.Parameters.AddWithValue("@probId", problemId);

        var count = Convert.ToInt64(await cmd.ExecuteScalarAsync(ct));
        return count > 0;
    }

    public async Task SaveRoundAsync(ProblemRoundRecord round, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        var roundId = $"{round.ProblemRunId}:r{round.RoundNumber}";
        var sql = """
            INSERT INTO problem_rounds (
                round_id, problem_run_id, round_number, prompt, response, code_snapshot,
                passed, bug_primary, bug_sub, compiler_feedback, token_count, duration_ms, created_at
            ) VALUES (
                @roundId, @problemRunId, @roundNumber, @prompt, @response, @codeSnapshot,
                @passed, @bugPrimary, @bugSub, @compilerFeedback, @tokenCount, @durationMs, @createdAt
            ) ON CONFLICT(round_id) DO UPDATE SET
                prompt = excluded.prompt,
                response = excluded.response,
                code_snapshot = excluded.code_snapshot,
                passed = excluded.passed,
                bug_primary = excluded.bug_primary,
                bug_sub = excluded.bug_sub,
                compiler_feedback = excluded.compiler_feedback,
                token_count = excluded.token_count,
                duration_ms = excluded.duration_ms;
        """;

        await using var cmd = new SqliteCommand(sql, conn);
        cmd.Parameters.AddWithValue("@roundId", roundId);
        cmd.Parameters.AddWithValue("@problemRunId", round.ProblemRunId);
        cmd.Parameters.AddWithValue("@roundNumber", round.RoundNumber);
        cmd.Parameters.AddWithValue("@prompt", round.Prompt);
        cmd.Parameters.AddWithValue("@response", round.Response);
        cmd.Parameters.AddWithValue("@codeSnapshot", round.CodeSnapshot);
        cmd.Parameters.AddWithValue("@passed", round.Passed ? 1 : 0);
        cmd.Parameters.AddWithValue("@bugPrimary", (object?)round.BugPrimary ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@bugSub", (object?)round.BugSub ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@compilerFeedback", (object?)round.CompilerFeedback ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@tokenCount", round.TokenCount);
        cmd.Parameters.AddWithValue("@durationMs", round.DurationMs);
        cmd.Parameters.AddWithValue("@createdAt", DateTime.UtcNow.ToString("O"));

        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task SaveProblemRunAsync(ProblemRunRecord run, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);

        var problemRunId = $"{run.RunId}:{run.Benchmark}:{run.ProblemId}";
        var sql = """
            INSERT INTO problem_runs (
                problem_run_id, run_id, benchmark, problem_id, sub_tier, passed, passed_round,
                initial_bug_primary, initial_bug_sub, final_bug_primary, final_bug_sub,
                total_duration_ms, completed_at
            ) VALUES (
                @problemRunId, @runId, @bm, @probId, @subTier, @passed, @passedRound,
                @initBugPrimary, @initBugSub, @finalBugPrimary, @finalBugSub,
                @durationMs, @completedAt
            ) ON CONFLICT(problem_run_id) DO UPDATE SET
                passed = excluded.passed,
                passed_round = excluded.passed_round,
                initial_bug_primary = excluded.initial_bug_primary,
                initial_bug_sub = excluded.initial_bug_sub,
                final_bug_primary = excluded.final_bug_primary,
                final_bug_sub = excluded.final_bug_sub,
                total_duration_ms = excluded.total_duration_ms,
                completed_at = excluded.completed_at;
        """;

        await using var cmd = new SqliteCommand(sql, conn);
        cmd.Parameters.AddWithValue("@problemRunId", problemRunId);
        cmd.Parameters.AddWithValue("@runId", run.RunId);
        cmd.Parameters.AddWithValue("@bm", run.Benchmark);
        cmd.Parameters.AddWithValue("@probId", run.ProblemId);
        cmd.Parameters.AddWithValue("@subTier", (object?)run.SubTier ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@passed", run.Passed ? 1 : 0);
        cmd.Parameters.AddWithValue("@passedRound", run.PassedRound);
        cmd.Parameters.AddWithValue("@initBugPrimary", (object?)run.InitialBugPrimary ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@initBugSub", (object?)run.InitialBugSub ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@finalBugPrimary", (object?)run.FinalBugPrimary ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@finalBugSub", (object?)run.FinalBugSub ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@durationMs", run.TotalDurationMs);
        cmd.Parameters.AddWithValue("@completedAt", DateTime.UtcNow.ToString("O"));

        await cmd.ExecuteNonQueryAsync(ct);
    }
}
