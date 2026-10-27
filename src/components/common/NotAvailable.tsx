import React from 'react';
import { cn } from '../../utils/cn';

/** Placeholder text for absent values; never rendered as 0 (27.3). */
export const NOT_AVAILABLE_TEXT = 'not available';

export interface NotAvailableProps {
  /** Why the value is missing, e.g. "RSR_2 needs k ≥ 2". Shown as a tooltip and read by screen readers. */
  reason?: string;
  className?: string;
}

/** Renders the "not available" placeholder (slate-600 text, 7.6:1 on white). */
export const NotAvailable: React.FC<NotAvailableProps> = ({ reason, className }) => (
  <span className={cn('italic text-slate-600', className)} title={reason}>
    {NOT_AVAILABLE_TEXT}
    {reason ? <span className="sr-only">{`: ${reason}`}</span> : null}
  </span>
);
