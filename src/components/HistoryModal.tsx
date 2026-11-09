import React from 'react';
import { History, X, ArrowRight, Trash2, Clock, Sparkles } from 'lucide-react';

export interface HistoryItem {
  id: string;
  prompt: string;
  timestamp: string;
  provider?: string;
  model?: string;
  verdict?: string;
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onSelectPrompt: (prompt: string) => void;
  onClearHistory: () => void;
}

const SAMPLE_PROMPTS = [
  {
    title: 'Library API with SQL Injection Protection',
    prompt: 'Create a Python library management system with SQLite, books search endpoint with parameterized queries to prevent SQL injection, and pytest coverage.',
  },
  {
    title: 'FastAPI JWT Authentication Service',
    prompt: 'Build a secure FastAPI user registration and JWT authentication service with password hashing and token expiration checks.',
  },
  {
    title: 'Mathematical Algorithm with Property Tests',
    prompt: 'Implement a memoized Fibonacci and prime factorization service with hypothesis property-based tests and boundary condition handling.',
  },
];

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  onSelectPrompt,
  onClearHistory,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card max-w-xl w-full p-6 relative bg-white border border-[#ddd0ff] shadow-2xl rounded-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[color:var(--color-hairline)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#7c3aed]/12 text-[#7c3aed] flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[color:var(--color-ink)] text-base">Generation History</h3>
              <p className="text-xs text-[color:var(--color-ink-muted)]">
                Review and reload past prompts and verification runs
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)] hover:bg-slate-100 transition cursor-pointer"
            aria-label="Close history modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
          {history.length > 0 ? (
            history.map((item) => (
              <div
                key={item.id}
                className="p-3.5 rounded-xl border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-1)] hover:border-[#7c3aed]/50 hover:bg-[#7c3aed]/[0.02] transition-all group"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-mono text-[color:var(--color-ink-faint)]">
                    <Clock className="w-3 h-3" />
                    {item.timestamp}
                  </span>
                  {item.verdict && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      {item.verdict}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[color:var(--color-ink)] font-medium line-clamp-2 leading-relaxed">
                  {item.prompt}
                </p>
                <div className="mt-3 flex items-center justify-between pt-2 border-t border-[color:var(--color-hairline)]">
                  <span className="text-[10px] text-[color:var(--color-ink-faint)] font-mono">
                    {item.provider ? `${item.provider.toUpperCase()} · ${item.model || ''}` : 'VeriFlow Run'}
                  </span>
                  <button
                    onClick={() => {
                      onSelectPrompt(item.prompt);
                      onClose();
                    }}
                    className="text-xs font-semibold text-[#7c3aed] hover:text-[#6d28d9] flex items-center gap-1 cursor-pointer transition"
                  >
                    <span>Load prompt</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-6 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#7c3aed]/10 text-[#7c3aed] mx-auto flex items-center justify-center mb-3">
                <Clock className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-semibold text-[color:var(--color-ink)] mb-1">No past runs yet</h4>
              <p className="text-xs text-[color:var(--color-ink-muted)] max-w-xs mx-auto mb-5">
                Prompts you generate will appear here so you can easily reload and re-verify them.
              </p>

              <div className="text-left pt-3 border-t border-[color:var(--color-hairline)]">
                <span className="eyebrow block mb-2 text-[10.5px]">Try one of these sample prompts:</span>
                <div className="space-y-2">
                  {SAMPLE_PROMPTS.map((sample, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        onSelectPrompt(sample.prompt);
                        onClose();
                      }}
                      className="w-full text-left p-2.5 rounded-xl border border-[color:var(--color-hairline)] hover:border-[#7c3aed]/40 hover:bg-[#7c3aed]/[0.03] transition cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#7c3aed] mb-0.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{sample.title}</span>
                      </div>
                      <p className="text-[11px] text-[color:var(--color-ink-muted)] line-clamp-1">{sample.prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {history.length > 0 && (
          <div className="pt-3 border-t border-[color:var(--color-hairline)] flex items-center justify-between shrink-0">
            <button
              onClick={onClearHistory}
              className="text-xs text-rose-600 hover:text-rose-700 flex items-center gap-1.5 cursor-pointer font-medium transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-[color:var(--color-ink)] transition cursor-pointer"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
