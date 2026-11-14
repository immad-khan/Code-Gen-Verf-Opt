namespace Maci.ExperimentRunner.Sandbox;

public sealed record SandboxExecutionResult(
    bool Success,
    int ExitCode,
    string Stdout,
    string Stderr,
    bool TimedOut,
    TimeSpan Duration
);

public interface IDockerSandbox
{
    Task<SandboxExecutionResult> RunTestAsync(
        string solutionCode,
        string testCode,
        int timeoutSeconds,
        CancellationToken ct = default);
}
