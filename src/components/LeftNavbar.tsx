import React from 'react';
import { History, User } from 'lucide-react';

interface LeftNavbarProps {
  activeView: 'pipeline' | 'history' | 'profile';
  onNavigate: (view: 'pipeline' | 'history' | 'profile') => void;
}

export const LeftNavbar: React.FC<LeftNavbarProps> = ({
  activeView,
  onNavigate,
}) => {
  return (
    <aside
      aria-label="Sidebar Navigation"
      className="fixed left-0 top-1/2 -translate-y-1/2 z-40 select-none"
    >
      <div className="flex flex-col items-center gap-3 py-3.5 px-2 rounded-r-2xl sm:rounded-r-3xl bg-white/95 border-r border-y border-[#ddd0ff] shadow-[4px_0_20px_-2px_rgba(124,58,237,0.12)] backdrop-blur-xl">
        {/* Subtle accent line at top edge */}
        <div className="w-4 h-0.5 rounded-full bg-[#7c3aed]/40 mb-1" aria-hidden="true" />

        {/* 1. History Button */}
        <div className="relative group">
          <button
            type="button"
            onClick={() => onNavigate(activeView === 'history' ? 'pipeline' : 'history')}
            aria-label="Generation History"
            title="History Page"
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
              activeView === 'history'
                ? 'bg-[#7c3aed] text-white shadow-[0_4px_14px_rgba(124,58,237,0.45)] scale-105'
                : 'text-[#64748b] hover:text-[#7c3aed] hover:bg-[#7c3aed]/10 hover:scale-105 active:scale-95'
            }`}
          >
            <History className="w-5 h-5 transition-transform group-hover:rotate-[-12deg]" />
          </button>

          {/* Floating Tooltip */}
          <div
            role="tooltip"
            className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-[color:var(--color-ink)] bg-white border border-[#ddd0ff] rounded-lg shadow-xl whitespace-nowrap z-50 animate-fade-in"
          >
            <History className="w-3.5 h-3.5 text-[#7c3aed]" />
            <span>History Page</span>
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-[#ddd0ff]" />
          </div>
        </div>

        {/* Divider dot */}
        <div className="w-1 h-1 rounded-full bg-[#ddd0ff]" aria-hidden="true" />

        {/* 2. Profile Button */}
        <div className="relative group">
          <button
            type="button"
            onClick={() => onNavigate(activeView === 'profile' ? 'pipeline' : 'profile')}
            aria-label="User Profile & Security"
            title="Profile & Settings"
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
              activeView === 'profile'
                ? 'bg-[#7c3aed] text-white shadow-[0_4px_14px_rgba(124,58,237,0.45)] scale-105'
                : 'text-[#64748b] hover:text-[#7c3aed] hover:bg-[#7c3aed]/10 hover:scale-105 active:scale-95'
            }`}
          >
            <User className="w-5 h-5 transition-transform group-hover:scale-110" />
          </button>

          {/* Floating Tooltip */}
          <div
            role="tooltip"
            className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-[color:var(--color-ink)] bg-white border border-[#ddd0ff] rounded-lg shadow-xl whitespace-nowrap z-50 animate-fade-in"
          >
            <User className="w-3.5 h-3.5 text-[#7c3aed]" />
            <span>Profile &amp; Security</span>
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-[#ddd0ff]" />
          </div>
        </div>

        {/* Subtle accent line at bottom edge */}
        <div className="w-4 h-0.5 rounded-full bg-[#7c3aed]/30 mt-1" aria-hidden="true" />
      </div>
    </aside>
  );
};
