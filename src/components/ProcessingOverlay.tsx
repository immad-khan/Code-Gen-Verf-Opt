import React from 'react';
import { AgentLog } from '../types';
import { CheckCircle2, Loader2 } from 'lucide-react';

interface ProcessingOverlayProps {
  progress: number;
  currentLog: AgentLog | null;
  allLogs: AgentLog[];
}

export const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({
  progress,
  currentLog,
  allLogs
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0c10]/80 backdrop-blur-md p-4">
      <div className="card max-w-lg w-full p-6 animate-fade-up">
        <div className="flex items-center gap-3 mb-5">
          <div className="relative w-11 h-11 flex items-center justify-center shrink-0">
            <span className="absolute inset-0 rounded-xl border-2 border-[color:var(--color-hairline)]" />
            <span className="absolute inset-0 rounded-xl border-2 border-[#7c6cff] border-t-transparent animate-spin" />
            <span className="w-4 h-4 rounded-md bg-gradient-to-br from-[#8b7bff] to-[#6b57f5]" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[color:var(--color-ink)]">Running the pipeline</h2>
            <p className="text-xs text-[color:var(--color-ink-muted)]">Generating Python, then auditing every line.</p>
          </div>
          <span className="ml-auto text-sm font-mono font-bold text-[color:var(--color-brand-soft)] tabular-nums">{progress}%</span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-[color:var(--color-surface-2)] h-1.5 rounded-full overflow-hidden mb-5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#8b7bff] to-[#6b57f5] transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Log stream */}
        <div className="card-quiet p-3.5 text-left font-mono text-xs max-h-52 overflow-y-auto space-y-2.5">
          {allLogs.map((log, index) => (
            <div key={index} className="flex items-start gap-2.5 text-[color:var(--color-ink-muted)]">
              <CheckCircle2 className="w-4 h-4 text-[color:var(--color-brand-soft)] shrink-0 mt-0.5" />
              <div>
                <span className="text-[color:var(--color-ink)] font-semibold">{log.agentName}</span>
                <span className="text-[color:var(--color-ink-faint)]"> — {log.message}</span>
              </div>
            </div>
          ))}
          {currentLog && progress < 100 && (
            <div className="flex items-start gap-2.5 text-[color:var(--color-ink)]">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5 text-[color:var(--color-brand-soft)]" />
              <div>
                <span className="font-semibold">{currentLog.agentName}</span>
                <span className="text-[color:var(--color-ink-muted)]"> — {currentLog.message}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
