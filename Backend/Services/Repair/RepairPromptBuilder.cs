using System.Globalization;
using Backend.Models;
using Backend.Services.Taxonomy;

namespace Backend.Services.Repair;

/// <summary>
/// Web repair prompts for every Repair_Mode, built only from Taxonomy_Definition
/// templates (port of <c>tivr/prompts.py</c> <c>build_repair_prompt</c>; design §3
/// "Repair prompt builders" and §7 "Repair loop"; Req. 20.3, 22.5).
/// <list type="bullet">
/// <item><c>dou</c> / <c>dou_no_bt</c>: <c>dou_critique</c> with <c>{solution}</c> = the
/// editable files rendered as <c>### File: &lt;path&gt;</c> + one fenced block each,
/// <c>{error log}</c> = Dou_Feedback, <c>{checklist}</c> = the 10 items (empty for
/// <c>dou_no_bt</c>).</item>
/// <item><c>generic</c>: <c>generic_repair</c> with the evidence of ≤3 findings.</item>
/// <item><c>evidence_only</c> / <c>taxonomy_only</c> / <c>full</c>: <c>tivr_repair</c>
/// with the mode's diagnosis, evidence, and lessons blocks.</item>
/// </list>
/// Only <see cref="VerificationResult.CorrectnessFindings"/> is read; advisory findings
/// never reach a prompt. Test files are excluded from every prompt (read-only).
/// </summary>
public sealed class RepairPromptBuilder
{
    public const int MaxEvidenceItems = 3;   // Req. 11.5, 11.6, 11.8
    public const int MaxLessons = 2;         // Req. 11.8

    public const string Dou = "dou";
    public const string DouNoBt = "dou_no_bt";
    public const string Generic = "generic";
    public const string EvidenceOnly = "evidence_only";
    public const string TaxonomyOnly = "taxonomy_only";
    public const string Full = "full";

    /// <summary>The six web Repair_Mode values (Req. 22.1).</summary>
    public static readonly IReadOnlyList<string> Modes = [Dou, DouNoBt, Generic, EvidenceOnly, TaxonomyOnly, Full];

    // Fixed filler text, identical to tivr/prompts.py.
    public const string EvidenceOnlyDiagnosis = "* (see evidence below)";
    public const string WithheldEvidence = "(withheld in this configuration)";
    public const string NoDiagnosis = "* No diagnosis produced.";
    public const string NoEvidence = "* No evidence captured.";

    private const string NoCodeSignal = "no_code_output";
    private const string TimeoutSignal = "timeout";
    private static readonly string[] ErrorReportStages = ["syntax", "import", "collection", "runtime"];
    private static readonly IReadOnlyDictionary<string, string> NoVariables = new Dictionary<string, string>();

    private readonly TaxonomyDefinition _defn;
    private readonly PromptRenderer _renderer;
    private readonly TaxonomyMapper _mapper;

    public RepairPromptBuilder(ITaxonomyProvider taxonomy)
    {
        ArgumentNullException.ThrowIfNull(taxonomy);
        _defn = taxonomy.Definition;
        _renderer = taxonomy.Renderer;
        _mapper = taxonomy.Mapper;
    }

    /// <summary>System prompt for every web repair call (<c>web_repair_system</c>).</summary>
    /// <exception cref="TemplateException">Template missing from the definition.</exception>
    public string WebSystemPrompt => _renderer.Render("web_repair_system", NoVariables);

    /// <summary>
    /// Build the repair prompt for <paramref name="mode"/> from the current verification.
    /// <paramref name="files"/> may include test files; they are filtered out here.
    /// <paramref name="lessons"/> are the lessons of earlier completed iterations (oldest
    /// first, see <see cref="LessonFrom"/>); only <c>full</c> uses them, from iteration 2.
    /// </summary>
    /// <exception cref="ArgumentException">Unknown or optional (intervenor) mode.</exception>
    /// <exception cref="TemplateException">Required template missing from the definition.</exception>
    public string Build(
        string mode,
        string? originalPrompt,
        IEnumerable<GeneratedCodeFile> files,
        VerificationResult current,
        int iteration = 1,
        int budget = 1,
        IReadOnlyList<string>? lessons = null)
    {
        ArgumentNullException.ThrowIfNull(files);
        ArgumentNullException.ThrowIfNull(current);
        var editable = RepairFiles.Editable(files);
        var prompt = originalPrompt ?? "";
        var correctness = current.CorrectnessFindings ?? [];

        switch (mode)
        {
            case Dou:
            case DouNoBt:
                return _renderer.Render("dou_critique", new Dictionary<string, string>
                {
                    ["prompt"] = prompt,
                    ["solution"] = RenderSolution(editable),
                    ["error log"] = DouFeedback(correctness),
                    ["checklist"] = mode == Dou ? _defn.ChecklistText() : "",
                });

            case Generic:
                return _renderer.Render("generic_repair", new Dictionary<string, string>
                {
                    ["spec"] = prompt.Trim(),
                    ["code"] = CodeText(editable),
                    ["evidence_block"] = GenericEvidence(correctness),
                });

            case EvidenceOnly:
            case TaxonomyOnly:
            case Full:
                return _renderer.Render("tivr_repair", new Dictionary<string, string>
                {
                    ["spec"] = prompt.Trim(),
                    ["code"] = CodeText(editable),
                    ["iteration"] = iteration.ToString(CultureInfo.InvariantCulture),
                    ["budget"] = budget.ToString(CultureInfo.InvariantCulture),
                    ["diagnosis_block"] = mode == EvidenceOnly ? EvidenceOnlyDiagnosis : DiagnosisBlock(correctness),
                    ["evidence_block"] = mode == TaxonomyOnly ? WithheldEvidence : EvidenceBlock(correctness),
                    ["lessons_block"] = mode == Full ? LessonsBlock(lessons ?? [], iteration) : "",
                });

            default:
                throw new ArgumentException(
                    $"invalid repair mode '{mode}' (expected one of: {string.Join(", ", Modes)})", nameof(mode));
        }
    }

    // ---- {solution} / {code} rendering ------------------------------------------------

    /// <summary>
    /// <c>{solution}</c> for web projects: per editable file <c>### File: &lt;path&gt;</c>, then
    /// one fenced block (<c>python</c> for .py files) with the content, joined by blank lines.
    /// The fence is longer than any backtick run at a line start of the content, so code that
    /// contains <c>```</c> cannot close it early.
    /// </summary>
    public static string RenderSolution(IEnumerable<GeneratedCodeFile> editable) =>
        string.Join("\n\n", editable.Select(f =>
        {
            var path = RepairFiles.PathOf(f);
            var content = Normalize(f.Content).TrimEnd('\n');
            var fence = FenceFor(content);
            var tag = RepairFiles.IsPythonPath(path) ? "python" : "";
            return $"### File: {path}\n{fence}{tag}\n{content}\n{fence}";
        }));

    /// <summary>
    /// <c>{code}</c> for templates that already wrap it in one Python fence (<c>tivr_repair</c>,
    /// <c>generic_repair</c>): the single editable file's content, or, for several files, each
    /// file preceded by a <c># File: &lt;path&gt;</c> comment line. Stripped like Python's <c>code.strip()</c>.
    /// </summary>
    public static string CodeText(IReadOnlyList<GeneratedCodeFile> editable)
    {
        if (editable.Count == 1)
            return Normalize(editable[0].Content).Trim();
        return string.Join("\n\n", editable.Select(f =>
            $"# File: {RepairFiles.PathOf(f)}\n{Normalize(f.Content).TrimEnd()}")).Trim();
    }

    private static string FenceFor(string content)
    {
        var longest = 0;
        foreach (var line in content.Split('\n'))
        {
            var run = line.TrimStart().TakeWhile(c => c == '`').Count();
            longest = Math.Max(longest, run);
        }
        return new string('`', Math.Max(3, longest + 1));
    }

    private static string Normalize(string? text) =>
        (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n');

    // ---- Dou feedback -----------------------------------------------------------------

    /// <summary>
    /// Dou_Feedback over correctness findings: any <c>timeout</c> → the fixed time-limit
    /// sentence; else the interpreter error reports of the first three
    /// syntax/import/collection/runtime/no_code_output findings joined by a blank line;
    /// else (functional only) the fixed sentence.
    /// </summary>
    public string DouFeedback(IEnumerable<MappedFinding> correctness)
    {
        var findings = correctness.ToList();
        if (findings.Any(f => f.Signal == TimeoutSignal))
            return _defn.DouFeedback["timeout"];
        var errors = findings.Where(IsErrorReport).Take(MaxEvidenceItems).ToList();
        if (errors.Count > 0)
            return string.Join("\n\n", errors.Select(ErrorReport));
        return _defn.DouFeedback["functional"];
    }

    private static bool IsErrorReport(MappedFinding f)
    {
        if (f.Signal == NoCodeSignal)
            return true;
        var stage = f.Signal.Split(':', 2)[0];
        return ErrorReportStages.Contains(stage);
    }

    private string ErrorReport(MappedFinding f)
    {
        if (!string.IsNullOrWhiteSpace(f.Evidence))
            return f.Evidence;
        if (f.Signal == NoCodeSignal)
            return _defn.DouFeedback["no_code"];
        return f.Message;
    }

    // ---- diagnosis / evidence / lessons ------------------------------------------------

    private IReadOnlyList<TaxonomyDiagnosis> Diagnoses(IEnumerable<MappedFinding> correctness) =>
        _mapper.Diagnose(correctness.Select(f => new ClassifiedFinding(
            new TaxonomyFinding(f.Technique, f.Signal, f.Message),
            new CategoryAssignment(KnownCategory(f.Category), null, f.Confidence))));

    private string KnownCategory(string? category) =>
        category is not null && _defn.Categories.ContainsKey(category) ? category : _defn.Unmapped.Id;

    private string PrimaryName(TaxonomyDiagnosis d) =>
        d.Primary is not null && _defn.PrimaryTypes.TryGetValue(d.Primary, out var p)
            ? p.Name
            : d.Primary ?? _defn.Unmapped.Id;

    private string SecondaryName(TaxonomyDiagnosis d)
    {
        if (!string.IsNullOrEmpty(d.Secondary))
            return d.Secondary;
        return _defn.Categories.TryGetValue(d.Category, out var c) ? c.Name : _defn.Unmapped.Name;
    }

    private string RepairHint(TaxonomyDiagnosis d)
    {
        if (!string.IsNullOrEmpty(d.RepairHint))
            return d.RepairHint;
        return _defn.Categories.TryGetValue(d.Category, out var c) ? c.RepairHint : _defn.Unmapped.RepairHint;
    }

    private static string Confidence(double? value) =>
        value is double v ? v.ToString("F2", CultureInfo.InvariantCulture) : "n/a";

    private static string Location(FindingLocation? loc)
    {
        if (loc is null)
            return "";
        return loc.Line is int line ? $" [{loc.File}:{line.ToString(CultureInfo.InvariantCulture)}]" : $" [{loc.File}]";
    }

    private string DiagnosisBlock(IEnumerable<MappedFinding> correctness)
    {
        var lines = new List<string>();
        foreach (var d in Diagnoses(correctness))
        {
            lines.Add(_renderer.Render("diagnosis_line", new Dictionary<string, string>
            {
                ["primary"] = PrimaryName(d),
                ["secondary"] = SecondaryName(d),
                ["confidence"] = Confidence(d.Confidence),
            }));
            lines.Add(_renderer.Render("guidance_line", new Dictionary<string, string>
            {
                ["repair_hint"] = RepairHint(d),
            }));
        }
        return lines.Count > 0 ? string.Join("\n", lines) : NoDiagnosis;
    }

    private string EvidenceBlock(IEnumerable<MappedFinding> correctness)
    {
        var lines = new List<string>();
        foreach (var f in correctness.Take(MaxEvidenceItems))
        {
            lines.Add(_renderer.Render("evidence_line", new Dictionary<string, string>
            {
                ["signal"] = f.Signal,
                ["location"] = Location(f.Location),
                ["message"] = f.Message,
            }));
            if (!string.IsNullOrWhiteSpace(f.Evidence))
                lines.Add("```\n" + f.Evidence.TrimEnd('\n') + "\n```");
        }
        return lines.Count > 0 ? string.Join("\n", lines) : NoEvidence;
    }

    private static string GenericEvidence(IEnumerable<MappedFinding> correctness)
    {
        var items = correctness.Take(MaxEvidenceItems)
            .Select(f => string.IsNullOrWhiteSpace(f.Evidence) ? f.Message : f.Evidence)
            .ToList();
        var text = string.Join("\n\n", items);
        return text.Length > 0 ? text : NoEvidence;
    }

    private string LessonsBlock(IReadOnlyList<string> lessons, int iteration)
    {
        var recent = lessons.Skip(Math.Max(0, lessons.Count - MaxLessons)).ToList();
        if (iteration < 2 || recent.Count == 0)
            return "";
        return "\n" + _renderer.Render("lessons_header", NoVariables) + string.Join("\n", recent) + "\n";
    }

    /// <summary>
    /// One-line lesson (with its <c>* </c> bullet) from a failed repair iteration
    /// (port of <c>lesson_from</c>): the highest-priority diagnosis and its evidence summary.
    /// </summary>
    public string LessonFrom(VerificationResult report, int iteration)
    {
        ArgumentNullException.ThrowIfNull(report);
        var correctness = report.CorrectnessFindings ?? [];
        var diagnoses = Diagnoses(correctness);
        var firstMessage = correctness.Count > 0 ? correctness[0].Message : "";
        string primary, secondary, summary;
        if (diagnoses.Count > 0)
        {
            var d = diagnoses[0];
            primary = PrimaryName(d);
            secondary = SecondaryName(d);
            summary = string.IsNullOrEmpty(d.EvidenceSummary) ? firstMessage : d.EvidenceSummary;
        }
        else
        {
            primary = _defn.Unmapped.Id;
            secondary = _defn.Unmapped.Name;
            summary = firstMessage;
        }
        return _renderer.Render("lesson", new Dictionary<string, string>
        {
            ["iteration"] = iteration.ToString(CultureInfo.InvariantCulture),
            ["primary"] = primary,
            ["secondary"] = secondary,
            ["evidence_summary"] = string.IsNullOrEmpty(summary) ? "verification still failing" : summary,
        });
    }
}
