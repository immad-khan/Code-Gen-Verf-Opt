import React from 'react';
import { SlidersHorizontal, ChevronDown, Check, KeyRound } from 'lucide-react';

interface HeaderProps {
  temperature: number;
  onTemperatureChange: (val: number) => void;
  hasApiKey: boolean;
  onOpenSettings: () => void;
}

const TEMPERATURE_OPTIONS = [
  { value: 0.0, label: 'Deterministic',  desc: 'Identical output every run — zero randomness' },
  { value: 0.1, label: 'Ultra-Focused',  desc: 'Near-deterministic with minimal drift' },
  { value: 0.2, label: 'Strict',         desc: 'Highly consistent — recommended for security audits' },
  { value: 0.3, label: 'Precise',        desc: 'Low variation, strong adherence to spec' },
  { value: 0.4, label: 'Balanced-Low',   desc: 'Slight creativity while staying accurate' },
  { value: 0.5, label: 'Neutral',        desc: 'Equal balance of precision and variation' },
  { value: 0.6, label: 'Balanced',       desc: 'Default — good creative / accuracy mix' },
  { value: 0.7, label: 'Flexible',       desc: 'More varied phrasing and structure' },
  { value: 0.8, label: 'Creative',       desc: 'Diverse, less predictable responses' },
  { value: 0.9, label: 'Exploratory',    desc: 'High randomness, novel approaches' },
  { value: 1.0, label: 'Max Creativity', desc: 'Maximum entropy — unpredictable output' },
];

export const Header: React.FC<HeaderProps> = ({ temperature, onTemperatureChange, hasApiKey, onOpenSettings }) => {
  const selected = TEMPERATURE_OPTIONS.reduce((prev, curr) =>
    Math.abs(curr.value - temperature) < Math.abs(prev.value - temperature) ? curr : prev
  );

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#0b0c10]/70 border-b border-[color:var(--color-hairline)]">
      <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-[#8b7bff] to-[#6b57f5] flex items-center justify-center shadow-[0_6px_18px_-6px_rgba(124,108,255,0.8)] shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M12 2L4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4z" fill="currentColor" fillOpacity="0.25"/>
              <path d="M9 12l2 2 4-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="leading-tight min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[15px] tracking-tight text-[color:var(--color-ink)]">MACI</span>
              <span className="chip text-[10px] px-2 py-0.5 tracking-wide">Python Audit</span>
            </div>
            <p className="text-[11px] text-[color:var(--color-ink-faint)] hidden sm:block truncate">
              Multi-Agent Code Intelligence
            </p>
          </div>
        </div>

        {/* Right controls: API button + temperature */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSettings}
            title={hasApiKey ? 'API connected — click to change' : 'Connect an AI provider'}
            className={`btn-ghost px-3 py-2 text-xs flex items-center gap-2 cursor-pointer ${hasApiKey ? 'border-emerald-500/30 text-emerald-300' : ''}`}
          >
            <KeyRound className="w-4 h-4" />
            <span className="hidden sm:inline">{hasApiKey ? 'API connected' : 'Connect API'}</span>
            {hasApiKey && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          </button>

          {/* Temperature Control */}
        <div className="relative group">
          <button className="flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-xl border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] hover:border-[#33384a] transition cursor-pointer">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[color:var(--color-brand-soft)]" />
            <div className="text-left hidden sm:block">
              <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-ink-faint)] leading-none">Temperature</div>
              <div className="text-xs font-semibold text-[color:var(--color-ink)] leading-tight mt-0.5">
                {temperature.toFixed(1)} · {selected.label}
              </div>
            </div>
            <span className="sm:hidden text-xs font-mono font-semibold text-[color:var(--color-ink)]">{temperature.toFixed(1)}</span>
            <ChevronDown className="w-4 h-4 text-[color:var(--color-ink-faint)] group-hover:rotate-180 transition-transform duration-200" />
          </button>

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 w-72 card p-1.5 z-50 opacity-0 translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all duration-200 origin-top-right">
            <div className="px-3 py-2 mb-1">
              <div className="eyebrow">Generation Temperature</div>
              <p className="text-[11px] text-[color:var(--color-ink-faint)] mt-1">Controls output randomness. Lower is safer for security audits.</p>
            </div>
            <div className="space-y-0.5 max-h-72 overflow-y-auto pr-0.5 scrollbar-thin">
              {TEMPERATURE_OPTIONS.map((opt) => {
                const active = Math.abs(opt.value - temperature) < 0.001;
                return (
                  <button
                    key={opt.value}
                    onClick={() => onTemperatureChange(opt.value)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition cursor-pointer ${
                      active ? 'bg-[#7c6cff]/12' : 'hover:bg-[color:var(--color-surface-3)]'
                    }`}
                  >
                    <span className={`font-mono text-xs w-7 shrink-0 ${active ? 'text-[color:var(--color-brand-soft)]' : 'text-[color:var(--color-ink-faint)]'}`}>
                      {opt.value.toFixed(1)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-semibold ${active ? 'text-[color:var(--color-ink)]' : 'text-[color:var(--color-ink-muted)]'}`}>{opt.label}</div>
                      <div className="text-[10px] text-[color:var(--color-ink-faint)] truncate">{opt.desc}</div>
                    </div>
                    {active && <Check className="w-4 h-4 text-[color:var(--color-brand-soft)] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        </div>
      </div>
    </header>
  );
};
