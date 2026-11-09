import React from 'react';
import { User, X, CheckCircle2, ShieldCheck, Mail, Phone, Cpu, LogOut } from 'lucide-react';
import type { SessionUser } from '../../landing_page/src/auth';
import type { ApiSettings } from '../types';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: SessionUser | null;
  apiSettings: ApiSettings;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  user,
  apiSettings,
  onOpenSettings,
  onSignOut,
}) => {
  if (!isOpen) return null;

  const displayName = user?.name?.trim() || 'VeriFlow User';
  const displayEmail = user?.email?.trim() || 'Signed in via Guest / Local session';
  const displayInitial = displayName.charAt(0).toUpperCase() || 'V';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card max-w-md w-full p-6 relative bg-white border border-[#ddd0ff] shadow-2xl rounded-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[color:var(--color-hairline)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7c3aed]/12 text-[#7c3aed] flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-[color:var(--color-ink)] text-base">User Profile</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)] hover:bg-slate-100 transition cursor-pointer"
            aria-label="Close profile modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Card */}
        <div className="py-5 text-center">
          <div className="relative inline-block mb-3">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#9d6cff] to-[#7c3aed] text-2xl font-extrabold text-white shadow-lg mx-auto">
              {displayInitial}
            </span>
            <span
              className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-white"
              title="Active session"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </span>
          </div>

          <h4 className="text-lg font-bold text-[color:var(--color-ink)]">{displayName}</h4>
          <p className="text-xs text-[color:var(--color-ink-muted)] mt-0.5">{displayEmail}</p>

          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Verified Account</span>
          </div>
        </div>

        {/* Info Rows */}
        <div className="space-y-2.5 py-2 border-t border-[color:var(--color-hairline)] text-xs">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-[color:var(--color-hairline)]">
            <span className="flex items-center gap-2 text-[color:var(--color-ink-muted)]">
              <Mail className="w-4 h-4 text-[#7c3aed]" />
              <span>Email</span>
            </span>
            <span className="font-mono font-medium text-[color:var(--color-ink)] truncate max-w-[200px]">
              {user?.email || 'Not configured'}
            </span>
          </div>

          {user?.phone && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-[color:var(--color-hairline)]">
              <span className="flex items-center gap-2 text-[color:var(--color-ink-muted)]">
                <Phone className="w-4 h-4 text-[#7c3aed]" />
                <span>Phone</span>
              </span>
              <span className="font-mono font-medium text-[color:var(--color-ink)]">{user.phone}</span>
            </div>
          )}

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-[color:var(--color-hairline)]">
            <span className="flex items-center gap-2 text-[color:var(--color-ink-muted)]">
              <Cpu className="w-4 h-4 text-[#7c3aed]" />
              <span>AI Provider</span>
            </span>
            <button
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              className="font-medium text-[#7c3aed] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{apiSettings.provider.toUpperCase()} · {apiSettings.model}</span>
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 pt-4 border-t border-[color:var(--color-hairline)] flex items-center justify-between gap-3">
          <button
            onClick={() => {
              onClose();
              onSignOut();
            }}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log out</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-[color:var(--color-ink)] transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
