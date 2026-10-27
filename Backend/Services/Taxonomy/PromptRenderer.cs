namespace Backend.Services.Taxonomy;

/// <summary>Unknown template or missing declared variable (programming error, never user-facing).</summary>
public sealed class TemplateException(string message) : Exception(message);

/// <summary>
/// Single-pass template renderer (design §1 "Template rendering"; identical to
/// Python's <c>prompts.render</c>). One pass over the template with
/// <c>\{([^{}\r\n]+)\}</c>: a match whose name is a declared variable is replaced
/// by the supplied value, any other match is left verbatim, and substituted
/// values are never rescanned.
/// </summary>
public sealed class PromptRenderer
{
    public PromptRenderer(TaxonomyDefinition definition)
    {
        Definition = definition ?? throw new ArgumentNullException(nameof(definition));
    }

    public TaxonomyDefinition Definition { get; }

    /// <summary>Render the definition template <paramref name="templateId"/>.</summary>
    /// <exception cref="TemplateException">Unknown template or a declared variable is missing.</exception>
    public string Render(string templateId, IReadOnlyDictionary<string, string> variables)
    {
        if (!Definition.Prompts.TryGetValue(templateId, out var template))
            throw new TemplateException($"unknown prompt template {TaxonomyDefinitionLoader.PyRepr(templateId)}");
        return Render(template, variables);
    }

    /// <summary>Render an explicit template (same algorithm).</summary>
    /// <exception cref="TemplateException">A declared variable is missing.</exception>
    public static string Render(PromptTemplate template, IReadOnlyDictionary<string, string> variables)
    {
        var missing = template.Variables.Where(v => !variables.ContainsKey(v)).ToList();
        if (missing.Count > 0)
            throw new TemplateException(
                $"template {TaxonomyDefinitionLoader.PyRepr(template.Name)} is missing variable(s): " +
                string.Join(", ", missing.Select(TaxonomyDefinitionLoader.PyRepr)));

        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var name in template.Variables)
            values[name] = variables[name] ?? "";

        // Regex.Replace scans the template once; replacement text is never rescanned.
        return TaxonomyDefinitionLoader.PlaceholderRegex.Replace(
            template.Text,
            m => values.TryGetValue(m.Groups[1].Value, out var value) ? value : m.Value);
    }
}
