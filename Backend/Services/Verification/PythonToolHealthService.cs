using System.Diagnostics;

namespace Backend.Services.Verification;

public record ToolStatusInfo(string Name, string? Version, bool Ok, string? Error = null);

public record PythonHealthReport(
    bool Ok,
    string? PythonPath,
    string? PythonVersion,
    List<ToolStatusInfo> Tools,
    string? Error = null);

public class PythonToolHealthService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<PythonToolHealthService> _logger;
    private string? _resolvedPythonPath;

    public PythonToolHealthService(IConfiguration configuration, ILogger<PythonToolHealthService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<string> ResolvePythonPathAsync()
    {
        if (!string.IsNullOrEmpty(_resolvedPythonPath))
            return _resolvedPythonPath;

        var configured = _configuration["Python:ExecutablePath"] ?? Environment.GetEnvironmentVariable("PYTHON_EXECUTABLE");
        var candidates = new List<string>();

        if (!string.IsNullOrWhiteSpace(configured))
            candidates.Add(configured);

        // Common Anaconda and system paths
        candidates.Add(@"E:\anaconda\python.exe");
        candidates.Add(@"C:\ProgramData\anaconda3\python.exe");
        candidates.Add("python");
        candidates.Add("python3");

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate) || candidate is "python" or "python3")
            {
                var (ok, ver) = await RunCommandAsync(candidate, "--version");
                if (ok && ver.Contains("Python", StringComparison.OrdinalIgnoreCase))
                {
                    _resolvedPythonPath = candidate;
                    _logger.LogInformation("Resolved active Python executable: {Path} ({Version})", candidate, ver.Trim());
                    return candidate;
                }
            }
        }

        _logger.LogError("No functional Python executable found on system.");
        return "python"; // fallback
    }

    public async Task<PythonHealthReport> CheckHealthAsync()
    {
        var pythonPath = await ResolvePythonPathAsync();
        var (pyOk, pyVer) = await RunCommandAsync(pythonPath, "--version");

        var tools = new List<ToolStatusInfo>();

        if (!pyOk)
        {
            return new PythonHealthReport(
                Ok: false,
                PythonPath: pythonPath,
                PythonVersion: null,
                Tools: tools,
                Error: $"Python executable '{pythonPath}' failed to run: {pyVer}"
            );
        }

        // 1. Pytest
        var (pytestOk, pytestVer) = await RunPythonSnippetAsync(
            pythonPath, "import pytest; print(pytest.__version__)");
        tools.Add(new ToolStatusInfo("pytest", pytestOk ? pytestVer.Trim() : null, pytestOk, pytestOk ? null : pytestVer.Trim()));

        // 2. Mypy
        var (mypyOk, mypyVer) = await RunPythonSnippetAsync(
            pythonPath, "import mypy.version; print(mypy.version.__version__)");
        tools.Add(new ToolStatusInfo("mypy", mypyOk ? mypyVer.Trim() : null, mypyOk, mypyOk ? null : mypyVer.Trim()));

        // 3. Radon
        var (radonOk, radonVer) = await RunPythonSnippetAsync(
            pythonPath, "import radon; print(radon.__version__)");
        tools.Add(new ToolStatusInfo("radon", radonOk ? radonVer.Trim() : null, radonOk, radonOk ? null : radonVer.Trim()));

        // 4. Semgrep
        var (semgrepOk, semgrepVer) = await RunPythonSnippetAsync(
            pythonPath, "import semgrep; print(getattr(semgrep, '__VERSION__', getattr(semgrep, '__version__', 'installed')))");
        tools.Add(new ToolStatusInfo("semgrep", semgrepOk ? semgrepVer.Trim() : null, semgrepOk, semgrepOk ? null : semgrepVer.Trim()));

        bool allOk = pyOk && tools.All(t => t.Ok);

        return new PythonHealthReport(
            Ok: allOk,
            PythonPath: pythonPath,
            PythonVersion: pyVer.Trim(),
            Tools: tools
        );
    }

    private static async Task<(bool Ok, string Output)> RunPythonSnippetAsync(string pythonPath, string snippet)
    {
        return await RunCommandAsync(pythonPath, $"-c \"{snippet}\"");
    }

    private static async Task<(bool Ok, string Output)> RunCommandAsync(string fileName, string arguments)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var proc = Process.Start(psi);
            if (proc == null) return (false, "Failed to start process");

            var stdout = await proc.StandardOutput.ReadToEndAsync();
            var stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();

            var combined = $"{stdout}\n{stderr}".Trim();
            return (proc.ExitCode == 0, combined);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }
}
