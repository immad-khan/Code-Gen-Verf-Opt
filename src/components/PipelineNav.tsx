import React from 'react';
import { PipelineStep } from '../types';
import { Check, PenLine, Code2, ShieldCheck } from 'lucide-react';

interface PipelineNavProps {
  currentStep: PipelineStep;
  onSelectStep: (step: PipelineStep) => void;
  hasResult: boolean;
}

export const PipelineNav: React.FC<PipelineNavProps> = ({
  currentStep,
  onSelectStep,
  hasResult
}) => {
  const steps = [
    { number: 1 as PipelineStep, label: 'Prompt', desc: 'Describe what to build', Icon: PenLine },
    { number: 2 as PipelineStep, label: 'Generate', desc: 'Python code synthesis', Icon: Code2 },
    { number: 3 as PipelineStep, label: 'Audit', desc: 'Security & quality report', Icon: ShieldCheck },
  ];

  return (
    <div className="border-b border-[color:var(--color-hairline)]">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-5">
        <div className="flex items-center">
          {steps.map((s, idx) => {
            const isActive = currentStep === s.number;
            const isPassed = currentStep > s.number || (hasResult && s.number < currentStep);
            const isClickable = s.number === 1 || hasResult;
            const isDone = (currentStep > s.number) || (hasResult && s.number < 3 && currentStep !== s.number);

            return (
              <React.Fragment key={s.number}>
                <button
                  onClick={() => isClickable && onSelectStep(s.number)}
                  disabled={!isClickable}
                  className={`flex items-center gap-3 group ${isClickable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                >
                  <div
                    className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
                      isActive
                        ? 'bg-gradient-to-br from-[#8b7bff] to-[#6b57f5] text-white shadow-[0_6px_18px_-6px_rgba(124,108,255,0.8)]'
                        : isDone
                        ? 'bg-[#7c6cff]/12 text-[color:var(--color-brand-soft)] border border-[#7c6cff]/30'
                        : 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-faint)] border border-[color:var(--color-hairline)]'
                    }`}
                  >
                    {isDone ? <Check className="w-5 h-5 stroke-[2.5]" /> : <s.Icon className="w-[18px] h-[18px]" />}
                  </div>
                  <div className="text-left hidden sm:block">
                    <div className={`text-sm font-semibold transition-colors ${
                      isActive ? 'text-[color:var(--color-ink)]' : isPassed ? 'text-[color:var(--color-ink-muted)]' : 'text-[color:var(--color-ink-faint)]'
                    }`}>
                      {s.label}
                    </div>
                    <div className="text-[11px] text-[color:var(--color-ink-faint)]">{s.desc}</div>
                  </div>
                </button>

                {idx < steps.length - 1 && (
                  <div className="flex-1 mx-3 sm:mx-4 h-px bg-[color:var(--color-hairline)] relative overflow-hidden rounded-full">
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
