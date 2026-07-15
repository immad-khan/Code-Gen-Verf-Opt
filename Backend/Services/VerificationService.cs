using System.Diagnostics;
using System.Text.Json;
using Backend.Models;

namespace Backend.Services;

public class VerificationService
{
    private readonly ILogger<VerificationService> _logger;

    public VerificationService(ILogger<VerificationService> logger)
    {
        _logger = logger;
    }

    // ------------------------------------------------------------------ embedded Python scripts

    private const string AST_PARSE_SCRIPT = """
import ast, sys, json, os

results = []
target = sys.argv[1]
for root, dirs, files_list in os.walk(target):
    for f in files_list:
        if f.endswith('.py') and not f.startswith('_maci_'):
            filepath = os.path.join(root, f)
            relpath = os.path.relpath(filepath, target)
            try:
                with open(filepath, 'r', encoding='utf-8') as fh:
                    ast.parse(fh.read(), filename=relpath)
                results.append({'file': relpath, 'ok': True})
            except SyntaxError as e:
                results.append({'file': relpath, 'ok': False, 'line': e.lineno, 'message': str(e)})
print(json.dumps(results))
""";

    private const string IMPORT_CHECK_SCRIPT = """
import ast, sys, json, os, importlib

results = []
checked = set()
target = sys.argv[1]
# Add target to path so local imports work
sys.path.insert(0, target)
for root, dirs, files_list in os.walk(target):
    for f in files_list:
        if f.endswith('.py') and not f.startswith('_maci_'):
            filepath = os.path.join(root, f)
            try:
                with open(filepath, 'r', encoding='utf-8') as fh:
                    tree = ast.parse(fh.read())
            except:
                continue
            relpath = os.path.relpath(filepath, target)
            for node in ast.walk(tree):
                mod = None
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        mod = alias.name.split('.')[0]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    mod = node.module.split('.')[0]
                if mod and mod not in checked:
                    checked.add(mod)
                    # Skip local project modules
                    local_path = os.path.join(target, mod)
                    if os.path.isdir(local_path) or os.path.isfile(local_path + '.py'):
                        results.append({'module': mod, 'ok': True, 'local': True})
                        continue
                    try:
                        importlib.import_module(mod)
                        results.append({'module': mod, 'ok': True})
                    except ImportError:
                        results.append({'module': mod, 'ok': False, 'message': f"Module '{mod}' not found"})
                    except Exception as e:
                        results.append({'module': mod, 'ok': True, 'warning': str(e)})
print(json.dumps(results))
""";

    private const string CODE_METRICS_SCRIPT = """
import ast, sys, json, os

def cyclomatic_complexity(tree):
    """Count decision points + 1 = McCabe CC"""
    decision_nodes = (ast.If, ast.For, ast.While, ast.ExceptHandler,
                      ast.With, ast.Assert, ast.comprehension)
    count = 1
    for node in ast.walk(tree):
        if isinstance(node, decision_nodes):
            count += 1
        elif isinstance(node, ast.BoolOp):
            count += len(node.values) - 1
    return count

target = sys.argv[1]
total_loc = 0
total_comment = 0
total_code_lines = 0
all_cc = []
all_imports = set()
file_count = 0

for root, dirs, files_list in os.walk(target):
    for f in files_list:
        if f.endswith('.py') and not f.startswith('_maci_'):
            filepath = os.path.join(root, f)
            file_count += 1
            try:
                with open(filepath, 'r', encoding='utf-8') as fh:
                    lines = fh.readlines()
                # LoC = non-blank lines
                non_blank = [l for l in lines if l.strip()]
                total_loc += len(non_blank)
                # Comment lines
                comment_lines = [l for l in non_blank if l.strip().startswith('#')]
                total_comment += len(comment_lines)
                total_code_lines += len(non_blank) - len(comment_lines)
                # AST for CC and imports
                source = ''.join(lines)
                tree = ast.parse(source)
                # CC per function
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        all_cc.append(cyclomatic_complexity(node))
                # Imports
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            all_imports.add(alias.name.split('.')[0])
                    elif isinstance(node, ast.ImportFrom) and node.module:
                        all_imports.add(node.module.split('.')[0])
            except:
                pass

avg_cc = round(sum(all_cc) / len(all_cc), 2) if all_cc else 0
max_cc = max(all_cc) if all_cc else 0
comment_ratio = round(total_comment / total_code_lines, 3) if total_code_lines > 0 else 0

print(json.dumps({
    'total_loc': total_loc,
    'avg_cc': avg_cc,
    'max_cc': max_cc,
    'api_count': len(all_imports),
    'comment_ratio': comment_ratio,
    'file_count': file_count
}))
""";

    // ------------------------------------------------------------------ main entry

    public async Task<VerificationResponse> VerifyAsync(List<GeneratedCodeFile> files)
    {
        var response = new VerificationResponse();
        var sw = Stopwatch.StartNew();
        var tempDir = Path.Combine(Path.GetTempPath(), $"maci_{Guid.NewGuid():N}");

        try
        {
            // Write generated files to temp directory
            Directory.CreateDirectory(tempDir);
            var pyFiles = new List<string>();

            foreach (var file in files)
            {
                if (string.IsNullOrWhiteSpace(file.Content)) continue;
                var safePath = file.Path.Replace('/', Path.DirectorySeparatorChar);
                var filePath = Path.Combine(tempDir, safePath);
                var dir = Path.GetDirectoryName(filePath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                await File.WriteAllTextAsync(filePath, file.Content);
                if (filePath.EndsWith(".py")) pyFiles.Add(filePath);
            }

            // Create __init__.py in subdirectories so imports work
            CreateInitFiles(tempDir);

            // Find Python
            var python = await FindPythonAsync();
            if (python == null)
            {
                response.Techniques.Add(new VerificationTechnique
                {
                    Id = 0, Name = "Python Check", Status = "ERROR",
                    Details = "Python not found on system. Install Python 3.8+ to enable verification."
                });
                response.OverallVerdict = "ERROR";
                return response;
            }

            _logger.LogInformation("Running verification in {TempDir} with {Python}", tempDir, python);

            // Run all 5 techniques
            var t1 = await RunTechnique1_AstParse(python, tempDir);
            var t2 = await RunTechnique2_ImportCheck(python, tempDir);
            var t3 = await RunTechnique3_Pytest(python, tempDir);
            var t4 = ExtractTechnique4_RuntimeErrors(t3);
            var t5 = await RunTechnique5_Mypy(python, tempDir);

            response.Techniques = new List<VerificationTechnique> { t1, t2, t3, t4, t5 };
            response.TotalPassed = response.Techniques.Count(t => t.Status == "PASS");
            response.TotalFailed = response.Techniques.Count(t => t.Status == "FAIL");
            response.TotalSkipped = response.Techniques.Count(t => t.Status == "SKIP");

            response.OverallVerdict = response.Techniques.Any(t => t.Status == "FAIL")
                ? "FAIL"
                : response.Techniques.All(t => t.Status is "PASS" or "SKIP")
                    ? "PASS" : "PARTIAL";

            // Compute research paper metrics
            response.Metrics = await ComputeCodeMetrics(python, tempDir, t1, t3, t4);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Verification failed unexpectedly");
            response.OverallVerdict = "ERROR";
        }
        finally
        {
            sw.Stop();
            response.TotalDurationMs = sw.ElapsedMilliseconds;
            try { Directory.Delete(tempDir, true); } catch { }
        }

        return response;
    }

    // ------------------------------------------------------------------ Technique 1: AST Parse

    private async Task<VerificationTechnique> RunTechnique1_AstParse(string python, string tempDir)
    {
        var technique = new VerificationTechnique { Id = 1, Name = "Syntax / AST Parsing" };
        var sw = Stopwatch.StartNew();

        try
        {
            var scriptPath = Path.Combine(tempDir, "_maci_ast_check.py");
            await File.WriteAllTextAsync(scriptPath, AST_PARSE_SCRIPT);

            var (exitCode, stdout, stderr) = await RunCommandAsync(python, $"\"{scriptPath}\" \"{tempDir}\"", tempDir);

            if (!string.IsNullOrWhiteSpace(stdout))
            {
                var results = JsonSerializer.Deserialize<List<AstResult>>(stdout);
                if (results != null)
                {
                    var failures = results.Where(r => !r.ok).ToList();
                    foreach (var fail in failures)
                    {
                        technique.Issues.Add(new VerificationIssue
                        {
                            File = fail.file ?? "",
                            Line = fail.line,
                            Message = fail.message ?? "Syntax error",
                            Severity = "ERROR"
                        });
                    }
                    var total = results.Count;
                    technique.Status = failures.Count == 0 ? "PASS" : "FAIL";
                    technique.Details = failures.Count == 0
                        ? $"All {total} Python files parsed successfully"
                        : $"{failures.Count}/{total} file(s) have syntax errors";
                }
            }
            else
            {
                technique.Status = "PASS";
                technique.Details = "No Python files to check";
            }
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"AST check error: {ex.Message}";
        }

        technique.DurationMs = sw.ElapsedMilliseconds;
        return technique;
    }

    // ------------------------------------------------------------------ Technique 2: Import Check

    private async Task<VerificationTechnique> RunTechnique2_ImportCheck(string python, string tempDir)
    {
        var technique = new VerificationTechnique { Id = 2, Name = "Import / API Hallucination Detection" };
        var sw = Stopwatch.StartNew();

        try
        {
            var scriptPath = Path.Combine(tempDir, "_maci_import_check.py");
            await File.WriteAllTextAsync(scriptPath, IMPORT_CHECK_SCRIPT);

            var (exitCode, stdout, stderr) = await RunCommandAsync(python, $"\"{scriptPath}\" \"{tempDir}\"", tempDir);

            if (!string.IsNullOrWhiteSpace(stdout))
            {
                var results = JsonSerializer.Deserialize<List<ImportResult>>(stdout);
                if (results != null)
                {
                    var failures = results.Where(r => !r.ok).ToList();
                    foreach (var fail in failures)
                    {
                        technique.Issues.Add(new VerificationIssue
                        {
                            File = fail.module ?? "",
                            Message = fail.message ?? $"Module '{fail.module}' not found",
                            Severity = "ERROR"
                        });
                    }
                    technique.Status = failures.Count == 0 ? "PASS" : "FAIL";
                    technique.Details = failures.Count == 0
                        ? $"All {results.Count} imports verified"
                        : $"{failures.Count} import(s) could not be resolved: {string.Join(", ", failures.Select(f => f.module))}";
                }
            }
            else
            {
                technique.Status = "PASS";
                technique.Details = "No imports to check";
            }
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"Import check error: {ex.Message}";
        }

        technique.DurationMs = sw.ElapsedMilliseconds;
        return technique;
    }

    // ------------------------------------------------------------------ Technique 3: Pytest Execution

    private async Task<VerificationTechnique> RunTechnique3_Pytest(string python, string tempDir)
    {
        var technique = new VerificationTechnique { Id = 3, Name = "Unit Test Execution (pytest)" };
        var sw = Stopwatch.StartNew();

        try
        {
            // Check if pytest is available
            var (checkExit, _, _) = await RunCommandAsync(python, "-m pytest --version", tempDir, 5000);
            if (checkExit != 0)
            {
                technique.Status = "SKIP";
                technique.Details = "pytest not installed. Run: pip install pytest";
                technique.DurationMs = sw.ElapsedMilliseconds;
                return technique;
            }

            // Run pytest
            var (exitCode, stdout, stderr) = await RunCommandAsync(
                python,
                $"-m pytest \"{tempDir}\" --tb=short -q --no-header 2>&1",
                tempDir,
                60000 // 60 second timeout for test execution
            );

            var output = $"{stdout}\n{stderr}".Trim();
            technique.Details = output;

            // Parse pytest output for pass/fail counts
            if (exitCode == 0)
            {
                technique.Status = "PASS";
                // Try to extract "X passed" from output
                var passMatch = System.Text.RegularExpressions.Regex.Match(output, @"(\d+)\s+passed");
                if (passMatch.Success)
                    technique.Details = $"{passMatch.Groups[1].Value} test(s) passed";
            }
            else if (exitCode == 5)
            {
                // Exit code 5 = no tests collected
                technique.Status = "SKIP";
                technique.Details = "No test functions found in generated code";
            }
            else
            {
                technique.Status = "FAIL";
                // Extract failure details
                var failMatch = System.Text.RegularExpressions.Regex.Match(output, @"(\d+)\s+failed");
                var passMatch = System.Text.RegularExpressions.Regex.Match(output, @"(\d+)\s+passed");
                var failed = failMatch.Success ? failMatch.Groups[1].Value : "?";
                var passed = passMatch.Success ? passMatch.Groups[1].Value : "0";
                technique.Details = $"{failed} test(s) failed, {passed} passed";

                // Extract individual failure messages
                var errorLines = output.Split('\n')
                    .Where(l => l.Contains("FAILED") || l.Contains("ERROR") || l.Contains("assert"))
                    .Take(10)
                    .ToList();
                foreach (var line in errorLines)
                {
                    technique.Issues.Add(new VerificationIssue
                    {
                        Message = line.Trim(),
                        Severity = "ERROR"
                    });
                }
            }
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"pytest execution error: {ex.Message}";
        }

        technique.DurationMs = sw.ElapsedMilliseconds;
        return technique;
    }

    // ------------------------------------------------------------------ Technique 4: Runtime Error Detection

    private VerificationTechnique ExtractTechnique4_RuntimeErrors(VerificationTechnique pytestResult)
    {
        var technique = new VerificationTechnique { Id = 4, Name = "Runtime Error Detection" };
        var sw = Stopwatch.StartNew();

        var runtimeErrors = new[] { "ImportError", "ModuleNotFoundError", "TypeError", "NameError",
            "AttributeError", "ValueError", "KeyError", "IndexError", "RuntimeError",
            "FileNotFoundError", "ZeroDivisionError", "RecursionError" };

        if (!string.IsNullOrEmpty(pytestResult.Details))
        {
            var lines = pytestResult.Details.Split('\n');
            foreach (var line in lines)
            {
                foreach (var errType in runtimeErrors)
                {
                    if (line.Contains(errType))
                    {
                        technique.Issues.Add(new VerificationIssue
                        {
                            Message = line.Trim(),
                            Severity = "ERROR"
                        });
                        break;
                    }
                }
            }
        }

        technique.Status = technique.Issues.Count == 0 ? "PASS" : "FAIL";
        technique.Details = technique.Issues.Count == 0
            ? "No runtime errors detected during test execution"
            : $"{technique.Issues.Count} runtime error(s) detected";

        // If pytest was skipped, we can't detect runtime errors
        if (pytestResult.Status == "SKIP")
        {
            technique.Status = "SKIP";
            technique.Details = "Skipped — pytest was not available";
        }

        technique.DurationMs = sw.ElapsedMilliseconds;
        return technique;
    }

    // ------------------------------------------------------------------ Technique 5: mypy Type Check

    private async Task<VerificationTechnique> RunTechnique5_Mypy(string python, string tempDir)
    {
        var technique = new VerificationTechnique { Id = 5, Name = "Type Checking (mypy)" };
        var sw = Stopwatch.StartNew();

        try
        {
            // Check if mypy is available
            var (checkExit, _, _) = await RunCommandAsync(python, "-m mypy --version", tempDir, 5000);
            if (checkExit != 0)
            {
                technique.Status = "SKIP";
                technique.Details = "mypy not installed. Run: pip install mypy";
                technique.DurationMs = sw.ElapsedMilliseconds;
                return technique;
            }

            // Collect .py files (excluding our helper scripts)
            var pyFiles = Directory.GetFiles(tempDir, "*.py", SearchOption.AllDirectories)
                .Where(f => !Path.GetFileName(f).StartsWith("_maci_"))
                .ToList();

            if (pyFiles.Count == 0)
            {
                technique.Status = "PASS";
                technique.Details = "No Python files to type-check";
                technique.DurationMs = sw.ElapsedMilliseconds;
                return technique;
            }

            var fileArgs = string.Join(" ", pyFiles.Select(f => $"\"{f}\""));
            var (exitCode, stdout, stderr) = await RunCommandAsync(
                python,
                $"-m mypy --ignore-missing-imports --no-error-summary {fileArgs}",
                tempDir,
                30000
            );

            var output = $"{stdout}\n{stderr}".Trim();
            var errorCount = 0;

            foreach (var line in output.Split('\n'))
            {
                if (line.Contains(": error:"))
                {
                    errorCount++;
                    var relLine = line;
                    // Make path relative
                    if (relLine.Contains(tempDir))
                        relLine = relLine.Replace(tempDir + Path.DirectorySeparatorChar, "");

                    technique.Issues.Add(new VerificationIssue
                    {
                        Message = relLine.Trim(),
                        Severity = "WARNING"
                    });
                }
            }

            technique.Status = errorCount == 0 ? "PASS" : "FAIL";
            technique.Details = errorCount == 0
                ? $"Type checking passed for {pyFiles.Count} file(s)"
                : $"{errorCount} type error(s) found";
        }
        catch (Exception ex)
        {
            technique.Status = "ERROR";
            technique.Details = $"mypy check error: {ex.Message}";
        }

        technique.DurationMs = sw.ElapsedMilliseconds;
        return technique;
    }

    // ------------------------------------------------------------------ Code Metrics (research paper)

    private async Task<CodeMetrics> ComputeCodeMetrics(
        string python, string tempDir,
        VerificationTechnique t1Ast,
        VerificationTechnique t3Pytest,
        VerificationTechnique t4Runtime)
    {
        var metrics = new CodeMetrics();
        try
        {
            var scriptPath = Path.Combine(tempDir, "_maci_metrics.py");
            await File.WriteAllTextAsync(scriptPath, CODE_METRICS_SCRIPT);
            var (_, stdout, _) = await RunCommandAsync(python, $"\"{scriptPath}\" \"{tempDir}\"", tempDir, 15000);

            if (!string.IsNullOrWhiteSpace(stdout))
            {
                var doc = System.Text.Json.JsonDocument.Parse(stdout);
                var root = doc.RootElement;
                metrics.TotalLinesOfCode     = root.TryGetProperty("total_loc",     out var loc)  ? loc.GetInt32()    : 0;
                metrics.AvgCyclomaticComplexity = root.TryGetProperty("avg_cc",     out var acc)  ? acc.GetDouble()   : 0;
                metrics.MaxCyclomaticComplexity = root.TryGetProperty("max_cc",     out var mcc)  ? mcc.GetInt32()    : 0;
                metrics.TotalApiCount        = root.TryGetProperty("api_count",     out var api)  ? api.GetInt32()    : 0;
                metrics.CommentCodeRatio     = root.TryGetProperty("comment_ratio", out var ccr)  ? ccr.GetDouble()   : 0;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Code metrics computation failed: {Msg}", ex.Message);
        }

        // Pass rate from pytest output
        if (t3Pytest.Status == "PASS" || t3Pytest.Status == "FAIL")
        {
            var pytestDetails = t3Pytest.Details ?? "";
            var passMatch = System.Text.RegularExpressions.Regex.Match(pytestDetails, @"(\d+)\s+passed");
            var failMatch = System.Text.RegularExpressions.Regex.Match(pytestDetails, @"(\d+)\s+failed");
            metrics.PassedTests  = passMatch.Success ? int.Parse(passMatch.Groups[1].Value) : (t3Pytest.Status == "PASS" ? 1 : 0);
            metrics.FailedTests  = failMatch.Success ? int.Parse(failMatch.Groups[1].Value) : 0;
            metrics.TotalTests   = metrics.PassedTests + metrics.FailedTests;
            metrics.PassRate     = metrics.TotalTests > 0
                ? Math.Round((double)metrics.PassedTests / metrics.TotalTests * 100, 1)
                : (t3Pytest.Status == "PASS" ? 100.0 : 0.0);
        }

        // Bug distribution
        metrics.SyntaxBugCount   = t1Ast.Status == "FAIL"    ? t1Ast.Issues.Count    : 0;
        metrics.RuntimeBugCount  = t4Runtime.Status == "FAIL" ? t4Runtime.Issues.Count : 0;
        metrics.FunctionalBugCount = t3Pytest.Status == "FAIL"
            ? Math.Max(0, t3Pytest.Issues.Count - metrics.RuntimeBugCount)
            : 0;

        return metrics;
    }

    // ------------------------------------------------------------------ helpers

    private async Task<string?> FindPythonAsync()
    {
        // Try python, then python3
        foreach (var cmd in new[] { "python", "python3" })
        {
            try
            {
                var (exit, stdout, _) = await RunCommandAsync(cmd, "--version", ".", 5000);
                if (exit == 0 && stdout.Contains("Python"))
                {
                    _logger.LogInformation("Found Python: {Cmd} → {Version}", cmd, stdout.Trim());
                    return cmd;
                }
            }
            catch { }
        }
        return null;
    }

    private async Task<(int exitCode, string stdout, string stderr)> RunCommandAsync(
        string command, string arguments, string workDir, int timeoutMs = 30000)
    {
        var psi = new ProcessStartInfo
        {
            FileName = command,
            Arguments = arguments,
            WorkingDirectory = workDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = psi };
        process.Start();

        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();

        var completed = process.WaitForExit(timeoutMs);
        if (!completed)
        {
            try { process.Kill(true); } catch { }
            return (-1, await stdoutTask, "Process timed out");
        }

        return (process.ExitCode, await stdoutTask, await stderrTask);
    }

    private void CreateInitFiles(string rootDir)
    {
        foreach (var dir in Directory.GetDirectories(rootDir, "*", SearchOption.AllDirectories))
        {
            // If directory contains .py files, create __init__.py
            if (Directory.GetFiles(dir, "*.py").Length > 0)
            {
                var initPath = Path.Combine(dir, "__init__.py");
                if (!File.Exists(initPath))
                {
                    File.WriteAllText(initPath, "");
                }
            }
        }
    }

    // ------------------------------------------------------------------ JSON helper types

    private record AstResult(string? file, bool ok, int? line, string? message);
    private record ImportResult(string? module, bool ok, string? message, bool? local);
}
