using Backend.Models;
using Backend.Services.Repair;
using System.Collections.Concurrent;

namespace Backend.Services;

public interface ILockedTestStore
{
    void Store(string hash, string testCode, int testCount);
    bool TryGet(string hash, out (string TestCode, int TestCount) item);
}

/// <summary>
/// Thread-safe in-memory store for locked test suites keyed by canonical SHA-256 hash.
/// Verify and repair requests send hash only, and the server validates the hash against stored tests.
/// </summary>
public class LockedTestStore : ILockedTestStore
{
    private readonly ConcurrentDictionary<string, (string TestCode, int TestCount)> _store = new(StringComparer.OrdinalIgnoreCase);

    public void Store(string hash, string testCode, int testCount)
    {
        var normalized = TestHashUtility.Normalize(testCode);
        var expectedHash = TestHashUtility.ComputeHash(normalized);
        if (!string.Equals(hash, expectedHash, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException($"Hash mismatch when storing locked tests. Expected: {expectedHash}, Received: {hash}");
        }

        _store[hash] = (normalized, testCount);
    }

    public bool TryGet(string hash, out (string TestCode, int TestCount) item)
    {
        return _store.TryGetValue(hash, out item);
    }
}

public static class LockedSuiteFiles
{
    public static string? Apply(ILockedTestStore store, string? hash, List<GeneratedCodeFile> files)
    {
        if (string.IsNullOrWhiteSpace(hash)) return null;
        if (!store.TryGet(hash, out var suite)) return "Locked test suite not found. Select or lock the suite again.";
        if (!string.Equals(TestHashUtility.ComputeHash(suite.TestCode), hash, StringComparison.OrdinalIgnoreCase))
            return "Locked test hash integrity validation failed.";
        files.RemoveAll(RepairFiles.IsTestFile);
        files.Add(new GeneratedCodeFile { Path = "test_solution.py", Name = "test_solution.py",
            Category = "test", Description = "Locked pytest suite", Content = suite.TestCode });
        return null;
    }
}
