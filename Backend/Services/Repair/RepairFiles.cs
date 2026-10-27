using Backend.Models;

namespace Backend.Services.Repair;

/// <summary>
/// File helpers shared by the repair prompt builder and response parser
/// (design §7 "Repair loop"): test files are read-only during repair, so they are
/// excluded from <c>{solution}</c> and response blocks targeting them are ignored.
/// </summary>
public static class RepairFiles
{
    /// <summary>Project-relative path used in <c>### File:</c> headers (Path, else Name).</summary>
    public static string PathOf(GeneratedCodeFile file) =>
        NormalizePath(string.IsNullOrWhiteSpace(file.Path) ? file.Name : file.Path);

    /// <summary>
    /// True for files the repair may not edit: <c>category == "test"</c>,
    /// <c>test_*.py</c>, <c>*_test.py</c>, and <c>conftest.py</c> (pytest
    /// configuration, excluded from candidate modules by the verifier as well).
    /// </summary>
    public static bool IsTestFile(GeneratedCodeFile file) =>
        string.Equals(file.Category, "test", StringComparison.OrdinalIgnoreCase) ||
        IsTestPath(PathOf(file));

    /// <summary>Name-based test-file rule (same as <c>tivr/verifier.py</c> <c>_is_test_file</c>, plus conftest.py).</summary>
    public static bool IsTestPath(string path)
    {
        var name = FileName(NormalizePath(path));
        return (name.StartsWith("test_", StringComparison.Ordinal) && name.EndsWith(".py", StringComparison.Ordinal))
            || name.EndsWith("_test.py", StringComparison.Ordinal)
            || name == "conftest.py";
    }

    /// <summary>Non-test files in their original order.</summary>
    public static IReadOnlyList<GeneratedCodeFile> Editable(IEnumerable<GeneratedCodeFile> files) =>
        files.Where(f => !IsTestFile(f)).ToList().AsReadOnly();

    /// <summary>Forward slashes, no leading <c>./</c>, trimmed.</summary>
    public static string NormalizePath(string? path)
    {
        var p = (path ?? "").Trim().Replace('\\', '/');
        while (p.StartsWith("./", StringComparison.Ordinal))
            p = p[2..];
        return p;
    }

    public static bool IsPythonPath(string path) =>
        NormalizePath(path).EndsWith(".py", StringComparison.OrdinalIgnoreCase);

    private static string FileName(string normalized)
    {
        var slash = normalized.LastIndexOf('/');
        return slash < 0 ? normalized : normalized[(slash + 1)..];
    }
}
