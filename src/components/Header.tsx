import React from 'react';
import { KeyRound, LogOut } from 'lucide-react';

interface HeaderProps {
  hasApiKey: boolean;
  onOpenSettings: () => void;
  onGoToLanding?: () => void;
  onSignOut?: () => void;
  user?: { name: string; email: string; phone?: string } | null;
  /** Top-level section navigation (AppShell passes SectionNav). */
  nav?: React.ReactNode;
  /** Global status area, e.g. the backend offline indicator (23.7). */
  status?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ hasApiKey, onOpenSettings, onGoToLanding, onSignOut, user, nav, status }) => {
  // Starts with the visible text so the accessible name matches the label (WCAG 2.5.3).
  const settingsLabel = hasApiKey ? 'API connected, change API settings' : 'Connect API provider';

  const handleLogout = () => {
    if (onSignOut) {
      onSignOut();
    } else {
      try {
        localStorage.removeItem('vf.session');
        sessionStorage.removeItem('vf.session');
      } catch {}
      window.location.hash = '';
      window.location.reload();
    }
  };

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/90 border-b border-[color:var(--color-hairline)] shadow-xs">
      <div className="max-w-6xl mx-auto px-4 md:px-6 min-h-16 py-2 flex flex-wrap items-center justify-between gap-3">
        {/* Brand - Exactly matches Landing Page logo */}
        <div
          onClick={onGoToLanding}
          className={`flex items-center gap-2.5 min-w-0 ${onGoToLanding ? 'cursor-pointer group' : ''}`}
          title={onGoToLanding ? 'Return to Landing Page' : undefined}
        >
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#9d6cff] to-[#7c3aed] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_16px_-8px_rgba(124,58,237,0.8)] shrink-0 group-hover:scale-105 transition-transform">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-white" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l5 5L19 7.5" />
            </svg>
          </span>
          <span className="text-[1.35rem] font-extrabold tracking-tight text-ink leading-none">
            Veri<span className="text-brand-600">Flow</span>
          </span>
        </div>

        {nav}

        {/* Right controls: user profile + global status + API button + Logout */}
        <div className="flex items-center gap-2.5">
          {status}

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={settingsLabel}
            title={hasApiKey ? 'API connected — click to change' : 'Connect an AI provider'}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-2 cursor-pointer transition-all shadow-xs ${
              hasApiKey
                ? 'border border-emerald-500/30 bg-emerald-50/90 text-emerald-800 hover:bg-emerald-100 hover:border-emerald-500/50'
                : 'border border-[#7c3aed]/40 bg-gradient-to-r from-[#7c3aed]/10 to-[#8b5cf6]/10 text-[#7c3aed] hover:bg-[#7c3aed]/20 hover:border-[#7c3aed]/60'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5 shrink-0 text-current" aria-hidden="true" />
            <span className="font-semibold text-current">{hasApiKey ? 'API connected' : 'Connect API'}</span>
            {hasApiKey ? (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" aria-hidden="true" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" aria-hidden="true" />
            )}
          </button>

          {user && (
            <div
              className="flex items-center gap-2 rounded-full border border-[#ddd0ff] bg-[#f6f2ff] py-1 pl-1 pr-3 text-[12.5px] font-semibold text-[#5b21b6] shadow-xs"
              title={`Logged in as ${user.name}${user.email ? ` (${user.email})` : ''}`}
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#8b5cf6] to-[#6d28d9] text-[11px] font-extrabold text-white shadow-xs">
                {user.name.trim().charAt(0).toUpperCase() || "U"}
              </span>
              <span className="truncate max-w-[120px]">{user.name.split(" ")[0]}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl text-rose-600 hover:text-rose-700 bg-rose-50/90 hover:bg-rose-100 border border-rose-200/80 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="Log out of VeriFlow"
            aria-label="Log out"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Log out</span>
          </button>
        </div>
      </div>
    </header>
  );
};
