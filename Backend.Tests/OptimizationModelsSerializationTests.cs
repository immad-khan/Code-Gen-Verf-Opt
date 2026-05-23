using System.Text.Json;
using Backend.Models;

namespace Backend.Tests;

/// <summary>
/// The web repair DTOs must serialize to the exact camelCase shapes declared in
/// src/api/types.ts, and RepairSessionRequest must bind any JSON for repairMode/k/temperature.
/// </summary>
public class OptimizationModelsSerializationTests
{
    // Same defaults ASP.NET Core MVC uses for controller requests and responses.
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static string[] Keys(JsonElement obj) =>
        obj.EnumerateObject().Select(p => p.Name).ToArray();

    private static RepairIteration SampleIteration() => new()
    {
        Iteration = 1,
        Prompt = "fix it",
        RawResponse = "```python\nx = 1\n```",
        CritiqueText = null,
        FilesBefore = [new GeneratedCodeFile { Name = "main.py", Path = "main.py", Content = "x =" }],
        FilesAfter = [new GeneratedCodeFile { Name = "main.py", Path = "main.py", Content = "x = 1" }],
        Verification = new VerificationResult { GatePassed = true, Complete = true, PrimaryState = "PASS" },
        VerificationComplete = true,
        Transition = new IterationTransition { From = "A", To = "PASS", Available = true, Failure = null },
        CategoriesBefore = ["A.1"],
        CategoriesAfter = [],
        Introduced = [],
        Resolved = ["A.1"],
        DurationMs = 42,
    };

    private static RepairResult SampleResult() => new()
    {
        EffectiveConfig = new EffectiveRepairConfig { RepairMode = "dou", K = 2, Temperature = 0.1 },
        IterationsPerformed = 1,
        Initial = new VerificationResult { PrimaryState = "A" },
        Iterations = [SampleIteration()],
        RepairSuccess = RepairSuccessValues.Repaired,
        PassedByIteration = [true, true],
        BugCounts = new BugCounts { FoundInitially = 1, Resolved = 1, Remaining = 0, Introduced = 0 },
        Transitions = [new RepairTransition { Iteration = 1, From = "A", To = "PASS", Count = 1, Available = true }],
        IncompleteVerifications = [IncompleteVerification.Initial, IncompleteVerification.ForIteration(2)],
        FinalFiles = [new GeneratedCodeFile { Name = "main.py", Path = "main.py", Content = "x = 1" }],
    };

    [Fact]
    public void RepairSessionView_SerializesToFrontendCamelCaseKeys()
    {
        var view = new RepairSessionView
        {
            SessionId = "s1",
            Status = RepairSessionStatus.Completed,
            EffectiveConfig = new EffectiveRepairConfig(),
            IterationsCompleted = 1,
            Partial = new RepairPartialResult { Initial = new VerificationResult(), Iterations = [SampleIteration()] },
            Result = SampleResult(),
            Error = new RepairSessionError { Operation = "repair", Reason = "provider returned 500" },
        };

        foreach (var options in new[] { Web, JsonSerializerOptions.Default })
        {
            using var doc = JsonDocument.Parse(JsonSerializer.Serialize(view, options));
            var root = doc.RootElement;

            Assert.Equal(
                new[] { "sessionId", "status", "effectiveConfig", "iterationsCompleted", "partial", "result", "error" },
                Keys(root));
            Assert.Equal("completed", root.GetProperty("status").GetString());
            Assert.Equal(new[] { "repairMode", "k", "temperature" }, Keys(root.GetProperty("effectiveConfig")));
            Assert.Equal(new[] { "initial", "iterations" }, Keys(root.GetProperty("partial")));
            Assert.Equal(new[] { "operation", "reason" }, Keys(root.GetProperty("error")));

            var result = root.GetProperty("result");
            Assert.Equal(
                new[] { "effectiveConfig", "iterationsPerformed", "initial", "iterations", "repairSuccess",
                        "passedByIteration", "bugCounts", "transitions", "incompleteVerifications", "finalFiles" },
                Keys(result));
            Assert.Equal("repaired", result.GetProperty("repairSuccess").GetString());
            Assert.Equal(
                new[] { "foundInitially", "resolved", "remaining", "introduced" },
                Keys(result.GetProperty("bugCounts")));
            Assert.Equal(
                new[] { "iteration", "from", "to", "count", "available" },
                Keys(result.GetProperty("transitions")[0]));

            var iteration = result.GetProperty("iterations")[0];
            Assert.Equal(
                new[] { "iteration", "prompt", "rawResponse", "critiqueText", "noExtractableCode", "filesBefore",
                        "filesAfter", "verification", "verificationComplete", "transition", "categoriesBefore",
                        "categoriesAfter", "introduced", "resolved", "durationMs" },
                Keys(iteration));
            Assert.Equal(JsonValueKind.Null, iteration.GetProperty("critiqueText").ValueKind);
            var transition = iteration.GetProperty("transition");
            Assert.Equal(new[] { "from", "to", "available", "failure" }, Keys(transition));
            Assert.Equal(JsonValueKind.Null, transition.GetProperty("failure").ValueKind);
        }
    }

    [Fact]
    public void RunningSessionView_WritesNullsForMissingResultAndError()
    {
        var json = JsonSerializer.Serialize(new RepairSessionView { SessionId = "s2" }, Web);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal("running", root.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("partial").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("result").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("error").ValueKind);
    }

    [Fact]
    public void NotApplicableResult_WritesNullPassedByIteration()
    {
        var json = JsonSerializer.Serialize(new RepairResult { PassedByIteration = null }, Web);
        using var doc = JsonDocument.Parse(json);

        Assert.Equal("not_applicable", doc.RootElement.GetProperty("repairSuccess").GetString());
        Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("passedByIteration").ValueKind);
    }

    [Fact]
    public void IncompleteVerifications_RoundTripsInitialAndIterationNumbers()
    {
        var json = JsonSerializer.Serialize(SampleResult(), Web);
        using (var doc = JsonDocument.Parse(json))
        {
            Assert.Equal("[\"initial\",2]", doc.RootElement.GetProperty("incompleteVerifications").GetRawText());
        }

        var back = JsonSerializer.Deserialize<RepairResult>(json, Web)!;
        Assert.Equal(
            new[] { IncompleteVerification.Initial, IncompleteVerification.ForIteration(2) },
            back.IncompleteVerifications);
        Assert.True(back.IncompleteVerifications[0].IsInitial);
        Assert.Equal(2, back.IncompleteVerifications[1].IterationNumber);
    }

    [Theory]
    [InlineData("\"iteration\"")]
    [InlineData("0")]
    [InlineData("1.5")]
    [InlineData("null")]
    public void IncompleteVerification_RejectsOtherValues(string value)
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<List<IncompleteVerification>>($"[{value}]", Web));
    }

    [Fact]
    public void CreateRepairSessionResponse_SerializesSessionIdAndEffectiveConfig()
    {
        var json = JsonSerializer.Serialize(
            new CreateRepairSessionResponse { SessionId = "abc", EffectiveConfig = new EffectiveRepairConfig() },
            JsonSerializerOptions.Default);
        using var doc = JsonDocument.Parse(json);

        Assert.Equal(new[] { "sessionId", "effectiveConfig" }, Keys(doc.RootElement));
        var config = doc.RootElement.GetProperty("effectiveConfig");
        Assert.Equal("dou", config.GetProperty("repairMode").GetString());
        Assert.Equal(2, config.GetProperty("k").GetInt32());
        Assert.Equal(0.1, config.GetProperty("temperature").GetDouble());
    }

    private const string RequestPrefix =
        """{"files":[{"name":"main.py","path":"main.py","content":"x = 1"}],"originalPrompt":"p","apiSettings":{"provider":"groq","apiKey":"","model":"m"}""";

    [Fact]
    public void RepairSessionRequest_OmittedSettingsBindAsNull()
    {
        var req = JsonSerializer.Deserialize<RepairSessionRequest>(RequestPrefix + "}", Web)!;

        Assert.Equal("p", req.OriginalPrompt);
        Assert.Equal("main.py", Assert.Single(req.Files).Path);
        Assert.Equal("m", req.ApiSettings.Model);
        Assert.Null(req.RepairMode);
        Assert.Null(req.K);
        Assert.Null(req.Temperature);
    }

    [Fact]
    public void RepairSessionRequest_JsonNullSettingsBindAsNull()
    {
        var req = JsonSerializer.Deserialize<RepairSessionRequest>(
            RequestPrefix + ""","repairMode":null,"k":null,"temperature":null}""", Web)!;

        Assert.Null(req.RepairMode);
        Assert.Null(req.K);
        Assert.Null(req.Temperature);
    }

    [Fact]
    public void RepairSessionRequest_NumbersBindAsRawNumbers()
    {
        var req = JsonSerializer.Deserialize<RepairSessionRequest>(
            RequestPrefix + ""","repairMode":5,"k":3,"temperature":0.5}""", Web)!;

        Assert.Equal(JsonValueKind.Number, req.RepairMode!.Value.ValueKind);
        Assert.Equal(3, req.K!.Value.GetInt32());
        Assert.Equal(0.5, req.Temperature!.Value.GetDouble());
    }

    [Fact]
    public void RepairSessionRequest_StringsBindAsRawStrings()
    {
        var req = JsonSerializer.Deserialize<RepairSessionRequest>(
            RequestPrefix + ""","repairMode":"Dou","k":"2","temperature":"0.1"}""", Web)!;

        // Wrong types reach the validator untouched instead of failing model binding (Req. 22.4).
        Assert.Equal("Dou", req.RepairMode!.Value.GetString());
        Assert.Equal(JsonValueKind.String, req.K!.Value.ValueKind);
        Assert.Equal("2", req.K.Value.GetString());
        Assert.Equal("0.1", req.Temperature!.Value.GetString());
    }

    [Fact]
    public void RepairSessionRequest_OtherJsonKindsBindAsRaw()
    {
        var req = JsonSerializer.Deserialize<RepairSessionRequest>(
            RequestPrefix + ""","repairMode":["dou"],"k":true,"temperature":{"v":1}}""", Web)!;

        Assert.Equal(JsonValueKind.Array, req.RepairMode!.Value.ValueKind);
        Assert.Equal(JsonValueKind.True, req.K!.Value.ValueKind);
        Assert.Equal(JsonValueKind.Object, req.Temperature!.Value.ValueKind);
    }
}
