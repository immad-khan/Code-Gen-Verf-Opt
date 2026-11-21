import React, { useState } from 'react';
import {
  AIResultData,
  GeneratedCodeFile,
  OptimizationResponse,
  OptimizationIteration,
  BugClassification,
  CompareRepairResponse,
  ImprovedRepairSources,
  ApiSettings
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
  Layers,
  Columns,
  GitCompare,
  Sliders
} from 'lucide-react';
import { computeLineDiff } from '../utils/diff';

interface Step4OptimizationProps {
  result: AIResultData;
  backendVerification: VerificationResponse | null;
  optimizationResult: OptimizationResponse | null;
  compareResult?: CompareRepairResponse | null;
  isOptimizing: boolean;
  onRunOptimization: (mode?: 'dou' | 'improved' | 'compare', sources?: ImprovedRepairSources) => void;
  onBackToVerification: () => void;
  onApplyRepairedCode?: (files: GeneratedCodeFile[]) => void;
  forcedIteration?: number;
  title?: string;
  stepBadge?: string;
  nextButtonLabel?: string;
  backButtonLabel?: string;
  onProceedNext?: () => void;
  apiSettings?: ApiSettings;
}

export const Step4Optimization: React.FC<Step4OptimizationProps> = ({
  result,
  backendVerification,
  optimizationResult,
  compareResult,
  isOptimizing,
  onRunOptimization,
  onBackToVerification,
  onApplyRepairedCode,
  forcedIteration,
  title,
  stepBadge,
  nextButtonLabel,
  backButtonLabel = 'Back to Verification',
  onProceedNext,
  apiSettings,
}) => {
  const [repairMode, setRepairMode] = useState<'dou' | 'improved' | 'compare'>('dou');
  const [sources, setSources] = useState<ImprovedRepairSources>({
    visibleTestDetail: false,
    promptOnly: true,
    staticAnalysis: true,
    history: true,
  });
  const [selectedBranch, setSelectedBranch] = useState<'dou' | 'improved'>('improved');
  const [activeIterationTab, setActiveIterationTab] = useState<number>(forcedIteration ?? 1);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [showPromptDetails, setShowPromptDetails] = useState<boolean>(false);
  const [codeCopied, setCodeCopied] = useState<boolean>(false);
  const [codeViewMode, setCodeViewMode] = useState<'split' | 'diff' | 'after'>('split');

  // If compareResult is active, display the selected branch's optimization result
  const activeOptResult = compareResult
    ? (selectedBranch === 'dou' ? compareResult.douResult : compareResult.improvedResult)
    : optimizationResult;

  const summary = activeOptResult?.summary;
  const initialDiagnosis = activeOptResult?.initialDiagnosis;
  const finalDiagnosis = activeOptResult?.finalDiagnosis;
  const iterations = activeOptResult?.iterations || [];
  const activeTab = forcedIteration ?? activeIterationTab;
  const currentIteration = iterations.find(it => it.iterationNumber === activeTab);

  const runResult = activeOptResult?.runResult;
  const measuredPassRate = (total?: number, rate?: number) => total && rate != null ? `${Math.round(rate)}%` : 'N/A';
  const baselineRate = runResult?.baselineComparator ?? 29.2;
  const baselineLabel = runResult?.baselineLabel ?? 'Paper, GPT-4';
  const rsrDisplay = summary?.repairSuccessRate == null ? 'N/A' : `${summary.repairSuccessRate.toFixed(1)}%`;
  const isRepairSkipped = Boolean(activeOptResult?.repairSkipped || runResult?.repairSkipped);

  const filesToDisplay = currentIteration?.repairedFiles || result.generatedCode;
  const selectedFile = filesToDisplay[selectedFileIndex] || filesToDisplay[0];

  // Code before this iteration:
  const previousIteration = iterations.find(it => it.iterationNumber === activeTab - 1);
  const beforeFiles = previousIteration ? previousIteration.repairedFiles : result.generatedCode;
  const beforeFile = beforeFiles.find(f => (f.name && selectedFile && f.name === selectedFile.name) || (f.path && selectedFile && f.path === selectedFile.path)) || beforeFiles[selectedFileIndex] || null;

  const beforeCode = beforeFile?.content || '';
  const nowCode = selectedFile?.content || '';
  const diffResult = computeLineDiff(beforeCode, nowCode);
  const isFileModified = diffResult.isModified;

  const handleCopyCode = () => {
    if (selectedFile?.content) {
      navigator.clipboard.writeText(selectedFile.content);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  };

  const handleTriggerRepair = () => {
    onRunOptimization(repairMode, sources);
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
            <ArrowLeft className="w-3.5 h-3.5" /> {backButtonLabel}
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[color:var(--color-ink)] tracking-tight">
              {title || 'Taxonomy-Guided Iterative Repair'}
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#7c3aed]/15 text-[color:var(--color-brand-soft)] border border-[#7c3aed]/30">
              <Sparkles className="w-3 h-3" /> {stepBadge || 'Dou et al. 2026 (k=2)'}
            </span>
          </div>
          <p className="text-xs text-[color:var(--color-ink-muted)] mt-1">
            Taxonomy-guided repair · up to two measured iterations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTriggerRepair}
            disabled={isOptimizing}
            className="btn-ghost px-4 py-2 text-sm font-medium transition flex items-center gap-2 cursor-pointer border border-[color:var(--color-hairline)]"
          >
            <RefreshCw className={`w-4 h-4 ${isOptimizing ? 'animate-spin' : ''}`} />
            {isOptimizing ? 'Repairing...' : repairMode === 'compare' ? 'Run Compare' : 'Re-run Repair'}
          </button>

          {onProceedNext && (
            <button
              onClick={onProceedNext}
              className="btn-primary px-4 py-2 text-sm font-medium transition flex items-center gap-2 cursor-pointer shadow-[0_4px_14px_rgba(124,58,237,0.4)]"
            >
              <Sparkles className="w-4 h-4" /> {nextButtonLabel || 'Proceed to Next Step →'}
            </button>
          )}

          {onApplyRepairedCode && currentIteration?.repairedFiles && currentIteration.repairedFiles.length > 0 && !onProceedNext && (
            <button
              onClick={() => onApplyRepairedCode(currentIteration.repairedFiles)}
              className="btn-primary px-4 py-2 text-sm font-medium transition flex items-center gap-2 cursor-pointer shadow-[0_4px_14px_rgba(124,58,237,0.4)]"
            >
              <Check className="w-4 h-4" /> Apply Repaired Code
            </button>
          )}
        </div>
      </div>

      {/* Model & System Metadata Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)] text-xs text-[color:var(--color-ink-muted)]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[color:var(--color-ink)]">Active Model Profile:</span>
          <span className="px-2 py-0.5 rounded bg-[color:var(--color-surface-1)] border border-[color:var(--color-hairline)] font-mono font-bold text-[color:var(--color-brand-soft)]">
            {apiSettings?.provider || 'not recorded'} / {runResult?.model || apiSettings?.model || 'not recorded'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>Verification: backend Python process</span>
        </div>
      </div>

      {/* Methodology Mode Switcher & Diagnostic Sources */}
      <div className="card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold text-[color:var(--color-ink)] uppercase tracking-wider">
              Repair Methodology Mode:
            </span>
            <p className="text-[11.5px] text-[color:var(--color-ink-muted)] mt-0.5">
              Choose paper baseline, multi-source enhanced repair, or parallel paired comparison.
            </p>
          </div>
          <div className="flex items-center rounded-xl bg-[color:var(--color-surface-2)] p-1 border border-[color:var(--color-hairline)]">
            <button
              type="button"
              onClick={() => setRepairMode('dou')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                repairMode === 'dou'
                  ? 'bg-[color:var(--color-surface-1)] text-[color:var(--color-brand-soft)] shadow-sm'
                  : 'text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
              }`}
            >
              Baseline (dou)
            </button>
            <button
              type="button"
              onClick={() => setRepairMode('improved')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                repairMode === 'improved'
                  ? 'bg-[color:var(--color-surface-1)] text-[color:var(--color-brand-soft)] shadow-sm'
                  : 'text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
              }`}
            >
              Enhanced (improved)
            </button>
            <button
              type="button"
              onClick={() => setRepairMode('compare')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                repairMode === 'compare'
                  ? 'bg-[color:var(--color-brand-primary)] text-white shadow-sm'
                  : 'text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" /> Compare Both Modes
            </button>
          </div>
        </div>

        {/* Diagnostic Source Controls (for improved / compare) */}
        {(repairMode === 'improved' || repairMode === 'compare') && (
          <div className="pt-2.5 border-t border-[color:var(--color-hairline)] flex flex-wrap items-center gap-4 text-xs">
            <span className="font-semibold text-[color:var(--color-ink)] flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5 text-[color:var(--color-brand-soft)]" /> Tagged Diagnostic Sources:
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sources.promptOnly}
                onChange={(e) => setSources((s) => ({ ...s, promptOnly: e.target.checked }))}
                className="rounded border-[color:var(--color-hairline)]"
              />
              <span className="text-[color:var(--color-ink-muted)] font-mono">[prompt-only]</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sources.staticAnalysis}
                onChange={(e) => setSources((s) => ({ ...s, staticAnalysis: e.target.checked }))}
                className="rounded border-[color:var(--color-hairline)]"
              />
              <span className="text-[color:var(--color-ink-muted)] font-mono">[static-analysis] Mypy/Semgrep</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sources.history}
                onChange={(e) => setSources((s) => ({ ...s, history: e.target.checked }))}
                className="rounded border-[color:var(--color-hairline)]"
              />
              <span className="text-[color:var(--color-ink-muted)] font-mono">[history] Prior Round</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sources.visibleTestDetail}
                onChange={(e) => setSources((s) => ({ ...s, visibleTestDetail: e.target.checked }))}
                className="rounded border-[color:var(--color-hairline)]"
              />
              <span className="text-[color:var(--color-ink-muted)] font-mono">[visible-test-detail] (Default: OFF)</span>
            </label>
          </div>
        )}
      </div>

      {/* Side-by-Side Comparison Card (when compareResult is active) */}
      {compareResult && (
        <div className="card p-6 border-2 border-[color:var(--color-brand-primary)]/40 bg-gradient-to-br from-[#7c3aed]/10 via-[color:var(--color-surface-1)] to-[#4f46e5]/10 flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-[color:var(--color-brand-primary)] text-white shadow-md">
                <GitCompare className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-[color:var(--color-ink)]">
                  Side-by-Side Methodology Comparison: Dou vs Improved
                </h3>
                <p className="text-xs text-[color:var(--color-ink-muted)]">
                  Both branches evaluated concurrently from the same Round 0 code.
                </p>
              </div>
            </div>

            {/* Winner Badge */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[color:var(--color-ink-muted)]">Outcome:</span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider ${
                  compareResult.summary.winner === 'improved'
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : compareResult.summary.winner === 'dou'
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                }`}
              >
                {compareResult.summary.winner === 'improved'
                  ? '★ Improved Mode Won'
                  : compareResult.summary.winner === 'dou'
                  ? 'Dou Baseline Won'
                  : 'Tie / Equal'}
              </span>
            </div>
          </div>

          <p className="text-xs text-[color:var(--color-ink)] font-medium p-3 rounded-lg bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)]">
            {compareResult.summary.description}
          </p>

          {/* Comparison Table */}
          <div className="overflow-x-auto rounded-xl border border-[color:var(--color-hairline)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] font-semibold border-b border-[color:var(--color-hairline)]">
                <tr>
                  <th className="py-2.5 px-4">Evaluation Metric</th>
                  <th className="py-2.5 px-4 text-center">Baseline (Dou et al.)</th>
                  <th className="py-2.5 px-4 text-center">Enhanced (Improved)</th>
                  <th className="py-2.5 px-4 text-center">Advantage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--color-hairline)]">
                <tr>
                  <td className="py-2.5 px-4 font-medium text-[color:var(--color-ink)]">Fixed in Round 1</td>
                  <td className="py-2.5 px-4 text-center font-bold">
                    {compareResult.summary.douFixedInRound1 ? (
                      <span className="text-emerald-400">✓ Yes</span>
                    ) : (
                      <span className="text-rose-400">✗ No</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-center font-bold">
                    {compareResult.summary.improvedFixedInRound1 ? (
                      <span className="text-emerald-400">✓ Yes</span>
                    ) : (
                      <span className="text-rose-400">✗ No</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-center font-semibold text-[color:var(--color-ink-muted)]">
                    {compareResult.summary.improvedFixedInRound1 && !compareResult.summary.douFixedInRound1
                      ? 'Improved passed first'
                      : compareResult.summary.douFixedInRound1 && !compareResult.summary.improvedFixedInRound1
                      ? 'Dou passed first'
                      : 'Equal'}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-medium text-[color:var(--color-ink)]">Fixed in Round 2</td>
                  <td className="py-2.5 px-4 text-center font-bold">
                    {compareResult.summary.douFixedInRound2 ? (
                      <span className="text-emerald-400">✓ Yes</span>
                    ) : (
                      <span className="text-[color:var(--color-ink-muted)]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-center font-bold">
                    {compareResult.summary.improvedFixedInRound2 ? (
                      <span className="text-emerald-400">✓ Yes</span>
                    ) : (
                      <span className="text-[color:var(--color-ink-muted)]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-center font-semibold text-[color:var(--color-ink-muted)]">
                    {compareResult.summary.improvedFixedInRound2 ? 'Resolved in R2' : 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-medium text-[color:var(--color-ink)]">Unresolved Status</td>
                  <td className="py-2.5 px-4 text-center font-bold">
                    {compareResult.summary.douUnresolved ? (
                      <span className="text-rose-400">Unresolved</span>
                    ) : (
                      <span>{compareResult.douResult.summary.repairSuccessRate == null ? 'N/A' : 'Repaired'}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-center font-bold">
                    {compareResult.summary.improvedUnresolved ? (
                      <span className="text-rose-400">Unresolved</span>
                    ) : (
                      <span>{compareResult.improvedResult.summary.repairSuccessRate == null ? 'N/A' : 'Repaired'}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-center font-semibold text-[color:var(--color-ink-muted)]">
                    {!compareResult.summary.improvedUnresolved && compareResult.summary.douUnresolved
                      ? 'Improved Clean'
                      : 'Equal'}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-medium text-[color:var(--color-ink)]">Estimated Tokens Consumed</td>
                  <td className="py-2.5 px-4 text-center font-mono font-bold text-[color:var(--color-ink)]">
                    {compareResult.summary.douTotalTokens.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-center font-mono font-bold text-[color:var(--color-ink)]">
                    {compareResult.summary.improvedTotalTokens.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-center font-semibold text-[color:var(--color-brand-soft)]">
                    {compareResult.summary.improvedTotalTokens < compareResult.summary.douTotalTokens
                      ? `${compareResult.summary.douTotalTokens - compareResult.summary.improvedTotalTokens} fewer tokens`
                      : compareResult.summary.douTotalTokens < compareResult.summary.improvedTotalTokens
                      ? `${compareResult.summary.improvedTotalTokens - compareResult.summary.douTotalTokens} more tokens`
                      : 'Equal tokens'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Inspect Code Branch Switcher */}
          <div className="flex items-center justify-between pt-2 border-t border-[color:var(--color-hairline)]">
            <span className="text-xs font-semibold text-[color:var(--color-ink-muted)]">
              Inspect Repaired Code &amp; Diagnostics for:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedBranch('improved')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  selectedBranch === 'improved'
                    ? 'bg-[color:var(--color-brand-primary)] text-white shadow-sm'
                    : 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
                }`}
              >
                Inspect Improved Branch
              </button>
              <button
                type="button"
                onClick={() => setSelectedBranch('dou')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  selectedBranch === 'dou'
                    ? 'bg-[color:var(--color-brand-primary)] text-white shadow-sm'
                    : 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
                }`}
              >
                Inspect Dou Branch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Optimizing State Indicator */}
      {isOptimizing && (
        <div className="card p-6 border border-[#7c3aed]/40 bg-gradient-to-r from-[#7c3aed]/10 via-[color:var(--color-surface-2)] to-[#6d28d9]/10 flex flex-col gap-3">
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

      {/* Repair Skipped Banner (Requirement 4) */}
      {isRepairSkipped && (
        <div className="card p-5 border border-emerald-500/30 bg-emerald-500/10 flex items-center gap-3 text-emerald-300 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <div className="font-bold text-emerald-200">Repair skipped</div>
            <div className="text-xs text-emerald-300/80 mt-0.5">
              No confirmed failing program to repair. Round 0 verdict: {summary?.initialVerdict ?? 'NOT_VERIFIED'}.
            </div>
          </div>
        </div>
      )}

      {/* Empty / Not yet run prompt */}
      {!optimizationResult && !isOptimizing && (
        <div className="card p-8 text-center flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#7c3aed]/15 text-[color:var(--color-brand-soft)] flex items-center justify-center border border-[#7c3aed]/30">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="max-w-md">
            <h3 className="text-lg font-bold text-[color:var(--color-ink)] mb-1">
              Ready to Optimize &amp; Repair Code
            </h3>
            <p className="text-xs text-[color:var(--color-ink-muted)]">
              Run taxonomy-guided repair: maps all verification failures to the paper's bug taxonomy (A.1–C.4), carries compiler traces into self-critique repair prompts, and performs 2 bounded repair iterations.
            </p>
          </div>
          <button
            onClick={handleTriggerRepair}
            className="btn-primary px-6 py-2.5 text-sm font-semibold flex items-center gap-2 cursor-pointer shadow-[0_6px_20px_rgba(124,58,237,0.4)]"
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
            {/* Card 1: Program repair outcome (single run) */}
            <div className="card p-5 flex flex-col justify-between min-h-[170px] relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[color:var(--color-ink-muted)] uppercase tracking-wider">
                  Program repair outcome (single run)
                </span>
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="text-3xl font-extrabold text-[color:var(--color-ink)]">
                  {rsrDisplay}
                </div>
                <div className="text-[11px] text-[color:var(--color-brand-soft)] mt-1 font-medium flex items-center gap-1">
                  <span>Reference only · {baselineLabel}: {baselineRate}% over 120 initially failing programs</span>
                </div>
              </div>
              <div className="w-full bg-[color:var(--color-surface-2)] h-2 rounded-full overflow-hidden border border-[color:var(--color-hairline)]">
                <div
                  className="h-full bg-gradient-to-r from-[#7c3aed] to-emerald-400 rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, summary?.repairSuccessRate || 0)}%` }}
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
                    {measuredPassRate(runResult?.rounds[0]?.testsSummary.total, summary?.initialPassRate ?? backendVerification?.metrics.passRate)}
                  </span>
                  <span className="text-3xl font-extrabold text-emerald-400">
                    → {measuredPassRate(runResult?.rounds.at(-1)?.testsSummary.total, summary?.finalPassRate)}
                  </span>
                </div>
                <div className="text-[11px] text-[color:var(--color-ink-muted)] mt-1 flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">
                    {summary?.initialVerdict || 'FAIL'}
                  </span>
                  <span>→</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                    {summary?.finalVerdict || 'NOT_VERIFIED'}
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
                  Reduction in findings
                </span>
                <Cpu className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
              </div>
              <div>
                <div className="text-3xl font-extrabold text-[color:var(--color-ink)]">
                  {summary ? `${summary.totalBugsFixed} / ${summary.totalBugsBefore}` : '0 / 0'}
                </div>
                <div className="text-[11px] text-[color:var(--color-ink-muted)] mt-1">
                  Iter 1: +{summary?.bugsFixedIteration1 || 0} fixed · Iter 2: +{summary?.bugsFixedIteration2 || 0} fixed
                </div>
              </div>
              <div className="text-[11px] text-emerald-400 font-semibold">
                {summary?.totalBugsAfter === 0 ? 'No diagnosed findings' : `${summary?.totalBugsAfter} remaining`}
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
                {`Model: ${runResult?.model || apiSettings?.model || 'not recorded'}`}
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
                  Automated classification of execution findings; not expert annotation.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2.5 py-1 rounded bg-[#7c3aed]/10 text-[color:var(--color-brand-soft)] border border-[#7c3aed]/30 font-semibold">
                  Syntax findings removed: {summary?.syntaxRepairRate == null ? 'N/A' : `${summary.syntaxRepairRate}%`}
                </span>
                <span className="text-xs px-2.5 py-1 rounded bg-[#7c3aed]/10 text-[color:var(--color-brand-soft)] border border-[#7c3aed]/30 font-semibold">
                  Runtime findings removed: {summary?.runtimeRepairRate == null ? 'N/A' : `${summary.runtimeRepairRate}%`}
                </span>
                <span className="text-xs px-2.5 py-1 rounded bg-[#7c3aed]/10 text-[color:var(--color-brand-soft)] border border-[#7c3aed]/30 font-semibold">
                  Functional findings removed: {summary?.functionalRepairRate == null ? 'N/A' : `${summary.functionalRepairRate}%`}
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
                    {summary?.syntaxRepairRate == null ? 'N/A' : `${summary.syntaxRepairRate}%`}
                  </span>
                </div>
                <div className="text-xs text-[color:var(--color-ink-muted)] space-y-1">
                  <div>• A.1 Incomplete syntax structure</div>
                  <div>• A.2 Incorrect indentation</div>
                  <div>• A.3 Library import error</div>
                </div>
                <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[11px] text-[color:var(--color-ink-faint)] flex justify-between">
                  <span>Initial: {initialDiagnosis?.syntaxBugs ?? 0}</span>
                  <span className={(finalDiagnosis?.syntaxBugs ?? 0) === 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                    Remaining: {finalDiagnosis?.syntaxBugs ?? (summary?.syntaxRepairRate === 100 ? 0 : (initialDiagnosis?.syntaxBugs ?? 0))}
                  </span>
                </div>
              </div>

              {/* Type B: Runtime */}
              <div className="p-4 rounded-xl bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[color:var(--color-ink)] uppercase">
                    Type B: Runtime Bug
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                    {summary?.runtimeRepairRate == null ? 'N/A' : `${summary.runtimeRepairRate}%`}
                  </span>
                </div>
                <div className="text-xs text-[color:var(--color-ink-muted)] space-y-1">
                  <div>• B.1 API misuse · B.2 Definition missing</div>
                  <div>• B.3 Boundary condition check</div>
                  <div>• B.4 Incorrect argument · B.5 Minors</div>
                </div>
                <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[11px] text-[color:var(--color-ink-faint)] flex justify-between">
                  <span>Initial: {initialDiagnosis?.runtimeBugs ?? 0}</span>
                  <span className={(finalDiagnosis?.runtimeBugs ?? 0) === 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                    Remaining: {finalDiagnosis?.runtimeBugs ?? (summary?.runtimeRepairRate === 100 ? 0 : (initialDiagnosis?.runtimeBugs ?? 0))}
                  </span>
                </div>
              </div>

              {/* Type C: Functional */}
              <div className="p-4 rounded-xl bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[color:var(--color-ink)] uppercase">
                    Type C: Functional Bug
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                    {summary?.functionalRepairRate == null ? 'N/A' : `${summary.functionalRepairRate}%`}
                  </span>
                </div>
                <div className="text-xs text-[color:var(--color-ink-muted)] space-y-1">
                  <div>• C.1 Misunderstanding &amp; logic error</div>
                  <div>• C.2 Hallucination</div>
                  <div>• C.3 I/O format error · C.4 Minors</div>
                </div>
                <div className="mt-3 pt-2 border-t border-[color:var(--color-hairline)] text-[11px] text-[color:var(--color-ink-faint)] flex justify-between">
                  <span>Initial: {initialDiagnosis?.functionalBugs ?? 0}</span>
                  <span className={(finalDiagnosis?.functionalBugs ?? 0) === 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                    Remaining: {finalDiagnosis?.functionalBugs ?? (summary?.functionalRepairRate === 100 ? 0 : (initialDiagnosis?.functionalBugs ?? 0))}
                  </span>
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
                  {initialDiagnosis.bugs.map((bug: BugClassification, idx: number) => {
                    const isResolved = summary?.repairSuccessRate === 100 || (finalDiagnosis != null && !finalDiagnosis.bugs.some(b => b.taxonomyId === bug.taxonomyId && b.message === bug.message));
                    return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-lg bg-[color:var(--color-surface-1)] border border-[color:var(--color-hairline)] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#7c3aed]/20 text-[color:var(--color-brand-soft)] border border-[#7c3aed]/30">
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
                        {summary?.repairSuccessRate == null ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#7c3aed]/10 text-[color:var(--color-brand-soft)] border border-[#7c3aed]/20">
                            Round 0 finding
                          </span>
                        ) : isResolved ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <Check className="w-3 h-3" /> Resolved in repair
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            Unresolved
                          </span>
                        )}
                      </div>
                    </div>
                  );
                  })}
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
                      ? 'border-[#7c3aed] text-[color:var(--color-brand-soft)]'
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

                {/* Code Changes Inspection (Before vs Now) */}
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                    <div>
                      <h4 className="text-xs font-bold text-[color:var(--color-ink-muted)] uppercase tracking-wider flex items-center gap-1.5">
                        <Code2 className="w-3.5 h-3.5" /> Code Changes Inspection (Before vs Now)
                      </h4>
                      <p className="text-[11px] text-[color:var(--color-ink-muted)] mt-0.5">
                        Compare what the code was before repair against what it is now in Iteration {currentIteration.iterationNumber}.
                      </p>
                    </div>

                    {/* View Mode Switcher + Copy Button */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-lg bg-[color:var(--color-surface-2)] p-0.5 border border-[color:var(--color-hairline)] text-xs">
                        <button
                          onClick={() => setCodeViewMode('split')}
                          className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 transition cursor-pointer ${
                            codeViewMode === 'split'
                              ? 'bg-[#7c3aed] text-white shadow-xs'
                              : 'text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
                          }`}
                          title="Side-by-side: Code before on left, code now on right"
                        >
                          <Columns className="w-3.5 h-3.5" />
                          <span>Split (Before vs Now)</span>
                        </button>
                        <button
                          onClick={() => setCodeViewMode('diff')}
                          className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 transition cursor-pointer ${
                            codeViewMode === 'diff'
                              ? 'bg-[#7c3aed] text-white shadow-xs'
                              : 'text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
                          }`}
                          title="Line-by-line colored diff"
                        >
                          <GitCompare className="w-3.5 h-3.5" />
                          <span>Diff View</span>
                        </button>
                        <button
                          onClick={() => setCodeViewMode('after')}
                          className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 transition cursor-pointer ${
                            codeViewMode === 'after'
                              ? 'bg-[#7c3aed] text-white shadow-xs'
                              : 'text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
                          }`}
                          title="Repaired code only"
                        >
                          <Code2 className="w-3.5 h-3.5" />
                          <span>Repaired Only</span>
                        </button>
                      </div>

                      <button
                        onClick={handleCopyCode}
                        className="text-xs text-[color:var(--color-brand-soft)] hover:underline flex items-center gap-1 cursor-pointer px-2 py-1"
                      >
                        {codeCopied ? '✓ Copied' : 'Copy Now'}
                      </button>
                    </div>
                  </div>

                  {/* Change Status Banner */}
                  <div className={`p-3 rounded-xl border mb-3 flex items-center justify-between text-xs transition-colors ${
                    isFileModified
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${isFileModified ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                      <span className="font-semibold text-[color:var(--color-ink)]">
                        {isFileModified ? 'File Modified in Repair Loop:' : 'File Unchanged:'}
                      </span>
                      <span className="font-mono font-medium text-[color:var(--color-brand-soft)]">
                        {selectedFile?.name}
                      </span>
                      <span className="text-[color:var(--color-ink-muted)] hidden md:inline">
                        {isFileModified
                          ? `Self-critique fixed diagnosed bugs (Delta: +${diffResult.additions} lines, -${diffResult.deletions} lines)`
                          : 'No bugs were located in this file, original code retained.'}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      isFileModified
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {isFileModified ? `+${diffResult.additions} / -${diffResult.deletions} CHANGED` : 'IDENTICAL'}
                    </span>
                  </div>

                  {/* File Selector Tabs */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-3">
                    {filesToDisplay.map((f: GeneratedCodeFile, idx: number) => {
                      const fileBefore = beforeFiles.find(bf => bf.name === f.name || bf.path === f.path) || beforeFiles[idx];
                      const fileDiff = computeLineDiff(fileBefore?.content || '', f.content || '');
                      const fileChanged = fileDiff.isModified;

                      return (
                        <button
                          key={idx}
                          onClick={() => setSelectedFileIndex(idx)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                            selectedFileIndex === idx
                              ? 'bg-[#7c3aed]/20 text-[color:var(--color-brand-soft)] border border-[#7c3aed]/40 font-bold shadow-xs'
                              : 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] border border-[color:var(--color-hairline)]'
                          }`}
                        >
                          <FileCode className="w-3.5 h-3.5" />
                          <span>{f.name}</span>
                          {fileChanged ? (
                            <span className="w-2 h-2 rounded-full bg-amber-400" title="Modified in this iteration" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-emerald-400/40" title="Unchanged" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Mode 1: Split View (Before on Left vs Now on Right) */}
                  {codeViewMode === 'split' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Left Column: Code Before */}
                      <div className="rounded-xl border border-rose-500/30 overflow-hidden bg-[#0d0e15] flex flex-col">
                        <div className="px-4 py-2.5 bg-rose-950/20 border-b border-rose-500/20 flex items-center justify-between text-xs font-mono">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              BEFORE REPAIR
                            </span>
                            <span className="text-[color:var(--color-ink-muted)] truncate">
                              {activeTab === 1 ? 'Round 0: Initial Code' : `Round ${activeTab - 1}: Previous Repaired Code`}
                            </span>
                          </div>
                          <span className="text-[10px] text-rose-400 font-mono">
                            {beforeCode.split('\n').length} lines
                          </span>
                        </div>
                        <pre className="p-4 font-mono text-xs text-rose-100/90 overflow-x-auto max-h-[460px] whitespace-pre bg-[#0a0b0f] flex-1">
                          <code>
                            {beforeCode ? (
                              beforeCode.split('\n').map((line, lIdx) => (
                                <div key={lIdx} className="flex">
                                  <span className="w-8 text-[color:var(--color-ink-faint)] select-none text-right pr-3 opacity-50">
                                    {lIdx + 1}
                                  </span>
                                  <span className="flex-1">{line || ' '}</span>
                                </div>
                              ))
                            ) : (
                              '# File did not exist in previous iteration'
                            )}
                          </code>
                        </pre>
                      </div>

                      {/* Right Column: Code Now */}
                      <div className="rounded-xl border border-emerald-500/30 overflow-hidden bg-[#0d0e15] flex flex-col">
                        <div className="px-4 py-2.5 bg-emerald-950/20 border-b border-emerald-500/20 flex items-center justify-between text-xs font-mono">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              NOW (REPAIRED)
                            </span>
                            <span className="text-[color:var(--color-ink-muted)] truncate">
                              Round {activeTab}: Repaired Code
                            </span>
                          </div>
                          <span className="text-[10px] text-emerald-400 font-mono">
                            {nowCode.split('\n').length} lines
                          </span>
                        </div>
                        <pre className="p-4 font-mono text-xs text-emerald-100/95 overflow-x-auto max-h-[460px] whitespace-pre bg-[#0a0b0f] flex-1">
                          <code>
                            {nowCode ? (
                              nowCode.split('\n').map((line, lIdx) => (
                                <div key={lIdx} className="flex">
                                  <span className="w-8 text-[color:var(--color-ink-faint)] select-none text-right pr-3 opacity-50">
                                    {lIdx + 1}
                                  </span>
                                  <span className="flex-1">{line || ' '}</span>
                                </div>
                              ))
                            ) : (
                              '# Empty file'
                            )}
                          </code>
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Mode 2: Unified Diff View */}
                  {codeViewMode === 'diff' && (
                    <div className="rounded-xl border border-[color:var(--color-hairline)] overflow-hidden bg-[#0a0b0f]">
                      <div className="px-4 py-2 bg-[#0d0e15] border-b border-[color:var(--color-hairline)] flex items-center justify-between text-xs text-[color:var(--color-ink-muted)] font-mono">
                        <span>{selectedFile?.path || selectedFile?.name} · Diff</span>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-emerald-400">+{diffResult.additions} added</span>
                          <span>·</span>
                          <span className="text-rose-400">-{diffResult.deletions} removed</span>
                        </div>
                      </div>
                      <div className="font-mono text-xs overflow-x-auto max-h-[460px]">
                        {diffResult.lines.map((line, idx) => (
                          <div
                            key={idx}
                            className={`flex px-3 py-0.5 leading-relaxed ${
                              line.type === 'added'
                                ? 'bg-emerald-500/15 text-emerald-200 border-l-2 border-emerald-500'
                                : line.type === 'removed'
                                ? 'bg-rose-500/15 text-rose-300 border-l-2 border-rose-500'
                                : 'text-[color:var(--color-ink-muted)]'
                            }`}
                          >
                            <span className="w-8 select-none text-right pr-2 opacity-40 text-[10px]">
                              {line.oldLineNumber || ''}
                            </span>
                            <span className="w-8 select-none text-right pr-3 opacity-40 text-[10px]">
                              {line.newLineNumber || ''}
                            </span>
                            <span className="w-4 select-none opacity-70 font-bold">
                              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                            </span>
                            <span className="flex-1 whitespace-pre">{line.text || ' '}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mode 3: Repaired Code Only */}
                  {codeViewMode === 'after' && (
                    <div className="rounded-xl border border-[color:var(--color-hairline)] overflow-hidden bg-[#0d0e15]">
                      <div className="px-4 py-2 bg-[#090a10] border-b border-[color:var(--color-hairline)] flex items-center justify-between text-xs text-[color:var(--color-ink-muted)] font-mono">
                        <span>{selectedFile?.path || selectedFile?.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#7c3aed]/20 text-[color:var(--color-brand-soft)]">
                          {selectedFile?.category || 'python'}
                        </span>
                      </div>
                      <pre className="p-4 font-mono text-xs text-white overflow-x-auto max-h-[460px] whitespace-pre">
                        <code>{nowCode || '# Empty file'}</code>
                      </pre>
                    </div>
                  )}
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
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#7c3aed]/20 text-[color:var(--color-brand-soft)]">
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
