namespace Maci.ExperimentRunner.Datasets;

public interface IBenchmarkDataset
{
    string BenchmarkName { get; }
    IReadOnlyList<BenchmarkProblem> LoadProblems(string dataDirectory, IEnumerable<string>? subTiers = null);
}
