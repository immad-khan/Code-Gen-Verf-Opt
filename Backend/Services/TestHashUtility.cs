using System.Security.Cryptography;
using System.Text;

namespace Backend.Services;

/// <summary>
/// Canonical SHA-256 hashing and normalization for test suites.
/// SHA-256 over normalized text (UTF-8, LF, trimmed end).
/// Shared across UI backend and CLI runner.
/// </summary>
public static class TestHashUtility
{
    public static string ComputeHash(string? testCode)
    {
        var normalized = Normalize(testCode);
        var bytes = Encoding.UTF8.GetBytes(normalized);
        var hashBytes = SHA256.HashData(bytes);
        return Convert.ToHexString(hashBytes).ToLowerInvariant();
    }

    public static string Normalize(string? code)
    {
        if (string.IsNullOrEmpty(code)) return "";
        return code.Trim('\uFEFF').Replace("\r\n", "\n").Replace('\r', '\n').TrimEnd();
    }
}
