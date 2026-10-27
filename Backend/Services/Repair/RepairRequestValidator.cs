using System.Text.Json;
using Backend.Models;

namespace Backend.Services.Repair;

/// <summary>
/// Outcome of <see cref="RepairRequestValidator.Validate"/>: either the effective repair
/// settings (defaults applied) or every invalid field.
/// </summary>
public sealed class RepairRequestValidationResult
{
    /// <summary>Effective settings; null when validation failed.</summary>
    public EffectiveRepairConfig? Config { get; }

    /// <summary>One entry per invalid field, in the order repairMode, k, temperature.</summary>
    public IReadOnlyList<InvalidField> Errors { get; }

    public bool IsValid => Errors.Count == 0;

    private RepairRequestValidationResult(EffectiveRepairConfig? config, IReadOnlyList<InvalidField> errors)
    {
        Config = config;
        Errors = errors;
    }

    internal static RepairRequestValidationResult Valid(EffectiveRepairConfig config) => new(config, []);

    internal static RepairRequestValidationResult Invalid(IReadOnlyList<InvalidField> errors) => new(null, errors);

    /// <summary>400 body <c>{error, invalidFields}</c>; the error message names every invalid field.</summary>
    public ApiValidationErrorBody ToErrorBody() => new()
    {
        Error = $"Invalid repair settings: {string.Join(", ", Errors.Select(e => e.Field))}",
        InvalidFields = Errors.ToList(),
    };
}

/// <summary>
/// Validates the repair settings of a <see cref="RepairSessionRequest"/> (Req. 22.1–22.4).
/// <list type="bullet">
/// <item><c>repairMode</c>: a JSON string equal (ordinal, case-sensitive) to one of <see cref="RepairModes.All"/>.</item>
/// <item><c>k</c>: a JSON number with an integral value from 1 to 3. JSON does not distinguish
/// <c>2</c> from <c>2.0</c> (and JavaScript serializes both as <c>2</c>), so a number literal such as
/// <c>2.0</c> or <c>2e0</c> is accepted as the integer 2; <c>2.5</c> is non-integer and rejected.</item>
/// <item><c>temperature</c>: a finite JSON number from 0.0 to 1.0 inclusive.</item>
/// </list>
/// Strings, booleans, arrays, and objects are rejected for every field (no coercion, e.g. <c>"2"</c>).
/// An omitted field or JSON <c>null</c> takes the default from <see cref="RepairDefaults"/>.
/// All invalid fields are reported, not just the first.
/// </summary>
public static class RepairRequestValidator
{
    public const string RepairModeField = "repairMode";
    public const string KField = "k";
    public const string TemperatureField = "temperature";

    public static RepairRequestValidationResult Validate(RepairSessionRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return Validate(request.RepairMode, request.K, request.Temperature);
    }

    public static RepairRequestValidationResult Validate(JsonElement? repairMode, JsonElement? k, JsonElement? temperature)
    {
        var errors = new List<InvalidField>();

        var mode = ValidateRepairMode(repairMode, errors);
        var kValue = ValidateK(k, errors);
        var temp = ValidateTemperature(temperature, errors);

        if (errors.Count > 0)
            return RepairRequestValidationResult.Invalid(errors);

        return RepairRequestValidationResult.Valid(new EffectiveRepairConfig
        {
            RepairMode = mode!,
            K = kValue!.Value,
            Temperature = temp!.Value,
        });
    }

    /// <summary>Omitted (C# null / Undefined) or JSON null → use the default.</summary>
    private static bool IsAbsent(JsonElement? value) =>
        value is null || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    private static string? ValidateRepairMode(JsonElement? value, List<InvalidField> errors)
    {
        if (IsAbsent(value)) return RepairDefaults.RepairMode;

        var allowed = string.Join(", ", RepairModes.All);
        if (value!.Value.ValueKind != JsonValueKind.String)
        {
            errors.Add(new(RepairModeField, $"repairMode must be a string, one of: {allowed}."));
            return null;
        }

        var mode = value.Value.GetString();
        if (mode is null || !RepairModes.All.Contains(mode, StringComparer.Ordinal))
        {
            errors.Add(new(RepairModeField, $"repairMode '{mode}' is not supported; expected one of (case-sensitive): {allowed}."));
            return null;
        }
        return mode;
    }

    private static int? ValidateK(JsonElement? value, List<InvalidField> errors)
    {
        if (IsAbsent(value)) return RepairDefaults.K;

        var range = $"{RepairDefaults.MinK} to {RepairDefaults.MaxK}";
        if (value!.Value.ValueKind != JsonValueKind.Number)
        {
            errors.Add(new(KField, $"k must be an integer from {range}."));
            return null;
        }

        if (!value.Value.TryGetDouble(out var d) || !double.IsFinite(d))
        {
            errors.Add(new(KField, $"k must be an integer from {range}."));
            return null;
        }
        if (d != Math.Floor(d))
        {
            errors.Add(new(KField, $"k must be an integer (got {value.Value.GetRawText()})."));
            return null;
        }
        if (d < RepairDefaults.MinK || d > RepairDefaults.MaxK)
        {
            errors.Add(new(KField, $"k must be from {range} (got {value.Value.GetRawText()})."));
            return null;
        }
        return (int)d;
    }

    private static double? ValidateTemperature(JsonElement? value, List<InvalidField> errors)
    {
        if (IsAbsent(value)) return RepairDefaults.Temperature;

        var range = FormattableString.Invariant($"{RepairDefaults.MinTemperature:0.0} to {RepairDefaults.MaxTemperature:0.0}");
        if (value!.Value.ValueKind != JsonValueKind.Number
            || !value.Value.TryGetDouble(out var t) || !double.IsFinite(t))
        {
            errors.Add(new(TemperatureField, $"temperature must be a number from {range}."));
            return null;
        }
        if (t < RepairDefaults.MinTemperature || t > RepairDefaults.MaxTemperature)
        {
            errors.Add(new(TemperatureField, $"temperature must be from {range} (got {value.Value.GetRawText()})."));
            return null;
        }
        return t + 0.0; // normalizes -0.0 to 0.0
    }
}
