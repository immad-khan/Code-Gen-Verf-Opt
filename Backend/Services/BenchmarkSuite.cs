using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Backend.Services;

/// <summary>The API and batch runner must execute the exact same prepared suite.</summary>
public static class BenchmarkSuite
{
    public static string Load(string dataDirectory, string rawRecord)
    {
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawRecord))).ToLowerInvariant();
        var path = Path.Combine(dataDirectory, "suites-v1", digest + ".py");
        if (!File.Exists(path))
            throw new FileNotFoundException("Benchmark suite unavailable. Run python scripts/prepare_benchmark_suites.py before using benchmarks.", path);
        return File.ReadAllText(path);
    }

    // Non-finite JSON numbers occur in EvalPlus inputs. These inputs are handled by
    // the offline oracle builder; replace only unquoted tokens when reading metadata.
    public static JsonNode? Metadata(string raw) => JsonNode.Parse(Regex.Replace(raw,
        "\"(?:\\\\.|[^\"\\\\])*\"|-?Infinity|NaN", m => m.Value[0] == '"' ? m.Value : "null"));

    public static string? AppsEntryPoint(JsonNode node) => node["inputs"] is JsonArray { Count: > 0 } inputs && inputs[0] is JsonArray
        ? Regex.Match(node["starter_code"]?.GetValue<string>() ?? "", @"\bdef\s+(\w+)\s*\(").Groups[1].Value : null;
}
