using System.Diagnostics;
using System.Text;

namespace Backend.Services;

public sealed class DockerSandbox : IDockerSandbox
{
    private readonly string _image;

    public DockerSandbox(string image = "veriflow-sandbox:3.11")
    {
        _image = image;
    }

    public async Task<bool> IsDockerAvailableAsync(CancellationToken ct = default)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "docker",
                Arguments = "info",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            if (proc == null) return false;
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
            await proc.WaitForExitAsync(linked.Token);
            return proc.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    public async Task<SandboxRunResult> RunCommandAsync(
        string workingDir,
        string command,
        int timeoutSeconds = 30,
        CancellationToken ct = default)
    {
        var normalizedDir = workingDir.Replace('\\', '/');
        if (normalizedDir.Length > 2 && normalizedDir[1] == ':')
        {
            // Convert C:/Users/... to /c/Users/... for docker volume mount
            normalizedDir = "/" + char.ToLowerInvariant(normalizedDir[0]) + normalizedDir[2..];
        }

        var escapedCommand = command.Replace("\"", "\\\"");
        var args = $"run --rm --network none --memory 4g --cpus 2 -w /sandbox -v \"{normalizedDir}:/sandbox:ro\" {_image} sh -c \"{escapedCommand}\"";

        var startInfo = new ProcessStartInfo
        {
            FileName = "docker",
            Arguments = args,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        var stdoutSb = new StringBuilder();
        var stderrSb = new StringBuilder();
        var sw = Stopwatch.StartNew();

        using var process = new Process { StartInfo = startInfo };
        process.OutputDataReceived += (_, e) => { if (e.Data != null) stdoutSb.AppendLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data != null) stderrSb.AppendLine(e.Data); };

        try
        {
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

            try
            {
                await process.WaitForExitAsync(linked.Token);
            }
            catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                return new SandboxRunResult(
                    Success: false,
                    ExitCode: -1,
                    Stdout: stdoutSb.ToString(),
                    Stderr: stderrSb.ToString() + "\nExecution timed out.",
                    TimedOut: true,
                    Duration: sw.Elapsed
                );
            }

            sw.Stop();
            return new SandboxRunResult(
                Success: process.ExitCode == 0,
                ExitCode: process.ExitCode,
                Stdout: stdoutSb.ToString(),
                Stderr: stderrSb.ToString(),
                TimedOut: false,
                Duration: sw.Elapsed
            );
        }
        catch (Exception ex)
        {
            sw.Stop();
            return new SandboxRunResult(
                Success: false,
                ExitCode: -1,
                Stdout: stdoutSb.ToString(),
                Stderr: $"Failed to run Docker command: {ex.Message}",
                TimedOut: false,
                Duration: sw.Elapsed
            );
        }
    }
}
