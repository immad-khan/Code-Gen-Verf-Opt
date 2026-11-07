import { useState, type FormEvent } from "react";
import { requestReset } from "../../auth";
import { EMAIL_RE } from "./utils";

export function ForgotStep({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter the email you signed up with.");
      return;
    }
    setError("");
    await requestReset(email);
    setSent(true);
  };

  return (
    <div>
      <h1 className="text-[26px] font-extrabold text-ink">Reset your password</h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-muted">Enter your account email and we'll send a reset link.</p>

      {sent ? (
        <div className="pop-card mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-[14px] font-semibold text-emerald-700">
          If an account exists for {email.trim()}, a reset link is on its way.
          <span className="mt-1 block text-[12.5px] font-medium text-emerald-600/80">Preview build: no email is actually sent.</span>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6" noValidate>
          <label htmlFor="forgot-email" className="mb-1.5 block text-[13px] font-bold text-ink">Email</label>
          <input
            id="forgot-email"
            type="email"
            className="field"
            placeholder="you@lab.dev"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
            autoComplete="email"
          />
          {error && <p className="mt-1.5 text-[12.5px] font-semibold text-rose-500" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary mt-5 w-full px-6 py-3.5 text-[15px]">Send reset link</button>
        </form>
      )}

      <button onClick={onBack} className="mt-5 text-[14px] font-bold text-brand-600 hover:text-brand-700">
        ← Back to log in
      </button>
    </div>
  );
}
