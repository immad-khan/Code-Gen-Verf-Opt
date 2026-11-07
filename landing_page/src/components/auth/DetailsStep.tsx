import type { FormEvent } from "react";
import type { Provider } from "../../auth";
import type { Errors, Form, Mode, Notice } from "./utils";
import { Banner, FieldError, PasswordField, PhoneField, TermsField } from "./fields";
import { GitHubIcon, GoogleIcon, Spinner } from "./icons";

type Props = {
  mode: Mode;
  form: Form;
  errors: Errors;
  loading: boolean;
  notice: Notice;
  onField: <K extends keyof Form>(key: K, value: Form[K]) => void;
  onSubmit: (e: FormEvent) => void;
  onForgot: () => void;
  onSocial: (provider: Provider) => void;
};

export function DetailsStep({ mode, form, errors, loading, notice, onField, onSubmit, onForgot, onSocial }: Props) {
  const signup = mode === "signup";

  return (
    <div>
      <h1 className="text-[26px] font-extrabold leading-tight text-ink">{signup ? "Start verifying in minutes" : "Welcome back"}</h1>
      <p className="mt-1.5 text-[14.5px] text-muted">
        {signup ? "Create your account, then confirm it with a one-time code." : "Log in to continue to VeriFlow."}
      </p>

      <Banner notice={notice} error={errors.form} />

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => onSocial("github")} className="btn btn-secondary px-4 py-3 text-[13.5px]">
          <GitHubIcon className="h-[18px] w-[18px] text-[#24292f]" /> GitHub
        </button>
        <button type="button" onClick={() => onSocial("google")} className="btn btn-secondary px-4 py-3 text-[13.5px]">
          <GoogleIcon className="h-[18px] w-[18px]" /> Google
        </button>
      </div>

      <div className="my-5 flex items-center gap-3 text-[11.5px] font-bold uppercase tracking-wider text-muted/60">
        <span className="h-px flex-1 bg-brand-100" /> or with email <span className="h-px flex-1 bg-brand-100" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {signup && (
          <div>
            <label htmlFor="name" className="mb-1.5 block text-[13px] font-bold text-ink">Full name</label>
            <input
              id="name"
              className="field"
              placeholder="Ada Lovelace"
              value={form.name}
              autoComplete="name"
              onChange={(e) => onField("name", e.target.value)}
              aria-invalid={!!errors.name}
            />
            <FieldError msg={errors.name} />
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-1.5 block text-[13px] font-bold text-ink">Email</label>
          <input
            id="email"
            type="email"
            className="field"
            placeholder="you@lab.dev"
            value={form.email}
            autoComplete="email"
            onChange={(e) => onField("email", e.target.value)}
            aria-invalid={!!errors.email}
          />
          <FieldError msg={errors.email} />
        </div>

        {signup && (
          <PhoneField
            country={form.country}
            phone={form.phone}
            error={errors.phone}
            hint="You'll choose whether we text or email your code next."
            onCountry={(c) => onField("country", c)}
            onPhone={(v) => onField("phone", v)}
          />
        )}

        <PasswordField
          id="password"
          label="Password"
          value={form.password}
          onChange={(v) => onField("password", v)}
          placeholder={signup ? "8+ chars, letter & number" : "Your password"}
          autoComplete={signup ? "new-password" : "current-password"}
          error={errors.password}
          strength={signup}
          action={
            signup ? undefined : (
              <button type="button" onClick={onForgot} className="text-[12.5px] font-bold text-brand-600 hover:text-brand-700">
                Forgot password?
              </button>
            )
          }
        />

        {signup && (
          <PasswordField
            id="confirm"
            label="Confirm password"
            value={form.confirm}
            onChange={(v) => onField("confirm", v)}
            placeholder="Repeat password"
            autoComplete="new-password"
            error={errors.confirm}
          />
        )}

        {signup ? (
          <TermsField checked={form.terms} onChange={(v) => onField("terms", v)} error={errors.terms} />
        ) : (
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
            <input type="checkbox" checked={form.remember} onChange={(e) => onField("remember", e.target.checked)} className="h-4 w-4 accent-[#7c3aed]" />
            Keep me signed in on this device
          </label>
        )}

        <button type="submit" disabled={loading} className="btn btn-primary w-full px-6 py-3.5 text-[15px] disabled:cursor-not-allowed disabled:opacity-80">
          {loading ? (
            <>
              <Spinner />
              {signup ? "Checking…" : "Logging in…"}
            </>
          ) : signup ? (
            "Continue →"
          ) : (
            "Log in →"
          )}
        </button>
      </form>
    </div>
  );
}
