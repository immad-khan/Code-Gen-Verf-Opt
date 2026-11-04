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
      {/* Sleek Metallic Silver / Soft Gray Industrial Dock */}
      <div className="flex flex-col items-center gap-3 py-3.5 px-2 rounded-r-2xl sm:rounded-r-3xl bg-gradient-to-b from-[#f8fafc] via-[#e2e8f0] to-[#cbd5e1] border-r border-y border-slate-300 shadow-[inset_0_1px_1px_rgba(255,255,255,0.95),inset_0_-1px_1px_rgba(0,0,0,0.06),4px_0_22px_rgba(71,85,105,0.22)] backdrop-blur-xl">
        {/* Subtle metallic brushed top highlight */}
        <div className="w-4 h-0.5 rounded-full bg-slate-400/75 mb-1" aria-hidden="true" />

        {/* 1. History Button */}
        <div className="relative group">
          <button
            type="button"
            onClick={() => onNavigate(activeView === 'history' ? 'pipeline' : 'history')}
            aria-label="Generation History"
            title="History Page"
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
              activeView === 'history'
                ? 'bg-[#7c3aed] text-white shadow-[0_4px_14px_rgba(124,58,237,0.5)] scale-105 ring-1 ring-white/60'
                : 'text-slate-600 hover:text-[#7c3aed] hover:bg-white/80 hover:shadow-xs hover:scale-105 active:scale-95'
            }`}
          >
            <History className="w-5 h-5 transition-transform group-hover:rotate-[-12deg]" />
          </button>

          {/* Floating Tooltip */}
          <div
            role="tooltip"
            className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-100 bg-slate-900/95 border border-slate-700/90 rounded-lg shadow-2xl whitespace-nowrap z-50 animate-fade-in backdrop-blur-md"
          >
            <History className="w-3.5 h-3.5 text-[#a78bfa]" />
            <span>History Page</span>
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-slate-900" />
          </div>
        </div>

        {/* Metallic divider dot */}
        <div className="w-1 h-1 rounded-full bg-slate-400/60" aria-hidden="true" />

        {/* 2. Profile Button */}
        <div className="relative group">
          <button
            type="button"
            onClick={() => onNavigate(activeView === 'profile' ? 'pipeline' : 'profile')}
            aria-label="User Profile & Security"
            title="Profile & Settings"
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
              activeView === 'profile'
                ? 'bg-[#7c3aed] text-white shadow-[0_4px_14px_rgba(124,58,237,0.5)] scale-105 ring-1 ring-white/60'
                : 'text-slate-600 hover:text-[#7c3aed] hover:bg-white/80 hover:shadow-xs hover:scale-105 active:scale-95'
            }`}
          >
            <User className="w-5 h-5 transition-transform group-hover:scale-110" />
          </button>

          {/* Floating Tooltip */}
          <div
            role="tooltip"
            className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-100 bg-slate-900/95 border border-slate-700/90 rounded-lg shadow-2xl whitespace-nowrap z-50 animate-fade-in backdrop-blur-md"
          >
            <User className="w-3.5 h-3.5 text-[#a78bfa]" />
            <span>Profile &amp; Security</span>
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-slate-900" />
          </div>
        </div>

        {/* Subtle metallic brushed bottom highlight */}
        <div className="w-4 h-0.5 rounded-full bg-slate-400/60 mt-1" aria-hidden="true" />
      </div>
    </aside>
  );
};
