import React from 'react';
import { History, User } from 'lucide-react';

interface LeftNavbarProps {
  onOpenHistory: () => void;
  onOpenProfile: () => void;
  isHistoryOpen?: boolean;
  isProfileOpen?: boolean;
}

export const LeftNavbar: React.FC<LeftNavbarProps> = ({
  onOpenHistory,
  onOpenProfile,
  isHistoryOpen = false,
  isProfileOpen = false,
}) => {
  return (
    <aside
      aria-label="Sidebar Navigation"
      className="fixed left-0 top-1/2 -translate-y-1/2 z-40 select-none"
    >
      <div className="flex flex-col items-center gap-3 py-4 px-2 sm:px-2.5 rounded-r-2xl sm:rounded-r-3xl bg-gradient-to-b from-[#240a4b] via-[#1a0736] to-[#120427] border-r border-y border-[#7c3aed]/35 shadow-[4px_0_24px_-2px_rgba(124,58,237,0.4)] backdrop-blur-xl">
        {/* Subtle accent glow line at top edge */}
        <div className="w-4 h-0.5 rounded-full bg-[#8b5cf6]/60 mb-1" aria-hidden="true" />

        {/* 1. History Button */}
        <div className="relative group">
          <button
            type="button"
            onClick={onOpenHistory}
            aria-label="Generation History"
            title="History"
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
              isHistoryOpen
                ? 'bg-[#7c3aed] text-white shadow-[0_0_16px_rgba(124,58,237,0.85)] scale-105 ring-1 ring-white/30'
                : 'text-[#c4b5fd]/75 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
            }`}
          >
            <History className="w-5 h-5 transition-transform group-hover:rotate-[-12deg]" />
          </button>

          {/* Floating Tooltip */}
          <div
            role="tooltip"
            className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-white bg-[#0f0422]/95 border border-[#7c3aed]/50 rounded-lg shadow-xl whitespace-nowrap z-50 animate-fade-in"
          >
            <History className="w-3.5 h-3.5 text-[#a78bfa]" />
            <span>History</span>
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-[#7c3aed]/50" />
          </div>
        </div>

        {/* Divider dot */}
        <div className="w-1 h-1 rounded-full bg-white/15" aria-hidden="true" />

        {/* 2. Profile Button */}
        <div className="relative group">
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="User Profile"
            title="Profile"
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
              isProfileOpen
                ? 'bg-[#7c3aed] text-white shadow-[0_0_16px_rgba(124,58,237,0.85)] scale-105 ring-1 ring-white/30'
                : 'text-[#c4b5fd]/75 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
            }`}
          >
            <User className="w-5 h-5 transition-transform group-hover:scale-110" />
          </button>

          {/* Floating Tooltip */}
          <div
            role="tooltip"
            className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-white bg-[#0f0422]/95 border border-[#7c3aed]/50 rounded-lg shadow-xl whitespace-nowrap z-50 animate-fade-in"
          >
            <User className="w-3.5 h-3.5 text-[#a78bfa]" />
            <span>Profile</span>
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-[#7c3aed]/50" />
          </div>
        </div>

        {/* Subtle accent glow line at bottom edge */}
        <div className="w-4 h-0.5 rounded-full bg-[#8b5cf6]/40 mt-1" aria-hidden="true" />
      </div>
    </aside>
  );
};
