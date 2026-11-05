import React, { useState } from 'react';
import { History, ArrowLeft, ArrowRight, Trash2, Clock, Search, Sparkles, Code2, CheckCircle2, Terminal } from 'lucide-react';

export interface HistoryItem {
  id: string;
  prompt: string;
  timestamp: string;
  provider?: string;
  model?: string;
  verdict?: string;
}

interface HistoryPageProps {
  history: HistoryItem[];
  onSelectPrompt: (prompt: string) => void;
  onClearHistory: () => void;
  onDeleteHistoryItem: (id: string) => void;
  onBackToPipeline: () => void;
}

const TEMPLATE_PROMPTS = [
  {
    title: 'Library API with SQL Injection Protection',
    category: 'Backend & Security',
    prompt: 'Create a Python library management system with SQLite, books search endpoint with parameterized queries to prevent SQL injection, and pytest coverage.',
  },
  {
    title: 'FastAPI JWT Authentication & User Management',
    category: 'Web API & Auth',
    prompt: 'Build a secure FastAPI user registration and JWT authentication service with password hashing and token expiration checks.',
  },
  {
    title: 'Mathematical Algorithm with Hypothesis Tests',
    category: 'Algorithms & Testing',
    prompt: 'Implement a memoized Fibonacci and prime factorization service with hypothesis property-based tests and boundary condition handling.',
  },
  {
    title: 'E-Commerce Order Processing Engine',
    category: 'Business Logic',
    prompt: 'Build a Python order processing engine that calculates sales tax, validates inventory stock, handles discounts, and generates receipt invoices.',
  },
];

export const HistoryPage: React.FC<HistoryPageProps> = ({
  history,
  onSelectPrompt,
  onClearHistory,
  onDeleteHistoryItem,
  onBackToPipeline,
}) => {
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = history.filter((item) =>
    item.prompt.toLowerCase().includes(search.toLowerCase()) ||
    (item.provider && item.provider.toLowerCase().includes(search.toLowerCase())) ||
    (item.model && item.model.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-6 py-6 animate-fade-in flex flex-col gap-6">
      {/* Top Navigation & Breadcrumb */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={onBackToPipeline}
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#7c3aed] hover:text-[#6d28d9] bg-white border border-[#ddd0ff] hover:border-[#7c3aed]/50 px-3.5 py-2 rounded-xl shadow-xs transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Pipeline</span>
        </button>

        {history.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <div className="flex items-center gap-2 animate-fade-in">
                <span className="text-xs text-rose-600 font-medium">Are you sure?</span>
                <button
                  onClick={() => {
                    onClearHistory();
                    setConfirmClear(false);
                  }}
                  className="px-2.5 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition"
                >
                  Yes, Clear All
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-2.5 py-1 text-xs font-semibold text-[color:var(--color-ink-muted)] hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 px-3 py-1.5 rounded-xl transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All History</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Hero Header - Light Theme */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#fcfaff] via-[#f7f2ff] to-[#f0e6ff] text-[color:var(--color-ink)] p-6 sm:p-8 shadow-xs border border-[#ddd0ff]">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#7c3aed]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[#ddd0ff] text-xs font-semibold text-[#6d28d9] mb-3 shadow-xs">
              <History className="w-3.5 h-3.5 text-[#7c3aed]" />
              <span>Session &amp; Prompt History</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[color:var(--color-ink)]">Generation History</h1>
            <p className="text-xs sm:text-sm text-[color:var(--color-ink-muted)] mt-1.5 leading-relaxed">
              Every synthesized program, security audit finding, and multi-agent repair run is preserved here. Reload any past prompt into the workbench with a single click.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 shrink-0">
            <div className="p-3 sm:p-4 rounded-xl bg-white/90 border border-[#ddd0ff] text-center shadow-xs">
              <div className="text-2xl sm:text-3xl font-extrabold text-[color:var(--color-ink)]">{history.length}</div>
              <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-ink-faint)] mt-0.5 font-medium">Recorded Runs</div>
            </div>
            <div className="p-3 sm:p-4 rounded-xl bg-white/90 border border-[#ddd0ff] text-center shadow-xs">
              <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600">
                {history.filter((h) => h.verdict?.includes('✓') || h.verdict?.includes('Verified')).length}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-ink-faint)] mt-0.5 font-medium">Verified Clean</div>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      {history.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-ink-faint)]" />
          <input
            type="text"
            placeholder="Search prompt history by keywords, provider, or model..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-xs sm:text-sm rounded-xl border border-[color:var(--color-hairline)] bg-white shadow-xs focus:outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* History Items List */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="card p-5 sm:p-6 bg-white border border-[#ddd0ff]/80 hover:border-[#7c3aed]/50 shadow-xs hover:shadow-md transition-all rounded-2xl flex flex-col justify-between gap-4 group"
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-mono text-[color:var(--color-ink-faint)] bg-slate-50 border border-slate-200/70 px-2.5 py-1 rounded-lg">
                      <Clock className="w-3 h-3 text-[#7c3aed]" />
                      <span>{item.timestamp}</span>
                    </span>
                    {item.provider && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-[#5b21b6] bg-[#f6f2ff] border border-[#ddd0ff] px-2 py-0.5 rounded-lg">
                        <Terminal className="w-3 h-3 text-[#7c3aed]" />
                        <span>{item.provider.toUpperCase()}</span>
                        {item.model && <span className="opacity-70">· {item.model}</span>}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {item.verdict && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{item.verdict}</span>
                      </span>
                    )}
                    <button
                      onClick={() => onDeleteHistoryItem(item.id)}
                      className="p-1.5 text-[color:var(--color-ink-faint)] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                      title="Delete this entry"
                      aria-label="Delete entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-sm font-semibold text-[color:var(--color-ink)] leading-relaxed bg-slate-50/70 p-3.5 rounded-xl border border-slate-200/50">
                  {item.prompt}
                </p>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[color:var(--color-hairline)]">
                <span className="text-xs text-[color:var(--color-ink-muted)] flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-[#7c3aed]" />
                  <span>Ready to re-synthesize or customize</span>
                </span>

                <button
                  onClick={() => {
                    onSelectPrompt(item.prompt);
                    onBackToPipeline();
                  }}
                  className="btn-primary px-4 py-2 text-xs font-semibold rounded-xl flex items-center gap-2 cursor-pointer shadow-xs transition"
                >
                  <span>Load into Pipeline</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : history.length > 0 ? (
        <div className="card p-10 text-center bg-white border border-[#ddd0ff] rounded-2xl">
          <p className="text-sm text-[color:var(--color-ink-muted)]">No runs matched your search query "{search}".</p>
          <button
            onClick={() => setSearch('')}
            className="mt-3 text-xs font-bold text-[#7c3aed] hover:underline"
          >
            Clear Search
          </button>
        </div>
      ) : (
        /* Empty State */
        <div className="card p-8 sm:p-12 text-center bg-white border border-[#ddd0ff] rounded-2xl flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-[#7c3aed]/10 text-[#7c3aed] flex items-center justify-center mb-4">
            <History className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-[color:var(--color-ink)]">No Generation Runs Yet</h3>
          <p className="text-xs sm:text-sm text-[color:var(--color-ink-muted)] max-w-md mt-1 mb-8 leading-relaxed">
            As you synthesize Python code and run Dou et al. iterative verification repairs, each prompt and outcome will automatically be preserved here.
          </p>

          <div className="w-full max-w-2xl text-left">
            <span className="eyebrow block mb-3 text-xs">Or choose a quick-start template:</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TEMPLATE_PROMPTS.map((t, i) => (
                <button
                  key={i}
                  onClick={() => {
                    onSelectPrompt(t.prompt);
                    onBackToPipeline();
                  }}
                  className="p-4 rounded-xl border border-[color:var(--color-hairline)] bg-slate-50/70 hover:bg-[#7c3aed]/[0.03] hover:border-[#7c3aed]/40 text-left transition cursor-pointer group flex flex-col justify-between"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#7c3aed] bg-[#7c3aed]/10 px-2 py-0.5 rounded-md inline-block mb-1.5">
                      {t.category}
                    </span>
                    <h4 className="text-xs font-bold text-[color:var(--color-ink)] group-hover:text-[#7c3aed] transition">
                      {t.title}
                    </h4>
                    <p className="text-[11px] text-[color:var(--color-ink-muted)] line-clamp-2 mt-1 leading-relaxed">
                      {t.prompt}
                    </p>
                  </div>
                  <div className="mt-3 text-xs font-semibold text-[#7c3aed] flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    <span>Try this prompt</span>
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
