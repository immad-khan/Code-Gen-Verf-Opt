using System.Globalization;
using System.Text;
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
    public const string Improved = "improved";

    /// <summary>The web Repair_Mode values (Req. 22.1).</summary>
    public static readonly IReadOnlyList<string> Modes = [Dou, DouNoBt, Generic, EvidenceOnly, TaxonomyOnly, Full, Improved];

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
        IReadOnlyList<string>? lessons = null,
        ImprovedRepairSources? sources = null,
        string? confirmedInterface = null)
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

            case Improved:
                return BuildImproved(prompt, editable, current, iteration, budget, lessons, sources, confirmedInterface);

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

    /// <summary>
    /// Builds the structured, multi-source prompt for the "improved" repair mode.
    /// Incorporates tagged diagnostic sections:
    /// [prompt-only], [visible-test-detail], [static-analysis], [history].
    /// </summary>
    public string BuildImproved(
        string? originalPrompt,
        IEnumerable<GeneratedCodeFile> files,
        VerificationResult current,
        int iteration = 1,
        int budget = 2,
        IReadOnlyList<string>? lessons = null,
        ImprovedRepairSources? sources = null,
        string? confirmedInterface = null)
    {
        ArgumentNullException.ThrowIfNull(files);
        ArgumentNullException.ThrowIfNull(current);
        var src = sources ?? new ImprovedRepairSources();
        var editable = RepairFiles.Editable(files).ToList();
        var prompt = (originalPrompt ?? "").Trim();
        var correctness = current.CorrectnessFindings ?? [];
        var advisory = current.AdvisoryFindings ?? [];

        var sb = new StringBuilder();

        // 1. [prompt-only] Task specification and interface contract
        if (src.PromptOnly)
        {
            sb.AppendLine("## [prompt-only] Problem Specification & Interface Contract");
            sb.AppendLine(prompt);
            if (!string.IsNullOrWhiteSpace(confirmedInterface))
            {
                sb.AppendLine();
                sb.AppendLine("### Confirmed Function Interface:");
                sb.AppendLine("```python");
                sb.AppendLine(confirmedInterface.Trim());
                sb.AppendLine("```");
            }
            sb.AppendLine();
        }

        // 2. Current erroneous solution
        sb.AppendLine($"## Current Erroneous Solution (Iteration {iteration} of {budget})");
        sb.AppendLine(RenderSolution(editable));
        sb.AppendLine();

        // 3. Machine-verified bug diagnosis (Dou et al. Taxonomy)
        sb.AppendLine("## Machine-Verified Bug Diagnosis (Dou et al. Taxonomy)");
        sb.AppendLine(DiagnosisBlock(correctness));
        sb.AppendLine();

        // 4. [visible-test-detail] Pytest execution details
        if (src.VisibleTestDetail)
        {
            sb.AppendLine("## [visible-test-detail] Test Failure Execution Details");
            var testFindings = correctness.Where(f => f.Technique == "tests" || f.Signal.StartsWith("tests:")).ToList();
            if (testFindings.Count > 0)
            {
                foreach (var tf in testFindings.Take(MaxEvidenceItems))
                {
                    sb.AppendLine($"- Test Failure in `{tf.Location?.File ?? "test_suite"}`: {tf.Message}");
                    if (!string.IsNullOrWhiteSpace(tf.Evidence))
                    {
                        sb.AppendLine("```");
                        sb.AppendLine(tf.Evidence.TrimEnd('\n'));
                        sb.AppendLine("```");
                    }
                }
            }
            else
            {
                sb.AppendLine(EvidenceBlock(correctness));
            }
            sb.AppendLine();
        }
        else
        {
            sb.AppendLine("## [visible-test-detail] Test Verification Summary");
            var testFailures = correctness.Count(f => f.Technique == "tests" || f.Signal.StartsWith("tests:"));
            if (testFailures > 0)
            {
                sb.AppendLine($"- {testFailures} test assertion(s) failed against the locked test suite.");
                sb.AppendLine("  (Detailed test traceback and assertion inputs withheld to prevent test fitting).");
            }
            else if (correctness.Count > 0)
            {
                sb.AppendLine("- Program failed pre-test correctness checks (syntax, imports, or runtime crash).");
            }
            else
            {
                sb.AppendLine("- All test assertions passed.");
            }
            sb.AppendLine();
        }

        // 5. [static-analysis] Mypy, Radon, Semgrep
        if (src.StaticAnalysis)
        {
            sb.AppendLine("## [static-analysis] Static Type, Quality & Security Diagnostics");
            var mypyIssues = advisory.Where(a => a.Technique == "types" || a.Technique == "mypy").ToList();
            var radonIssues = advisory.Where(a => a.Technique == "quality" || a.Technique == "radon").ToList();
            var semgrepIssues = advisory.Where(a => a.Technique == "security" || a.Technique == "semgrep").ToList();

            if (mypyIssues.Count > 0)
            {
                sb.AppendLine("### Type Analysis (Mypy):");
                foreach (var issue in mypyIssues.Take(4))
                {
                    var loc = issue.Line != null ? $"Line {issue.Line}: " : "";
                    sb.AppendLine($"- {loc}{issue.Message}");
                }
            }
            else
            {
                sb.AppendLine("- Type Analysis (Mypy): No static type errors found.");
            }

            if (radonIssues.Count > 0)
            {
                sb.AppendLine("### Maintainability & Complexity (Radon):");
                foreach (var issue in radonIssues.Take(3))
                {
                    sb.AppendLine($"- {issue.Message}");
                }
            }

            if (semgrepIssues.Count > 0)
            {
                sb.AppendLine("### Security Vulnerabilities (Semgrep):");
                foreach (var issue in semgrepIssues.Take(4))
                {
                    var loc = issue.Line != null ? $"Line {issue.Line}: " : "";
                    sb.AppendLine($"- [WARNING] {loc}{issue.Message}");
                }
            }
            else
            {
                sb.AppendLine("- Security Scan (Semgrep): Clean - no dangerous constructs detected.");
            }
            sb.AppendLine();
        }

        // 6. [history] Lessons and prior round critique
        if (src.History && iteration >= 2)
        {
            sb.AppendLine("## [history] Previous Repair Round Critique & Unresolved Issues");
            var recentLessons = (lessons ?? []).Skip(Math.Max(0, (lessons?.Count ?? 0) - MaxLessons)).ToList();
            if (recentLessons.Count > 0)
            {
                foreach (var l in recentLessons)
                {
                    sb.AppendLine($"- {l}");
                }
            }
            else
            {
                sb.AppendLine($"- Round {iteration - 1} attempt left {correctness.Count} unresolved issue(s). Do not repeat the same logic error.");
            }
            sb.AppendLine();
        }

        // 7. Repair instructions
        sb.AppendLine("## Repair Instructions");
        sb.AppendLine("1. Fix all diagnosed bugs. Do not output or modify any test files.");
        sb.AppendLine("2. For each modified file, write a line '### File: <path>' followed by a ```python ... ``` code block.");
        sb.AppendLine("3. Output complete runnable code without placeholders.");

        return sb.ToString();
    }

    /// <summary>
    /// Overload of BuildImproved accepting the legacy VerificationResponse and BugTaxonomyReport.
    /// </summary>
    public string BuildImproved(
        string? originalPrompt,
        IEnumerable<GeneratedCodeFile> files,
        VerificationResponse response,
        BugTaxonomyReport? diagnosis = null,
        int iteration = 1,
        int budget = 2,
        IReadOnlyList<string>? lessons = null,
        ImprovedRepairSources? sources = null,
        string? confirmedInterface = null)
    {
        var result = ToVerificationResult(response, diagnosis);
        return BuildImproved(originalPrompt, files, result, iteration, budget, lessons, sources, confirmedInterface);
    }

    /// <summary>
    /// Maps a VerificationResponse and optional BugTaxonomyReport into a canonical VerificationResult.
    /// </summary>
    public static VerificationResult ToVerificationResult(VerificationResponse resp, BugTaxonomyReport? diagnosis = null)
    {
        ArgumentNullException.ThrowIfNull(resp);
        var result = new VerificationResult
        {
            DurationMs = resp.TotalDurationMs,
            GatePassed = resp.OverallVerdict is "PASS" or "VERIFIED",
            Complete = true,
            TestsPassed = resp.Metrics?.PassedTests ?? 0,
            TestsFailed = resp.Metrics?.FailedTests ?? 0
        };

        foreach (var t in resp.Techniques)
        {
            var raw = t.Name.ToLowerInvariant();
            var techId = raw switch
            {
                var s when s.Contains("syntax") => "syntax",
                var s when s.Contains("import") => "imports",
                var s when s.Contains("test") => "tests",
                var s when s.Contains("runtime") || s.Contains("trace") => "runtime",
                var s when s.Contains("type") || s.Contains("mypy") => "types",
                var s when s.Contains("quality") || s.Contains("radon") => "quality",
                var s when s.Contains("security") || s.Contains("semgrep") => "security",
                _ => raw
            };

            result.Techniques.Add(new TechniqueStatus
            {
                Id = techId,
                Name = t.Name,
                Status = t.Status.ToLowerInvariant(),
                Complete = true,
                Details = t.Details
            });

            if (techId is "types" or "quality" or "security")
            {
                foreach (var issue in t.Issues)
                {
                    result.AdvisoryFindings.Add(new AdvisoryFinding
                    {
                        Technique = techId,
                        Message = issue.Message,
                        File = issue.File,
                        Line = issue.Line
                    });
                }
                if (t.Issues.Count == 0 && t.Status == "FAIL" && !string.IsNullOrWhiteSpace(t.Details))
                {
                    result.AdvisoryFindings.Add(new AdvisoryFinding
                    {
                        Technique = techId,
                        Message = t.Details
                    });
                }
            }
            else
            {
                foreach (var issue in t.Issues)
                {
                    result.CorrectnessFindings.Add(new MappedFinding
                    {
                        Technique = techId,
                        Signal = $"{techId}:{issue.Message}",
                        Message = issue.Message,
                        Evidence = issue.CodeSnippet ?? t.Details,
                        Location = new FindingLocation { File = issue.File, Line = issue.Line },
                        Category = "C.1"
                    });
                }
                if (t.Issues.Count == 0 && t.Status == "FAIL" && !string.IsNullOrWhiteSpace(t.Details))
                {
                    result.CorrectnessFindings.Add(new MappedFinding
                    {
                        Technique = techId,
                        Signal = $"{techId}:failure",
                        Message = t.Details,
                        Evidence = t.Details,
                        Category = "C.1"
                    });
                }
            }
        }

        if (diagnosis?.Bugs != null)
        {
            foreach (var bug in diagnosis.Bugs)
            {
                var match = result.CorrectnessFindings.FirstOrDefault(f => f.Message.Contains(bug.Message) || (bug.Line.HasValue && f.Location?.Line == bug.Line));
                if (match != null)
                {
                    match.Category = bug.TaxonomyId;
                    match.CategoryName = bug.SecondaryType;
                    match.PrimaryType = bug.PrimaryType;
                }
                else
                {
                    result.CorrectnessFindings.Add(new MappedFinding
                    {
                        Technique = "tests",
                        Category = bug.TaxonomyId,
                        CategoryName = bug.SecondaryType,
                        PrimaryType = bug.PrimaryType,
                        Message = bug.Message,
                        Evidence = bug.CompilerFeedback ?? bug.CodeSnippet ?? "",
                        Location = new FindingLocation { File = bug.File, Line = bug.Line }
                    });
                }
            }
        }

        return result;
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
