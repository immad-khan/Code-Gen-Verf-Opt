using System.Collections.ObjectModel;
using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Backend.Services.Taxonomy;

/// <summary>
/// The definition file is missing, unreadable, or invalid (Req. 7.7).
/// Formatted as <c>&lt;file&gt;: &lt;json-path&gt;: &lt;reason&gt;</c>, identical to Python's
/// <c>TaxonomyLoadError</c>.
/// </summary>
public sealed class TaxonomyLoadException : Exception
{
    public TaxonomyLoadException(string file, string jsonPath, string reason)
        : base($"{file}: {jsonPath}: {reason}")
    {
        File = file;
        JsonPath = jsonPath;
        Reason = reason;
    }

    public string File { get; }
    public string JsonPath { get; }
    public string Reason { get; }
}

/// <summary>
/// Loads and validates the shared Taxonomy_Definition in the fixed order of
/// design §1 "Loader validation" (port of <c>tivr/taxonomy_def.py</c>; the first
/// failure wins and nothing is returned unless every step passes):
/// <list type="number">
/// <item>file missing / unreadable / invalid JSON (duplicate keys rejected)</item>
/// <item><c>schema == "maci.taxonomy"</c> and supported <c>version</c></item>
/// <item>required fields present with correct types</item>
/// <item>exactly the 12 category IDs, unique; priorities a permutation of 1..12, A &lt; B &lt; C</item>
/// <item>primary types A–D; D, C.2, C.4 not auto-assignable with a reason; hints non-empty</item>
/// <item>checklist has exactly 10 items</item>
/// <item>rules: unique ID, auto-assignable defined target (never D), confidence in [0, 1],
/// at least one condition, regexes in the portable subset and compiling</item>
/// <item>required prompt templates present; declared variables appear in their text</item>
/// </list>
/// </summary>
public static class TaxonomyDefinitionLoader
{
    public const string SchemaId = "maci.taxonomy";
    public static readonly IReadOnlyList<string> SupportedVersions = ["1.0.0"];

    public static readonly IReadOnlyList<string> CategoryIds =
    [
        "A.1", "A.2", "A.3",
        "B.1", "B.2", "B.3", "B.4", "B.5",
        "C.1", "C.2", "C.3", "C.4",
    ];

    public static readonly IReadOnlyList<string> PrimaryIds = ["A", "B", "C", "D"];
    public static readonly IReadOnlyList<string> CategoryPrimaries = ["A", "B", "C"];
    public static readonly IReadOnlyList<string> NotAutoAssignable = ["C.2", "C.4"];  // Req. 10.7, 10.8
    public const string NotAutoPrimary = "D";                                          // Req. 7.2
    public const int ChecklistLength = 10;                                             // Req. 7.3
    public static readonly IReadOnlyList<string> DouFeedbackKeys = ["functional", "timeout", "no_code"];

    public static readonly IReadOnlyList<string> RequiredPrompts =
    [
        "dou_generation", "tivr_generation", "dou_critique", "tivr_repair",
        "generic_repair", "diagnosis_line", "guidance_line", "evidence_line",
        "lessons_header", "lesson", "web_repair_system",
    ];

    /// <summary>Allowed keys inside a rule's <c>match</c> object, sorted (used in the reason text).</summary>
    public static readonly IReadOnlyList<string> MatchKeys = ["ignore_case", "message", "signal", "technique"];

    /// <summary>Match timeout applied to every rule regex.</summary>
    public static readonly TimeSpan MatchTimeout = TimeSpan.FromMilliseconds(100);

    /// <summary>Placeholder grammar shared with the template renderer (design §1).</summary>
    public static readonly Regex PlaceholderRegex =
        new(@"\{([^{}\r\n]+)\}", RegexOptions.CultureInvariant);

    /// <summary>Load and validate; throws <see cref="TaxonomyLoadException"/> on the first failure.</summary>
    public static TaxonomyDefinition Load(string path) => new Validator(path).Run();

    /// <summary>
    /// Return a reason if <paramref name="pattern"/> leaves the portable regex
    /// subset, else null (identical to Python's <c>check_regex_subset</c>).
    /// Allowed: ASCII literals, character classes, <c>\d \s \w</c> (and their
    /// negations), escaped punctuation, groups, alternation, <c>? * +</c>,
    /// <c>{m,n}</c>. Rejected: any <c>(?</c> construct, letter/digit escapes
    /// other than the class escapes, possessive quantifiers, non-ASCII.
    /// </summary>
    public static string? CheckRegexSubset(string pattern)
    {
        int i = 0, n = pattern.Length;
        bool inClass = false;
        int classStart = -1;
        bool prevQuant = false;
        while (i < n)
        {
            char c = pattern[i];
            if (c > 127)
                return $"non-ASCII character {PyRepr(c.ToString())} at offset {i}";
            if (c == '\\')
            {
                if (i + 1 >= n)
                    return "trailing backslash";
                char e = pattern[i + 1];
                if (e > 127)
                    return $"non-ASCII character {PyRepr(e.ToString())} at offset {i + 1}";
                if (char.IsAsciiLetterOrDigit(e) && "dswDSW".IndexOf(e) < 0)
                    return $"unsupported escape '\\{e}' at offset {i}";
                i += 2;
                prevQuant = false;
                continue;
            }
            if (inClass)
            {
                // ']' directly after '[' or '[^' is a literal in both engines
                if (c == ']' && i > classStart)
                    inClass = false;
                i += 1;
                continue;
            }
            if (c == '[')
            {
                inClass = true;
                classStart = i + 1;
                if (classStart < n && pattern[classStart] == '^')
                    classStart += 1;
                i += 1;
                prevQuant = false;
                continue;
            }
            if (c == '(' && i + 1 < n && pattern[i + 1] == '?')
                return $"unsupported group construct '(?' at offset {i}";
            if (c == '+' && prevQuant)
                return $"possessive quantifier at offset {i}";
            prevQuant = "*+?}".IndexOf(c) >= 0;
            if (c == '?' && i > 0 && "*+?}".IndexOf(pattern[i - 1]) >= 0)
                prevQuant = false;  // lazy marker, not a quantifier itself
            i += 1;
        }
        return null;
    }

    // ---- Python-compatible text helpers (reason texts match tivr) -------

    /// <summary>Approximation of Python's <c>repr(str)</c>.</summary>
    internal static string PyRepr(string s)
    {
        char quote = s.Contains('\'') && !s.Contains('"') ? '"' : '\'';
        var sb = new StringBuilder(s.Length + 2);
        sb.Append(quote);
        foreach (char c in s)
        {
            if (c == quote || c == '\\') sb.Append('\\').Append(c);
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            else if (c < 0x20 || c == 0x7f) sb.Append("\\x").Append(((int)c).ToString("x2", CultureInfo.InvariantCulture));
            else sb.Append(c);
        }
        sb.Append(quote);
        return sb.ToString();
    }

    /// <summary>Python <c>str.isspace</c> for a single UTF-16 unit.</summary>
    internal static bool IsPyWhitespace(char c) =>
        char.IsWhiteSpace(c) || (c >= '\x1c' && c <= '\x1f');

    /// <summary>Python <c>not s.strip()</c>.</summary>
    internal static bool IsBlank(string s)
    {
        foreach (char c in s)
            if (!IsPyWhitespace(c)) return false;
        return true;
    }

    // ---- validation ------------------------------------------------------

    private enum JType { String, Boolean, Array, Object, Integer, Number }

    private sealed class Validator(string file)
    {
        private readonly string _file = file;

        private TaxonomyLoadException Fail(string jsonPath, string reason) =>
            new(_file, jsonPath, reason);

        // -- step 3 helpers ------------------------------------------------

        private static string TypeName(JType t) => t switch
        {
            JType.String => "a string",
            JType.Boolean => "a boolean",
            JType.Array => "an array",
            JType.Object => "an object",
            JType.Integer => "an integer",
            _ => "a number",
        };

        private static bool IsIntegerToken(JsonElement v)
        {
            if (v.ValueKind != JsonValueKind.Number) return false;
            var raw = v.GetRawText();
            return raw.IndexOfAny(['.', 'e', 'E']) < 0;
        }

        private JsonElement Typed(JsonElement value, JType t, string path)
        {
            bool ok = t switch
            {
                JType.String => value.ValueKind == JsonValueKind.String,
                JType.Boolean => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
                JType.Array => value.ValueKind == JsonValueKind.Array,
                JType.Object => value.ValueKind == JsonValueKind.Object,
                JType.Integer => IsIntegerToken(value),
                _ => value.ValueKind == JsonValueKind.Number,
            };
            if (!ok)
                throw Fail(path, $"must be {TypeName(t)}");
            return value;
        }

        private JsonElement Req(JsonElement obj, string key, JType t, string path)
        {
            var p = $"{path}.{key}";
            if (!obj.TryGetProperty(key, out var value))
                throw Fail(p, "required field missing");
            return Typed(value, t, p);
        }

        private JsonElement? Opt(JsonElement obj, string key, JType t, string path)
        {
            if (!obj.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null)
                return null;
            return Typed(value, t, $"{path}.{key}");
        }

        private void StrList(JsonElement obj, string key, string path, bool required = true)
        {
            JsonElement? items = required ? Req(obj, key, JType.Array, path) : Opt(obj, key, JType.Array, path);
            if (items is null) return;
            int i = 0;
            foreach (var item in items.Value.EnumerateArray())
            {
                Typed(item, JType.String, $"{path}.{key}[{i}]");
                i++;
            }
        }

        private List<JsonElement> ObjList(JsonElement root, string key)
        {
            var items = Req(root, key, JType.Array, "$");
            var list = new List<JsonElement>();
            int i = 0;
            foreach (var item in items.EnumerateArray())
            {
                list.Add(Typed(item, JType.Object, $"$.{key}[{i}]"));
                i++;
            }
            return list;
        }

        // -- accessors for already-validated values ------------------------

        private static string Str(JsonElement obj, string key) => obj.GetProperty(key).GetString()!;

        private static string? OptStr(JsonElement obj, string key) =>
            obj.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static bool Bool(JsonElement obj, string key) => obj.GetProperty(key).GetBoolean();

        private static bool OptBool(JsonElement obj, string key) =>
            obj.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.True;

        private static BigInteger BigInt(JsonElement obj, string key) =>
            BigInteger.Parse(obj.GetProperty(key).GetRawText(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);

        private static int ClampInt(BigInteger v) =>
            v > int.MaxValue ? int.MaxValue : v < int.MinValue ? int.MinValue : (int)v;

        private static List<JsonElement> Items(JsonElement root, string key) =>
            root.GetProperty(key).EnumerateArray().ToList();

        private static List<string> Strings(JsonElement arr) =>
            arr.EnumerateArray().Select(e => e.GetString()!).ToList();

        // -- driver --------------------------------------------------------

        public TaxonomyDefinition Run()
        {
            using var doc = Step1Read();
            var root = doc.RootElement;
            Step2SchemaVersion(root);
            Step3Types(root);
            Step4Categories(root);
            Step5PrimariesAndHints(root);
            Step6Checklist(root);
            var rules = Step7Rules(root);
            var prompts = Step8Prompts(root);
            return Build(root, rules, prompts);
        }

        // -- step 1 --------------------------------------------------------

        private JsonDocument Step1Read()
        {
            byte[] raw;
            try
            {
                raw = System.IO.File.ReadAllBytes(_file);
            }
            catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
            {
                throw Fail("$", "file not found");
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                                           or NotSupportedException or ArgumentException)
            {
                throw Fail("$", $"file unreadable: {ex.Message}");
            }

            string text;
            try
            {
                int offset = raw.Length >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF ? 3 : 0;
                text = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true)
                    .GetString(raw, offset, raw.Length - offset);
            }
            catch (DecoderFallbackException ex)
            {
                throw Fail("$", $"file is not valid UTF-8: {ex.Message}");
            }

            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(text, new JsonDocumentOptions
                {
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow,
                });
            }
            catch (JsonException ex)
            {
                throw Fail("$", $"invalid JSON: {JsonErrorText(ex)}");
            }

            try
            {
                RejectDuplicateKeys(doc.RootElement);
                if (doc.RootElement.ValueKind != JsonValueKind.Object)
                    throw Fail("$", "root must be a JSON object");
                return doc;
            }
            catch
            {
                doc.Dispose();
                throw;
            }
        }

        private static string JsonErrorText(JsonException ex)
        {
            var msg = ex.Message;
            int cut = msg.IndexOf(" Path:", StringComparison.Ordinal);
            if (cut < 0) cut = msg.IndexOf(" LineNumber:", StringComparison.Ordinal);
            if (cut >= 0) msg = msg[..cut];
            msg = msg.TrimEnd().TrimEnd('.');
            if (ex.LineNumber is long line && ex.BytePositionInLine is long col)
                msg += $" at line {line + 1} column {col + 1}";
            return msg;
        }

        // Post-order like Python's object_pairs_hook: inner objects are checked
        // before the object that contains them.
        private void RejectDuplicateKeys(JsonElement element)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Object:
                    var seen = new HashSet<string>(StringComparer.Ordinal);
                    string? duplicate = null;
                    foreach (var prop in element.EnumerateObject())
                    {
                        RejectDuplicateKeys(prop.Value);
                        if (!seen.Add(prop.Name) && duplicate is null)
                            duplicate = prop.Name;
                    }
                    if (duplicate is not null)
                        throw Fail("$", $"invalid JSON: duplicate JSON object key {PyRepr(duplicate)}");
                    break;
                case JsonValueKind.Array:
                    foreach (var item in element.EnumerateArray())
                        RejectDuplicateKeys(item);
                    break;
            }
        }

        // -- step 2 --------------------------------------------------------

        private void Step2SchemaVersion(JsonElement root)
        {
            var schema = Req(root, "schema", JType.String, "$").GetString()!;
            if (schema != SchemaId)
                throw Fail("$.schema", $"expected {PyRepr(SchemaId)}, got {PyRepr(schema)}");
            var version = Req(root, "version", JType.String, "$").GetString()!;
            if (!SupportedVersions.Contains(version))
                throw Fail("$.version", $"unsupported version {PyRepr(version)} " +
                                        $"(supported: {string.Join(", ", SupportedVersions.Order(StringComparer.Ordinal))})");
        }

        // -- step 3 --------------------------------------------------------

        private void Step3Types(JsonElement root)
        {
            Opt(root, "source", JType.String, "$");

            int i = 0;
            foreach (var pt in ObjList(root, "primary_types"))
            {
                var p = $"$.primary_types[{i++}]";
                Req(pt, "id", JType.String, p);
                Req(pt, "name", JType.String, p);
                Req(pt, "auto_assignable", JType.Boolean, p);
                Opt(pt, "not_assigned_reason", JType.String, p);
            }

            i = 0;
            foreach (var cat in ObjList(root, "categories"))
            {
                var p = $"$.categories[{i++}]";
                Req(cat, "id", JType.String, p);
                Req(cat, "primary", JType.String, p);
                Req(cat, "name", JType.String, p);
                Req(cat, "priority", JType.Integer, p);
                Req(cat, "auto_assignable", JType.Boolean, p);
                Req(cat, "repair_hint", JType.String, p);
                Opt(cat, "not_assigned_reason", JType.String, p);
            }

            var unmapped = Req(root, "unmapped", JType.Object, "$");
            Req(unmapped, "id", JType.String, "$.unmapped");
            Req(unmapped, "name", JType.String, "$.unmapped");
            Req(unmapped, "priority", JType.Integer, "$.unmapped");
            Req(unmapped, "primary_state", JType.String, "$.unmapped");
            Req(unmapped, "repair_hint", JType.String, "$.unmapped");

            StrList(root, "checklist", "$");

            i = 0;
            foreach (var rule in ObjList(root, "rules"))
            {
                var p = $"$.rules[{i++}]";
                Req(rule, "id", JType.String, p);
                var match = Req(rule, "match", JType.Object, p);
                var mp = $"{p}.match";
                foreach (var prop in match.EnumerateObject())
                {
                    if (!MatchKeys.Contains(prop.Name))
                        throw Fail($"{mp}.{prop.Name}",
                                   $"unknown match condition (allowed: {string.Join(", ", MatchKeys)})");
                }
                StrList(match, "technique", mp, required: false);
                Opt(match, "signal", JType.String, mp);
                Opt(match, "message", JType.String, mp);
                Opt(match, "ignore_case", JType.Boolean, mp);
                Req(rule, "category", JType.String, p);
                Req(rule, "confidence", JType.Number, p);
                StrList(rule, "covers", p, required: false);
            }

            var fb = Req(root, "dou_feedback", JType.Object, "$");
            foreach (var key in DouFeedbackKeys)
                Req(fb, key, JType.String, "$.dou_feedback");
            foreach (var prop in fb.EnumerateObject())
                Typed(prop.Value, JType.String, $"$.dou_feedback.{prop.Name}");

            var prompts = Req(root, "prompts", JType.Object, "$");
            foreach (var prop in prompts.EnumerateObject())
            {
                var p = $"$.prompts.{prop.Name}";
                Typed(prop.Value, JType.Object, p);
                StrList(prop.Value, "variables", p);
                Req(prop.Value, "text", JType.String, p);
                Opt(prop.Value, "optional", JType.Boolean, p);
            }
        }

        // -- step 4 --------------------------------------------------------

        private void Step4Categories(JsonElement root)
        {
            var cats = Items(root, "categories");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < cats.Count; i++)
            {
                var cid = Str(cats[i], "id");
                if (seen.Contains(cid))
                    throw Fail($"$.categories[{i}].id", $"duplicate category ID {PyRepr(cid)}");
                if (!CategoryIds.Contains(cid))
                    throw Fail($"$.categories[{i}].id", $"unknown category ID {PyRepr(cid)} " +
                                                        "(expected exactly A.1-A.3, B.1-B.5, C.1-C.4)");
                seen.Add(cid);
            }
            var missing = CategoryIds.Where(c => !seen.Contains(c)).ToList();
            if (missing.Count > 0)
                throw Fail("$.categories", $"missing category IDs: {string.Join(", ", missing)}");

            var prios = new Dictionary<BigInteger, string>();
            for (int i = 0; i < cats.Count; i++)
            {
                var pr = BigInt(cats[i], "priority");
                if (pr < 1 || pr > CategoryIds.Count)
                    throw Fail($"$.categories[{i}].priority",
                               $"priority {pr} outside 1..{CategoryIds.Count}");
                if (prios.TryGetValue(pr, out var other))
                    throw Fail($"$.categories[{i}].priority",
                               $"duplicate priority {pr} (also used by {other})");
                prios[pr] = Str(cats[i], "id");
            }

            var byPrimary = CategoryPrimaries.ToDictionary(p => p, _ => new List<BigInteger>());
            foreach (var cat in cats)
                byPrimary[Str(cat, "id")[..1]].Add(BigInt(cat, "priority"));
            foreach (var (lo, hi) in new[] { ("A", "B"), ("B", "C") })
            {
                var minHi = byPrimary[hi].Min();
                if (byPrimary[lo].Max() >= minHi)
                {
                    int offender = cats.FindIndex(c => Str(c, "id")[..1] == hi && BigInt(c, "priority") == minHi);
                    throw Fail($"$.categories[{offender}].priority",
                               $"every {lo} category must rank before every {hi} category");
                }
            }

            var um = root.GetProperty("unmapped");
            var umId = Str(um, "id");
            if (seen.Contains(umId))
                throw Fail("$.unmapped.id", $"unmapped ID {PyRepr(umId)} collides with a category ID");
            if (BigInt(um, "priority") <= CategoryIds.Count)
                throw Fail("$.unmapped.priority", $"must rank below every category (> {CategoryIds.Count})");
            if (!CategoryPrimaries.Contains(Str(um, "primary_state")))
                throw Fail("$.unmapped.primary_state", $"must be one of {string.Join(", ", CategoryPrimaries)}");
        }

        // -- step 5 --------------------------------------------------------

        private void Step5PrimariesAndHints(JsonElement root)
        {
            var pts = Items(root, "primary_types");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < pts.Count; i++)
            {
                var id = Str(pts[i], "id");
                if (seen.Contains(id))
                    throw Fail($"$.primary_types[{i}].id", $"duplicate primary type {PyRepr(id)}");
                if (!PrimaryIds.Contains(id))
                    throw Fail($"$.primary_types[{i}].id", $"unknown primary type {PyRepr(id)}");
                if (IsBlank(Str(pts[i], "name")))
                    throw Fail($"$.primary_types[{i}].name", "must be non-empty");
                seen.Add(id);
            }
            var missing = PrimaryIds.Where(p => !seen.Contains(p)).ToList();
            if (missing.Count > 0)
                throw Fail("$.primary_types", $"missing primary types: {string.Join(", ", missing)}");
            for (int i = 0; i < pts.Count; i++)
                CheckAssignability(pts[i], $"$.primary_types[{i}]", Str(pts[i], "id") == NotAutoPrimary);

            var cats = Items(root, "categories");
            for (int i = 0; i < cats.Count; i++)
            {
                var p = $"$.categories[{i}]";
                var id = Str(cats[i], "id");
                if (Str(cats[i], "primary") != id[..1])
                    throw Fail($"{p}.primary", $"category {id} must belong to primary {PyRepr(id[..1])}");
                if (IsBlank(Str(cats[i], "name")))
                    throw Fail($"{p}.name", "must be non-empty");
                CheckAssignability(cats[i], p, NotAutoAssignable.Contains(id));
                if (IsBlank(Str(cats[i], "repair_hint")))
                    throw Fail($"{p}.repair_hint", "repair hint must be non-empty");
            }

            if (IsBlank(Str(root.GetProperty("unmapped"), "repair_hint")))
                throw Fail("$.unmapped.repair_hint", "repair hint must be non-empty");
        }

        private void CheckAssignability(JsonElement entry, string path, bool mustBeManual)
        {
            bool auto = Bool(entry, "auto_assignable");
            if (mustBeManual && auto)
                throw Fail($"{path}.auto_assignable", $"{Str(entry, "id")} must not be automatically assignable");
            if (!auto)
            {
                var reason = OptStr(entry, "not_assigned_reason");
                if (reason is null)
                    throw Fail($"{path}.not_assigned_reason", "required field missing");
                if (IsBlank(reason))
                    throw Fail($"{path}.not_assigned_reason", "reason must be non-empty");
            }
        }

        // -- step 6 --------------------------------------------------------

        private void Step6Checklist(JsonElement root)
        {
            int n = root.GetProperty("checklist").GetArrayLength();
            if (n != ChecklistLength)
                throw Fail("$.checklist", $"must contain exactly {ChecklistLength} items, got {n}");
        }

        // -- step 7 --------------------------------------------------------

        private List<TaxonomyRule> Step7Rules(JsonElement root)
        {
            var cats = Items(root, "categories").ToDictionary(c => Str(c, "id"), StringComparer.Ordinal);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var rules = new List<TaxonomyRule>();
            var items = Items(root, "rules");
            for (int i = 0; i < items.Count; i++)
            {
                var r = items[i];
                var p = $"$.rules[{i}]";
                var rid = Str(r, "id");
                if (IsBlank(rid))
                    throw Fail($"{p}.id", "rule ID must be non-empty");
                if (!seen.Add(rid))
                    throw Fail($"{p}.id", $"duplicate rule ID {PyRepr(rid)}");

                var target = Str(r, "category");
                if (target == NotAutoPrimary)
                    throw Fail($"{p}.category", "rule must not target primary type D");
                if (!cats.TryGetValue(target, out var cat))
                    throw Fail($"{p}.category", $"rule targets undefined category {PyRepr(target)}");
                if (!Bool(cat, "auto_assignable"))
                    throw Fail($"{p}.category",
                               $"rule targets {PyRepr(target)}, which is not automatically assignable");

                var confElement = r.GetProperty("confidence");
                double conf = double.Parse(confElement.GetRawText(), NumberStyles.Float, CultureInfo.InvariantCulture);
                if (!(double.IsFinite(conf) && conf >= 0.0 && conf <= 1.0))
                    throw Fail($"{p}.confidence", $"confidence {PyNumberRepr(confElement, conf)} outside [0, 1]");

                var match = r.GetProperty("match");
                List<string>? technique = match.TryGetProperty("technique", out var t) && t.ValueKind == JsonValueKind.Array
                    ? Strings(t) : null;
                var signal = OptStr(match, "signal");
                var message = OptStr(match, "message");
                bool ignoreCase = OptBool(match, "ignore_case");
                if (technique is null && signal is null && message is null)
                    throw Fail($"{p}.match", "rule needs at least one of technique, signal, message");
                if (technique is not null && technique.Count == 0)
                    throw Fail($"{p}.match.technique", "technique list must be non-empty");

                var signalRe = Compile(signal, $"{p}.match.signal", full: true, ignoreCase: false);
                var messageRe = Compile(message, $"{p}.match.message", full: false, ignoreCase: ignoreCase);

                var covers = r.TryGetProperty("covers", out var cv) && cv.ValueKind == JsonValueKind.Array
                    ? Strings(cv) : [];
                rules.Add(new TaxonomyRule(
                    id: rid,
                    category: target,
                    confidence: conf,
                    covers: covers.AsReadOnly(),
                    technique: technique is null ? null : new HashSet<string>(technique, StringComparer.Ordinal),
                    signal: signal,
                    message: message,
                    ignoreCase: ignoreCase,
                    signalRegex: signalRe,
                    messageRegex: messageRe));
            }
            return rules;
        }

        private Regex? Compile(string? pattern, string path, bool full, bool ignoreCase)
        {
            if (pattern is null) return null;
            if (pattern.Length == 0)
                throw Fail(path, "pattern must be non-empty");
            var bad = CheckRegexSubset(pattern);
            if (bad is not null)
                throw Fail(path, $"regex outside the portable subset: {bad}");
            var options = RegexOptions.CultureInvariant | (ignoreCase ? RegexOptions.IgnoreCase : RegexOptions.None);
            try
            {
                var plain = new Regex(pattern, options, MatchTimeout);
                return full ? new Regex($@"\A(?:{pattern})\z", options, MatchTimeout) : plain;
            }
            catch (ArgumentException ex)
            {
                throw Fail(path, $"regex does not compile: {ex.Message}");
            }
        }

        private static string PyNumberRepr(JsonElement element, double value)
        {
            if (IsIntegerToken(element))
                return BigInteger.Parse(element.GetRawText(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture)
                    .ToString(CultureInfo.InvariantCulture);
            if (double.IsPositiveInfinity(value)) return "inf";
            if (double.IsNegativeInfinity(value)) return "-inf";
            if (double.IsNaN(value)) return "nan";
            var s = value.ToString("R", CultureInfo.InvariantCulture).Replace('E', 'e');
            return s.IndexOfAny(['.', 'e']) < 0 ? s + ".0" : s;
        }

        // -- step 8 --------------------------------------------------------

        private List<PromptTemplate> Step8Prompts(JsonElement root)
        {
            var prompts = root.GetProperty("prompts");
            foreach (var name in RequiredPrompts)
            {
                if (!prompts.TryGetProperty(name, out var tpl))
                    throw Fail($"$.prompts.{name}", "required prompt template missing");
                if (OptBool(tpl, "optional"))
                    throw Fail($"$.prompts.{name}.optional", "required template cannot be optional");
            }

            var output = new List<PromptTemplate>();
            foreach (var prop in prompts.EnumerateObject())
            {
                var p = $"$.prompts.{prop.Name}";
                var variables = Strings(prop.Value.GetProperty("variables"));
                var text = Str(prop.Value, "text");
                var present = PlaceholderRegex.Matches(text)
                    .Select(m => m.Groups[1].Value)
                    .ToHashSet(StringComparer.Ordinal);
                var seenVars = new HashSet<string>(StringComparer.Ordinal);
                for (int j = 0; j < variables.Count; j++)
                {
                    var v = variables[j];
                    if (!seenVars.Add(v))
                        throw Fail($"{p}.variables[{j}]", $"duplicate variable {PyRepr(v)}");
                    if (!present.Contains(v))
                        throw Fail($"{p}.variables[{j}]", $"declared variable {{{v}}} does not appear in the text");
                }
                output.Add(new PromptTemplate(prop.Name, variables.AsReadOnly(), text, OptBool(prop.Value, "optional")));
            }
            return output;
        }

        // -- build ---------------------------------------------------------

        private TaxonomyDefinition Build(JsonElement root, List<TaxonomyRule> rules, List<PromptTemplate> prompts)
        {
            var primaries = new OrderedDictionary<string, PrimaryType>(StringComparer.Ordinal);
            foreach (var pt in Items(root, "primary_types").OrderBy(x => Str(x, "id"), StringComparer.Ordinal))
            {
                var id = Str(pt, "id");
                primaries[id] = new PrimaryType(id, Str(pt, "name"), Bool(pt, "auto_assignable"),
                                                OptStr(pt, "not_assigned_reason"));
            }

            var categories = new OrderedDictionary<string, TaxonomyCategory>(StringComparer.Ordinal);
            foreach (var c in Items(root, "categories").OrderBy(x => BigInt(x, "priority")))
            {
                var id = Str(c, "id");
                categories[id] = new TaxonomyCategory(id, Str(c, "primary"), Str(c, "name"),
                                                      ClampInt(BigInt(c, "priority")), Bool(c, "auto_assignable"),
                                                      Str(c, "repair_hint"), OptStr(c, "not_assigned_reason"));
            }

            var um = root.GetProperty("unmapped");
            var unmapped = new UnmappedCategory(Str(um, "id"), Str(um, "name"), ClampInt(BigInt(um, "priority")),
                                                Str(um, "primary_state"), Str(um, "repair_hint"));

            var feedback = new OrderedDictionary<string, string>(StringComparer.Ordinal);
            foreach (var prop in root.GetProperty("dou_feedback").EnumerateObject())
                feedback[prop.Name] = prop.Value.GetString()!;

            var promptMap = new OrderedDictionary<string, PromptTemplate>(StringComparer.Ordinal);
            foreach (var tpl in prompts)
                promptMap[tpl.Name] = tpl;

            return new TaxonomyDefinition(
                path: _file,
                schema: Str(root, "schema"),
                version: Str(root, "version"),
                primaryTypes: new ReadOnlyDictionary<string, PrimaryType>(primaries),
                categories: new ReadOnlyDictionary<string, TaxonomyCategory>(categories),
                priorityOrder: categories.Keys.ToList().AsReadOnly(),
                unmapped: unmapped,
                checklist: Strings(root.GetProperty("checklist")).AsReadOnly(),
                rules: rules.AsReadOnly(),
                douFeedback: new ReadOnlyDictionary<string, string>(feedback),
                prompts: new ReadOnlyDictionary<string, PromptTemplate>(promptMap));
        }
    }
}
