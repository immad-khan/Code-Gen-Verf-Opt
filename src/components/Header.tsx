import React from 'react';
import { Lock, KeyRound } from 'lucide-react';

interface HeaderProps {
  temperature?: number;
  onTemperatureChange?: (val: number) => void;
  hasApiKey: boolean;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({ hasApiKey, onOpenSettings }) => {
  const lockedTemperature = 0.1;

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b border-[color:var(--color-hairline)] shadow-xs">
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
              <span className="font-bold text-[15px] tracking-tight text-[color:var(--color-ink)]">Veriflow</span>
              <span className="chip text-[10px] px-2 py-0.5 tracking-wide">Python Audit</span>
            </div>
            <p className="text-[11px] text-[color:var(--color-ink-faint)] hidden sm:block truncate">
              Multi-Agent Code Intelligence
            </p>
          </div>
        </div>

        {/* Right controls: API button + locked temperature */}
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

          {/* Locked Temperature Indicator */}
          <div className="relative group">
            <div 
              title="Temperature locked at 0.1 for deterministic audit repeatability"
              className="flex items-center gap-2.5 pl-3 pr-3 py-2 rounded-xl border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] select-none cursor-default"
            >
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <div className="text-left hidden sm:block">
                <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-ink-faint)] leading-none flex items-center gap-1.5">
                  <span>Temperature</span>
                  <span className="text-[8px] px-1 py-0.2 rounded bg-amber-400/15 text-amber-300 font-semibold tracking-wider">LOCKED</span>
                </div>
                <div className="text-xs font-semibold text-[color:var(--color-ink)] leading-tight mt-0.5">
                  {lockedTemperature.toFixed(1)} · Ultra-Focused
                </div>
              </div>
              <span className="sm:hidden text-xs font-mono font-semibold text-amber-300 flex items-center gap-1">
                {lockedTemperature.toFixed(1)}
              </span>
            </div>

            {/* Hover Tooltip */}
            <div className="absolute right-0 top-full mt-2 w-64 card p-3 z-50 opacity-0 translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 origin-top-right shadow-xl">
              <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold mb-1">
                <Lock className="w-3.5 h-3.5" />
                <span>Locked at 0.1</span>
              </div>
              <p className="text-[11px] text-[color:var(--color-ink-faint)] leading-relaxed">
                Temperature is permanently locked at 0.1 (Ultra-Focused) to ensure strictly deterministic code generation and audit consistency.
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
