using Backend.Models;
using Backend.Services.Repair;
using Backend.Services.Taxonomy;

namespace Backend.Tests;

/// <summary>
/// Web repair prompts per Repair_Mode over the real shared definition
/// (Req. 20.3 advisory exclusion, 22.5 Dou prompt/feedback from the definition).
/// </summary>
public class RepairPromptBuilderTests
{
    private const string AdvisorySentinel = "ADVISORY_SENTINEL_7f3a";
    private const string TestFileSentinel = "TEST_FILE_SENTINEL_91c2";
    private const string EvidenceSentinel = "EVIDENCE_SENTINEL_44d0";
    private const string MessageSentinel = "MESSAGE_SENTINEL_5b11";

    private static readonly TaxonomyProvider Taxonomy = TaxonomyProvider.LoadOrThrow(
        Path.Combine(AppContext.BaseDirectory, "shared", "taxonomy.v1.json"));

    private static readonly RepairPromptBuilder Builder = new(Taxonomy);
    private static TaxonomyDefinition Defn => Taxonomy.Definition;

    private static List<GeneratedCodeFile> Files() =>
    [
        new() { Name = "main.py", Path = "main.py", Category = "main", Content = "def f(d):\n    return d['k']\n" },
        new() { Name = "utils.py", Path = "pkg/utils.py", Category = "utility", Content = "def g():\n    return 1\n" },
        new() { Name = "test_main.py", Path = "test_main.py", Category = "test",
                Content = $"# {TestFileSentinel}\nfrom main import f\n" },
    ];

    private static MappedFinding Finding(string signal, string category, string evidence, string message,
                                         string technique = "tests", int? line = 2)
    {
        var known = Defn.Categories.TryGetValue(category, out var c);
        return new MappedFinding
        {
            Technique = technique, Signal = signal, Message = message, Evidence = evidence,
            Location = new FindingLocation { File = "main.py", Line = line },
            Category = category, PrimaryType = known ? c!.Primary : null,
            CategoryName = known ? c!.Name : null, RepairHint = known ? c!.RepairHint : null,
            Confidence = known ? 0.9 : null,
        };
    }

    private static VerificationResult Verification(params MappedFinding[] correctness) => new()
    {
        CorrectnessFindings = correctness.ToList(),
        AdvisoryFindings =
        [
            new AdvisoryFinding { Technique = "security", Message = AdvisorySentinel, File = "main.py", Line = 1 },
            new AdvisoryFinding { Technique = "quality", Message = $"radon {AdvisorySentinel}" },
        ],
        Complete = true,
        PrimaryState = "B",
    };

    private static VerificationResult RuntimeFailure() => Verification(
        Finding("runtime:KeyError", "B.3", $"Traceback (most recent call last):\nKeyError: 'k' {EvidenceSentinel}",
                $"'k' {MessageSentinel}"));

    private static readonly string[] Lessons =
    [
        "* Iteration 1: LESSON_ONE",
        "* Iteration 2: LESSON_TWO",
        "* Iteration 3: LESSON_THREE",
    ];

    private static string BuildPrompt(string mode, int iteration = 1, VerificationResult? v = null) =>
        Builder.Build(mode, "Write f(d) returning d['k'] or None.", Files(), v ?? RuntimeFailure(),
                      iteration, budget: 3, lessons: Lessons);

    public static TheoryData<string> AllModes() => new(RepairPromptBuilder.Modes);

    [Theory]
    [MemberData(nameof(AllModes))]
    public void EveryMode_ExcludesAdvisoryFindingsAndTestFiles(string mode)
    {
        var prompt = BuildPrompt(mode, iteration: 3);

        Assert.DoesNotContain(AdvisorySentinel, prompt);
        Assert.DoesNotContain(TestFileSentinel, prompt);
        Assert.DoesNotContain("test_main.py", prompt);
        Assert.Contains("return d['k']", prompt);
        Assert.Contains("return 1", prompt);
    }

    [Fact]
    public void Dou_UsesCritiqueTemplate_FileRendering_FeedbackAndChecklist_Only()
    {
        var prompt = BuildPrompt("dou", iteration: 3);
        var cat = Defn.Categories["B.3"];

        Assert.StartsWith("You are an expert in code bug fixing.", prompt);
        Assert.Contains(
            "## Error generation code is:\n### File: main.py\n```python\ndef f(d):\n    return d['k']\n```\n\n" +
            "### File: pkg/utils.py\n```python\ndef g():\n    return 1\n```\n", prompt);
        Assert.Contains(Defn.ChecklistText(), prompt);
        Assert.Contains($"## Compilation and execution error message\nTraceback (most recent call last):\nKeyError: 'k' {EvidenceSentinel}\n", prompt);
        Assert.DoesNotContain(cat.Name, prompt);
        Assert.DoesNotContain(cat.RepairHint, prompt);
        Assert.DoesNotContain("0.90", prompt);
        Assert.DoesNotContain("LESSON_", prompt);
    }

    [Fact]
    public void DouNoBt_EqualsDouWithEmptyChecklist()
    {
        var dou = BuildPrompt("dou");
        var noBt = BuildPrompt("dou_no_bt");

        Assert.Equal(dou.Replace(Defn.ChecklistText(), ""), noBt);
        Assert.All(Defn.Checklist, item => Assert.DoesNotContain(item.Trim(), noBt));
        Assert.Contains("## Possible error types and causes:\n\n", noBt);
    }

    [Fact]
    public void Generic_HasEvidenceOnly_NoTaxonomyChecklistOrLessons()
    {
        var prompt = BuildPrompt("generic", iteration: 3);
        var cat = Defn.Categories["B.3"];

        Assert.StartsWith("You wrote this code for the task:", prompt);
        Assert.Contains(EvidenceSentinel, prompt);
        Assert.Contains("# File: main.py\ndef f(d):", prompt);
        Assert.Contains("# File: pkg/utils.py\ndef g():", prompt);
        Assert.DoesNotContain(cat.Name, prompt);
        Assert.DoesNotContain(cat.RepairHint, prompt);
        Assert.DoesNotContain("confidence", prompt);
        Assert.All(Defn.Checklist, item => Assert.DoesNotContain(item.Trim(), prompt));
        Assert.DoesNotContain("LESSON_", prompt);
    }

    [Fact]
    public void EvidenceOnly_HasEvidenceAndFiller_NoCategoryHintOrConfidence()
    {
        var prompt = BuildPrompt("evidence_only", iteration: 3);
        var cat = Defn.Categories["B.3"];

        Assert.Contains("## Verified bug diagnosis\n* (see evidence below)\n", prompt);
        Assert.Contains($"* runtime:KeyError [main.py:2]: 'k' {MessageSentinel}\n```\nTraceback", prompt);
        Assert.Contains(EvidenceSentinel, prompt);
        Assert.DoesNotContain(cat.Name, prompt);
        Assert.DoesNotContain(cat.RepairHint, prompt);
        Assert.DoesNotContain("confidence", prompt);
        Assert.DoesNotContain("LESSON_", prompt);
    }

    [Fact]
    public void TaxonomyOnly_HasCategoryAndHint_EvidenceWithheld()
    {
        var prompt = BuildPrompt("taxonomy_only", iteration: 3);
        var cat = Defn.Categories["B.3"];

        Assert.Contains($"* Category: {Defn.PrimaryTypes["B"].Name} -> {cat.Name} (confidence 0.90)", prompt);
        Assert.Contains($"  Guidance: {cat.RepairHint}", prompt);
        Assert.Contains("## Evidence from execution\n(withheld in this configuration)\n", prompt);
        Assert.DoesNotContain(EvidenceSentinel, prompt);
        Assert.DoesNotContain(MessageSentinel, prompt);
        Assert.DoesNotContain("LESSON_", prompt);
    }

    [Fact]
    public void Full_HasCategoryHintEvidence_AndLessonsOnlyFromIteration2()
    {
        var cat = Defn.Categories["B.3"];
        var first = BuildPrompt("full", iteration: 1);
        var third = BuildPrompt("full", iteration: 3);

        Assert.Contains(cat.RepairHint, first);
        Assert.Contains(EvidenceSentinel, first);
        Assert.Contains("(iteration 1 of 3)", first);
        Assert.DoesNotContain("Lessons from previous repair attempts", first);
        Assert.DoesNotContain("LESSON_", first);

        Assert.Contains("## Lessons from previous repair attempts\n* Iteration 2: LESSON_TWO\n* Iteration 3: LESSON_THREE\n", third);
        Assert.DoesNotContain("LESSON_ONE", third);
    }

    [Fact]
    public void Evidence_IsCappedAtThreeFindings()
    {
        var v = Verification(
            Finding("functional:logic", "C.1", "EV_1", "M_1"),
            Finding("functional:logic", "C.1", "EV_2", "M_2"),
            Finding("functional:logic", "C.1", "EV_3", "M_3"),
            Finding("functional:logic", "C.1", "EV_4", "M_4"));

        foreach (var mode in new[] { "generic", "evidence_only", "full" })
        {
            var prompt = BuildPrompt(mode, v: v);
            Assert.Contains("EV_3", prompt);
            Assert.DoesNotContain("EV_4", prompt);
        }
    }

    [Fact]
    public void EmptyBlocks_UseFillers_AndUnmappedUsesDefinitionNames()
    {
        var none = Verification();
        Assert.Contains(RepairPromptBuilder.NoEvidence, BuildPrompt("evidence_only", v: none));
        Assert.Contains(RepairPromptBuilder.NoDiagnosis, BuildPrompt("taxonomy_only", v: none));

        var unmapped = BuildPrompt("taxonomy_only",
            v: Verification(Finding("runtime:UnicodeDecodeError", "UNMAPPED", "", "bad byte")));
        Assert.Contains($"* Category: {Defn.Unmapped.Id} -> {Defn.Unmapped.Name} (confidence n/a)", unmapped);
        Assert.Contains(Defn.Unmapped.RepairHint, unmapped);
    }

    [Fact]
    public void DouFeedback_TimeoutWinsOverEverything()
    {
        var text = Builder.DouFeedback(
        [
            Finding("syntax:SyntaxError", "A.1", "SyntaxError: bad", "bad", "syntax"),
            Finding("timeout", "C.1", "took too long", "timeout"),
        ]);

        Assert.Equal(Defn.DouFeedback["timeout"], text);
    }

    [Fact]
    public void DouFeedback_FunctionalOnly_IsFixedSentence()
    {
        var text = Builder.DouFeedback([Finding("functional:logic", "C.1", "assert 1 == 2", "assert 1 == 2")]);

        Assert.Equal(Defn.DouFeedback["functional"], text);
        Assert.Equal("The functionality of code is incorrect", text);
    }

    [Fact]
    public void DouFeedback_ErrorReports_FirstThreeJoinedByBlankLine()
    {
        var text = Builder.DouFeedback(
        [
            Finding("functional:logic", "C.1", "FUNCTIONAL_EVIDENCE", "f"),
            Finding("syntax:SyntaxError", "A.1", "E1", "m1", "syntax"),
            Finding("import:ModuleNotFoundError", "A.4", "E2", "m2", "imports"),
            Finding("runtime:TypeError", "B.1", "", "M3_FROM_MESSAGE"),
            Finding("collection:ImportError", "A.4", "E4", "m4"),
        ]);

        Assert.Equal("E1\n\nE2\n\nM3_FROM_MESSAGE", text);
    }

    [Fact]
    public void DouFeedback_NoCodeWithoutEvidence_UsesDefinitionSentence()
    {
        var text = Builder.DouFeedback([Finding("no_code_output", "A.1", "", "", "syntax")]);

        Assert.Equal(Defn.DouFeedback["no_code"], text);
    }

    [Theory]
    [InlineData("intervenor")]
    [InlineData("dou_intervenor")]
    [InlineData("DOU")]
    [InlineData("")]
    public void UnknownOrOptionalMode_Throws(string mode)
    {
        Assert.Throws<ArgumentException>(() => BuildPrompt(mode));
    }

    [Fact]
    public void WebSystemPrompt_ComesFromDefinition_AndAsksForFileHeaders()
    {
        Assert.Equal(Defn.Prompt("web_repair_system").Text, Builder.WebSystemPrompt);
        Assert.Contains("### File: <path>", Builder.WebSystemPrompt);
    }

    [Fact]
    public void RenderSolution_LengthensFenceWhenContentHasBackticks()
    {
        var text = RepairPromptBuilder.RenderSolution(
        [
            new GeneratedCodeFile { Path = "doc.py", Content = "X = '''\n```\n'''\r\n" },
        ]);

        Assert.Equal("### File: doc.py\n````python\nX = '''\n```\n'''\n````", text);
    }

    [Fact]
    public void SingleEditableFile_CodeIsStrippedContent()
    {
        var files = new List<GeneratedCodeFile>
        {
            new() { Path = "main.py", Content = "\n\ndef f():\n    return 1\n\n" },
            new() { Path = "tests/test_main.py", Content = TestFileSentinel },
        };

        var prompt = Builder.Build("full", "task", files, RuntimeFailure());

        Assert.Contains("```python\ndef f():\n    return 1\n```", prompt);
        Assert.DoesNotContain("# File:", prompt);
        Assert.DoesNotContain(TestFileSentinel, prompt);
    }

    [Fact]
    public void LessonFrom_UsesHighestPriorityDiagnosis()
    {
        var v = Verification(
            Finding("functional:logic", "C.1", "", "assert 1 == 2"),
            Finding("runtime:KeyError", "B.3", "", "'k'\nmore"));

        var lesson = Builder.LessonFrom(v, 2);

        Assert.Equal(
            $"* Iteration 2: fix attempt still fails with {Defn.PrimaryTypes["B"].Name} -> " +
            $"{Defn.Categories["B.3"].Name} (runtime:KeyError: 'k'). A different fix strategy is required.",
            lesson);
    }
}
