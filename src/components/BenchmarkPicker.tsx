import React, { useState, useEffect } from 'react';
import { Database, Search, CheckCircle2, ArrowRight, Filter, Lock } from 'lucide-react';
import { fetchBenchmarkProblems, fetchBenchmarkProblem } from '../services/aiService';
import { InterfaceDefinition, LockedTestSuite } from '../types';

interface BenchmarkProblemSummary {
  benchmark: string;
  problemId: string;
  title: string;
  subTier?: string;
}

interface BenchmarkPickerProps {
  onSelectProblem: (payload: {
    prompt: string;
    interface: InterfaceDefinition;
    lockedTestSuite: LockedTestSuite;
    benchmark: string;
    problemId: string;
  }) => void;
  onCancel?: () => void;
}

export const BenchmarkPicker: React.FC<BenchmarkPickerProps> = ({ onSelectProblem, onCancel }) => {
  const [selectedBenchmark, setSelectedBenchmark] = useState<'all' | 'humaneval_plus' | 'mbpp_plus' | 'apps_plus'>('all');
  const [problems, setProblems] = useState<BenchmarkProblemSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const [problemDetail, setProblemDetail] = useState<{
    benchmark: string;
    problemId: string;
    prompt: string;
    interface: InterfaceDefinition;
    testCount: number;
    previewTests: string;
    lockedTestHash: string;
  } | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoadingList(true);
      setLoadError(null);
      try {
        const benchParam = selectedBenchmark === 'all' ? undefined : selectedBenchmark;
        const list = await fetchBenchmarkProblems(benchParam);
        if (!cancelled) setProblems(list);
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || 'Failed to load problems from backend.');
      } finally {
        if (!cancelled) setIsLoadingList(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [selectedBenchmark]);

  const handleSelectProblem = async (summary: BenchmarkProblemSummary) => {
    setSelectedProblemId(summary.problemId);
    setIsLoadingDetail(true);
    setProblemDetail(null);
    try {
      const detail = await fetchBenchmarkProblem(summary.benchmark, summary.problemId);
      setProblemDetail(detail);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load problem details.');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleConfirmSelection = () => {
    if (!problemDetail) return;
    onSelectProblem({
      prompt: problemDetail.prompt,
      interface: problemDetail.interface,
      lockedTestSuite: {
        testCode: problemDetail.previewTests,
        hash: problemDetail.lockedTestHash,
        testCount: problemDetail.testCount,
        isLocked: true,
        lockedAtUtc: new Date().toISOString()
      },
      benchmark: problemDetail.benchmark,
      problemId: problemDetail.problemId
    });
  };

  const filteredProblems = problems.filter(p => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return p.problemId.toLowerCase().includes(q) || p.title.toLowerCase().includes(q);
  });

  return (
    <div className="card p-6 border-2 border-[#7c3aed]/30 bg-[color:var(--color-surface-1)] rounded-2xl shadow-xl space-y-6 animate-fade-up">
      {loadError && <p role="alert">{loadError}</p>}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[color:var(--color-hairline)]">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-[#7c3aed]" />
            <h2 className="text-lg font-bold text-[color:var(--color-ink)]">Benchmark Problem Picker</h2>
            <span className="chip text-[11px] px-2.5 py-0.5 bg-[#7c3aed]/15 text-[#7c3aed] border border-[#7c3aed]/30 font-semibold">
              Live Datasets
            </span>
          </div>
          <p className="text-xs text-[color:var(--color-ink-muted)] mt-1">
            Choose from HumanEval+ (164), MBPP+ (399), or APPS+ (600). Dataset tests are read-only and pre-locked.
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)] px-3 py-1.5 rounded-lg border border-[color:var(--color-hairline)]"
          >
            Switch to Freeform Prompt
          </button>
        )}
      </div>

      {/* Benchmark Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[color:var(--color-ink-muted)] flex items-center gap-1 mr-2">
          <Filter className="w-3.5 h-3.5" /> Benchmark:
        </span>
        {(['all', 'humaneval_plus', 'mbpp_plus', 'apps_plus'] as const).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => { setSelectedBenchmark(b); setSelectedProblemId(null); setProblemDetail(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              selectedBenchmark === b
                ? 'bg-[#7c3aed] text-white shadow-md'
                : 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-3)] border border-[color:var(--color-hairline)]'
            }`}
          >
            {b === 'all' ? 'All (1,163)' : b === 'humaneval_plus' ? 'HumanEval+ (164)' : b === 'mbpp_plus' ? 'MBPP+ (399)' : 'APPS+ (600)'}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--color-ink-faint)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by problem ID (e.g. HumanEval/0, apps_plus_0581, mbpp_11)..."
          className="input-field w-full pl-10 pr-4 py-2 text-xs rounded-xl"
        />
      </div>

      {/* Two Column Selector & Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Problems List (Left) */}
        <div className="lg:col-span-5 border border-[color:var(--color-hairline)] rounded-xl bg-[color:var(--color-surface-2)] max-h-96 overflow-y-auto divide-y divide-[color:var(--color-hairline)]">
          {isLoadingList ? (
            <div className="p-8 text-center text-xs text-[color:var(--color-ink-faint)] flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-[#7c3aed]/40 border-t-[#7c3aed] animate-spin" />
              Loading problems...
            </div>
          ) : filteredProblems.length === 0 ? (
            <div className="p-8 text-center text-xs text-[color:var(--color-ink-faint)]">
              No problems found matching query.
            </div>
          ) : (
            filteredProblems.map((prob) => {
              const isSelected = selectedProblemId === prob.problemId;
              return (
                <button
                  key={`${prob.benchmark}_${prob.problemId}`}
                  type="button"
                  onClick={() => handleSelectProblem(prob)}
                  className={`w-full text-left p-3 text-xs transition-colors flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? 'bg-[#7c3aed]/15 border-l-4 border-l-[#7c3aed] text-[color:var(--color-ink)]'
                      : 'hover:bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-muted)]'
                  }`}
                >
                  <div className="truncate pr-2">
                    <div className="font-mono font-bold text-[color:var(--color-ink)]">{prob.problemId}</div>
                    <div className="text-[11px] text-[color:var(--color-ink-faint)] truncate">{prob.title}</div>
                  </div>
                  <span className="shrink-0 chip text-[10px] px-2 py-0.5 uppercase font-mono">
                    {prob.benchmark.replace('_plus', '+')}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Problem Detail Preview (Right) */}
        <div className="lg:col-span-7 border border-[color:var(--color-hairline)] rounded-xl bg-[color:var(--color-surface-2)] p-4 space-y-4">
          {isLoadingDetail ? (
            <div className="h-64 flex items-center justify-center text-xs text-[color:var(--color-ink-faint)] gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-[#7c3aed]/40 border-t-[#7c3aed] animate-spin" />
              Loading problem specification & tests...
            </div>
          ) : problemDetail ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[color:var(--color-hairline)]">
                <div>
                  <h3 className="text-sm font-bold font-mono text-[color:var(--color-ink)]">{problemDetail.problemId}</h3>
                  <p className="text-[11px] text-[color:var(--color-ink-faint)] uppercase">{problemDetail.benchmark}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="chip text-[11px] px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-mono">
                    <Lock className="w-3 h-3" /> {problemDetail.testCount} Tests Locked
                  </span>
                </div>
              </div>

              {/* Target Contract */}
              <div className="p-3 bg-[color:var(--color-surface-1)] border border-[color:var(--color-hairline)] rounded-lg text-xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-[color:var(--color-ink-faint)] tracking-wider">Target Contract</span>
                {problemDetail.interface.isStdinStdout ? (
                  <div className="font-mono text-amber-400 font-semibold">read stdin, print stdout (CLI Standard I/O)</div>
                ) : (
                  <div className="font-mono text-[#a078ff]">{problemDetail.interface.signature}</div>
                )}
              </div>

              {/* SHA-256 Hash */}
              <div className="flex items-center justify-between text-[11px] bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 font-mono text-slate-400">
                <span>SHA-256:</span>
                <span className="text-emerald-400 truncate ml-2" title={problemDetail.lockedTestHash}>
                  {problemDetail.lockedTestHash.slice(0, 24)}...
                </span>
              </div>

              {/* Prompt Text Preview */}
              <div>
                <span className="text-[10px] uppercase font-bold text-[color:var(--color-ink-faint)] tracking-wider">Problem Description</span>
                <pre className="mt-1 p-3 bg-slate-950 text-slate-200 rounded-lg text-xs font-mono max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-slate-800">
                  {problemDetail.prompt}
                </pre>
              </div>

              {/* Tests Preview (First 5) */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-[color:var(--color-ink-faint)] tracking-wider">
                    Tests Preview (First 5 of {problemDetail.testCount})
                  </span>
                  <span className="text-[10px] text-amber-400 font-semibold">Read-only from dataset</span>
                </div>
                <pre className="mt-1 p-3 bg-slate-950 text-emerald-300 rounded-lg text-xs font-mono max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-slate-800">
                  {problemDetail.previewTests}
                </pre>
              </div>

              {/* Select Button */}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleConfirmSelection}
                  className="btn-primary px-5 py-2 text-xs flex items-center gap-2 shadow-lg"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Use This Problem ({problemDetail.problemId})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center text-xs text-[color:var(--color-ink-faint)] p-6 space-y-2">
              <Database className="w-8 h-8 text-[color:var(--color-ink-faint)] opacity-40" />
              <p>Select any benchmark problem on the left to preview its specification and pre-locked tests.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
