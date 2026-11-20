namespace Maci.ExperimentRunner.Storage;

public sealed record ProblemRunRecord(
    string RunId,
    string Benchmark,
    string ProblemId,
    string? SubTier,
    bool Passed,
    int PassedRound,
    string? InitialBugPrimary,
    string? InitialBugSub,
    string? FinalBugPrimary,
    string? FinalBugSub,
    long TotalDurationMs
);

public sealed record ProblemRoundRecord(
    string ProblemRunId,
    int RoundNumber,
    string Prompt,
    string Response,
    string CodeSnapshot,
    bool Passed,
    string? BugPrimary,
    string? BugSub,
    string? CompilerFeedback,
    int TokenCount,
    long DurationMs
);

public interface IExperimentStorage
{
    Task InitializeAsync(CancellationToken ct = default);
    Task RegisterRunAsync(string runId, string model, string mode, int iterations, int seed, string configJson, CancellationToken ct = default);
    Task<string?> GetLatestRunIdAsync(string model, string mode, int seed, CancellationToken ct = default);
    Task<bool> IsProblemCompletedAsync(string runId, string benchmark, string problemId, CancellationToken ct = default);
    Task SaveProblemRunAsync(ProblemRunRecord run, IReadOnlyList<ProblemRoundRecord> rounds, CancellationToken ct = default);
}
