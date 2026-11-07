using Npgsql;

namespace Backend.Data;

public static class DatabaseConfiguration
{
    public static string ResolveConnectionString(IConfiguration configuration)
    {
        // 1. Check environment variable DATABASE_URL or POSTGRES_URL
        var connectionUrl = Environment.GetEnvironmentVariable("DATABASE_URL")
            ?? Environment.GetEnvironmentVariable("POSTGRES_URL")
            ?? configuration.GetConnectionString("DefaultConnection")
            ?? "";

        return ConvertPostgreSqlUriToConnectionString(connectionUrl);
    }

    public static string ConvertPostgreSqlUriToConnectionString(string rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl))
            return string.Empty;

        // If it's already an ADO.NET connection string (key=value), return as is
        if (!rawUrl.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
            !rawUrl.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            return rawUrl;
        }

        try
        {
            var uri = new Uri(rawUrl);
            var userInfo = uri.UserInfo.Split(':');
            var username = userInfo.Length > 0 ? Uri.UnescapeDataString(userInfo[0]) : "";
            var password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "";
            var host = uri.Host;
            var port = uri.Port > 0 ? uri.Port : 5432;
            var database = uri.AbsolutePath.TrimStart('/');

            var builder = new NpgsqlConnectionStringBuilder
            {
                Host = host,
                Port = port,
                Database = database,
                Username = username,
                Password = password,
                SslMode = SslMode.Require,
                Pooling = true,
                Timeout = 15,
                CommandTimeout = 30
            };

            return builder.ConnectionString;
        }
        catch
        {
            // Fallback to raw string if URI parsing encounters an issue
            return rawUrl;
        }
    }
}
