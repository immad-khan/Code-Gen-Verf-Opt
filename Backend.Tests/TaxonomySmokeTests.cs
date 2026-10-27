using Backend.Services.Taxonomy;

namespace Backend.Tests;

/// <summary>
/// Smoke tests for the C# taxonomy components over the real shared definition.
/// Full loader and conformance coverage lives in the dedicated loader/conformance tests.
/// </summary>
public class TaxonomySmokeTests
{
    private static readonly string DefinitionPath =
        Path.Combine(AppContext.BaseDirectory, "shared", "taxonomy.v1.json");

    private static TaxonomyProvider Load() => TaxonomyProvider.LoadOrThrow(DefinitionPath);

    [Fact]
    public void RealDefinition_Loads()
    {
        var defn = Load().Definition;

        Assert.Equal("maci.taxonomy", defn.Schema);
        Assert.Equal("1.0.0", defn.Version);
        Assert.Equal(TaxonomyDefinitionLoader.CategoryIds, defn.PriorityOrder);
        Assert.Equal(new[] { "A", "B", "C", "D" }, defn.PrimaryTypes.Keys);
        Assert.Equal(10, defn.Checklist.Count);
        Assert.Equal(18, defn.Rules.Count);
        Assert.Equal("UNMAPPED", defn.Unmapped.Id);
        Assert.All(TaxonomyDefinitionLoader.RequiredPrompts, p => Assert.True(defn.Prompts.ContainsKey(p)));
    }

    [Fact]
    public void DefaultPath_ResolvesUnderBaseDirectory()
    {
        Assert.Equal(Path.GetFullPath(DefinitionPath), TaxonomyProvider.ResolvePath(null));
    }

    [Fact]
    public void MissingFile_ThrowsWithFileAndPath()
    {
        var missing = Path.Combine(AppContext.BaseDirectory, "shared", "does-not-exist.json");

        var ex = Assert.Throws<TaxonomyLoadException>(() => TaxonomyDefinitionLoader.Load(missing));

        Assert.Equal(missing, ex.File);
        Assert.Equal("$", ex.JsonPath);
        Assert.Equal($"{missing}: $: file not found", ex.Message);
    }

    [Fact]
    public void Mapper_FirstMatchUnmappedAndAdvisory()
    {
        var mapper = Load().Mapper;

        var b4 = mapper.Assign(new TaxonomyFinding("tests", "runtime:TypeError",
            "f() takes 1 positional argument but 2 were given"));
        var b1 = mapper.Assign(new TaxonomyFinding("tests", "runtime:TypeError",
            "unsupported operand type(s) for +: 'int' and 'str'"));
        var a1 = mapper.Assign(new TaxonomyFinding("syntax", "syntax:SyntaxError", "'(' WAS NEVER CLOSED"));
        var unmapped = mapper.Assign(new TaxonomyFinding("tests", "runtime:UnicodeDecodeError", "bad byte"));
        var partialSignal = mapper.Assign(new TaxonomyFinding("tests", "runtime:TypeErrorX", "x"));
        var advisory = mapper.Assign(new TaxonomyFinding("types", "runtime:TypeError", "x", Blocking: false));

        Assert.Equal(new CategoryAssignment("B.4", "R11", 0.9), b4);
        Assert.Equal(new CategoryAssignment("B.1", "R12", 0.8), b1);
        Assert.Equal("A.1", a1?.Category);
        Assert.Equal(new CategoryAssignment("UNMAPPED"), unmapped);
        Assert.Equal("UNMAPPED", partialSignal?.Category);
        Assert.Null(advisory);
    }

    [Fact]
    public void Diagnoses_SortedByPriority_UnmappedLast_AndPrimaryState()
    {
        var mapper = Load().Mapper;
        var findings = mapper.MapAll(
        [
            new TaxonomyFinding("tests", "runtime:UnicodeDecodeError", "bad byte"),
            new TaxonomyFinding("tests", "functional:logic", "assert 1 == 2\nmore"),
            new TaxonomyFinding("tests", "runtime:KeyError", "'k'"),
            new TaxonomyFinding("quality", "radon", "complex", Blocking: false),
        ]);

        var diagnoses = mapper.Diagnose(findings);

        Assert.Equal(new[] { "B.3", "C.1", "UNMAPPED" }, diagnoses.Select(d => d.Category));
        Assert.Equal("functional:logic: assert 1 == 2", diagnoses[1].EvidenceSummary);
        Assert.Null(diagnoses[2].Primary);
        Assert.Equal(("B", false), mapper.PrimaryState(findings, gatePassed: false));
        Assert.Equal(("PASS", false), mapper.PrimaryState([], gatePassed: true));
        Assert.Equal(("C", true), mapper.PrimaryState([findings[0]], gatePassed: false));
        Assert.Equal(("C", true), mapper.PrimaryState([], gatePassed: false));
    }

    [Fact]
    public void Renderer_SinglePass_LeavesUndeclaredAndDoesNotRescan()
    {
        var renderer = Load().Renderer;

        var text = renderer.Render("dou_critique", new Dictionary<string, string>
        {
            ["prompt"] = "Return {solution} and {x}",
            ["solution"] = "def f(): return {'a': 1}",
            ["error log"] = "boom",
            ["checklist"] = "",
        });

        Assert.Contains("## Problem description is:\nReturn {solution} and {x}\n", text);
        Assert.Contains("## Error generation code is:\ndef f(): return {'a': 1}\n", text);
        Assert.Throws<TemplateException>(() => renderer.Render("guidance_line", new Dictionary<string, string>()));
        Assert.Throws<TemplateException>(() => renderer.Render("nope", new Dictionary<string, string>()));
    }

    [Theory]
    [InlineData("(?=a)")]
    [InlineData("a++")]
    [InlineData(@"\1")]
    [InlineData("é")]
    public void RegexSubset_RejectsNonPortableConstructs(string pattern)
    {
        Assert.NotNull(TaxonomyDefinitionLoader.CheckRegexSubset(pattern));
    }
}
