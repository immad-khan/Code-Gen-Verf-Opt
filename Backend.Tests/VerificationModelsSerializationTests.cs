using System.Text.Json;
using Backend.Models;

namespace Backend.Tests;

/// <summary>
/// The web verification DTOs must serialize to the exact camelCase shapes declared in
/// src/api/types.ts, and the verify_cli DTOs must read tivr's snake_case JSON.
/// </summary>
public class VerificationModelsSerializationTests
{
    // Same defaults ASP.NET Core MVC uses for controller responses.
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static string[] Keys(JsonElement obj) =>
        obj.EnumerateObject().Select(p => p.Name).ToArray();

    private static VerificationResult Sample() => new()
    {
        Techniques =
        [
            new TechniqueStatus { Id = "syntax", Name = "Syntax", Status = "pass", Complete = true, Details = "" },
        ],
        CorrectnessFindings =
        [
            new MappedFinding
            {
                Technique = "tests", Signal = "runtime:KeyError", Message = "'k'", Evidence = "KeyError: 'k'",
                Category = "B.3", PrimaryType = "B", CategoryName = "Index/Key Error",
                RepairHint = "check keys", Confidence = 0.9, Occurrences = 2,
                // Exception and Location left null: nulls must be written, not omitted.
            },
        ],
        AdvisoryFindings = [new AdvisoryFinding { Technique = "quality", Message = "complex" }],
        GatePassed = false,
        Complete = true,
        PrimaryState = "B",
        TestsPassed = 3,
        TestsFailed = 2,
        DurationMs = 1234,
    };

    [Fact]
    public void VerificationResult_SerializesToFrontendCamelCaseKeys()
    {
        // Both MVC web defaults and plain default options produce the same shape.
        foreach (var options in new[] { Web, JsonSerializerOptions.Default })
        {
            using var doc = JsonDocument.Parse(JsonSerializer.Serialize(Sample(), options));
            var root = doc.RootElement;

            Assert.Equal(
                new[] { "techniques", "correctnessFindings", "advisoryFindings", "gatePassed", "complete",
                        "incompleteTechniques", "primaryState", "testsPassed", "testsFailed", "durationMs" },
                Keys(root));
            Assert.Equal(
                new[] { "id", "name", "status", "complete", "details" },
                Keys(root.GetProperty("techniques")[0]));

            var finding = root.GetProperty("correctnessFindings")[0];
            Assert.Equal(
                new[] { "technique", "signal", "exception", "message", "evidence", "location", "category",
                        "primaryType", "categoryName", "repairHint", "confidence", "occurrences" },
                Keys(finding));
            Assert.Equal(JsonValueKind.Null, finding.GetProperty("exception").ValueKind);
            Assert.Equal(JsonValueKind.Null, finding.GetProperty("location").ValueKind);

            var advisory = root.GetProperty("advisoryFindings")[0];
            Assert.Equal(new[] { "technique", "message", "file", "line" }, Keys(advisory));
            Assert.Equal(JsonValueKind.Null, advisory.GetProperty("line").ValueKind);

            Assert.Equal(JsonValueKind.Array, root.GetProperty("incompleteTechniques").ValueKind);
            Assert.Equal("B", root.GetProperty("primaryState").GetString());
        }
    }

    [Fact]
    public void MappedFindingLocation_SerializesFileAndLine()
    {
        var json = JsonSerializer.Serialize(
            new MappedFinding { Location = new FindingLocation { File = "main.py", Line = 7 } }, Web);
        using var doc = JsonDocument.Parse(json);

        var location = doc.RootElement.GetProperty("location");
        Assert.Equal(new[] { "file", "line" }, Keys(location));
        Assert.Equal("main.py", location.GetProperty("file").GetString());
        Assert.Equal(7, location.GetProperty("line").GetInt32());
    }

    [Fact]
    public void VerifyCliReport_ReadsTivrSnakeCaseJson()
    {
        const string json = """
        {
          "techniques": {
            "syntax": {"status": "pass", "complete": true, "details": ""},
            "imports": {"status": "pass", "complete": true, "details": ""},
            "tests": {"status": "fail", "complete": true, "details": "1 failed"},
            "runtime": {"status": "error", "complete": false, "details": "timeout"}
          },
          "correctness": [
            {"technique": "tests", "severity": "blocking", "signal": "functional:logic",
             "message": "assert 1 == 2", "evidence": "E   assert 1 == 2", "exception": "AssertionError",
             "location": {"file": "test_main.py", "line": 4}, "test_id": "test_main.py::test_f",
             "occurrences": 3, "values": [{"input": "(1,)", "actual": "1", "expected": null}]}
          ],
          "tests_passed": 5,
          "tests_failed": 1
        }
        """;

        var report = JsonSerializer.Deserialize<VerifyCliReport>(json)!;

        Assert.Equal(new[] { "syntax", "imports", "tests", "runtime" }, report.Techniques.Keys);
        Assert.True(report.Techniques["tests"].IsComplete);
        Assert.False(report.Techniques["runtime"].IsComplete);
        Assert.Equal(5, report.TestsPassed);
        Assert.Equal(1, report.TestsFailed);

        var f = Assert.Single(report.Correctness);
        Assert.True(f.IsBlocking);
        Assert.Equal("functional:logic", f.Signal);
        Assert.Equal("AssertionError", f.Exception);
        Assert.Equal("test_main.py", f.Location?.File);
        Assert.Equal(4, f.Location?.Line);
        Assert.Equal("test_main.py::test_f", f.TestId);
        Assert.Equal(3, f.Occurrences);
        var values = Assert.Single(f.Values);
        Assert.Equal("1", values.Actual);
        Assert.Null(values.Expected);
    }

    [Fact]
    public void VerifyCliTechniqueStatus_CompleteDerivedFromStatusWhenOmitted()
    {
        var ok = JsonSerializer.Deserialize<VerifyCliTechniqueStatus>("""{"status": "skipped_upstream"}""")!;
        var err = JsonSerializer.Deserialize<VerifyCliTechniqueStatus>("""{"status": "error"}""")!;

        Assert.True(ok.IsComplete);
        Assert.False(err.IsComplete);
    }
}
