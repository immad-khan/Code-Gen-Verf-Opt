using System.Diagnostics;
using System.Text.Json;
using Maci.ExperimentRunner.Config;
using Maci.ExperimentRunner.Datasets;
using Maci.ExperimentRunner.Execution;
using Maci.ExperimentRunner.Sandbox;
using Maci.ExperimentRunner.Storage;

namespace Maci.ExperimentRunner;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        Console.WriteLine("==================================================================");
        Console.WriteLine(" VeriFlow Baseline Reproduction Experiment Runner (Dou et al.)   ");
        Console.WriteLine("==================================================================");

        var configPath = "run_config.json";
        int? cliMaxProblems = null;
        bool? cliDryRun = null;
        string? cliBenchmarks = null;
        string? cliRunId = null;
        bool cliResume = false;
        bool cliReportOnly = false;

        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--config" && i + 1 < args.Length)
            {
                configPath = args[++i];
            }
            else if (args[i] == "--max-problems" && i + 1 < args.Length)
            {
                if (int.TryParse(args[++i], out var max)) cliMaxProblems = max;
            }
            else if (args[i] == "--dry-run")
            {
                cliDryRun = true;
            }
            else if (args[i] == "--benchmarks" && i + 1 < args.Length)
            {
                cliBenchmarks = args[++i];
            }
            else if (args[i] == "--run-id" && i + 1 < args.Length)
            {
                cliRunId = args[++i];
            }
            else if (args[i] == "--resume")
            {
                cliResume = true;
            }
            else if (args[i] == "--report")
            {
                cliReportOnly = true;
            }
        }

        if (!File.Exists(configPath))
        {
            Console.WriteLine($"[ERROR] Configuration file '{configPath}' not found.");
            return 1;
        }

        var configJson = await File.ReadAllTextAsync(configPath);
        var config = JsonSerializer.Deserialize<ExperimentConfig>(configJson) ?? new ExperimentConfig();

        if (cliMaxProblems.HasValue) config.MaxProblems = cliMaxProblems.Value;
        if (cliDryRun.HasValue) config.DryRun = cliDryRun.Value;
        if (!string.IsNullOrEmpty(cliBenchmarks))
        {
            config.Benchmarks = cliBenchmarks.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        }

        // Resolve DeepSeek API Key
        var apiKey = config.ApiKey ?? Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY");
        if (string.IsNullOrEmpty(apiKey) && File.Exists(".env"))
        {
            foreach (var line in File.ReadAllLines(".env"))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith("DEEPSEEK_API_KEY="))
                {
                    apiKey = trimmed["DEEPSEEK_API_KEY=".Length..].Trim('"', '\'', ' ');
                    break;
                }
            }
        }

        Console.WriteLine($"Execution Mode: {config.Mode}");
        Console.WriteLine($"Target Model:   {config.Model} (configured)");
        Console.WriteLine($"Docker Image:   {config.DockerImage}");
        Console.WriteLine($"Iterations:     {config.Iterations}");
        Console.WriteLine($"Dry Run:        {config.DryRun}");
        Console.WriteLine($"Seed:           {config.Seed}");
        Console.WriteLine($"Database Path:  {config.DatabasePath}");
        Console.WriteLine($"Benchmarks:     {string.Join(", ", config.Benchmarks)}");

        if (cliReportOnly)
        {
            Console.WriteLine("\n[REPORT] Generating experiment reports from database...");
            await GenerateReportsAsync(config, cliRunId);
            return 0;
        }

        if (string.IsNullOrEmpty(apiKey) && !config.DryRun)
        {
            Console.WriteLine("\n[ERROR] No DEEPSEEK_API_KEY provided. Please provide it in run_config.json, .env, or as an environment variable.");
            Console.WriteLine("If you want to validate the Docker sandbox and benchmark harnesses with canonical solutions, use --dry-run.");
            return 1;
        }

        // Initialize SQLite storage
        var storage = new SqliteExperimentStorage(config.DatabasePath);
        await storage.InitializeAsync();

        string runId;
        if (!string.IsNullOrEmpty(cliRunId))
        {
            runId = cliRunId;
            Console.WriteLine($"[RESUME] Using specified Run ID: {runId}");
        }
        else if (cliResume)
        {
            var latest = await storage.GetLatestRunIdAsync(config.Model, config.Mode, config.Seed);
            if (!string.IsNullOrEmpty(latest))
            {
                runId = latest;
                Console.WriteLine($"[RESUME] Resuming previous active Run ID: {runId}");
            }
            else
            {
                runId = $"{config.Model}_{config.Mode}_{config.Seed}_{DateTime.UtcNow:yyyyMMdd_HHmmss}";
                Console.WriteLine($"[RESUME] No prior run found. Starting new Run ID: {runId}");
            }
        }
        else
        {
            runId = $"{config.Model}_{config.Mode}_{config.Seed}_{DateTime.UtcNow:yyyyMMdd_HHmmss}";
        }

        await storage.RegisterRunAsync(runId, config.Model, config.Mode, config.Iterations, config.Seed, configJson);

        Console.WriteLine($"\n[RUN INITIALIZED] Run ID: {runId}");

        var sandbox = new DockerSandbox(config.DockerImage);
        DeepSeekClient? llmClient = !string.IsNullOrEmpty(apiKey) ? new DeepSeekClient(apiKey, config.Model) : null;
        var engine = new ExperimentEngine(config, sandbox, storage, llmClient, runId);

        // Load benchmark problems
        var allProblems = new List<BenchmarkProblem>();
        foreach (var bm in config.Benchmarks)
        {
            IBenchmarkDataset loader = bm.ToLowerInvariant() switch
            {
                "humaneval_plus" or "humanevalplus" or "humaneval" => new HumanEvalPlusDataset(),
                "mbpp_plus" or "mbppplus" or "mbpp" => new MbppPlusDataset(),
                "apps_plus" or "appsplus" or "apps" => new AppsPlusDataset(),
                _ => throw new ArgumentException($"Unknown benchmark: {bm}")
            };

            Console.WriteLine($"--> Loading dataset: {loader.BenchmarkName} from '{config.DataDirectory}'...");
            var loaded = loader.LoadProblems(config.DataDirectory, config.AppsPlusLevels);
            Console.WriteLine($"    Loaded {loaded.Count} problems for {loader.BenchmarkName}.");
            allProblems.AddRange(loaded);
        }

        // Apply seed shuffle
        var rng = new Random(config.Seed);
        var shuffledProblems = allProblems.OrderBy(_ => rng.Next()).ToList();

        if (config.MaxProblems.HasValue && config.MaxProblems.Value > 0)
        {
            shuffledProblems = shuffledProblems.Take(config.MaxProblems.Value).ToList();
            Console.WriteLine($"[FILTER] Limited execution to {shuffledProblems.Count} problems (maxProblems = {config.MaxProblems.Value}).");
        }

        Console.WriteLine($"\n--> Starting execution for {shuffledProblems.Count} problems...");

        var totalCount = shuffledProblems.Count;
        var r0PassCount = 0;
        var r1PassCount = 0;
        var r2PassCount = 0;
        var finalFailCount = 0;
        var initialFailingCount = 0;
        var fixedCount = 0;
        var skippedCount = 0;
        var bugCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        var timer = Stopwatch.StartNew();

        for (var idx = 0; idx < shuffledProblems.Count; idx++)
        {
            var prob = shuffledProblems[idx];
            Console.WriteLine($"\n[{idx + 1}/{totalCount}] Processing {prob.Benchmark} :: {prob.ProblemId}...");

            try
            {
                var summary = await engine.ProcessProblemAsync(prob);
                if (summary.WasSkipped)
                {
                    skippedCount++;
                    continue;
                }

                if (summary.Passed)
                {
                    if (summary.PassedRound == 0) r0PassCount++;
                    else if (summary.PassedRound == 1) { r1PassCount++; fixedCount++; initialFailingCount++; }
                    else if (summary.PassedRound == 2) { r2PassCount++; fixedCount++; initialFailingCount++; }
                }
                else
                {
                    finalFailCount++;
                    initialFailingCount++;
                }

                if (summary.InitialBugSub != null)
                {
                    bugCounts[summary.InitialBugSub] = bugCounts.GetValueOrDefault(summary.InitialBugSub) + 1;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[EXCEPTION] Failed processing problem {prob.ProblemId}: {ex.Message}");
                finalFailCount++;
                initialFailingCount++;
            }
        }

        timer.Stop();

        var totalPassed = r0PassCount + r1PassCount + r2PassCount;
        var rsr = initialFailingCount > 0
            ? $"{(double)fixedCount / initialFailingCount * 100.0:F1}% ({fixedCount}/{initialFailingCount})"
            : "N/A (0 failing problems)";

        Console.WriteLine("\n==================================================================");
        Console.WriteLine(" EXPERIMENT RUN COMPLETE                                          ");
        Console.WriteLine("==================================================================");
        Console.WriteLine($"Total Problems:               {totalCount}");
        Console.WriteLine($"Skipped (Already Done):       {skippedCount}");
        Console.WriteLine($"Pass@Round 0 (Initial Gen):   {r0PassCount} ({(totalCount > 0 ? (double)r0PassCount / totalCount * 100.0 : 0):F1}%)");
        Console.WriteLine($"Pass after iteration 1:       {r0PassCount + r1PassCount} ({(totalCount > 0 ? (double)(r0PassCount + r1PassCount) / totalCount * 100.0 : 0):F1}%)");
        Console.WriteLine($"Pass after iteration 2:       {totalPassed} ({(totalCount > 0 ? (double)totalPassed / totalCount * 100.0 : 0):F1}%)");
        Console.WriteLine($"Failed after all iterations:  {finalFailCount}");
        Console.WriteLine($"Repair Success Rate (RSR):    {rsr}");
        Console.WriteLine($"Elapsed Time:                 {timer.Elapsed:hh\\:mm\\:ss}");
        Console.WriteLine($"Database Saved At:            {config.DatabasePath}");
        if (bugCounts.Count > 0)
        {
            Console.WriteLine("\nInitial Bug Distribution:");
            foreach (var (bug, count) in bugCounts.OrderBy(k => k.Key))
            {
                Console.WriteLine($"  - {bug,-6}: {count} problems");
            }
        }
        Console.WriteLine("==================================================================");

        await GenerateReportsAsync(config, runId);

        return 0;
    }

    private static async Task GenerateReportsAsync(ExperimentConfig config, string? runId)
    {
        try
        {
            var curDir = Directory.GetCurrentDirectory();
            var runArg = string.IsNullOrEmpty(runId) ? "" : $"\"{runId}\"";
            var psi = new ProcessStartInfo
            {
                FileName = "docker",
                Arguments = $"run --rm -v \"{curDir}:/app\" -w /app {config.DockerImage} python scripts/generate_reports.py \"{config.DatabasePath}\" {runArg}",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            using var proc = Process.Start(psi);
            if (proc != null)
            {
                var stdout = await proc.StandardOutput.ReadToEndAsync();
                var stderr = await proc.StandardError.ReadToEndAsync();
                await proc.WaitForExitAsync();
                if (!string.IsNullOrWhiteSpace(stdout)) Console.WriteLine(stdout.Trim());
                if (!string.IsNullOrWhiteSpace(stderr)) Console.WriteLine(stderr.Trim());
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[WARN] Could not auto-generate report: {ex.Message}");
        }
    }
}
