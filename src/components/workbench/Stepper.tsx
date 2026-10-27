import React from 'react';
import { Check, Loader2, Lock, X } from 'lucide-react';
import type { StageId, StageStatus, WorkbenchState } from '../../state/workbench';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from '../common/asyncStateModel';
import { stepperItems } from './stageModel';

export interface StepperProps {
  state: Pick<WorkbenchState, 'stages' | 'current'>;
  /** Called for unlocked stages only; locked stages are disabled (25.4). */
  onSelect: (stage: StageId) => void;
  className?: string;
}

const STATUS_CLASSES: Record<StageStatus, string> = {
  locked: 'border-slate-300 bg-slate-50 text-slate-600',
  available: 'border-indigo-600 bg-white text-indigo-900',
  running: 'border-sky-700 bg-sky-50 text-sky-900',
  complete: 'border-emerald-700 bg-emerald-50 text-emerald-900',
  failed: 'border-rose-700 bg-rose-50 text-rose-900',
};

function StatusIcon({ status, position }: { status: StageStatus; position: number }) {
  const props = { 'aria-hidden': true, focusable: false, className: 'h-3.5 w-3.5' } as const;
  switch (status) {
    case 'locked':
      return <Lock {...props} />;
    case 'running':
      return <Loader2 {...props} className="h-3.5 w-3.5 animate-spin" />;
    case 'complete':
      return <Check {...props} />;
    case 'failed':
      return <X {...props} />;
    default:
      return <span aria-hidden="true">{position}</span>;
  }
}

/**
 * Workbench stepper: the five stages in fixed order, each with exactly one
 * visible status (25.3). Locked stages are disabled buttons (25.4); the current
 * stage carries `aria-current="step"`.
 */
export const Stepper: React.FC<StepperProps> = ({ state, onSelect, className }) => {
  const items = stepperItems(state);
  return (
    <nav aria-label="Workbench stages" className={cn('w-full', className)}>
      <ol className="flex flex-wrap items-stretch gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex-1 min-w-[8rem]">
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              disabled={item.disabled}
              aria-current={item.current ? 'step' : undefined}
              aria-label={`Stage ${item.position}: ${item.label}, ${item.statusLabel.toLowerCase()}`}
              data-status={item.status}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                'disabled:cursor-not-allowed cursor-pointer',
                STATUS_CLASSES[item.status],
                item.current && 'ring-2 ring-indigo-700 ring-offset-1',
                FOCUS_RING,
              )}
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold">
                <StatusIcon status={item.status} position={item.position} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{item.label}</span>
                <span className="text-xs">{item.statusLabel}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
};
