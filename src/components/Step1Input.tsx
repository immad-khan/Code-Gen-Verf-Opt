import React, { useState } from 'react';
import { PromptPreset, PRESET_PROMPTS } from '../prompt-presets';
import { ArrowRight, ShieldCheck, Gauge, Code2, Sparkles, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Database, PenLine } from 'lucide-react';
import { ApiSettings, InterfaceDefinition, LockedTestSuite } from '../types';
import { extractInterface } from '../services/aiService';
import { BenchmarkPicker } from './BenchmarkPicker';

interface Step1InputProps {
  prompt: string;
  onPromptChange: (newPrompt: string) => void;
  onProceedToInterface: (iface: InterfaceDefinition) => void;
  onSelectBenchmarkProblem: (payload: {
    prompt: string;
    interface: InterfaceDefinition;
    lockedTestSuite: LockedTestSuite;
    benchmark: string;
    problemId: string;
  }) => void;
  isProcessing: boolean;
  apiSettings: ApiSettings;
  errorMessage?: string | null;
  rawErrorResponse?: string | null;
}

export const Step1Input: React.FC<Step1InputProps> = ({
  prompt,
  onPromptChange,
  onProceedToInterface,
  onSelectBenchmarkProblem,
  isProcessing,
  apiSettings,
  errorMessage,
  rawErrorResponse,
}) => {
  const [activeTab, setActiveTab] = useState<'prompt' | 'benchmark'>('prompt');
  const [isExtractingInterface, setIsExtractingInterface] = useState(false);
  const [interfaceError, setInterfaceError] = useState<string | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);

  const charCount = prompt.length;
  const wordCount = prompt.trim() ? prompt.trim().split(/\s+/).length : 0;

  const handlePresetSelect = (preset: PromptPreset) => {
    onPromptChange(preset.prompt);
  };

  const handleProceedWithContract = async () => {
    if (!prompt.trim() || isExtractingInterface) return;
    setIsExtractingInterface(true);
    setInterfaceError(null);
    try {
      const iface = await extractInterface(prompt, apiSettings);
      onProceedToInterface(iface);
    } catch (err: any) {
      setInterfaceError(err.message || 'Failed to extract interface.');
    } finally {
      setIsExtractingInterface(false);
    }
  };

  return (
    <div className="flex-1 w-full">
      {/* Hero */}
      <section className="border-b border-[color:var(--color-hairline)]">
        <div className="max-w-3xl mx-auto px-4 md:px-6 pt-14 pb-8 text-center animate-fade-up">
          <div className="inline-flex items-center gap-2 chip px-3 py-1.5 text-xs mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-soft-pulse" />
            <span className="text-[color:var(--color-ink-muted)]">Prompt → Interface → Tests (Lock) → Code → Verify → Repair</span>
          </div>
          <h1 className="text-3xl md:text-[40px] font-extrabold tracking-tight leading-[1.1] text-[color:var(--color-ink)]">
            Ship Python code you can
            <span className="bg-gradient-to-r from-[#a078ff] to-[#7c3aed] bg-clip-text text-transparent"> actually trust.</span>
          </h1>
          <p className="mt-3 text-[14px] text-[color:var(--color-ink-muted)] max-w-xl mx-auto leading-relaxed">
            Specify requirements once. VeriFlow extracts the contract, isolates tests with SHA-256 integrity, and synthesizes verifiable solutions in Docker.
          </p>

          {/* Active Model & Trust strip */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-[color:var(--color-ink-faint)]">
            <span className="inline-flex items-center gap-1.5 font-mono text-[color:var(--color-brand)] bg-[#7c3aed]/10 px-2.5 py-1 rounded-md">
              <Sparkles className="w-3.5 h-3.5" /> Provider: {apiSettings.provider.toUpperCase()} ({apiSettings.model})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--color-brand-soft)]" /> Docker Sandbox (veriflow-sandbox:3.11)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-[color:var(--color-brand-soft)]" /> Fenced Code Blocks (solution.py)
            </span>
          </div>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* Source Mode Selector (Prompt vs Benchmark) */}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('prompt')}
            className={`px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'prompt'
                ? 'bg-[#7c3aed] text-white shadow-lg ring-2 ring-[#7c3aed]/30'
                : 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-3)] border border-[color:var(--color-hairline)]'
            }`}
          >
            <PenLine className="w-3.5 h-3.5" />
            <span>Freeform Prompt / Templates</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('benchmark')}
            className={`px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'benchmark'
                ? 'bg-[#7c3aed] text-white shadow-lg ring-2 ring-[#7c3aed]/30'
                : 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-3)] border border-[color:var(--color-hairline)]'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Benchmark Problem Picker (1,163 problems)</span>
          </button>
        </div>

        {/* Error Banner with Show Raw Response Toggle */}
        {(errorMessage || interfaceError) && (
          <div className="card p-4 border border-rose-500/30 bg-rose-500/10 text-rose-300 rounded-xl space-y-2 animate-fade-up">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span className="text-sm font-semibold text-rose-200">Error</span>
              </div>
              {rawErrorResponse && (
                <button
                  type="button"
                  onClick={() => setShowRawResponse((prev) => !prev)}
                  className="text-xs font-mono text-rose-300 hover:text-white underline inline-flex items-center gap-1 cursor-pointer"
                >
                  {showRawResponse ? (
                    <>Hide Raw Response <ChevronUp className="w-3 h-3" /></>
                  ) : (
                    <>Show Raw Response <ChevronDown className="w-3 h-3" /></>
                  )}
                </button>
              )}
            </div>
            <p className="text-xs text-rose-300 leading-relaxed">{errorMessage || interfaceError}</p>
            {showRawResponse && rawErrorResponse && (
              <pre className="mt-3 p-3 bg-slate-950 text-slate-200 rounded-lg text-xs font-mono overflow-auto max-h-60 border border-slate-800 whitespace-pre-wrap">
                {rawErrorResponse}
              </pre>
            )}
          </div>
        )}

        {/* Tab 1: Freeform Prompt */}
        {activeTab === 'prompt' && (
          <div className="space-y-6">
            <div className="card p-5 md:p-6 animate-fade-up space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-[color:var(--color-ink)]">Task Requirements</label>
                <span className="text-[11px] text-[color:var(--color-ink-faint)] font-mono">{wordCount} words · {charCount} chars</span>
              </div>

              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => onPromptChange(e.target.value)}
                  placeholder="e.g. Write a function is_palindrome(s: str) -> bool that ignores whitespace and punctuation..."
                  className="input-field w-full p-4 text-sm min-h-[140px] resize-y leading-relaxed font-mono"
                />
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[color:var(--color-hairline)]">
                <p className="text-[11px] text-[color:var(--color-ink-faint)]">
                  Step 1: Prompt → Step 2: Interface (Contract) → Step 3: Tests (Locked) → Step 4: Code
                </p>
                <button
                  type="button"
                  onClick={handleProceedWithContract}
                  disabled={isExtractingInterface || isProcessing || !prompt.trim()}
                  className="btn-primary px-6 py-2.5 text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg disabled:opacity-40"
                >
                  {isExtractingInterface ? (
                    <>
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      <span>Proposing Interface…</span>
                    </>
                  ) : (
                    <>
                      <span>Propose Contract &amp; Proceed</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Template Presets */}
            <div className="animate-fade-up">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Start from a template</h2>
                <span className="eyebrow">{PRESET_PROMPTS.length} templates</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PRESET_PROMPTS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handlePresetSelect(preset)}
                    className="card-quiet p-4 text-left transition-all hover:border-[#33384a] hover:-translate-y-0.5 group cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <span className="font-semibold text-sm text-[color:var(--color-ink)] group-hover:text-[color:var(--color-brand-soft)] transition-colors">
                        {preset.title}
                      </span>
                      <span className="chip text-[10px] px-2 py-0.5 shrink-0">{preset.category}</span>
                    </div>
                    <p className="text-xs text-[color:var(--color-ink-muted)] leading-relaxed line-clamp-2">
                      {preset.description}
                    </p>
                    <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--color-brand-soft)] opacity-0 group-hover:opacity-100 transition-opacity">
                      Use this template <ArrowRight className="w-3 h-3" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Benchmark Problem Picker */}
        {activeTab === 'benchmark' && (
          <BenchmarkPicker
            onSelectProblem={onSelectBenchmarkProblem}
            onCancel={() => setActiveTab('prompt')}
          />
        )}
      </div>
    </div>
  );
};
