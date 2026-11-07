import { useState, type ReactNode } from "react";
import { COUNTRIES, countryOf, strengthOf, type Notice } from "./utils";
import { EyeIcon } from "./icons";

export function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="mt-1.5 text-[12.5px] font-semibold text-rose-500" role="alert">
      {msg}
    </p>
  );
}

export function Banner({ notice, error }: { notice: Notice; error?: string }) {
  return (
    <>
      {notice && (
        <div
          className={`mt-4 rounded-xl border p-3 text-[13px] font-semibold ${
            notice.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-brand-200 bg-brand-50 text-brand-700"
          }`}
        >
          {notice.text}
        </div>
      )}
      {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] font-semibold text-rose-600">{error}</div>}
    </>
  );
}

type PhoneProps = {
  country: string;
  phone: string;
  error?: string;
  hint?: string;
  onCountry: (code: string) => void;
  onPhone: (value: string) => void;
};

export function PhoneField({ country, phone, error, hint, onCountry, onPhone }: PhoneProps) {
  const c = countryOf(country);
  return (
    <div>
      <label htmlFor="phone" className="mb-1.5 block text-[13px] font-bold text-ink">Mobile number</label>
      <div className="field-group" data-invalid={!!error}>
        <div className="relative shrink-0 border-r border-brand-100">
          <span className="pointer-events-none flex h-full items-center gap-1.5 pl-3.5 pr-3 text-[14.5px] font-bold text-ink">
            {c.code}
            <span className="font-semibold text-muted">{c.dial}</span>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
          <select
            aria-label="Country code"
            value={country}
            onChange={(e) => onCountry(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            {COUNTRIES.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.name} ({opt.dial})
              </option>
            ))}
          </select>
        </div>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="Mobile number"
          value={phone}
          onChange={(e) => onPhone(e.target.value.replace(/[^\d\s-]/g, ""))}
          aria-invalid={!!error}
          className="min-w-0 flex-1 rounded-r-[14px] bg-transparent px-3.5 py-3 text-[15px] text-ink outline-none placeholder:text-[#a9a3c2]"
        />
      </div>
      {error ? <FieldError msg={error} /> : hint ? <p className="mt-1.5 text-[12px] text-muted/80">{hint}</p> : null}
    </div>
  );
}

type PasswordProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete: string;
  error?: string;
  strength?: boolean;
  action?: ReactNode;
};

export function PasswordField({ id, label, value, onChange, placeholder, autoComplete, error, strength = false, action }: PasswordProps) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const s = strengthOf(value);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="block text-[13px] font-bold text-ink">{label}</label>
        {action}
      </div>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          className="field pr-12"
          placeholder={placeholder}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
          aria-invalid={!!error}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-brand-600"
        >
          <EyeIcon open={show} />
        </button>
      </div>
      {caps && <p className="mt-1.5 text-[12px] font-semibold text-amber-600">Caps Lock is on.</p>}
      <FieldError msg={error} />
      {strength && value && (
        <div className="mt-2.5">
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i < s.score ? s.tone : "bg-brand-100"}`} />
            ))}
          </div>
          <p className="mt-1 text-[12px] font-semibold text-muted">{s.label}</p>
        </div>
      )}
    </div>
  );
}

export function TermsField({ checked, onChange, error }: { checked: boolean; onChange: (v: boolean) => void; error?: string }) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-muted">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#7c3aed]" />
        <span>I agree to the terms of service and understand this preview stores my account locally in this browser.</span>
      </label>
      <FieldError msg={error} />
    </div>
  );
}
