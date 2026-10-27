import React from 'react';
import { KeyRound } from 'lucide-react';

interface HeaderProps {
  hasApiKey: boolean;
  onOpenSettings: () => void;
  onGoToLanding?: () => void;
  /** Top-level section navigation (AppShell passes SectionNav). */
  nav?: React.ReactNode;
  /** Global status area, e.g. the backend offline indicator (23.7). */
  status?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ hasApiKey, onOpenSettings, onGoToLanding, nav, status }) => {
  // Starts with the visible text so the accessible name matches the label (WCAG 2.5.3).
  const settingsLabel = hasApiKey ? 'API connected, change API settings' : 'Connect API provider';
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/90 border-b border-[color:var(--color-hairline)] shadow-xs">
      <div className="max-w-6xl mx-auto px-4 md:px-6 min-h-16 py-2 flex flex-wrap items-center justify-between gap-3">
        {/* Brand */}
        <div
          onClick={onGoToLanding}
          className={`flex items-center gap-3 min-w-0 ${onGoToLanding ? 'cursor-pointer group' : ''}`}
          title={onGoToLanding ? 'Return to Landing Page' : undefined}
        >
          <div
            className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-[#8b7bff] to-[#6b57f5] flex items-center justify-center shadow-[0_6px_18px_-6px_rgba(124,108,255,0.8)] shrink-0 group-hover:scale-105 transition-transform"
            aria-hidden="true"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white" focusable="false">
              <path d="M12 2L4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4z" fill="currentColor" fillOpacity="0.25"/>
              <path d="M9 12l2 2 4-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="leading-tight min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[15px] tracking-tight text-[color:var(--color-ink)] group-hover:text-[#7c6cff] transition-colors">Veriflow</span>
              <span className="chip text-[10px] px-2 py-0.5 tracking-wide">Python Audit</span>
            </div>
            <p className="text-[11px] text-[color:var(--color-ink-faint)] hidden sm:block truncate">
              Multi-Agent Code Intelligence
            </p>
          </div>
        </div>

        {nav}

        {/* Right controls: Landing Page link + global status + API button */}
        <div className="flex items-center gap-2">
          {onGoToLanding && (
            <button
              type="button"
              onClick={onGoToLanding}
              className="btn-ghost px-3 py-2 text-xs flex items-center gap-1.5 cursor-pointer text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]"
              title="Return to Landing Page"
            >
              <span>← Landing Page</span>
            </button>
          )}
          {status}
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={settingsLabel}
            title={hasApiKey ? 'API connected — click to change' : 'Connect an AI provider'}
            className={`btn-ghost px-3 py-2 text-xs flex items-center gap-2 cursor-pointer ${hasApiKey ? 'border-emerald-600/40 text-emerald-800' : ''}`}
          >
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline" aria-hidden="true">{hasApiKey ? 'API connected' : 'Connect API'}</span>
            {hasApiKey && <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>
  );
};
