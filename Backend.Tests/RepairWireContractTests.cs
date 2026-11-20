using System.Net.Http.Json;
using System.Text.Json;
using Backend.Models;
using Backend.Services.Verification.Pipeline;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Backend.Tests;

public class RepairWireContractTests
{
    private sealed class Unavailable : IVerificationPipeline
    {
        public Task<VerificationResponse> ExecuteAsync(List<GeneratedCodeFile> files) =>
            Task.FromResult(new VerificationResponse { OverallVerdict = "ERROR" });
    }

    [Fact]
    public async Task Repair_UsesServerVerificationAndReturnsUnmeasuredOutcomeWhenUnavailable()
    {
        using var app = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
            b.ConfigureServices(s => s.AddSingleton<IVerificationPipeline>(new Unavailable())));
        using var client = app.CreateClient();
        using var res = await client.PostAsJsonAsync("/api/optimization/repair", new
        {
            files = new[] { new { name = "solution.py", path = "solution.py", content = "pass" } },
            originalPrompt = "Example", apiSettings = new { model = "fixture" }, repairMode = "dou",
            verificationResult = new { overallVerdict = "VERIFIED" }
        });
        res.EnsureSuccessStatusCode();
        var result = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(result.GetProperty("repairSkipped").GetBoolean());
        Assert.Equal(0, result.GetProperty("iterations").GetArrayLength());
        var run = result.GetProperty("runResult");
        Assert.Equal("fixture", run.GetProperty("model").GetString());
        Assert.Equal(JsonValueKind.Number, run.GetProperty("baselineComparator").ValueKind);
        Assert.Equal(JsonValueKind.Null, run.GetProperty("repairSuccessRate").ValueKind);
        Assert.Equal("ERROR", run.GetProperty("rounds")[0].GetProperty("verdict").GetString());
    }
}
