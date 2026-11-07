import type { FormEvent } from "react";
import type { Provider, ProviderProfile } from "../../auth";
import type { Errors, Form, Notice } from "./utils";
import { Banner, FieldError, PasswordField, PhoneField, TermsField } from "./fields";
import { CheckIcon, Spinner } from "./icons";
import { Avatar, PROVIDER_LABEL, ProviderMark } from "./ProviderModal";

type Props = {
  provider: Provider;
  profile: ProviderProfile;
  form: Form;
  errors: Errors;
  loading: boolean;
  notice: Notice;
  onField: <K extends keyof Form>(key: K, value: Form[K]) => void;
  onSubmit: (e: FormEvent) => void;
  onSwitchAccount: () => void;
  onCancel: () => void;
};

/** Second step of GitHub / Google sign-up: name, mobile number and password, then the account is created. */
export function SocialStep({ provider, profile, form, errors, loading, notice, onField, onSubmit, onSwitchAccount, onCancel }: Props) {
  const label = PROVIDER_LABEL[provider];
  return (
    <div>
      <h1 className="text-[26px] font-extrabold leading-tight text-ink">Complete your profile</h1>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">
        You're connected with {label}. Add your mobile number and a password to finish creating your VeriFlow account.
      </p>

      <Banner notice={notice} error={errors.form} />

      <div className="pop-card mt-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5">
        <span className="relative shrink-0">
          <Avatar profile={profile} className="h-11 w-11 text-[16px]" />
          <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-white text-[#24292f] shadow-sm ring-1 ring-black/5">
            <ProviderMark provider={provider} className={provider === "github" ? "h-3.5 w-3.5" : "h-3 w-3"} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-extrabold text-ink">{profile.name}</p>
          <p className="truncate text-[12.5px] text-muted">{profile.email}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-extrabold text-emerald-700">
          <CheckIcon className="h-3 w-3" /> Verified
        </span>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
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

        <PhoneField
          country={form.country}
          phone={form.phone}
          error={errors.phone}
          hint="The number you'd like on this account."
          onCountry={(c) => onField("country", c)}
          onPhone={(v) => onField("phone", v)}
        />

        <PasswordField
          id="password"
          label="Create a password"
          value={form.password}
          onChange={(v) => onField("password", v)}
          placeholder="8+ chars, letter & number"
          autoComplete="new-password"
          error={errors.password}
          strength
        />

        <PasswordField
          id="confirm"
          label="Confirm password"
          value={form.confirm}
          onChange={(v) => onField("confirm", v)}
          placeholder="Repeat password"
          autoComplete="new-password"
          error={errors.confirm}
        />

        <TermsField checked={form.terms} onChange={(v) => onField("terms", v)} error={errors.terms} />

        <button type="submit" disabled={loading} className="btn btn-primary w-full px-6 py-3.5 text-[15px] disabled:cursor-not-allowed disabled:opacity-80">
          {loading ? (
            <>
              <Spinner />
              Creating account…
            </>
          ) : (
            "Create account →"
          )}
        </button>
      </form>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-brand-50 pt-4 text-[13.5px] font-bold">
        <button onClick={onSwitchAccount} className="text-brand-600 hover:text-brand-700">
          Use a different {label} account
        </button>
        <button onClick={onCancel} className="text-muted hover:text-brand-600">
          Cancel
        </button>
      </div>
    </div>
  );
}
