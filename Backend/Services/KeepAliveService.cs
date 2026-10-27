using System.Net.Http;

namespace Backend.Services;

/// <summary>
/// Background service that periodically pings the server's public URL
/// to prevent platforms like Render from sleeping due to inactivity.
/// </summary>
public class KeepAliveService : BackgroundService
{
    private readonly ILogger<KeepAliveService> _logger;
    private readonly IConfiguration _configuration;
    private readonly HttpClient _httpClient;

    public KeepAliveService(
        ILogger<KeepAliveService> logger,
        IConfiguration configuration,
        IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _configuration = configuration;
        _httpClient = httpClientFactory.CreateClient("KeepAliveClient");
        _httpClient.Timeout = TimeSpan.FromSeconds(15);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Initial delay before first ping
        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            // Render automatically provides RENDER_EXTERNAL_URL (e.g., https://app.onrender.com)
            var externalUrl = _configuration["RENDER_EXTERNAL_URL"]
                ?? _configuration["KEEP_ALIVE_URL"]
                ?? Environment.GetEnvironmentVariable("RENDER_EXTERNAL_URL")
                ?? Environment.GetEnvironmentVariable("KEEP_ALIVE_URL");

            if (!string.IsNullOrWhiteSpace(externalUrl))
            {
                try
                {
                    var targetUrl = $"{externalUrl.TrimEnd('/')}/api/health";
                    _logger.LogInformation("Sending keep-alive ping to {Url}...", targetUrl);

                    var response = await _httpClient.GetAsync(targetUrl, stoppingToken);
                    _logger.LogInformation("Keep-alive response status: {StatusCode}", response.StatusCode);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogWarning("Keep-alive ping failed: {Message}", ex.Message);
                }
            }
            else
            {
                _logger.LogDebug("No RENDER_EXTERNAL_URL or KEEP_ALIVE_URL configured; skipping self-ping.");
            }

            // Ping every 5 minutes (Render sleep timeout is typically 15 minutes)
            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
        }
    }
}
