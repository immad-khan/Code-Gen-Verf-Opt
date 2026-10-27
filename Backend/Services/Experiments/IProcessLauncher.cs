using System.Diagnostics;

namespace Backend.Services.Experiments;

/// <summary>
/// Starts the Benchmark_Runner child process (design "Experiments"). Abstracted so tests can
/// replace the real process with a fake.
/// </summary>
public interface IProcessLauncher
{
    /// <summary>
    /// Start <paramref name="startInfo"/> with stdout and stderr redirected. Every output line
    /// (from either stream, without the line terminator) is passed to <paramref name="onOutput"/>,
    /// possibly from two threads at once.
    /// </summary>
    /// <exception cref="Exception">The process could not be started (e.g. executable not found).</exception>
    IRunnerProcess Start(ProcessStartInfo startInfo, Action<string> onOutput);
}

/// <summary>A started runner process.</summary>
public interface IRunnerProcess : IDisposable
{
    /// <summary>Completes with the exit code once the process has exited and its output is drained.</summary>
    Task<int> Completion { get; }

    /// <summary>Terminate the process and all of its descendants. No-op if it already exited.</summary>
    void Kill();
}

/// <summary><see cref="IProcessLauncher"/> backed by <see cref="Process"/>.</summary>
public sealed class SystemProcessLauncher : IProcessLauncher
{
    public IRunnerProcess Start(ProcessStartInfo startInfo, Action<string> onOutput)
    {
        ArgumentNullException.ThrowIfNull(startInfo);
        ArgumentNullException.ThrowIfNull(onOutput);

        startInfo.UseShellExecute = false;
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;
        startInfo.RedirectStandardInput = false;
        startInfo.CreateNoWindow = true;

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) onOutput(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) onOutput(e.Data); };
        try
        {
            if (!process.Start())
                throw new InvalidOperationException("the process did not start");
        }
        catch
        {
            process.Dispose();
            throw;
        }
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return new SystemRunnerProcess(process);
    }

    private sealed class SystemRunnerProcess : IRunnerProcess
    {
        private readonly Process _process;

        public SystemRunnerProcess(Process process)
        {
            _process = process;
            Completion = WaitAsync();
        }

        public Task<int> Completion { get; }

        // With asynchronous output reading, WaitForExitAsync also waits for both streams to reach EOF.
        private async Task<int> WaitAsync()
        {
            await _process.WaitForExitAsync().ConfigureAwait(false);
            return _process.ExitCode;
        }

        public void Kill()
        {
            try
            {
                _process.Kill(entireProcessTree: true);
            }
            catch (InvalidOperationException)
            {
                // Already exited (or never associated with a running process).
            }
        }

        public void Dispose() => _process.Dispose();
    }
}
