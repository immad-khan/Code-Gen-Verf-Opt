namespace Maci.ExperimentRunner.Datasets;

public sealed class BenchmarkProblem
{
    public required string Benchmark { get; set; }
    public required string ProblemId { get; set; }
    public string? SubTier { get; set; }
    public required string Prompt { get; set; }
    public string? EntryPoint { get; set; }
    public required string CanonicalSolution { get; set; }
    public required string TestCode { get; set; }
    public string? TestImports { get; set; }
    public List<string>? Inputs { get; set; }
    public List<string>? Outputs { get; set; }
    public string? StarterCode { get; set; }
}
