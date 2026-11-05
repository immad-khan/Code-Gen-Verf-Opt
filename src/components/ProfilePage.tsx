import React, { useState } from 'react';
import {
  User,
  ArrowLeft,
  Mail,
  Phone,
  ShieldCheck,
  CheckCircle2,
  Lock,
  KeyRound,
  LogOut,
  Cpu,
  Eye,
  EyeOff,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import type { SessionUser } from '../../landing_page/src/auth';
import { updateUserPhone, sendOtp, verifyOtp, resetPasswordWithOtp } from '../../landing_page/src/auth';
import { COUNTRIES, type Country } from '../../landing_page/src/components/auth/utils';
import type { ApiSettings } from '../types';

interface ProfilePageProps {
  user: SessionUser | null;
  apiSettings: ApiSettings;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onBackToPipeline: () => void;
  onUserUpdated: (updatedUser: SessionUser) => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  user,
  apiSettings,
  onOpenSettings,
  onSignOut,
  onBackToPipeline,
  onUserUpdated,
}) => {
  // Phone management state
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<Country>(() => {
    return COUNTRIES.find((c) => c.code === 'US') || COUNTRIES[0];
  });
  const [rawPhone, setRawPhone] = useState('');
  const [phoneMessage, setPhoneMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password reset state
  const [resetMethod, setResetMethod] = useState<'email' | 'phone'>('email');
  const [otpSent, setOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetStatus, setResetStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);

  const displayName = user?.name?.trim() || 'VeriFlow Developer';
  const displayEmail = user?.email?.trim() || 'developer@veriflow.dev';
  const displayPhone = user?.phone?.trim() || '';
  const displayInitial = displayName.charAt(0).toUpperCase() || 'V';

  // Handle Save Phone
  const handleSavePhone = (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneMessage(null);
    const digitsOnly = rawPhone.replace(/\D/g, '');
    if (digitsOnly.length < 7) {
      setPhoneMessage({ type: 'error', text: 'Please enter a valid phone number with at least 7 digits.' });
      return;
    }

    const fullPhone = `${selectedCountry.dial} ${digitsOnly}`;
    const result = updateUserPhone(fullPhone);
    if (result.ok && result.user) {
      onUserUpdated(result.user);
      setPhoneMessage({ type: 'success', text: `Phone number successfully updated to ${fullPhone}` });
      setIsEditingPhone(false);
      setRawPhone('');
    } else {
      setPhoneMessage({ type: 'error', text: result.error || 'Failed to update phone number.' });
    }
  };

  // Handle Send OTP
  const handleSendResetOtp = async () => {
    setResetStatus(null);
    const target = resetMethod === 'email' ? displayEmail : displayPhone;

    if (!target) {
      setResetStatus({
        type: 'error',
        text: resetMethod === 'phone' ? 'Please add a mobile number first above.' : 'No email address found.',
      });
      return;
    }

    setIsSendingOtp(true);
    try {
      const channel = resetMethod === 'email' ? 'email' : 'sms';
      const res = await sendOtp(channel, target);
      setOtpSent(true);
      setResetStatus({
        type: 'success',
        text: `A 6-digit one-time verification code was dispatched to ${target}. (Code: ${res.code})`,
      });
    } catch {
      setResetStatus({ type: 'error', text: 'Failed to send verification code. Please check connectivity.' });
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Handle Submit Password Reset
  const handleSubmitResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetStatus(null);

    if (otpCode.trim().length !== 6) {
      setResetStatus({ type: 'error', text: 'Please enter the complete 6-digit verification code.' });
      return;
    }
    if (newPassword.length < 8) {
      setResetStatus({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetStatus({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setIsSubmittingReset(true);
    try {
      // 1. Verify code
      const check = verifyOtp(otpCode.trim());
      if (!check.ok) {
        setResetStatus({
          type: 'error',
          text: check.reason === 'expired' ? 'Verification code has expired. Please request a new one.' : 'Incorrect verification code. Please try again.',
        });
        setIsSubmittingReset(false);
        return;
      }

      // 2. Update password
      const target = resetMethod === 'email' ? displayEmail : displayPhone;
      const res = await resetPasswordWithOtp(target, newPassword);
      if (res.ok) {
        setResetStatus({
          type: 'success',
          text: 'Password successfully changed! Your new credentials are now active.',
        });
        setOtpCode('');
        setNewPassword('');
        setConfirmPassword('');
        setOtpSent(false);
      } else {
        setResetStatus({ type: 'error', text: res.error || 'Could not update password.' });
      }
    } catch {
      setResetStatus({ type: 'error', text: 'An unexpected error occurred while resetting password.' });
    } finally {
      setIsSubmittingReset(false);
    }
  };

  return (
    <div className="flex-1 max-w-5xl w-full mx-auto px-4 md:px-6 py-6 animate-fade-in flex flex-col gap-6">
      {/* Top Back Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBackToPipeline}
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#7c3aed] hover:text-[#6d28d9] bg-white border border-[#ddd0ff] hover:border-[#7c3aed]/50 px-3.5 py-2 rounded-xl shadow-xs transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Pipeline</span>
        </button>
      </div>

      {/* Hero Profile Banner - Light Theme */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#fcfaff] via-[#f7f2ff] to-[#f0e6ff] text-[color:var(--color-ink)] p-6 sm:p-8 shadow-xs border border-[#ddd0ff]">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#7c3aed]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-5 sm:gap-6 text-center sm:text-left">
          <div className="relative">
            <span className="grid h-20 w-20 sm:h-24 sm:w-24 place-items-center rounded-2xl bg-gradient-to-br from-[#9d6cff] to-[#7c3aed] text-3xl sm:text-4xl font-extrabold text-white shadow-md">
              {displayInitial}
            </span>
            <span
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-white shadow-xs"
              title="Active session"
            >
              <CheckCircle2 className="w-4 h-4" />
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1.5">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[color:var(--color-ink)] truncate">{displayName}</h1>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold shadow-xs">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Verified Account</span>
              </span>
            </div>

            <p className="text-xs sm:text-sm text-[color:var(--color-ink-muted)] flex items-center justify-center sm:justify-start gap-2 truncate">
              <Mail className="w-3.5 h-3.5 text-[#7c3aed]" />
              <span>{displayEmail}</span>
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white text-[#5b21b6] text-xs font-mono font-medium border border-[#ddd0ff] shadow-xs">
                <Cpu className="w-3.5 h-3.5 text-[#7c3aed]" />
                <span>{apiSettings.provider.toUpperCase()} · {apiSettings.model}</span>
              </span>
              <button
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#7c3aed] hover:text-[#6d28d9] underline ml-1 cursor-pointer"
              >
                Change Provider Key
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Details & Password Reset */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Phone Number & Contact Details */}
        <div className="card p-6 bg-white border border-[#ddd0ff] rounded-2xl shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[color:var(--color-hairline)] mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#7c3aed]/10 text-[#7c3aed] flex items-center justify-center">
                  <Phone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[color:var(--color-ink)]">Mobile Phone Number</h3>
                  <p className="text-[11px] text-[color:var(--color-ink-muted)]">Used for SMS security verification and password recovery</p>
                </div>
              </div>
            </div>

            {/* Current Phone Status */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 mb-4">
              <span className="text-[10.5px] uppercase font-bold tracking-wider text-[color:var(--color-ink-muted)] block mb-1">
                Current Registered Phone
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-[color:var(--color-ink)]">
                  {displayPhone ? displayPhone : 'No mobile number linked yet'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${
                    displayPhone
                      ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-700 border border-amber-500/20'
                  }`}
                >
                  {displayPhone ? 'Active' : 'Missing'}
                </span>
              </div>
            </div>

            {phoneMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-medium mb-4 flex items-center gap-2 ${
                  phoneMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {phoneMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span>{phoneMessage.text}</span>
              </div>
            )}

            {/* Form to Add or Change Phone */}
            {isEditingPhone ? (
              <form onSubmit={handleSavePhone} className="space-y-3 p-4 rounded-xl border border-[#7c3aed]/30 bg-[#7c3aed]/[0.02]">
                <label className="block text-xs font-bold text-[color:var(--color-ink)]">
                  Enter Mobile Number
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedCountry.code}
                    onChange={(e) => {
                      const found = COUNTRIES.find((c) => c.code === e.target.value);
                      if (found) setSelectedCountry(found);
                    }}
                    className="w-28 text-xs font-semibold px-2 py-2 rounded-xl border border-[color:var(--color-hairline)] bg-white focus:outline-none focus:border-[#7c3aed]"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.dial} ({c.code})
                      </option>
                    ))}
                  </select>

                  <input
                    type="tel"
                    placeholder="e.g. 3001234567"
                    value={rawPhone}
                    onChange={(e) => setRawPhone(e.target.value)}
                    className="flex-1 text-xs font-mono px-3 py-2 rounded-xl border border-[color:var(--color-hairline)] bg-white focus:outline-none focus:border-[#7c3aed] focus:ring-1 focus:ring-[#7c3aed]"
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingPhone(false);
                      setRawPhone('');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-[color:var(--color-ink-muted)] hover:bg-slate-100 rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-lg shadow-xs"
                  >
                    Save Number
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setIsEditingPhone(true)}
                className="w-full py-2.5 px-4 text-xs font-semibold rounded-xl border border-[#7c3aed]/40 text-[#7c3aed] hover:bg-[#7c3aed]/10 transition cursor-pointer flex items-center justify-center gap-2"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>{displayPhone ? 'Change Mobile Number' : 'Add Mobile Number'}</span>
              </button>
            )}
          </div>

          <p className="text-[11px] text-[color:var(--color-ink-faint)] mt-4 pt-3 border-t border-[color:var(--color-hairline)]">
            SMS verification messages are dispatched via TextBee gateway. Carrier rates may apply based on your region.
          </p>
        </div>

        {/* Card 2: Forgot / Reset Password Using Email or Phone */}
        <div className="card p-6 bg-white border border-[#ddd0ff] rounded-2xl shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[color:var(--color-hairline)] mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#7c3aed]/10 text-[#7c3aed] flex items-center justify-center">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[color:var(--color-ink)]">Forgot / Reset Password</h3>
                  <p className="text-[11px] text-[color:var(--color-ink-muted)]">Verify via one-time code to update your security password</p>
                </div>
              </div>
            </div>

            {/* Method Chooser Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 mb-4 text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setResetMethod('email');
                  setOtpSent(false);
                  setResetStatus(null);
                }}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  resetMethod === 'email' ? 'bg-white text-[#7c3aed] shadow-xs' : 'text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Via Email</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setResetMethod('phone');
                  setOtpSent(false);
                  setResetStatus(null);
                }}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  resetMethod === 'phone' ? 'bg-white text-[#7c3aed] shadow-xs' : 'text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]'
                }`}
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Via Phone SMS</span>
              </button>
            </div>

            {/* Target Display */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs mb-4 flex items-center justify-between">
              <span className="text-[color:var(--color-ink-muted)]">
                Reset code target:
              </span>
              <span className="font-mono font-bold text-[color:var(--color-ink)]">
                {resetMethod === 'email' ? displayEmail : (displayPhone || 'No phone set')}
              </span>
            </div>

            {resetStatus && (
              <div
                className={`p-3 rounded-xl text-xs font-medium mb-4 flex items-start gap-2 ${
                  resetStatus.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {resetStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                <span className="leading-relaxed">{resetStatus.text}</span>
              </div>
            )}

            {/* Step 1: Send OTP Button */}
            {!otpSent ? (
              <button
                type="button"
                onClick={handleSendResetOtp}
                disabled={isSendingOtp || (resetMethod === 'phone' && !displayPhone)}
                className="w-full py-2.5 px-4 rounded-xl btn-primary text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {isSendingOtp
                    ? 'Dispatching OTP code...'
                    : resetMethod === 'phone' && !displayPhone
                    ? 'Add Phone Number Above First'
                    : `Send One-Time Code via ${resetMethod === 'email' ? 'Email' : 'SMS'}`}
                </span>
              </button>
            ) : (
              /* Step 2: Enter OTP + New Password Form */
              <form onSubmit={handleSubmitResetPassword} className="space-y-3 animate-fade-in">
                <div>
                  <label className="block text-xs font-bold text-[color:var(--color-ink)] mb-1">
                    6-Digit Verification Code
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    className="w-full text-center tracking-[0.3em] font-mono text-base font-bold py-2 rounded-xl border border-[color:var(--color-hairline)] bg-white focus:outline-none focus:border-[#7c3aed] focus:ring-1 focus:ring-[#7c3aed]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[color:var(--color-ink)] mb-1">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="At least 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full text-xs py-2 pl-3 pr-9 rounded-xl border border-[color:var(--color-hairline)] bg-white focus:outline-none focus:border-[#7c3aed] focus:ring-1 focus:ring-[#7c3aed]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[color:var(--color-ink)] mb-1">
                    Confirm New Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Repeat new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full text-xs py-2 px-3 rounded-xl border border-[color:var(--color-hairline)] bg-white focus:outline-none focus:border-[#7c3aed] focus:ring-1 focus:ring-[#7c3aed]"
                    required
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setOtpSent(false)}
                    className="w-1/3 py-2 text-xs font-semibold text-[color:var(--color-ink-muted)] hover:bg-slate-100 rounded-xl transition"
                  >
                    Resend Code
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingReset}
                    className="flex-1 py-2 btn-primary text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{isSubmittingReset ? 'Updating...' : 'Update Password'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          <p className="text-[11px] text-[color:var(--color-ink-faint)] mt-4 pt-3 border-t border-[color:var(--color-hairline)]">
            Passwords are cryptographically hashed using SHA-256 before local persistence.
          </p>
        </div>
      </div>
    </div>
  );
};
