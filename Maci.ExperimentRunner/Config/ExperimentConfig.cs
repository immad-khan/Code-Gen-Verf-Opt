using System.Text.Json.Serialization;

namespace Maci.ExperimentRunner.Config;

public sealed class ExperimentConfig
{
    [JsonPropertyName("model")]
    public string Model { get; set; } = "deepseek-reasoner";

    [JsonPropertyName("mode")]
    public string Mode { get; set; } = "dou";

    [JsonPropertyName("benchmarks")]
    public List<string> Benchmarks { get; set; } = new() { "humaneval_plus", "mbpp_plus", "apps_plus" };

    [JsonPropertyName("iterations")]
    public int Iterations { get; set; } = 2;

    [JsonPropertyName("timeout")]
    public int TimeoutSeconds { get; set; } = 10;

    [JsonPropertyName("concurrency")]
    public int Concurrency { get; set; } = 1;

    [JsonPropertyName("seed")]
    public int Seed { get; set; } = 42;

    [JsonPropertyName("dockerImage")]
    public string DockerImage { get; set; } = "veriflow-sandbox:3.11";

    [JsonPropertyName("databasePath")]
    public string DatabasePath { get; set; } = "data/experiments.db";

    [JsonPropertyName("dataDirectory")]
    public string DataDirectory { get; set; } = "data";

    [JsonPropertyName("appsPlusLevels")]
    public List<string> AppsPlusLevels { get; set; } = new() { "introductory", "interview", "competition" };

    [JsonPropertyName("maxProblems")]
    public int? MaxProblems { get; set; }

    [JsonPropertyName("dryRun")]
    public bool DryRun { get; set; } = false;

    [JsonPropertyName("provider")]
    public string Provider { get; set; } = "openrouter";

    [JsonPropertyName("apiEndpoint")]
    public string? ApiEndpoint { get; set; }

    [JsonPropertyName("apiKey")]
    public string? ApiKey { get; set; }
}
