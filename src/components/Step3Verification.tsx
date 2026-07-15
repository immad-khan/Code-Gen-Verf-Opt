import React from 'react';
import { AIResultData } from '../types';
import { VerificationResponse } from '../services/verificationService';
import {
  ArrowLeft, ShieldCheck, ShieldAlert, Ban, Loader2, WifiOff,
  CheckCircle2, XCircle, AlertTriangle, HelpCircle, Terminal, Download,
  Bug, BarChart2, Zap, Code2, GitBranch, BookOpen, Layers
} from 'lucide-react';

interface Step3VerificationProps {
  result: AIResultData;
  onUpdateFindings?: (newFindings: any[]) => void;
  onBackToCode: () => void;
  onBackToPrompt: () => void;
  onExport: () => void;
  backendVerification: VerificationResponse | null;
  isVerifying: boolean;
}

export const Step3Verification: React.FC<Step3VerificationProps> = ({
  onBackToCode,
  onExport,
  backendVerification,
  isVerifying
}) => {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PASS':   return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      case 'FAIL':   return <XCircle className="w-5 h-5 text-rose-400" />;
      case 'SKIP':   return <HelpCircle className="w-5 h-5 text-amber-400" />;
      case 'ERROR':  return <AlertTriangle className="w-5 h-5 text-rose-500" />;
      default:       return <Loader2 className="w-5 h-5 text-[color:var(--color-ink-faint)] animate-spin" />;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'PASS':  return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'FAIL':  return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'SKIP':  return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'ERROR': return 'bg-rose-500/20 text-rose-500 border-rose-500/30';
      default:      return 'chip';
    }
  };

  const m = backendVerification?.metrics;
  const allIssues = backendVerification?.techniques.flatMap(t =>
    t.issues.map(i => ({ ...i, techniqueName: t.name }))
  ) || [];

  const totalBugs = (m?.syntaxBugCount ?? 0) + (m?.runtimeBugCount ?? 0) + (m?.functionalBugCount ?? 0);

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-6 py-8 flex flex-col gap-6 animate-fade-up">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={onBackToCode} className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] transition mb-2 cursor-pointer">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to code
          </button>
          <h1 className="text-xl font-bold tracking-tight text-[color:var(--color-ink)]">Execution Verification Report</h1>
          <p className="text-sm text-[color:var(--color-ink-muted)] mt-0.5">
            Real-time execution verification on target Python environment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="btn-ghost px-3.5 py-2 text-sm cursor-pointer">Print</button>
          <button onClick={onExport} className="btn-primary px-4 py-2 text-sm flex items-center gap-2">
            <Download className="w-4 h-4" /> Export report
          </button>
        </div>
      </div>

      {/* Main Status Banner */}
      <div className={`card overflow-hidden ${
        isVerifying ? 'border-[color:var(--color-hairline)]'
        : !backendVerification ? 'border-amber-500/30'
        : backendVerification.overallVerdict === 'PASS' ? 'border-emerald-500/30'
        : 'border-rose-500/30'
      }`}>
        <div className="flex items-start gap-4 p-5">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
            isVerifying ? 'bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-faint)]'
            : !backendVerification ? 'bg-amber-500/12 text-amber-400'
            : backendVerification.overallVerdict === 'PASS' ? 'bg-emerald-500/12 text-emerald-400'
            : 'bg-rose-500/12 text-rose-400'
          }`}>
            {isVerifying ? <Loader2 className="w-5 h-5 animate-spin" />
             : !backendVerification ? <WifiOff className="w-5 h-5" />
             : backendVerification.overallVerdict === 'PASS' ? <ShieldCheck className="w-5 h-5" />
             : <Ban className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold ${
                isVerifying ? 'text-[color:var(--color-ink-muted)]'
                : !backendVerification ? 'text-amber-400'
                : backendVerification.overallVerdict === 'PASS' ? 'text-emerald-400'
                : 'text-rose-400'
              }`}>
                {isVerifying ? 'Running execution tests...'
                 : !backendVerification ? 'Verification Offline'
                 : backendVerification.overallVerdict === 'PASS' ? 'Verification Passed'
                 : 'Verification Failed'}
              </span>
              <span className="eyebrow">Execution Verdict</span>
            </div>
            <p className="text-sm text-[color:var(--color-ink-muted)] mt-1 leading-relaxed">
              {isVerifying ? 'Executing syntax parsing, import verification, unit test suites, and type-checks.'
               : !backendVerification ? 'The verification server could not be reached. Ensure the backend C# service is running.'
               : backendVerification.overallVerdict === 'PASS'
               ? `All correctness checks passed. Clean syntax, imports, tests, and type-checks completed in ${backendVerification.totalDurationMs}ms.`
               : `Verification found issues. Checked ${backendVerification.totalPassed} techniques successfully, ${backendVerification.totalFailed} failed.`}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Research Paper Metrics Panel ─── */}
      {backendVerification && m && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-5">
            <BarChart2 className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
            <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Code Analysis Metrics</h2>
            <span className="eyebrow ml-auto">Pre-optimization · Research Paper Aligned</span>
          </div>

          {/* Row 1: Core Verification */}
          <div className="mb-4">
            <p className="text-[10px] font-semibold text-[color:var(--color-ink-faint)] uppercase tracking-widest mb-2">Core Verification</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Pass Rate */}
              <div className="card-quiet p-3.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <Zap className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wide">Pass Rate</span>
                </div>
                <span className={`text-2xl font-extrabold tracking-tight ${m.passRate >= 80 ? 'text-emerald-400' : m.passRate >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {m.passRate.toFixed(1)}%
                </span>
                <span className="text-[10px] text-[color:var(--color-ink-faint)]">{m.passedTests}/{m.totalTests} tests passed</span>
              </div>

              {/* Syntax Bugs */}
              <div className="card-quiet p-3.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <Bug className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-[10px] font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wide">Syntax Bugs</span>
                </div>
                <span className={`text-2xl font-extrabold tracking-tight ${m.syntaxBugCount === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {m.syntaxBugCount}
                </span>
                <span className="text-[10px] text-[color:var(--color-ink-faint)]">AST parse failures</span>
              </div>

              {/* Runtime Bugs */}
              <div className="card-quiet p-3.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <Bug className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wide">Runtime Bugs</span>
                </div>
                <span className={`text-2xl font-extrabold tracking-tight ${m.runtimeBugCount === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {m.runtimeBugCount}
                </span>
                <span className="text-[10px] text-[color:var(--color-ink-faint)]">Exceptions during tests</span>
              </div>

              {/* Functional Bugs */}
              <div className="card-quiet p-3.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <Bug className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-[10px] font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wide">Functional Bugs</span>
                </div>
                <span className={`text-2xl font-extrabold tracking-tight ${m.functionalBugCount === 0 ? 'text-emerald-400' : 'text-sky-400'}`}>
                  {m.functionalBugCount}
                </span>
                <span className="text-[10px] text-[color:var(--color-ink-faint)]">Test assertion failures</span>
              </div>
            </div>
          </div>

          {/* Bug Distribution Bar */}
          {totalBugs > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold text-[color:var(--color-ink-faint)] uppercase tracking-widest mb-1.5">Bug Distribution</p>
              <div className="flex h-2.5 rounded-full overflow-hidden gap-px bg-[color:var(--color-surface-3)]">
                {m.syntaxBugCount > 0 && (
                  <div style={{ width: `${(m.syntaxBugCount / totalBugs) * 100}%` }} className="bg-rose-500 rounded-l-full" title={`Syntax: ${m.syntaxBugCount}`} />
                )}
                {m.runtimeBugCount > 0 && (
                  <div style={{ width: `${(m.runtimeBugCount / totalBugs) * 100}%` }} className="bg-amber-500" title={`Runtime: ${m.runtimeBugCount}`} />
                )}
                {m.functionalBugCount > 0 && (
                  <div style={{ width: `${(m.functionalBugCount / totalBugs) * 100}%` }} className="bg-sky-500 rounded-r-full" title={`Functional: ${m.functionalBugCount}`} />
                )}
              </div>
              <div className="flex gap-4 mt-1.5">
                <span className="text-[10px] flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500 inline-block" />Syntax</span>
                <span className="text-[10px] flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />Runtime</span>
                <span className="text-[10px] flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-500 inline-block" />Functional</span>
              </div>
            </div>
          )}

          {/* Row 2: Code Quality / Complexity */}
          <div>
            <p className="text-[10px] font-semibold text-[color:var(--color-ink-faint)] uppercase tracking-widest mb-2">Code Quality & Complexity</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* LoC */}
              <div className="card-quiet p-3.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <Code2 className="w-3.5 h-3.5 text-[color:var(--color-brand-soft)]" />
                  <span className="text-[10px] font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wide">Lines of Code</span>
                </div>
                <span className="text-2xl font-extrabold tracking-tight text-[color:var(--color-ink)]">{m.totalLinesOfCode}</span>
                <span className="text-[10px] text-[color:var(--color-ink-faint)]">Non-blank lines (LoC)</span>
              </div>

              {/* Avg CC */}
              <div className="card-quiet p-3.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <GitBranch className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-[10px] font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wide">Avg CC</span>
                </div>
                <span className={`text-2xl font-extrabold tracking-tight ${m.avgCyclomaticComplexity <= 5 ? 'text-emerald-400' : m.avgCyclomaticComplexity <= 10 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {m.avgCyclomaticComplexity.toFixed(1)}
                </span>
                <span className="text-[10px] text-[color:var(--color-ink-faint)]">McCabe avg · max: {m.maxCyclomaticComplexity}</span>
              </div>

              {/* API Count */}
              <div className="card-quiet p-3.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-[10px] font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wide">API / Imports</span>
                </div>
                <span className="text-2xl font-extrabold tracking-tight text-[color:var(--color-ink)]">{m.totalApiCount}</span>
                <span className="text-[10px] text-[color:var(--color-ink-faint)]">Distinct library calls</span>
              </div>

              {/* Comment/Code Ratio */}
              <div className="card-quiet p-3.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <BookOpen className="w-3.5 h-3.5 text-teal-400" />
                  <span className="text-[10px] font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wide">Comment Ratio</span>
                </div>
                <span className="text-2xl font-extrabold tracking-tight text-[color:var(--color-ink)]">
                  {(m.commentCodeRatio * 100).toFixed(1)}%
                </span>
                <span className="text-[10px] text-[color:var(--color-ink-faint)]">Comment lines / code lines</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Verification Techniques Grid */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-[color:var(--color-ink)] mb-4">Verification Techniques</h2>

        {isVerifying && !backendVerification && (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-[color:var(--color-ink-muted)] gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-[color:var(--color-brand-soft)]" />
            <span>Running AST check, import checks, pytest suite, and type checking...</span>
          </div>
        )}

        {!isVerifying && !backendVerification && (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-[color:var(--color-ink-faint)] gap-2">
            <WifiOff className="w-6 h-6" />
            <span>Backend verification service offline</span>
          </div>
        )}

        {backendVerification && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {backendVerification.techniques.map((t) => {
              const isPass = t.status === 'PASS';
              const isFail = t.status === 'FAIL';
              return (
                <div key={t.id} className={`card-quiet p-4 flex flex-col justify-between min-h-[140px] transition ${
                  isPass ? 'border-emerald-500/20 bg-emerald-500/[0.01]'
                  : isFail ? 'border-rose-500/20 bg-rose-500/[0.01]'
                  : 'border-amber-500/20 bg-amber-500/[0.01]'
                }`}>
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold text-[color:var(--color-ink)] leading-snug">{t.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border ${getStatusClass(t.status)}`}>
                        {t.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-[color:var(--color-ink-muted)] leading-relaxed">{t.details}</p>
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-2 border-t border-[color:var(--color-hairline)]/40">
                    <span className="text-[9px] font-mono text-[color:var(--color-ink-faint)]">{t.durationMs}ms</span>
                    {getStatusIcon(t.status)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Execution Issues */}
      {backendVerification && allIssues.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Execution Issues &amp; Compiler Details</h2>
          </div>
          <div className="space-y-3">
            {backendVerification.techniques.filter(t => t.issues.length > 0).map((t) => (
              <div key={t.id} className="border border-[color:var(--color-hairline)] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-[color:var(--color-surface-2)] border-b border-[color:var(--color-hairline)] flex items-center justify-between">
                  <span className="text-xs font-semibold text-[color:var(--color-ink)]">{t.name}</span>
                  <span className="text-[10px] text-rose-400 font-mono">{t.issues.length} issue(s)</span>
                </div>
                <div className="p-3 bg-[#0a0b0f] font-mono text-xs text-rose-300/90 overflow-x-auto space-y-2">
                  {t.issues.map((issue, idx) => (
                    <div key={idx} className="flex items-start gap-2 py-1 border-b border-white/[0.03] last:border-0">
                      <span className="text-rose-500 shrink-0 select-none">❯</span>
                      <div className="whitespace-pre-wrap">
                        {issue.file && <span className="text-sky-400 underline mr-1.5">{issue.file}{issue.line ? `:${issue.line}` : ''}</span>}
                        {issue.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* pytest Console Output */}
      {backendVerification && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
            <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">pytest Process Console Output</h2>
          </div>
          <pre className="p-4 rounded-xl bg-[#0a0b0f] border border-[color:var(--color-hairline)] font-mono text-xs text-[color:var(--color-ink-muted)] overflow-x-auto max-h-80 whitespace-pre-wrap">
            {backendVerification.techniques.find(t => t.id === 3)?.details || 'No pytest execution logs available.'}
          </pre>
        </div>
      )}
    </div>
  );
};
