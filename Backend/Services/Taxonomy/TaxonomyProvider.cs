namespace Backend.Services.Taxonomy;

/// <summary>Process-wide access to the validated Taxonomy_Definition (registered as a singleton).</summary>
public interface ITaxonomyProvider
{
    TaxonomyDefinition Definition { get; }
    TaxonomyMapper Mapper { get; }
    PromptRenderer Renderer { get; }
}

/// <summary>
/// Loads the shared definition once and exposes the mapper and renderer built
/// over it. Construction throws <see cref="TaxonomyLoadException"/> when the file
/// is missing or invalid, so resolving the singleton at startup stops the
/// process (Req. 7.7).
/// </summary>
public sealed class TaxonomyProvider : ITaxonomyProvider
{
    /// <summary>Configuration key of the definition path.</summary>
    public const string DefinitionPathKey = "Taxonomy:DefinitionPath";

    /// <summary>Default path, relative to <see cref="AppContext.BaseDirectory"/>.</summary>
    public const string DefaultDefinitionPath = "shared/taxonomy.v1.json";

    public TaxonomyProvider(TaxonomyDefinition definition)
    {
        Definition = definition ?? throw new ArgumentNullException(nameof(definition));
        Mapper = new TaxonomyMapper(definition);
        Renderer = new PromptRenderer(definition);
    }

    public TaxonomyDefinition Definition { get; }
    public TaxonomyMapper Mapper { get; }
    public PromptRenderer Renderer { get; }

    /// <summary>
    /// <c>Taxonomy:DefinitionPath</c> if set (relative paths resolve against
    /// <see cref="AppContext.BaseDirectory"/>), else <c>shared/taxonomy.v1.json</c>
    /// under the base directory.
    /// </summary>
    public static string ResolvePath(IConfiguration? configuration)
    {
        var configured = configuration?[DefinitionPathKey];
        var path = string.IsNullOrWhiteSpace(configured) ? DefaultDefinitionPath : configured.Trim();
        return Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, path));
    }

    /// <summary>Load from the configured path; throws <see cref="TaxonomyLoadException"/> on failure.</summary>
    public static TaxonomyProvider LoadOrThrow(IConfiguration? configuration) =>
        LoadOrThrow(ResolvePath(configuration));

    /// <summary>Load from <paramref name="path"/>; throws <see cref="TaxonomyLoadException"/> on failure.</summary>
    public static TaxonomyProvider LoadOrThrow(string path) =>
        new(TaxonomyDefinitionLoader.Load(path));
}
