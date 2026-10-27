import React from 'react';
import { cn } from '../../utils/cn';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

// Each tone pairs a 50-level background with 800/900-level text (≥ 7:1) and a
// 600-level border (≥ 3:1 against white) so the badge meets 28.11. Meaning is
// always carried by the text, never by color alone.
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-50 text-slate-800 border-slate-500',
  info: 'bg-sky-50 text-sky-900 border-sky-700',
  success: 'bg-emerald-50 text-emerald-900 border-emerald-700',
  warning: 'bg-amber-50 text-amber-900 border-amber-700',
  danger: 'bg-rose-50 text-rose-900 border-rose-700',
  brand: 'bg-indigo-50 text-indigo-900 border-indigo-600',
};

export interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  /** Decorative icon rendered before the text; hidden from assistive technologies. */
  icon?: React.ReactNode;
  /** Extra description for assistive technologies, e.g. "results come from the mock LLM client". */
  description?: string;
  className?: string;
}

/** Small inline label for statuses and run markers (e.g. `mock`, `legacy`, stage status). */
export const Badge: React.FC<BadgeProps> = ({ children, tone = 'neutral', icon, description, className }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap',
      TONE_CLASSES[tone],
      className,
    )}
    title={description}
  >
    {icon ? (
      <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 items-center justify-center">
        {icon}
      </span>
    ) : null}
    <span>{children}</span>
    {description ? <span className="sr-only">{` (${description})`}</span> : null}
  </span>
);
