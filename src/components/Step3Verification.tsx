import React from 'react';
import { AIResultData } from '../types';
import { VerificationResponse } from '../services/verificationService';
import {
  ArrowLeft, AlertTriangle, Info,
  Terminal, BarChart2, ChevronDown, ChevronUp, Sparkles, CheckCircle2, HelpCircle, RefreshCw, XCircle
} from 'lucide-react';

interface Step3VerificationProps {
  result: AIResultData;
  onUpdateFindings?: (newFindings: any[]) => void;
  onBackToCode: () => void;
  onBackToPrompt: () => void;
  onExport?: () => void;
  onProceedToOptimization?: () => void;
  backendVerification: VerificationResponse | null;
  verificationError?: string | null;
  isVerifying: boolean;
  onRetryVerification?: () => void;
}

export const Step3Verification: React.FC<Step3VerificationProps> = ({
  result: _result,
  onBackToCode,
  onProceedToOptimization,
  backendVerification,
  verificationError,
  isVerifying,
  onRetryVerification,
}) => {
  const [showDetailedLogs, setShowDetailedLogs] = React.useState(false);

  const m = backendVerification?.metrics;
  const hasResult = Boolean(backendVerification);
  
  // Real metrics calculated directly from backend verification results
  const passRate = m?.passRate != null
    ? Math.round(m.passRate)
    : backendVerification
      ? Math.round((backendVerification.totalPassed / Math.max(1, backendVerification.totalPassed + backendVerification.totalFailed)) * 100)
      : null;

  const passedTests = m?.passedTests ?? (backendVerification ? backendVerification.totalPassed : null);
  const totalTests = m?.totalTests ?? (backendVerification ? (backendVerification.totalPassed + backendVerification.totalFailed) : null);

  // Helper to explain why any issue is a problem
  const getWhyItIsAnIssue = (msg: string, tech: string) => {
    const text = (msg || '').toLowerCase();
    if (text.includes('syntaxerror') || text.includes('syntax')) {
      return 'Invalid Python syntax prevents the interpreter from parsing or compiling the code into bytecode. The program crashes immediately upon load.';
    }
    if (text.includes('indentationerror') || text.includes('taberror')) {
      return 'Python enforces whitespace indentation for code blocks. Misaligned indentation corrupts block scope and halts the interpreter before execution.';
    }
    if (text.includes('modulenotfounderror') || text.includes('importerror')) {
      return 'The required library or module does not exist in the environment or cannot be resolved, causing an unhandled startup crash.';
    }
    if (text.includes('assertionerror') || text.includes('assert')) {
      return 'The computed output does not match expected test assertions, indicating a functional algorithm defect or missing edge-case handling.';
    }
    if (text.includes('indexerror')) {
      return 'Attempted to access a sequence item outside its valid bounds, causing an unhandled runtime crash.';
    }
    if (text.includes('keyerror')) {
      return 'A dictionary key was accessed that does not exist in the collection, crashing execution without defensive .get() or membership guards.';
    }
    if (text.includes('zerodivisionerror')) {
      return 'Dividing or taking modulo by zero results in a fatal arithmetic crash when denominator inputs evaluate to zero.';
    }
    if (text.includes('nameerror') || text.includes('unboundlocalerror')) {
      return 'A variable, parameter, or helper is referenced before declaration or is misspelled, triggering an immediate crash at runtime.';
    }
    if (text.includes('typeerror')) {
      return 'An operation or function was invoked with incompatible types or wrong parameter count, violating the function signature contract.';
    }
    if (text.includes('attributeerror')) {
      return 'Calling a non-existent method or property on an object halts execution.';
    }
    if (text.includes('timeout') || text.includes('recursionerror')) {
      return 'Unbounded loops or missing recursion base cases prevent execution from terminating, causing process hang or stack overflow.';
    }
    if (tech.includes('Radon')) {
      return 'High cyclomatic complexity and low maintainability make the logic fragile, defect-prone, and difficult to test.';
    }
    if (tech.includes('Semgrep') || tech.includes('Security')) {
      return 'Identified security or correctness flaw that violates safe production standards.';
    }
    return 'Violates correctness, security, or runtime constraints, preventing this check from passing automated quality verification.';
  };

  // Compile real issues from backend verification techniques
  const allVerificationIssues = React.useMemo(() => {
    const list: Array<{
      id: string;
      title: string;
      source: string;
      severity: string;
      file: string;
      line?: number | string;
      message: string;
      whyIsThisAnIssue: string;
      snippet?: string;
      fix?: string;
    }> = [];

    if (backendVerification) {
      backendVerification.techniques.forEach(t => {
        t.issues.forEach((iss, iIdx) => {
          list.push({
            id: `backend-${t.id}-${iIdx}`,
            title: `${t.name}: ${iss.message.slice(0, 75)}`,
            source: t.name,
            severity: iss.severity || (t.status === 'FAIL' ? 'HIGH' : 'MEDIUM'),
            file: iss.file || 'project',
            line: iss.line,
            message: iss.message,
            whyIsThisAnIssue: getWhyItIsAnIssue(iss.message, t.name),
            snippet: iss.codeSnippet,
          });
        });
      });
    }

    return list;
  }, [backendVerification]);

  // Real issues extracted per technique
  const syntaxTechnique = backendVerification?.techniques.find(t => t.id === 1 || t.name.includes('Syntax'));
  const syntaxIssues = syntaxTechnique?.issues || [];

  const importTechnique = backendVerification?.techniques.find(t => t.id === 2 || t.name.includes('Import'));
  const importIssues = importTechnique?.issues || [];

  const runtimeTechnique = backendVerification?.techniques.find(t => t.id === 4 || t.name.includes('Runtime'));
  const runtimeIssues = runtimeTechnique?.issues || [];

  const typeTechnique = backendVerification?.techniques.find(t => t.id === 5 || t.name.includes('Type'));
  const typeIssues = typeTechnique?.issues || [];

  const scoreColor = passRate == null
    ? 'text-gray-400'
    : passRate >= 80
      ? 'text-emerald-500'
      : passRate >= 50
        ? 'text-amber-500'
        : 'text-red-500';

  const arcStroke = passRate == null
    ? '#4b5563'
    : passRate >= 80
      ? '#10b981'
      : passRate >= 50
        ? '#f59e0b'
        : '#ef4444';

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-8 py-6 flex flex-col gap-6 animate-fade-up">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[color:var(--color-hairline)]">
        <div>
          <button
            onClick={onBackToCode}
            className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] font-medium transition mb-1 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to code
          </button>
          <h1 className="text-2xl font-bold text-[color:var(--color-ink)] tracking-tight">Verification Results</h1>
        </div>
        <div className="flex items-center gap-3">
          {onProceedToOptimization && (
            <button
              onClick={onProceedToOptimization}
              className="btn-primary px-4 py-2 text-sm font-medium transition flex items-center gap-2 cursor-pointer shadow-[0_4px_14px_rgba(124,108,255,0.4)]"
            >
              <Sparkles className="w-4 h-4" /> Proceed to Optimization →
            </button>
          )}
        </div>
      </div>

      {/* Loading Banner */}
      {isVerifying && (
        <div className="p-4 bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)] text-[color:var(--color-ink)] rounded-xl flex items-center gap-3 text-sm animate-pulse">
          <div className="w-4 h-4 border-2 border-[color:var(--color-brand-soft)] border-t-transparent rounded-full animate-spin"></div>
          Running backend execution verification tests on Render...
        </div>
      )}

      {/* Real Error Banner: Shown when backend verification fails */}
      {verificationError && !isVerifying && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-red-200">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-red-300">Backend Execution Verification Failed</div>
              <div className="text-xs text-red-300/80 mt-1 font-mono break-all">{verificationError}</div>
              <div className="text-xs text-[color:var(--color-ink-muted)] mt-1.5">
                Ensure the backend on Render is awake and healthy.
              </div>
            </div>
          </div>
          {onRetryVerification && (
            <button
              onClick={onRetryVerification}
              className="btn-primary bg-red-600 hover:bg-red-500 text-white px-4 py-2 text-xs font-semibold rounded-lg shrink-0 flex items-center gap-1.5 transition self-start sm:self-center cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Verification
            </button>
          )}
        </div>
      )}

      {/* Top Row: 4 Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        
        {/* Card 1: Verification Score */}
        <div className="card p-5 flex flex-col items-center justify-between text-center min-h-[220px]">
          <h3 className="text-sm font-semibold text-[color:var(--color-ink)]">Verification Score</h3>
          
          <div className="relative flex flex-col items-center justify-center my-2">
            <svg className="w-36 h-20 overflow-visible" viewBox="0 0 160 90">
              <path
                d="M 15,80 A 65,65 0 0,1 145,80"
                fill="none"
                stroke="var(--color-surface-3)"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <path
                d="M 15,80 A 65,65 0 0,1 145,80"
                fill="none"
                stroke={arcStroke}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray="204"
                strokeDashoffset={204 - (204 * (passRate ?? 0)) / 100}
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute bottom-0 flex flex-col items-center">
              <span className={`text-2xl font-extrabold ${scoreColor}`}>
                {passRate != null ? `${passRate}%` : (isVerifying ? '...' : '--%')}
              </span>
            </div>
          </div>

          <p className="text-xs text-[color:var(--color-ink-muted)] font-normal">
            {backendVerification
              ? `Verdict: ${backendVerification.overallVerdict}`
              : (verificationError ? 'Verification unavailable' : 'Awaiting verification')}
          </p>
        </div>

        {/* Card 2: Coverage / Tests Statistics */}
        <div className="card p-5 flex flex-col items-center justify-between text-center min-h-[220px]">
          <h3 className="text-sm font-semibold text-[color:var(--color-ink)]">Test & Execution Rate</h3>
          
          <div className="my-auto">
            <div className={`text-4xl font-extrabold tracking-tight ${hasResult ? 'text-blue-500' : 'text-gray-500'}`}>
              {passRate != null ? `${passRate}%` : '--%'}
            </div>
            <div className="text-xs font-medium text-[color:var(--color-ink-muted)] mt-2">
              {hasResult ? 'Pytest Pass Rate' : 'Execution Status'}
            </div>
            <div className="text-xs text-[color:var(--color-ink-faint)] mt-0.5">
              {passedTests != null && totalTests != null
                ? `${passedTests} of ${totalTests} checks passed`
                : (isVerifying ? 'Running test runner...' : 'No test results')}
            </div>
          </div>

          <div className="w-full text-[11px] text-[color:var(--color-ink-faint)]">
            {backendVerification ? `${backendVerification.totalDurationMs} ms execution time` : ''}
          </div>
        </div>

        {/* Card 3: Syntax & AST Parsing */}
        <div className="card p-5 flex flex-col justify-between min-h-[220px]">
          <div>
            <div className="flex items-center gap-2 mb-3">
              {syntaxIssues.length > 0 ? (
                <AlertTriangle className="w-4 h-4 text-amber-500 fill-amber-500/20" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
              <h3 className="text-sm font-semibold text-[color:var(--color-ink)]">
                Syntax &amp; AST ({syntaxIssues.length})
              </h3>
            </div>
            {syntaxIssues.length === 0 ? (
              <div className="py-4 text-xs text-emerald-400/90 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{hasResult ? 'All Python files parsed cleanly without syntax errors.' : 'Waiting for syntax verification...'}</span>
              </div>
            ) : (
              <ul className="space-y-2">
                {syntaxIssues.slice(0, 4).map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs font-medium text-[color:var(--color-ink-muted)]">
                    <span className="w-3.5 h-3.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">!</span>
                    <span className="truncate">{item.file ? `${item.file}: ` : ''}{item.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[10px] text-[color:var(--color-ink-muted)]">
            <strong className="text-amber-400">Technique 1:</strong> Python AST compilation verification.
          </div>
        </div>

        {/* Card 4: Import Hallucinations */}
        <div className="card p-5 flex flex-col justify-between min-h-[220px]">
          <div>
            <div className="flex items-center gap-2 mb-3">
              {importIssues.length > 0 ? (
                <Info className="w-4 h-4 text-blue-500 fill-blue-500/20" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
              <h3 className="text-sm font-semibold text-[color:var(--color-ink)]">
                Import Resolution ({importIssues.length})
              </h3>
            </div>
            {importIssues.length === 0 ? (
              <div className="py-4 text-xs text-emerald-400/90 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{hasResult ? 'All imported modules and stdlib packages resolved.' : 'Waiting for import resolution...'}</span>
              </div>
            ) : (
              <ul className="space-y-2">
                {importIssues.slice(0, 4).map((iss, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs font-medium text-[color:var(--color-ink-muted)]">
                    <span className="w-3.5 h-3.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">i</span>
                    <span className="truncate">{iss.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[10px] text-[color:var(--color-ink-muted)]">
            <strong className="text-blue-400">Technique 2:</strong> Detects non-existent or hallucinated module imports.
          </div>
        </div>

      </div>

      {/* Bottom Row: 2 Detail Cards (Runtime + Types) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        {/* Card 5: Runtime Errors */}
        <div className="card p-5 min-h-[160px] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-4 h-4 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center text-[10px] font-bold">!</span>
              <h3 className="text-sm font-semibold text-[color:var(--color-ink)]">Runtime Errors ({runtimeIssues.length})</h3>
            </div>
            {runtimeIssues.length === 0 ? (
              <div className="text-xs text-emerald-400/90 flex items-center gap-2 py-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{hasResult ? 'No runtime crashes (NameError, TypeError, IndexError) observed.' : 'No runtime check data.'}</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {runtimeIssues.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2.5">
                    <span className="w-4 h-4 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 shrink-0 mt-0.5 flex items-center justify-center text-[10px] font-bold">!</span>
                    <div>
                      <div className="text-xs font-bold text-[color:var(--color-ink)]">{item.message}</div>
                      {item.file && <div className="text-[11px] text-[color:var(--color-ink-faint)] mt-0.5">{item.file}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[10px] text-[color:var(--color-ink-muted)]">
            <strong className="text-red-400">Technique 4:</strong> Isolated runtime execution crash diagnostics.
          </div>
        </div>

        {/* Card 6: Type Checking & Static Contracts */}
        <div className="card p-5 min-h-[160px] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 fill-amber-500/20" />
              <h3 className="text-sm font-semibold text-[color:var(--color-ink)]">Type Checking (mypy) ({typeIssues.length})</h3>
            </div>
            {typeIssues.length === 0 ? (
              <div className="text-xs text-emerald-400/90 flex items-center gap-2 py-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{hasResult ? 'All functions and type annotations satisfy static type contracts.' : 'No type check data.'}</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {typeIssues.slice(0, 4).map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-[color:var(--color-ink)]">{item.message}</div>
                      {item.file && <div className="text-[11px] text-[color:var(--color-ink-faint)] mt-0.5">{item.file}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[10px] text-[color:var(--color-ink-muted)]">
            <strong className="text-amber-400">Technique 5:</strong> Static type validation with mypy.
          </div>
        </div>

      </div>

      {/* Dedicated Section: Detected Verification Issues & Why They Matter */}
      <div className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[color:var(--color-hairline)] pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-bold text-[color:var(--color-ink)]">
                Detected Issues &amp; Root Cause Diagnostics
              </h3>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                allVerificationIssues.length > 0
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}>
                {allVerificationIssues.length > 0 ? `${allVerificationIssues.length} Issue(s) Diagnosed` : 'All Checks Clean'}
              </span>
            </div>
            <p className="text-xs text-[color:var(--color-ink-muted)] mt-1">
              Every identified issue is detailed below with an explanation of why it is an issue and how it threatens program execution.
            </p>
          </div>
        </div>

        {allVerificationIssues.length === 0 ? (
          <div className="p-5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-center gap-3 text-xs text-emerald-300">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <div className="font-semibold text-emerald-200">
                {hasResult ? 'No Blocking Verification Issues Detected' : 'No Verification Data Yet'}
              </div>
              <div className="text-[11px] text-[color:var(--color-ink-muted)] mt-0.5">
                {hasResult
                  ? 'The synthesized Python codebase satisfies AST parsing, imports, runtime checks, and unit tests cleanly.'
                  : (verificationError ? 'Backend verification encountered an error. Click Retry Verification above.' : 'Run verification to test the generated Python code.')}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            {allVerificationIssues.map((issue) => (
              <div
                key={issue.id}
                className="p-4 rounded-xl bg-[color:var(--color-surface-1)] border border-[color:var(--color-hairline)] space-y-3 hover:border-[#7c6cff]/40 transition"
              >
                {/* Issue Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                      issue.severity === 'CRITICAL'
                        ? 'bg-red-500/15 text-red-400 border-red-500/30'
                        : issue.severity === 'HIGH'
                        ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                        : issue.severity === 'MEDIUM'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                    }`}>
                      {issue.severity}
                    </span>
                    <span className="font-bold text-xs text-[color:var(--color-ink)]">
                      {issue.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-[color:var(--color-ink-muted)] font-mono">
                    <span className="px-2 py-0.5 rounded bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)]">
                      {issue.source}
                    </span>
                    {issue.file && (
                      <span className="text-[color:var(--color-brand-soft)]">
                        {issue.file}{issue.line ? `:${issue.line}` : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* What Happened / Message */}
                <div className="text-xs text-[color:var(--color-ink)] font-mono bg-[#090a10] p-2.5 rounded-lg border border-[color:var(--color-hairline)] text-rose-300/90 overflow-x-auto">
                  {issue.message}
                </div>

                {/* WHY IS THIS AN ISSUE Box */}
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Why is this an issue?</span>
                  </div>
                  <p className="text-xs text-[color:var(--color-ink)] leading-relaxed pl-5">
                    {issue.whyIsThisAnIssue}
                  </p>
                </div>

                {/* Snippet */}
                {issue.snippet && (
                  <div className="p-2.5 rounded-lg bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)] font-mono text-xs">
                    <div className="text-[10px] text-[color:var(--color-ink-muted)] mb-1 uppercase font-semibold">Offending Line</div>
                    <code className="text-[11px] text-rose-300">{issue.snippet}</code>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Expandable Technical Details Section */}
      <div className="card overflow-hidden mt-2">
        <button
          onClick={() => setShowDetailedLogs(!showDetailedLogs)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-[color:var(--color-surface-2)] transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[color:var(--color-ink-muted)]" />
            <span className="text-sm font-semibold text-[color:var(--color-ink)]">Detailed Backend Analysis &amp; Compiler Logs</span>
          </div>
          {showDetailedLogs ? (
            <ChevronUp className="w-4 h-4 text-[color:var(--color-ink-muted)]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[color:var(--color-ink-muted)]" />
          )}
        </button>

        {showDetailedLogs && (
          <div className="p-5 border-t border-[color:var(--color-hairline)] bg-[color:var(--color-surface-1)] space-y-5">
            {backendVerification && (
              <div>
                <h4 className="text-xs font-bold text-[color:var(--color-ink-muted)] uppercase tracking-wider mb-3">Verification Pipeline Checks</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {backendVerification.techniques.map(t => (
                    <div key={t.id} className="p-3 card-quiet border border-[color:var(--color-hairline)] rounded-lg flex items-center justify-between">
                      <span className="text-xs font-semibold text-[color:var(--color-ink)]">{t.name}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        t.status === 'PASS' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        {t.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="w-4 h-4 text-[color:var(--color-ink-muted)]" />
                <h4 className="text-xs font-bold text-[color:var(--color-ink-muted)] uppercase tracking-wider">Pytest Execution Console Output</h4>
              </div>
              <pre className="p-4 rounded-lg bg-[#0a0b0f] font-mono text-xs text-[color:var(--color-ink-muted)] overflow-x-auto max-h-60 whitespace-pre-wrap border border-[color:var(--color-hairline)]">
                {backendVerification?.techniques.find(t => t.id === 3)?.details || (verificationError ? `Verification error: ${verificationError}` : 'No execution logs available.')}
              </pre>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
