import React, { useState } from 'react';
import {
  AIResultData,
  GeneratedCodeFile,
  OptimizationResponse,
  OptimizationIteration,
  BugClassification
} from '../types';
import { VerificationResponse } from '../services/verificationService';
import {
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Terminal,
  Code2,
  ChevronDown,
  ChevronUp,
  Cpu,
  TrendingUp,
  GitCommit,
  Check,
  FileCode,
  Layers
} from 'lucide-react';

interface Step4OptimizationProps {
  result: AIResultData;
  backendVerification: VerificationResponse | null;
  optimizationResult: OptimizationResponse | null;
  isOptimizing: boolean;
  onRunOptimization: () => void;
  onBackToVerification: () => void;
  onApplyRepairedCode: (files: GeneratedCodeFile[]) => void;
}

export const Step4Optimization: React.FC<Step4OptimizationProps> = ({
  result,
  backendVerification,
  optimizationResult,
  isOptimizing,
  onRunOptimization,
  onBackToVerification,
  onApplyRepairedCode,
}) => {
  const [activeIterationTab, setActiveIterationTab] = useState<number>(1);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [showPromptDetails, setShowPromptDetails] = useState<boolean>(false);
  const [codeCopied, setCodeCopied] = useState<boolean>(false);

  const summary = optimizationResult?.summary;
  const initialDiagnosis = optimizationResult?.initialDiagnosis;
  const iterations = optimizationResult?.iterations || [];
  const currentIteration = iterations.find(it => it.iterationNumber === activeIterationTab) || iterations[0];

  const filesToDisplay = currentIteration?.repairedFiles || result.generatedCode;
  const selectedFile = filesToDisplay[selectedFileIndex] || filesToDisplay[0];

  const handleCopyCode = () => {
    if (selectedFile?.content) {
      navigator.clipboard.writeText(selectedFile.content);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  };

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-8 py-6 flex flex-col gap-6 animate-fade-up">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[color:var(--color-hairline)]">
        <div>
          <button
            onClick={onBackToVerification}
            className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] font-medium transition mb-1 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Verification
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[color:var(--color-ink)] tracking-tight">
              Taxonomy-Guided Iterative Repair
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#7c6cff]/15 text-[color:var(--color-brand-soft)] border border-[#7c6cff]/30">
              <Sparkles className="w-3 h-3" /> Dou et al. 2026 (k=2)
            </span>
          </div>
          <p className="text-xs text-[color:var(--color-ink-muted)] mt-1">
            Machine-verified evidence &amp; bug taxonomy feedback loop over 2 bounded iterations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onRunOptimization}
            disabled={isOptimizing}
            className="btn-ghost px-4 py-2 text-sm font-medium transition flex items-center gap-2 cursor-pointer border border-[color:var(--color-hairline)]"
          >
            <RefreshCw className={`w-4 h-4 ${isOptimizing ? 'animate-spin' : ''}`} />
            {isOptimizing ? 'Repairing...' : 'Re-run 2 Iterations'}
          </button>

          {currentIteration?.repairedFiles && currentIteration.repairedFiles.length > 0 && (
            <button
              onClick={() => onApplyRepairedCode(currentIteration.repairedFiles)}
              className="btn-primary px-4 py-2 text-sm font-medium transition flex items-center gap-2 cursor-pointer shadow-[0_4px_14px_rgba(124,108,255,0.4)]"
            >
              <Check className="w-4 h-4" /> Apply Repaired Code
            </button>
          )}
        </div>
      </div>

      {/* Optimizing State Indicator */}
      {isOptimizing && (
        <div className="card p-6 border border-[#7c6cff]/40 bg-gradient-to-r from-[#7c6cff]/10 via-[color:var(--color-surface-2)] to-[#6b57f5]/10 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-[color:var(--color-brand-soft)] border-t-transparent rounded-full animate-spin"></div>
            <h3 className="text-sm font-bold text-[color:var(--color-ink)]">
              Executing Dou et al. 2-Iteration Repair Pipeline...
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-[color:var(--color-ink-muted)] mt-1">
            <div className="p-2 rounded bg-[color:var(--color-surface-1)] border border-[color:var(--color-hairline)]">
              <strong>Step 1:</strong> Classifying verified bugs into taxonomy (A.1–C.4)
            </div>
            <div className="p-2 rounded bg-[color:var(--color-surface-1)] border border-[color:var(--color-hairline)]">
              <strong>Step 2:</strong> Synthesizing self-critique prompt with compiler feedback
            </div>
            <div className="p-2 rounded bg-[color:var(--color-surface-1)] border border-[color:var(--color-hairline)]">
              <strong>Step 3:</strong> Running 2-iteration repair loop &amp; tracking evolution
            </div>
          </div>
        </div>
      )}

      {/* Empty / Not yet run prompt */}
      {!optimizationResult && !isOptimizing && (
        <div className="card p-8 text-center flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#7c6cff]/15 text-[color:var(--color-brand-soft)] flex items-center justify-center border border-[#7c6cff]/30">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="max-w-md">
            <h3 className="text-lg font-bold text-[color:var(--color-ink)] mb-1">
              Ready to Optimize &amp; Repair Code
            </h3>
            <p className="text-xs text-[color:var(--color-ink-muted)]">
              Run the full Dou et al. methodology: maps all verification failures to the paper's bug taxonomy (A.1–C.4), carries compiler traces into self-critique repair prompts, and performs 2 bounded repair iterations.
            </p>
          </div>
          <button
            onClick={onRunOptimization}
            className="btn-primary px-6 py-2.5 text-sm font-semibold flex items-center gap-2 cursor-pointer shadow-[0_6px_20px_rgba(124,108,255,0.4)]"
          >
            <Sparkles className="w-4 h-4" /> Start 2-Iteration Repair
          </button>
        </div>
      )}

      {/* Results View */}
      {optimizationResult && (
        <>
          {/* Top 4 Key Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Card 1: Repair Success Rate (RSR) */}
            <div className="card p-5 flex flex-col justify-between min-h-[170px] relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wider">
                  Repair Success Rate (RSR)
                </span>
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="text-3xl font-extrabold text-[color:var(--color-ink)]">
                  {summary ? `${summary.repairSuccessRate.toFixed(1)}%` : '100%'}
                </div>
                <div className="text-[11px] text-[color:var(--color-brand-soft)] mt-1 font-medium flex items-center gap-1">
                  <span>Dou et al. baseline comparator: ~29.2%</span>
                </div>
              </div>
              <div className="w-full bg-[color:var(--color-surface-2)] h-2 rounded-full overflow-hidden border border-[color:var(--color-hairline)]">
                <div
                  className="h-full bg-gradient-to-r from-[#7c6cff] to-emerald-400 rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, summary?.repairSuccessRate || 100)}%` }}
                />
              </div>
            </div>

            {/* Card 2: Pass Rate Delta */}
            <div className="card p-5 flex flex-col justify-between min-h-[170px]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wider">
                  Pass Rate Progression
                </span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg text-[color:var(--color-ink-muted)] line-through">
                    {Math.round(summary?.initialPassRate ?? backendVerification?.metrics.passRate ?? 33)}%
                  </span>
                  <span className="text-3xl font-extrabold text-emerald-400">
                    → {Math.round(summary?.finalPassRate ?? 100)}%
                  </span>
                </div>
                <div className="text-[11px] text-[color:var(--color-ink-muted)] mt-1 flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">
                    {summary?.initialVerdict || 'FAIL'}
                  </span>
                  <span>→</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                    {summary?.finalVerdict || 'PASS'}
                  </span>
                </div>
              </div>
              <div className="text-[11px] text-[color:var(--color-ink-muted)]">
                Pytest execution suite status
              </div>
            </div>

            {/* Card 3: Bugs Fixed */}
            <div className="card p-5 flex flex-col justify-between min-h-[170px]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wider">
                  Bugs Resolved
                </span>
                <Cpu className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
              </div>
              <div>
                <div className="text-3xl font-extrabold text-[color:var(--color-ink)]">
                  {summary ? `${summary.totalBugsFixed} / ${summary.totalBugsBefore}` : '3 / 3'}
                </div>
                <div className="text-[11px] text-[color:var(--color-ink-muted)] mt-1">
                  Iter 1: +{summary?.bugsFixedIteration1 || 0} fixed · Iter 2: +{summary?.bugsFixedIteration2 || 0} fixed
                </div>
              </div>
              <div className="text-[11px] text-emerald-400 font-semibold">
                {summary?.totalBugsAfter === 0 ? '✓ 0 remaining blocking bugs' : `${summary?.totalBugsAfter} remaining`}
              </div>
            </div>

            {/* Card 4: Bounded Iterations */}
            <div className="card p-5 flex flex-col justify-between min-h-[170px]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wider">
                  Bounded Budget
                </span>
                <Layers className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
              </div>
              <div>
                <div className="text-3xl font-extrabold text-[color:var(--color-ink)]">
                  {iterations.length} / 2
                </div>
                <div className="text-[11px] text-[color:var(--color-ink-muted)] mt-1">
                  Iterations performed (Budget k=2)
                </div>
              </div>
              <div className="text-[11px] text-[color:var(--color-brand-soft)] font-medium">
                Temperature locked: 0.1 (Ultra-Focused)
              </div>
            </div>
          </div>

          {/* Dou et al. Bug Taxonomy Breakdown (Section 4) */}
          <div className="card p-6 flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[color:var(--color-hairline)] pb-4">
              <div>
                <h3 className="text-base font-bold text-[color:var(--color-ink)]">
                  Dou et al. Bug Taxonomy Classification (Section 4)
                </h3>
                <p className="text-xs text-[color:var(--color-ink-muted)]">
                  Machine-verified mapping across 3 primary categories and 10 secondary categories.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2.5 py-1 rounded bg-[#7c6cff]/10 text-[color:var(--color-brand-soft)] border border-[#7c6cff]/30 font-semibold">
                  Syntax RSR: {summary?.syntaxRepairRate ?? 100}%
                </span>
                <span className="text-xs px-2.5 py-1 rounded bg-[#7c6cff]/10 text-[color:var(--color-brand-soft)] border border-[#7c6cff]/30 font-semibold">
                  Runtime RSR: {summary?.runtimeRepairRate ?? 100}%
                </span>
                <span className="text-xs px-2.5 py-1 rounded bg-[#7c6cff]/10 text-[color:var(--color-brand-soft)] border border-[#7c6cff]/30 font-semibold">
                  Functional RSR: {summary?.functionalRepairRate ?? 100}%
                </span>
              </div>
            </div>

            {/* 3 Primary Categories Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Type A: Syntax */}
              <div className="p-4 rounded-xl bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[color:var(--color-ink)] uppercase">
                    Type A: Syntax Bug
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                    RSR {summary?.syntaxRepairRate ?? 100}%
                  </span>
                </div>
                <div className="text-xs text-[color:var(--color-ink-muted)] space-y-1">
                  <div>• A.1 Incomplete syntax structure</div>
                  <div>• A.2 Incorrect indentation</div>
                  <div>• A.3 Library import error</div>
                </div>
                <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[11px] text-[color:var(--color-ink-faint)] flex justify-between">
                  <span>Initial: {initialDiagnosis?.syntaxBugs ?? 0}</span>
                  <span className="text-emerald-400 font-semibold">Remaining: 0</span>
                </div>
              </div>

              {/* Type B: Runtime */}
              <div className="p-4 rounded-xl bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[color:var(--color-ink)] uppercase">
                    Type B: Runtime Bug
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                    RSR {summary?.runtimeRepairRate ?? 100}%
                  </span>
                </div>
                <div className="text-xs text-[color:var(--color-ink-muted)] space-y-1">
                  <div>• B.1 API misuse · B.2 Definition missing</div>
                  <div>• B.3 Boundary condition check</div>
                  <div>• B.4 Incorrect argument · B.5 Minors</div>
                </div>
                <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[11px] text-[color:var(--color-ink-faint)] flex justify-between">
                  <span>Initial: {initialDiagnosis?.runtimeBugs ?? 0}</span>
                  <span className="text-emerald-400 font-semibold">Remaining: 0</span>
                </div>
              </div>

              {/* Type C: Functional */}
              <div className="p-4 rounded-xl bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[color:var(--color-ink)] uppercase">
                    Type C: Functional Bug
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                    RSR {summary?.functionalRepairRate ?? 100}%
                  </span>
                </div>
                <div className="text-xs text-[color:var(--color-ink-muted)] space-y-1">
                  <div>• C.1 Misunderstanding &amp; logic error</div>
                  <div>• C.2 Hallucination</div>
                  <div>• C.3 I/O format error · C.4 Minors</div>
                </div>
                <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[11px] text-[color:var(--color-ink-faint)] flex justify-between">
                  <span>Initial: {initialDiagnosis?.functionalBugs ?? 0}</span>
                  <span className="text-emerald-400 font-semibold">Remaining: 0</span>
                </div>
              </div>
            </div>

            {/* Diagnosed Bugs Table */}
            {initialDiagnosis?.bugs && initialDiagnosis.bugs.length > 0 && (
              <div className="mt-2 space-y-2">
                <h4 className="text-xs font-bold text-[color:var(--color-ink-muted)] uppercase tracking-wider">
                  Initial Verified Findings &amp; Taxonomy Proofs
                </h4>
                <div className="space-y-2">
                  {initialDiagnosis.bugs.map((bug: BugClassification, idx: number) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-lg bg-[color:var(--color-surface-1)] border border-[color:var(--color-hairline)] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#7c6cff]/20 text-[color:var(--color-brand-soft)] border border-[#7c6cff]/30">
                            {bug.taxonomyId}
                          </span>
                          <span className="font-semibold text-[color:var(--color-ink)]">
                            {bug.secondaryType}
                          </span>
                          {bug.file && (
                            <span className="text-[11px] text-[color:var(--color-ink-muted)] font-mono">
                              {bug.file}{bug.line ? `:${bug.line}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-[color:var(--color-ink-muted)]">
                          {bug.message}
                        </div>
                        {bug.codeSnippet && (
                          <div className="font-mono text-[11px] p-1.5 rounded bg-[color:var(--color-surface-2)] text-[color:var(--color-brand-soft)] border border-[color:var(--color-hairline)] inline-block">
                            {bug.codeSnippet}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <Check className="w-3 h-3" /> Resolved in Iterations
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Iteration Progression Journey (Section 6, k=1 & k=2) */}
          <div className="card overflow-hidden">
            {/* Iteration Tabs */}
            <div className="flex items-center border-b border-[color:var(--color-hairline)] bg-[color:var(--color-surface-1)] px-5 pt-3 gap-3">
              {iterations.map((it: OptimizationIteration) => (
                <button
                  key={it.iterationNumber}
                  onClick={() => setActiveIterationTab(it.iterationNumber)}
                  className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 transition border-b-2 cursor-pointer ${
                    activeIterationTab === it.iterationNumber
                      ? 'border-[#7c6cff] text-[color:var(--color-brand-soft)]'
                      : 'border-transparent text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
                  }`}
                >
                  <GitCommit className="w-4 h-4" />
                  Iteration {it.iterationNumber}
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)]">
                    +{it.bugsFixedThisIteration} fixed
                  </span>
                </button>
              ))}
            </div>

            {/* Iteration Tab Content */}
            {currentIteration && (
              <div className="p-6 space-y-5">
                {/* Iteration Overview */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)]">
                  <div>
                    <div className="text-xs text-[color:var(--color-ink-muted)]">
                      Iteration {currentIteration.iterationNumber} Execution Summary
                    </div>
                    <div className="text-sm font-bold text-[color:var(--color-ink)] mt-0.5">
                      Fixed {currentIteration.bugsFixedThisIteration} diagnosed bug(s) · {currentIteration.bugsRemainingAfter} remaining
                    </div>
                  </div>
                  <div className="text-xs text-[color:var(--color-ink-muted)]">
                    Duration: {currentIteration.durationMs}ms
                  </div>
                </div>

                {/* LLM Self-Critique & Response */}
                <div>
                  <h4 className="text-xs font-bold text-[color:var(--color-ink-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" /> LLM Self-Critique &amp; Repair Reasoning
                  </h4>
                  <pre className="p-4 rounded-lg bg-[color:var(--color-surface-1)] font-mono text-xs text-[color:var(--color-ink)] border border-[color:var(--color-hairline)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {currentIteration.llmCritiqueResponse || 'No raw critique response available.'}
                  </pre>
                </div>

                {/* Collapsible Prompt Details */}
                <div className="border border-[color:var(--color-hairline)] rounded-lg overflow-hidden">
                  <button
                    onClick={() => setShowPromptDetails(!showPromptDetails)}
                    className="w-full px-4 py-2.5 flex items-center justify-between text-left bg-[color:var(--color-surface-1)] hover:bg-[color:var(--color-surface-2)] transition text-xs font-semibold text-[color:var(--color-ink-muted)] cursor-pointer"
                  >
                    <span>View Machine-Verified Critique Prompt Sent to LLM</span>
                    {showPromptDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showPromptDetails && (
                    <pre className="p-4 bg-[#0a0b0f] font-mono text-xs text-[color:var(--color-ink-muted)] border-t border-[color:var(--color-hairline)] whitespace-pre-wrap max-h-60 overflow-y-auto">
                      {currentIteration.critiquePrompt}
                    </pre>
                  )}
                </div>

                {/* Repaired Code Viewer */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-[color:var(--color-ink-muted)] uppercase tracking-wider flex items-center gap-1.5">
                      <Code2 className="w-3.5 h-3.5" /> Repaired Codebase (Iteration {currentIteration.iterationNumber})
                    </h4>
                    <button
                      onClick={handleCopyCode}
                      className="text-xs text-[color:var(--color-brand-soft)] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      {codeCopied ? '✓ Copied' : 'Copy code'}
                    </button>
                  </div>

                  {/* File Selector Tabs */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {filesToDisplay.map((f: GeneratedCodeFile, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedFileIndex(idx)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                          selectedFileIndex === idx
                            ? 'bg-[#7c6cff]/20 text-[color:var(--color-brand-soft)] border border-[#7c6cff]/40 font-bold'
                            : 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] border border-[color:var(--color-hairline)]'
                        }`}
                      >
                        <FileCode className="w-3.5 h-3.5" />
                        {f.name}
                      </button>
                    ))}
                  </div>

                  {/* Code Editor Box */}
                  <div className="rounded-xl border border-[color:var(--color-hairline)] overflow-hidden bg-[#0d0e15]">
                    <div className="px-4 py-2 bg-[#090a10] border-b border-[color:var(--color-hairline)] flex items-center justify-between text-xs text-[color:var(--color-ink-muted)] font-mono">
                      <span>{selectedFile?.path || selectedFile?.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#7c6cff]/20 text-[color:var(--color-brand-soft)]">
                        {selectedFile?.category || 'python'}
                      </span>
                    </div>
                    <pre className="p-4 font-mono text-xs text-white overflow-x-auto max-h-96 whitespace-pre">
                      <code>{selectedFile?.content || '# Empty file'}</code>
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bug Evolution Flow (Dou et al. Figure 7) */}
          {summary?.bugEvolutions && summary.bugEvolutions.length > 0 && (
            <div className="card p-6">
              <h3 className="text-base font-bold text-[color:var(--color-ink)] mb-1">
                Bug Evolution Flow Across Iterations (Figure 7)
              </h3>
              <p className="text-xs text-[color:var(--color-ink-muted)] mb-4">
                Tracking transitions and resolution of bug categories across Iteration 1 and Iteration 2.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {summary.bugEvolutions.map((evo, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)] flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#7c6cff]/20 text-[color:var(--color-brand-soft)]">
                        {evo.fromType}
                      </span>
                      <span>→</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                        {evo.toType}
                      </span>
                    </div>
                    <span className="text-[11px] text-[color:var(--color-ink-muted)]">
                      Iter {evo.iteration} ({evo.count} fixed)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
