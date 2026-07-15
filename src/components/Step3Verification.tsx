import React from 'react';
import { AIResultData } from '../types';
import { VerificationResponse } from '../services/verificationService';
import {
  ArrowLeft, ShieldCheck, ShieldAlert, Ban, Loader2, WifiOff,
  CheckCircle2, XCircle, AlertTriangle, HelpCircle, Terminal, Download
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
      case 'PASS':
        return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      case 'FAIL':
        return <XCircle className="w-5 h-5 text-rose-400" />;
      case 'SKIP':
        return <HelpCircle className="w-5 h-5 text-amber-400" />;
      case 'ERROR':
        return <AlertTriangle className="w-5 h-5 text-rose-500" />;
      default:
        return <Loader2 className="w-5 h-5 text-[color:var(--color-ink-faint)] animate-spin" />;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'PASS':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'FAIL':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'SKIP':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'ERROR':
        return 'bg-rose-500/20 text-rose-500 border-rose-500/30';
      default:
        return 'chip';
    }
  };

  const allIssues = backendVerification?.techniques.flatMap(t => 
    t.issues.map(i => ({ ...i, techniqueName: t.name }))
  ) || [];

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
               ? `Successfully verified all correctness parameters. Clean syntax, imports, tests passed, and type-checks completed in ${backendVerification.totalDurationMs}ms.`
               : `Failed verification. Checked ${backendVerification.totalPassed} techniques successfully, but found issues in ${backendVerification.totalFailed} check(s).`}
            </p>
          </div>
        </div>
      </div>

      {/* 5 Real Verification Techniques Grid */}
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
              const isSkip = t.status === 'SKIP';
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

      {/* Execution Issues & Tracebacks */}
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

      {/* pytest Output Logs */}
      {backendVerification && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
            <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">pytest Process Console Output</h2>
          </div>
          <pre className="p-4 rounded-xl bg-[#0a0b0f] border border-[color:var(--color-hairline)] font-mono text-xs text-[color:var(--color-ink-muted)] overflow-x-auto max-h-80 whitespace-pre-wrap">
            {backendVerification.techniques.find(t => t.id === 3)?.details || "No pytest execution logs available."}
          </pre>
        </div>
      )}
    </div>
  );
};
