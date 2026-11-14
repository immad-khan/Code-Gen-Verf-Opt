import React from 'react';
import { PipelineStep } from '../types';
import { Check, PenLine, FileText, Lock, Code2, ShieldCheck, Sparkles } from 'lucide-react';

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
  maxUnlockedStep = 6,
}) => {
  const steps = [
    { number: 1 as PipelineStep, label: 'Prompt', shortLabel: 'Prompt', desc: 'Task / Benchmark', Icon: PenLine },
    { number: 2 as PipelineStep, label: 'Interface', shortLabel: 'Interface', desc: 'Contract review', Icon: FileText },
    { number: 3 as PipelineStep, label: 'Tests (Lock)', shortLabel: 'Tests', desc: 'Pytest & integrity', Icon: Lock },
    { number: 4 as PipelineStep, label: 'Code', shortLabel: 'Code', desc: 'Docker synthesis', Icon: Code2 },
    { number: 5 as PipelineStep, label: 'Verify', shortLabel: 'Verify', desc: 'R0 / R1 / R2 checks', Icon: ShieldCheck },
    { number: 6 as PipelineStep, label: 'Repair', shortLabel: 'Repair', desc: 'Dou / Improved / Compare', Icon: Sparkles },
  ];

  return (
    <div className="border-b border-[color:var(--color-hairline)] bg-[color:var(--color-surface-1)] sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3">
        <div className="flex items-center overflow-x-auto scrollbar-none gap-2 sm:gap-2 pb-1 sm:pb-0 justify-between">
          {steps.map((s, idx) => {
            const isActive = currentStep === s.number;
            const isPassed = currentStep > s.number;
            const isClickable = s.number <= maxUnlockedStep;
            const isDone = isPassed;

            return (
              <React.Fragment key={s.number}>
                <button
                  onClick={() => isClickable && onSelectStep(s.number)}
                  disabled={!isClickable}
                  title={`${s.label}: ${s.desc}`}
                  className={`flex items-center gap-2 sm:gap-2.5 px-3 py-1.5 rounded-xl transition-all shrink-0 group ${
                    isClickable ? 'cursor-pointer hover:bg-[color:var(--color-surface-2)]' : 'cursor-not-allowed opacity-40'
                  } ${isActive ? 'bg-[color:var(--color-surface-2)] ring-1 ring-[#7c3aed]/40' : ''}`}
                >
                  <div
                    className={`relative w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all duration-300 shrink-0 ${
                      isActive
                        ? 'bg-gradient-to-br from-[#8b5cf6] to-[#6d28d9] text-white shadow-[0_4px_12px_rgba(124,58,237,0.5)]'
                        : isDone
                        ? 'bg-[#7c3aed]/15 text-[#7c3aed] border border-[#7c3aed]/30'
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
                  <div className="w-4 sm:w-6 h-px bg-[color:var(--color-hairline)] shrink-0 relative overflow-hidden rounded-full my-auto">
                    <div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#8b5cf6] to-[#6d28d9] transition-all duration-500 ease-out"
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
