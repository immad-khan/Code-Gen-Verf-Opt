using System.Globalization;
using System.Text.Json;
using Backend.Models;
using Backend.Services.Repair;

namespace Backend.Tests;

/// <summary>RepairRequestValidator (Requirements 22.1–22.4).</summary>
public class RepairRequestValidatorTests
{
    /// <summary>Deserializes a request body the same way the controller binds it.</summary>
    private static RepairSessionRequest Parse(string settingsJson)
    {
        var body = "{\"files\":[],\"originalPrompt\":\"p\",\"apiSettings\":{}" +
                   (settingsJson.Length > 0 ? "," + settingsJson : "") + "}";
        return JsonSerializer.Deserialize<RepairSessionRequest>(body)!;
    }

    private static RepairRequestValidationResult Validate(string settingsJson) =>
        RepairRequestValidator.Validate(Parse(settingsJson));

    private static void AssertDefaults(RepairRequestValidationResult r)
    {
        Assert.True(r.IsValid);
        Assert.Empty(r.Errors);
        Assert.NotNull(r.Config);
        Assert.Equal("dou", r.Config!.RepairMode);
        Assert.Equal(2, r.Config.K);
        Assert.Equal(0.1, r.Config.Temperature);
    }

    private static void AssertInvalidFields(RepairRequestValidationResult r, params string[] fields)
    {
        Assert.False(r.IsValid);
        Assert.Null(r.Config);
        Assert.Equal(fields, r.Errors.Select(e => e.Field).ToArray());
        Assert.All(r.Errors, e => Assert.Contains(e.Field, e.Message));
    }

    // ── Defaults (22.1, 22.2, 22.3) ──────────────────────────────────────────

    [Fact]
    public void Omitted_fields_use_defaults() => AssertDefaults(Validate(""));

    [Fact]
    public void Json_null_fields_use_defaults() =>
        AssertDefaults(Validate("\"repairMode\":null,\"k\":null,\"temperature\":null"));

    [Fact]
    public void Csharp_null_and_undefined_elements_use_defaults()
    {
        AssertDefaults(RepairRequestValidator.Validate(null, null, null));
        AssertDefaults(RepairRequestValidator.Validate(default(JsonElement), default(JsonElement), default(JsonElement)));
    }

    [Fact]
    public void Defaults_apply_per_field()
    {
        var r = Validate("\"k\":3");
        Assert.True(r.IsValid);
        Assert.Equal("dou", r.Config!.RepairMode);
        Assert.Equal(3, r.Config.K);
        Assert.Equal(0.1, r.Config.Temperature);
    }

    // ── repairMode (22.1, 22.4) ──────────────────────────────────────────────

    [Theory]
    [InlineData("dou")]
    [InlineData("dou_no_bt")]
    [InlineData("generic")]
    [InlineData("evidence_only")]
    [InlineData("taxonomy_only")]
    [InlineData("full")]
    public void Each_of_the_six_modes_is_accepted(string mode)
    {
        var r = Validate($"\"repairMode\":\"{mode}\"");
        Assert.True(r.IsValid);
        Assert.Equal(mode, r.Config!.RepairMode);
    }

    [Theory]
    [InlineData("\"intervenor\"")]
    [InlineData("\"dou_intervenor\"")]
    [InlineData("\"Dou\"")]
    [InlineData("\"DOU\"")]
    [InlineData("\"Full\"")]
    [InlineData("\" dou\"")]
    [InlineData("\"\"")]
    [InlineData("1")]
    [InlineData("true")]
    [InlineData("[\"dou\"]")]
    [InlineData("{}")]
    public void Unsupported_or_non_string_modes_are_rejected(string modeJson) =>
        AssertInvalidFields(Validate($"\"repairMode\":{modeJson}"), "repairMode");

    // ── k (22.2, 22.4) ───────────────────────────────────────────────────────

    [Theory]
    [InlineData("1", 1)]
    [InlineData("2", 2)]
    [InlineData("3", 3)]
    [InlineData("2.0", 2)] // integral JSON number: accepted (JSON/JS do not distinguish 2 and 2.0)
    [InlineData("3e0", 3)]
    public void Integer_k_in_range_is_accepted(string kJson, int expected)
    {
        var r = Validate($"\"k\":{kJson}");
        Assert.True(r.IsValid);
        Assert.Equal(expected, r.Config!.K);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("4")]
    [InlineData("-1")]
    [InlineData("1.5")]
    [InlineData("2.0001")]
    [InlineData("1e400")]
    [InlineData("99999999999999999999")]
    [InlineData("\"2\"")]
    [InlineData("true")]
    [InlineData("[2]")]
    [InlineData("{}")]
    public void Invalid_k_is_rejected(string kJson) =>
        AssertInvalidFields(Validate($"\"k\":{kJson}"), "k");

    // ── temperature (22.3, 22.4) ─────────────────────────────────────────────

    [Theory]
    [InlineData("0", 0.0)]
    [InlineData("0.0", 0.0)]
    [InlineData("-0.0", 0.0)]
    [InlineData("0.1", 0.1)]
    [InlineData("0.7", 0.7)]
    [InlineData("1", 1.0)]
    [InlineData("1.0", 1.0)]
    [InlineData("5e-1", 0.5)]
    public void Numeric_temperature_in_range_is_accepted(string tJson, double expected)
    {
        var r = Validate($"\"temperature\":{tJson}");
        Assert.True(r.IsValid);
        Assert.Equal(expected, r.Config!.Temperature);
        Assert.False(double.IsNegative(r.Config.Temperature));
    }

    [Theory]
    [InlineData("-0.1")]
    [InlineData("1.0000001")]
    [InlineData("2")]
    [InlineData("1e400")]
    [InlineData("\"0.5\"")]
    [InlineData("false")]
    [InlineData("[0.5]")]
    [InlineData("{}")]
    public void Invalid_temperature_is_rejected(string tJson) =>
        AssertInvalidFields(Validate($"\"temperature\":{tJson}"), "temperature");

    // ── All errors reported (22.4) ───────────────────────────────────────────

    [Fact]
    public void Every_invalid_field_is_reported()
    {
        var r = Validate("\"repairMode\":\"intervenor\",\"k\":5,\"temperature\":\"hot\"");
        AssertInvalidFields(r, "repairMode", "k", "temperature");

        var body = r.ToErrorBody();
        Assert.Contains("repairMode", body.Error);
        Assert.Contains("k", body.Error);
        Assert.Contains("temperature", body.Error);
        Assert.Equal(3, body.InvalidFields.Count);
    }

    [Fact]
    public void Only_invalid_fields_are_reported()
    {
        var r = Validate("\"repairMode\":\"full\",\"k\":1.5,\"temperature\":2");
        AssertInvalidFields(r, "k", "temperature");
        Assert.DoesNotContain("repairMode", r.ToErrorBody().Error);
    }

    [Fact]
    public void Error_body_serializes_to_frontend_envelope()
    {
        var json = JsonSerializer.Serialize(Validate("\"k\":0").ToErrorBody());
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.Equal(JsonValueKind.String, root.GetProperty("error").ValueKind);
        var field = Assert.Single(root.GetProperty("invalidFields").EnumerateArray());
        Assert.Equal("k", field.GetProperty("field").GetString());
        Assert.Contains("k", field.GetProperty("message").GetString());
    }

    // ── Exhaustive sweep over valid combinations ─────────────────────────────

    [Fact]
    public void Every_valid_combination_round_trips_to_effective_config()
    {
        foreach (var mode in RepairModes.All)
        for (var k = RepairDefaults.MinK; k <= RepairDefaults.MaxK; k++)
        for (var step = 0; step <= 10; step++)
        {
            var t = step / 10.0;
            var tJson = t.ToString("R", CultureInfo.InvariantCulture);
            var r = Validate($"\"repairMode\":\"{mode}\",\"k\":{k},\"temperature\":{tJson}");
            Assert.True(r.IsValid, $"{mode}/{k}/{tJson}");
            Assert.Equal(mode, r.Config!.RepairMode);
            Assert.Equal(k, r.Config.K);
            Assert.Equal(t, r.Config.Temperature);
        }
    }
}
