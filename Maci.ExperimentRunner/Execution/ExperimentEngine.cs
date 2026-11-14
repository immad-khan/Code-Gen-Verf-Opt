using System.Diagnostics;
using Maci.ExperimentRunner.Classification;
using Maci.ExperimentRunner.Config;
using Maci.ExperimentRunner.Datasets;
using Maci.ExperimentRunner.Sandbox;
using Maci.ExperimentRunner.Storage;

namespace Maci.ExperimentRunner.Execution;

public sealed record ProblemExecutionSummary(
    bool Passed,
    int PassedRound, // -1 if not passed, 0 if R0, 1 if R1, 2 if R2
    string? InitialBugPrimary,
    string? InitialBugSub,
    bool WasSkipped
);

public sealed class ExperimentEngine
{
    private readonly ExperimentConfig _config;
    private readonly IDockerSandbox _sandbox;
    private readonly IExperimentStorage _storage;
    private readonly DeepSeekClient? _llmClient;
    private readonly string _runId;

    public ExperimentEngine(
        ExperimentConfig config,
        IDockerSandbox sandbox,
        IExperimentStorage storage,
        DeepSeekClient? llmClient,
        string runId)
    {
        _config = config;
        _sandbox = sandbox;
        _storage = storage;
        _llmClient = llmClient;
        _runId = runId;
    }

    public async Task<ProblemExecutionSummary> ProcessProblemAsync(BenchmarkProblem problem, CancellationToken ct = default)
    {
        var isDone = await _storage.IsProblemCompletedAsync(_runId, problem.Benchmark, problem.ProblemId, ct);
        if (isDone)
        {
            Console.WriteLine($"[RESUME] Skipping already completed problem: {problem.Benchmark} / {problem.ProblemId}");
            return new ProblemExecutionSummary(Passed: true, PassedRound: 0, InitialBugPrimary: null, InitialBugSub: null, WasSkipped: true);
        }

        Console.WriteLine($"\n=======================================================");
        Console.WriteLine($"[START] {problem.Benchmark} / {problem.ProblemId} (Tier: {problem.SubTier ?? "standard"})");
        Console.WriteLine($"=======================================================");

        var problemRunId = $"{_runId}:{problem.Benchmark}:{problem.ProblemId}";
        var overallSw = Stopwatch.StartNew();

        if (_config.DryRun)
        {
            // Dry run: Validate canonical solution directly in Docker sandbox
            Console.WriteLine($"[DRY-RUN] Validating canonical solution in Docker sandbox...");
            var testRes = await _sandbox.RunTestAsync(problem.CanonicalSolution, problem.TestCode, _config.TimeoutSeconds, ct);
            if (!testRes.Success)
            {
                Console.WriteLine($"[DRY-RUN FAIL] Canonical solution failed for {problem.ProblemId}!");
                Console.WriteLine(testRes.Stdout);
                Console.WriteLine(testRes.Stderr);
                return new ProblemExecutionSummary(Passed: false, PassedRound: -1, InitialBugPrimary: null, InitialBugSub: null, WasSkipped: false);
            }

            Console.WriteLine($"[DRY-RUN PASS] Canonical solution passed 100% in Docker sandbox!");
            await _storage.SaveProblemRunAsync(new ProblemRunRecord(
                RunId: _runId,
                Benchmark: problem.Benchmark,
                ProblemId: problem.ProblemId,
                SubTier: problem.SubTier,
                Passed: true,
                PassedRound: 0,
                InitialBugPrimary: null,
                InitialBugSub: null,
                FinalBugPrimary: null,
                FinalBugSub: null,
                TotalDurationMs: overallSw.ElapsedMilliseconds
            ), ct);
            return new ProblemExecutionSummary(Passed: true, PassedRound: 0, InitialBugPrimary: null, InitialBugSub: null, WasSkipped: false);
        }

        if (_llmClient == null)
        {
            throw new InvalidOperationException("LLM client is required when dryRun is false.");
        }

        // ================= ROUND 0: Initial Generation =================
        Console.WriteLine($"--> Round 0: Generating initial solution with {_config.Model}...");
        var genPrompt = PromptBuilder.BuildGenerationPrompt(problem);
        var genResponse = await _llmClient.CompleteAsync(genPrompt, ct);
        var initialCode = CodeExtractor.ExtractPythonCode(genResponse.Content);

        Console.WriteLine($"--> Round 0: Running generated code in Docker sandbox ({_config.DockerImage})...");
        var r0Result = await _sandbox.RunTestAsync(initialCode, problem.TestCode, _config.TimeoutSeconds, ct);

        if (r0Result.Success)
        {
            Console.WriteLine($"[SUCCESS] Round 0 passed all tests! Repair skipped.");
            await _storage.SaveRoundAsync(new ProblemRoundRecord(
                ProblemRunId: problemRunId,
                RoundNumber: 0,
                Prompt: genPrompt,
                Response: genResponse.Content,
                CodeSnapshot: initialCode,
                Passed: true,
                BugPrimary: null,
                BugSub: null,
                CompilerFeedback: null,
                TokenCount: genResponse.TotalTokens,
                DurationMs: (long)genResponse.Duration.TotalMilliseconds + (long)r0Result.Duration.TotalMilliseconds
            ), ct);

            await _storage.SaveProblemRunAsync(new ProblemRunRecord(
                RunId: _runId,
                Benchmark: problem.Benchmark,
                ProblemId: problem.ProblemId,
                SubTier: problem.SubTier,
                Passed: true,
                PassedRound: 0,
                InitialBugPrimary: null,
                InitialBugSub: null,
                FinalBugPrimary: null,
                FinalBugSub: null,
                TotalDurationMs: overallSw.ElapsedMilliseconds
            ), ct);

            return new ProblemExecutionSummary(Passed: true, PassedRound: 0, InitialBugPrimary: null, InitialBugSub: null, WasSkipped: false);
        }

        // Classify initial bug
        var r0Diag = BugClassifier.Classify(r0Result);
        Console.WriteLine($"[R0 FAIL] Diagnosed bug: Type {r0Diag.PrimaryType} ({r0Diag.SubType}: {r0Diag.SubTypeName})");
        Console.WriteLine($"  Feedback: {r0Diag.CompilerFeedback}");

        await _storage.SaveRoundAsync(new ProblemRoundRecord(
            ProblemRunId: problemRunId,
            RoundNumber: 0,
            Prompt: genPrompt,
            Response: genResponse.Content,
            CodeSnapshot: initialCode,
            Passed: false,
            BugPrimary: r0Diag.PrimaryType,
            BugSub: r0Diag.SubType,
            CompilerFeedback: r0Diag.CompilerFeedback,
            TokenCount: genResponse.TotalTokens,
            DurationMs: (long)genResponse.Duration.TotalMilliseconds + (long)r0Result.Duration.TotalMilliseconds
        ), ct);

        // ================= REPAIR LOOP: n = iterations (default 2) =================
        var currentCode = initialCode;
        var currentDiag = r0Diag;
        var passed = false;
        var passedRound = -1;

        for (var round = 1; round <= _config.Iterations; round++)
        {
            Console.WriteLine($"--> Round {round}: Requesting repair using Figure 6 prompt...");
            var repairPrompt = PromptBuilder.BuildRepairPrompt(currentCode, currentDiag, _config.Mode);
            var repairResponse = await _llmClient.CompleteAsync(repairPrompt, ct);
            var repairedCode = CodeExtractor.ExtractPythonCode(repairResponse.Content);

            Console.WriteLine($"--> Round {round}: Running repaired code in Docker sandbox...");
            var repairResult = await _sandbox.RunTestAsync(repairedCode, problem.TestCode, _config.TimeoutSeconds, ct);

            if (repairResult.Success)
            {
                Console.WriteLine($"[SUCCESS] Round {round} repair succeeded! Code passed all tests.");
                passed = true;
                passedRound = round;

                await _storage.SaveRoundAsync(new ProblemRoundRecord(
                    ProblemRunId: problemRunId,
                    RoundNumber: round,
                    Prompt: repairPrompt,
                    Response: repairResponse.Content,
                    CodeSnapshot: repairedCode,
                    Passed: true,
                    BugPrimary: null,
                    BugSub: null,
                    CompilerFeedback: null,
                    TokenCount: repairResponse.TotalTokens,
                    DurationMs: (long)repairResponse.Duration.TotalMilliseconds + (long)repairResult.Duration.TotalMilliseconds
                ), ct);

                break;
            }

            var nextDiag = BugClassifier.Classify(repairResult);
            Console.WriteLine($"[R{round} FAIL] Repaired code still failed: Type {nextDiag.PrimaryType} ({nextDiag.SubType}: {nextDiag.SubTypeName})");

            await _storage.SaveRoundAsync(new ProblemRoundRecord(
                ProblemRunId: problemRunId,
                RoundNumber: round,
                Prompt: repairPrompt,
                Response: repairResponse.Content,
                CodeSnapshot: repairedCode,
                Passed: false,
                BugPrimary: nextDiag.PrimaryType,
                BugSub: nextDiag.SubType,
                CompilerFeedback: nextDiag.CompilerFeedback,
                TokenCount: repairResponse.TotalTokens,
                DurationMs: (long)repairResponse.Duration.TotalMilliseconds + (long)repairResult.Duration.TotalMilliseconds
            ), ct);

            currentCode = repairedCode;
            currentDiag = nextDiag;
        }

        await _storage.SaveProblemRunAsync(new ProblemRunRecord(
            RunId: _runId,
            Benchmark: problem.Benchmark,
            ProblemId: problem.ProblemId,
            SubTier: problem.SubTier,
            Passed: passed,
            PassedRound: passedRound,
            InitialBugPrimary: r0Diag.PrimaryType,
            InitialBugSub: r0Diag.SubType,
            FinalBugPrimary: passed ? null : currentDiag.PrimaryType,
            FinalBugSub: passed ? null : currentDiag.SubType,
            TotalDurationMs: overallSw.ElapsedMilliseconds
        ), ct);

        overallSw.Stop();
        return new ProblemExecutionSummary(Passed: passed, PassedRound: passedRound, InitialBugPrimary: r0Diag.PrimaryType, InitialBugSub: r0Diag.SubType, WasSkipped: false);
    }
}
