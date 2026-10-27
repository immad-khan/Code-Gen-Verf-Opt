import React from 'react';
import { PipelineStep } from '../types';
import { Check, PenLine, Code2, ShieldCheck, Sparkles, Trophy } from 'lucide-react';

interface PipelineNavProps {
  currentStep: PipelineStep;
  onSelectStep: (step: PipelineStep) => void;
  hasResult: boolean;
  maxUnlockedStep?: PipelineStep;
}

export const PipelineNav: React.FC<PipelineNavProps> = ({
  currentStep,
  onSelectStep,
  hasResult,
  maxUnlockedStep = 8,
}) => {
  const steps = [
    { number: 1 as PipelineStep, label: 'Prompt', shortLabel: 'Prompt', desc: 'Requirements', Icon: PenLine },
    { number: 2 as PipelineStep, label: 'Generate', shortLabel: 'Generate', desc: 'Code synthesis', Icon: Code2 },
    { number: 3 as PipelineStep, label: 'Verif. R0', shortLabel: 'V0', desc: 'Initial 7 checks', Icon: ShieldCheck },
    { number: 4 as PipelineStep, label: 'Repair R1', shortLabel: 'R1', desc: 'Self-critique 1', Icon: Sparkles },
    { number: 5 as PipelineStep, label: 'Verif. R1', shortLabel: 'V1', desc: 'Re-check R1', Icon: ShieldCheck },
    { number: 6 as PipelineStep, label: 'Repair R2', shortLabel: 'R2', desc: 'Self-critique 2', Icon: Sparkles },
    { number: 7 as PipelineStep, label: 'Verif. R2', shortLabel: 'V2', desc: 'Re-check R2', Icon: ShieldCheck },
    { number: 8 as PipelineStep, label: 'Final Results', shortLabel: 'Results', desc: 'Evolution & RSR', Icon: Trophy },
  ];

  return (
    <div className="border-b border-[color:var(--color-hairline)] bg-[color:var(--color-surface-1)] sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3">
        <div className="flex items-center overflow-x-auto scrollbar-none gap-2 sm:gap-1.5 pb-1 sm:pb-0">
          {steps.map((s, idx) => {
            const isActive = currentStep === s.number;
            const isPassed = currentStep > s.number;
            const isClickable = s.number === 1 || (hasResult && s.number <= maxUnlockedStep);
            const isDone = isPassed && hasResult;

            return (
              <React.Fragment key={s.number}>
                <button
                  onClick={() => isClickable && onSelectStep(s.number)}
                  disabled={!isClickable}
                  title={`${s.label}: ${s.desc}`}
                  className={`flex items-center gap-2 sm:gap-2.5 px-2.5 py-1.5 rounded-xl transition-all shrink-0 group ${
                    isClickable ? 'cursor-pointer hover:bg-[color:var(--color-surface-2)]' : 'cursor-not-allowed opacity-40'
                  } ${isActive ? 'bg-[color:var(--color-surface-2)] ring-1 ring-[#7c6cff]/40' : ''}`}
                >
                  <div
                    className={`relative w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all duration-300 shrink-0 ${
                      isActive
                        ? 'bg-gradient-to-br from-[#8b7bff] to-[#6b57f5] text-white shadow-[0_4px_12px_rgba(124,108,255,0.6)]'
                        : isDone
                        ? 'bg-[#7c6cff]/15 text-[color:var(--color-brand-soft)] border border-[#7c6cff]/30'
                        : 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-faint)] border border-[color:var(--color-hairline)]'
                    }`}
                  >
                    {isDone ? (
                      <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
                    ) : (
                      <s.Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    )}
                  </div>
                  <div className="text-left">
                    <div className={`text-xs font-semibold whitespace-nowrap transition-colors ${
                      isActive
                        ? 'text-[color:var(--color-ink)]'
                        : isPassed
                        ? 'text-[color:var(--color-ink-muted)]'
                        : 'text-[color:var(--color-ink-faint)]'
                    }`}>
                      <span className="hidden md:inline">{s.label}</span>
                      <span className="md:hidden">{s.shortLabel}</span>
                    </div>
                    <div className="text-[10px] text-[color:var(--color-ink-faint)] hidden lg:block leading-none mt-0.5 whitespace-nowrap">
                      {s.desc}
                    </div>
                  </div>
                </button>

                {idx < steps.length - 1 && (
                  <div className="w-3 sm:w-4 h-px bg-[color:var(--color-hairline)] shrink-0 relative overflow-hidden rounded-full my-auto">
                    <div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#8b7bff] to-[#6b57f5] transition-all duration-500 ease-out"
                      style={{ width: currentStep > s.number ? '100%' : '0%' }}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
