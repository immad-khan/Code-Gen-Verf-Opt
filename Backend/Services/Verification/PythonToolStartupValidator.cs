namespace Backend.Services.Verification;

public class PythonToolStartupValidator : IHostedService
{
    private readonly PythonToolHealthService _healthService;
    private readonly ILogger<PythonToolStartupValidator> _logger;
    private readonly IWebHostEnvironment _env;

    public PythonToolStartupValidator(
        PythonToolHealthService healthService,
        ILogger<PythonToolStartupValidator> logger,
        IWebHostEnvironment env)
    {
        _healthService = healthService;
        _logger = logger;
        _env = env;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Validating Python environment and verification tools on startup...");
        var report = await _healthService.CheckHealthAsync();

        if (report.Ok)
        {
            _logger.LogInformation("Python Environment Healthy: {Path} ({Version})", report.PythonPath, report.PythonVersion);
            foreach (var t in report.Tools)
            {
                _logger.LogInformation("  [OK] Tool {Name}: v{Version}", t.Name, t.Version);
            }
        }
        else
        {
            var missing = report.Tools.Where(t => !t.Ok).Select(t => t.Name).ToList();
            var msg = $"CRITICAL STARTUP FAILURE: Required verification tool(s) missing or broken: {string.Join(", ", missing)}. Error: {report.Error}";
            _logger.LogCritical("{Message}", msg);
            foreach (var t in report.Tools)
            {
                if (t.Ok)
                    _logger.LogInformation("  [OK] Tool {Name}: v{Version}", t.Name, t.Version);
                else
                    _logger.LogError("  [FAIL] Tool {Name}: {Error}", t.Name, t.Error);
            }

            // In development, fail loud so developer immediately fixes environment
            if (_env.IsDevelopment())
            {
                throw new InvalidOperationException(msg);
            }
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
