namespace Backend.Tests;

/// <summary>
/// Guards the shared-file linking: the taxonomy definition must be copied to the
/// test output directory so conformance tests load the same file as Python.
/// </summary>
public class SharedFilesTests
{
    [Fact]
    public void TaxonomyDefinition_IsCopiedToTestOutput()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "shared", "taxonomy.v1.json");

        Assert.True(File.Exists(path), $"Expected linked shared file at '{path}'.");
        Assert.True(new FileInfo(path).Length > 0, "Linked taxonomy.v1.json is empty.");
    }
}
