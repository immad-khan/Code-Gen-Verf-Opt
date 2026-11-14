namespace Backend.Services;

public sealed record SandboxRunResult(
    bool Success,
    int ExitCode,
    string Stdout,
    string Stderr,
    bool TimedOut,
    TimeSpan Duration
);

public interface IDockerSandbox
{
    Task<SandboxRunResult> RunCommandAsync(
        string workingDir,
        string command,
        int timeoutSeconds = 30,
        CancellationToken ct = default);

    Task<bool> IsDockerAvailableAsync(CancellationToken ct = default);
}
