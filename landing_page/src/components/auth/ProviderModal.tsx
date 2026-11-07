import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  listProviderAccounts,
  providerAccountId,
  removeProviderAccount,
  saveProviderAccount,
  type Provider,
  type ProviderProfile,
} from "../../auth";
import { avatarColor, EMAIL_RE, initialOf } from "./utils";
import { CheckIcon, GitHubIcon, GoogleIcon, LockIcon, PlusIcon } from "./icons";

type View = "pick" | "add" | "consent" | "authorizing";

export const PROVIDER_LABEL: Record<Provider, string> = { github: "GitHub", google: "Google" };

const META: Record<
  Provider,
  { origin: string; consentTitle: string; permissionsTitle: string; permissions: string[]; authorize: string; buttonClass: string; note: string }
> = {
  github: {
    origin: "github.com/login/oauth/authorize",
    consentTitle: "Authorize VeriFlow",
    permissionsTitle: "Personal user data",
    permissions: ["Email addresses (read-only)", "Profile information (read-only)"],
    authorize: "Authorize veriflow-dev",
    buttonClass: "rounded-lg bg-[#1f883d] hover:bg-[#1a7f37]",
    note: "Authorizing will redirect you back to veriflow.dev.",
  },
  google: {
    origin: "accounts.google.com/o/oauth2/v2/auth",
    consentTitle: "VeriFlow wants to access your Google Account",
    permissionsTitle: "This will allow VeriFlow to:",
    permissions: ["See your name and profile picture", "See your primary email address"],
    authorize: "Continue",
    buttonClass: "rounded-full bg-[#1a73e8] hover:bg-[#1765cc]",
    note: "Make sure you trust VeriFlow. You can remove access at any time.",
  },
};

export function Avatar({ profile, className = "h-9 w-9 text-[14px]" }: { profile: ProviderProfile; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-extrabold text-white ${className}`} style={{ background: avatarColor(profile.email) }}>
      {initialOf(profile.name)}
    </span>
  );
}

export function ProviderMark({ provider, className }: { provider: Provider; className?: string }) {
  return provider === "github" ? <GitHubIcon className={className} /> : <GoogleIcon className={className} />;
}

type Props = {
  provider: Provider;
  onSuccess: (profile: ProviderProfile) => void;
  onCancel: () => void;
};

/**
 * Simulated OAuth window. Looks like the provider's account chooser + consent
 * screen, but nothing leaves the browser: the "account" is just a name and
 * email the person types, remembered on this device for next time.
 */
export function ProviderModal({ provider, onSuccess, onCancel }: Props) {
  const meta = META[provider];
  const label = PROVIDER_LABEL[provider];
  const [accounts, setAccounts] = useState<ProviderProfile[]>(() => listProviderAccounts(provider));
  const [view, setView] = useState<View>(() => (listProviderAccounts(provider).length ? "pick" : "add"));
  const [chosen, setChosen] = useState<ProviderProfile | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errs, setErrs] = useState<{ name?: string; email?: string }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef(onCancel);
  const successRef = useRef(onSuccess);
  cancelRef.current = onCancel;
  successRef.current = onSuccess;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const pick = (a: ProviderProfile) => {
    setChosen(a);
    setView("consent");
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errs = {};
    if (name.trim().length < 2) next.name = "Enter the name on this account.";
    if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address.";
    if (Object.keys(next).length) return setErrs(next);
    setErrs({});
    const account: ProviderProfile = {
      id: providerAccountId(provider, email),
      name: name.trim(),
      email: email.trim().toLowerCase(),
    };
    saveProviderAccount(provider, account);
    setAccounts(listProviderAccounts(provider));
    pick(account);
  };

  const forget = (id: string) => {
    removeProviderAccount(provider, id);
    const next = listProviderAccounts(provider);
    setAccounts(next);
    if (!next.length) setView("add");
  };

  const authorize = () => {
    if (!chosen) return;
    setView("authorizing");
    timer.current = setTimeout(() => successRef.current(chosen), 1000);
  };

  const title =
    view === "pick" ? "Choose an account" : view === "add" ? `Sign in with ${label}` : view === "consent" ? meta.consentTitle : "Signing you in…";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`${label} sign-in`}>
      <div className="absolute inset-0 bg-[#12082a]/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="modal-in relative w-full max-w-[420px] overflow-hidden rounded-[22px] bg-white shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        {/* popup-style address bar */}
        <div className="flex items-center gap-2 border-b border-black/5 bg-[#f6f8fa] px-3.5 py-2.5">
          <LockIcon className="h-3.5 w-3.5 shrink-0 text-[#57606a]" />
          <span className="truncate font-mono text-[11.5px] text-[#57606a]">{meta.origin}</span>
          <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700">Simulated</span>
          <button onClick={onCancel} aria-label="Close" className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#57606a] transition hover:bg-black/5">
            ✕
          </button>
        </div>

        <div key={view} className="step-fwd px-6 pb-6 pt-7">
          <div className="flex flex-col items-center text-center">
            <ProviderMark provider={provider} className={provider === "github" ? "h-10 w-10 text-[#24292f]" : "h-9 w-9"} />
            <h2 className="mt-4 text-[20px] font-extrabold leading-snug text-ink">{title}</h2>
            {view !== "authorizing" && (
              <p className="mt-1 text-[13.5px] text-muted">
                {view === "consent" && chosen && provider === "github" ? (
                  <>
                    VeriFlow by <b className="text-ink">veriflow-dev</b> wants to access your <b className="text-ink">{chosen.name}</b> account
                  </>
                ) : view === "consent" ? null : (
                  <>
                    to continue to <b className="text-ink">VeriFlow</b>
                  </>
                )}
              </p>
            )}
          </div>

          {view === "pick" && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-black/10">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center border-b border-black/5 last:border-b-0">
                  <button onClick={() => pick(a)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition hover:bg-[#f6f8fa]">
                    <Avatar profile={a} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold text-ink">{a.name}</span>
                      <span className="block truncate text-[12.5px] text-muted">{a.email}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => forget(a.id)}
                    aria-label={`Remove ${a.email} from this list`}
                    className="mr-2 grid h-7 w-7 place-items-center rounded-full text-muted/60 transition hover:bg-black/5 hover:text-ink"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button onClick={() => setView("add")} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#f6f8fa]">
                <span className="grid h-9 w-9 place-items-center rounded-full border border-dashed border-black/20 text-muted">
                  <PlusIcon />
                </span>
                <span className="text-[14px] font-bold text-ink">Use another account</span>
              </button>
            </div>
          )}

          {view === "add" && (
            <form onSubmit={add} className="mt-6 space-y-3.5" noValidate>
              <div>
                <label htmlFor="provider-name" className="mb-1.5 block text-[13px] font-bold text-ink">Name</label>
                <input
                  id="provider-name"
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                  aria-invalid={!!errs.name}
                />
                {errs.name && <p className="mt-1.5 text-[12.5px] font-semibold text-rose-500" role="alert">{errs.name}</p>}
              </div>
              <div>
                <label htmlFor="provider-email" className="mb-1.5 block text-[13px] font-bold text-ink">Email</label>
                <input
                  id="provider-email"
                  type="email"
                  className="field"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={provider === "github" ? "you@example.com" : "you@gmail.com"}
                  autoComplete="email"
                  aria-invalid={!!errs.email}
                />
                {errs.email && <p className="mt-1.5 text-[12.5px] font-semibold text-rose-500" role="alert">{errs.email}</p>}
              </div>
              <p className="text-[12px] leading-relaxed text-muted/80">This is the profile {label} will share with VeriFlow.</p>
              <div className="flex items-center justify-end gap-2 pt-1">
                {accounts.length > 0 && (
                  <button type="button" onClick={() => setView("pick")} className="rounded-full px-4 py-2.5 text-[13.5px] font-bold text-muted transition hover:text-ink">
                    Back
                  </button>
                )}
                <button type="submit" className={`px-5 py-2.5 text-[13.5px] font-bold text-white transition ${meta.buttonClass}`}>
                  Next
                </button>
              </div>
            </form>
          )}

          {view === "consent" && chosen && (
            <div className="mt-5">
              <div className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-black/10 py-1 pl-1 pr-3">
                <Avatar profile={chosen} className="h-6 w-6 text-[11px]" />
                <span className="truncate text-[13px] font-semibold text-ink">{chosen.email}</span>
              </div>
              <p className="mt-5 text-[13px] font-bold text-ink">{meta.permissionsTitle}</p>
              <ul className="mt-2 space-y-2">
                {meta.permissions.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-[13.5px] text-ink/80">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                      <CheckIcon className="h-3 w-3" />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[12px] leading-relaxed text-muted/80">{meta.note}</p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button onClick={onCancel} className="rounded-full px-4 py-2.5 text-[13.5px] font-bold text-muted transition hover:text-ink">
                  Cancel
                </button>
                <button onClick={authorize} className={`px-5 py-2.5 text-[13.5px] font-bold text-white transition ${meta.buttonClass}`}>
                  {meta.authorize}
                </button>
              </div>
            </div>
          )}

          {view === "authorizing" && chosen && (
            <div className="mt-6 flex flex-col items-center">
              <div className="flex items-center gap-3 rounded-full border border-black/10 py-1.5 pl-1.5 pr-4">
                <Avatar profile={chosen} className="h-7 w-7 text-[12px]" />
                <span className="text-[13px] font-semibold text-ink">{chosen.email}</span>
              </div>
              <div className="mt-5 h-1 w-48 overflow-hidden rounded-full bg-brand-100">
                <div className="bar-indeterminate h-full w-1/3 rounded-full bg-brand-600" />
              </div>
              <p className="mt-3 text-[13px] text-muted">Redirecting back to VeriFlow…</p>
            </div>
          )}
        </div>

        <p className="border-t border-black/5 bg-[#f6f8fa] px-5 py-2.5 text-center text-[11.5px] leading-relaxed text-muted">
          Preview simulation. No request is sent to {label}, and nothing you enter here leaves your browser.
        </p>
      </div>
    </div>
  );
}
