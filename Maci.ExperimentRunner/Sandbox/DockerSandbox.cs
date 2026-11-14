using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace Maci.ExperimentRunner.Sandbox;

public sealed class DockerSandbox : IDockerSandbox
{
    private readonly string _image;

    public DockerSandbox(string image = "veriflow-sandbox:3.11")
    {
        _image = image;
    }

    public async Task<SandboxExecutionResult> RunTestAsync(
        string solutionCode,
        string testCode,
        int timeoutSeconds,
        CancellationToken ct = default)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "veriflow_run_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);

        var solutionPath = Path.Combine(tempDir, "solution.py");
        var testPath = Path.Combine(tempDir, "test_solution.py");

        try
        {
            await File.WriteAllTextAsync(solutionPath, solutionCode, Encoding.UTF8, ct);
            await File.WriteAllTextAsync(testPath, testCode, Encoding.UTF8, ct);

            // Record SHA-256 of the test file to guarantee tests are strictly read-only
            var initialTestHash = ComputeSha256(testPath);

            var normalizedDir = tempDir.Replace('\\', '/');
            if (normalizedDir.Length > 2 && normalizedDir[1] == ':')
            {
                // Docker Desktop accepts /c/Users/... or C:/Users/...
                normalizedDir = char.ToLowerInvariant(normalizedDir[0]) + normalizedDir[1..];
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = "docker",
                Arguments = $"run --rm --network none --memory 4g --cpus 2 -v \"{normalizedDir}:/sandbox:ro\" {_image} python -B -m pytest -q --tb=short -o cache_dir=/tmp/.pytest_cache test_solution.py",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            var sw = Stopwatch.StartNew();
            using var process = new Process { StartInfo = startInfo };
            var stdoutSb = new StringBuilder();
            var stderrSb = new StringBuilder();

            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data != null) stdoutSb.AppendLine(e.Data);
            };
            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data != null) stderrSb.AppendLine(e.Data);
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

            var timedOut = false;
            try
            {
                await process.WaitForExitAsync(linkedCts.Token);
            }
            catch (OperationCanceledException)
            {
                if (timeoutCts.IsCancellationRequested && !ct.IsCancellationRequested)
                {
                    timedOut = true;
                    try { process.Kill(entireProcessTree: true); } catch { }
                }
                else
                {
                    try { process.Kill(entireProcessTree: true); } catch { }
                    throw;
                }
            }

            sw.Stop();

            // Verify test file was NEVER modified
            var postRunTestHash = ComputeSha256(testPath);
            if (!string.Equals(initialTestHash, postRunTestHash, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("CRITICAL: Test suite was modified during execution! Tests are strictly read-only.");
            }

            var exitCode = timedOut ? -1 : process.ExitCode;
            var success = !timedOut && exitCode == 0;

            return new SandboxExecutionResult(
                Success: success,
                ExitCode: exitCode,
                Stdout: stdoutSb.ToString(),
                Stderr: stderrSb.ToString(),
                TimedOut: timedOut,
                Duration: sw.Elapsed
            );
        }
        finally
        {
            try
            {
                if (Directory.Exists(tempDir))
                    Directory.Delete(tempDir, recursive: true);
            }
            catch { }
        }
    }

    private static string ComputeSha256(string filePath)
    {
        using var stream = File.OpenRead(filePath);
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(stream);
        return Convert.ToHexString(bytes);
    }
}
