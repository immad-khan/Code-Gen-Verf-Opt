import React from 'react';
import { PromptPreset, PRESET_PROMPTS } from '../prompt-presets';
import { ArrowRight, ShieldCheck, Gauge, GitBranch, Sparkles } from 'lucide-react';

interface Step1InputProps {
  prompt: string;
  onPromptChange: (newPrompt: string) => void;
  onProcess: () => void;
  isProcessing: boolean;
  temperature: number;
}

export const Step1Input: React.FC<Step1InputProps> = ({
  prompt,
  onPromptChange,
  onProcess,
  isProcessing,
}) => {
  const charCount = prompt.length;
  const wordCount = prompt.trim() ? prompt.trim().split(/\s+/).length : 0;

  const handlePresetSelect = (preset: PromptPreset) => {
    onPromptChange(preset.prompt);
  };

  return (
    <div className="flex-1 w-full">
      {/* Hero */}
      <section className="grid-bg border-b border-[color:var(--color-hairline)]">
        <div className="max-w-3xl mx-auto px-4 md:px-6 pt-16 pb-10 text-center animate-fade-up">
          <div className="inline-flex items-center gap-2 chip px-3 py-1.5 text-xs mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c6cff] animate-soft-pulse" />
            <span className="text-[color:var(--color-ink-muted)]">Generate - Verify - Optimize</span>
          </div>
          <h1 className="text-3xl md:text-[42px] font-extrabold tracking-tight leading-[1.1] text-[color:var(--color-ink)]">
            Ship Python code you can
            <span className="bg-gradient-to-r from-[#a78bfa] to-[#7c6cff] bg-clip-text text-transparent"> actually trust.</span>
          </h1>
          <p className="mt-4 text-[15px] text-[color:var(--color-ink-muted)] max-w-xl mx-auto leading-relaxed">
            Describe your project once. MACI generates a complete Python codebase, then verifies and if issues reported optimizes it for you .
          </p>

          {/* Trust strip */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[color:var(--color-ink-faint)]">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-[color:var(--color-brand-soft)]" /> SQLi &amp; secret detection</span>
            <span className="inline-flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-[color:var(--color-brand-soft)]" /> Type &amp; performance checks</span>
          </div>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 md:px-6 py-10 space-y-8">
        {/* Prompt Composer */}
        <div className="card p-5 md:p-6 animate-fade-up">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-semibold text-[color:var(--color-ink)]">What should we build?</label>
            <span className="text-[11px] text-[color:var(--color-ink-faint)] font-mono">{wordCount} words · {charCount} chars</span>
          </div>

          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="e.g. Build a FastAPI service for a library with SQLAlchemy models, JWT auth, book reservations, and pytest tests…"
              className="input-field w-full p-4 text-sm min-h-[160px] resize-y leading-relaxed"
            />
          </div>

          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[11px] text-[color:var(--color-ink-faint)] order-2 sm:order-1">
              Prompt Input → Generate → Verification
            </p>
            <button
              onClick={onProcess}
              disabled={isProcessing || !prompt.trim()}
              className="btn-primary order-1 sm:order-2 w-full sm:w-auto px-6 py-3 text-sm flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  <span>Generating…</span>
                </>
              ) : (
                <>
                  <span>Generate</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Presets */}
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
                  <span className="font-semibold text-sm text-[color:var(--color-ink)] group-hover:text-white transition-colors">
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
    </div>
  );
};
