import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  checkAvailable,
  clearOtp,
  createAccount,
  sendOtp,
  signIn,
  signInWithProvider,
  verifyOtp,
  type AuthVia,
  type OtpChannel,
  type Provider,
  type ProviderProfile,
  type SessionUser,
} from "../auth";
import { Logo } from "./Header";
import { BrandPanel } from "./auth/BrandPanel";
import { DeliveryToast } from "./auth/DeliveryToast";
import { DetailsStep } from "./auth/DetailsStep";
import { ForgotStep } from "./auth/ForgotStep";
import { MethodStep } from "./auth/MethodStep";
import { OtpStep, type VerifyResult } from "./auth/OtpStep";
import { ProviderModal } from "./auth/ProviderModal";
import { SocialStep } from "./auth/SocialStep";
import { Stepper } from "./auth/Stepper";
import { VerifiedScreen } from "./auth/VerifiedScreen";
import {
  EMAIL_RE,
  guessCountry,
  maskEmail,
  maskPhone,
  toE164,
  validatePhone,
  type Errors,
  type Form,
  type Mode,
  type Notice,
  type Step,
} from "./auth/utils";

type Props = {
  session: SessionUser | null;
  justVerified: { fresh: boolean; via?: AuthVia } | null;
  onAuthed: (user: SessionUser, fresh: boolean, via?: AuthVia) => void;
  onSignOut: () => void;
};

type Toast = { id: number; code: string; channel: OtpChannel };
type Social = { provider: Provider; profile: ProviderProfile };

const SIGNUP_STEPS = ["Details", "Method", "Verify"];
const SOCIAL_STEPS = ["Connect", "Profile"];
const STEP_INDEX: Record<Step, number> = { details: 0, method: 1, otp: 2, social: 1 };

export function AuthPage({ session, justVerified, onAuthed, onSignOut }: Props) {
  const [mode, setMode] = useState<Mode>("signup");
  const [step, setStep] = useState<Step>("details");
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [form, setForm] = useState<Form>(() => ({
    name: "",
    email: "",
    country: guessCountry(),
    phone: "",
    password: "",
    confirm: "",
    terms: false,
    remember: true,
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [channel, setChannel] = useState<OtpChannel>("sms");
  const [toast, setToast] = useState<Toast | null>(null);
  const [resendCount, setResendCount] = useState(0);
  const [autofill, setAutofill] = useState<{ code: string; nonce: number } | null>(null);
  const [providerModal, setProviderModal] = useState<Provider | null>(null);
  const [social, setSocial] = useState<Social | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeSend = useRef(0);
  const toastId = useRef(0);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      clearOtp();
    },
    []
  );

  const go = (next: Step, d: "fwd" | "back") => {
    setDir(d);
    setStep(next);
    if (next !== "otp") {
      activeSend.current = 0;
      setToast(null);
      clearOtp();
    }
  };

  const onField = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key as keyof Errors]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const fail = (errs: Errors) => {
    setErrors(errs);
    setShake(true);
  };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setDir("fwd");
    setMode(m);
    setErrors({});
    setNotice(null);
  };

  const validate = (): Errors => {
    const errs: Errors = {};
    const socialStep = step === "social";
    if (mode === "signup" && form.name.trim().length < 2) errs.name = "Tell us your name (2+ characters).";
    if (!socialStep && !EMAIL_RE.test(form.email.trim())) errs.email = "Enter a valid email address.";
    if (mode === "signup") {
      const phoneError = validatePhone(form.country, form.phone);
      if (phoneError) errs.phone = phoneError;
      if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
        errs.password = "Use 8+ characters with at least one letter and one number.";
      }
      if (!form.confirm || form.confirm !== form.password) errs.confirm = "Passwords don't match.";
      if (!form.terms) errs.terms = "Please accept the terms to continue.";
    } else if (!form.password) {
      errs.password = "Enter your password.";
    }
    return errs;
  };

  /* ---- email + password ---- */
  const submitDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setNotice(null);
    const errs = validate();
    if (Object.keys(errs).length) return fail(errs);
    setErrors({});
    setLoading(true);

    if (mode === "login") {
      const res = await signIn(form.email, form.password, form.remember);
      setLoading(false);
      if (!res.ok) return fail({ [res.field]: res.error } as Errors);
      return onAuthed(res.user, false);
    }

    const avail = await checkAvailable(form.email, toE164(form.country, form.phone));
    setLoading(false);
    if (!avail.ok) return fail({ [avail.field]: avail.error } as Errors);
    go("method", "fwd");
  };

  /* ---- GitHub / Google ---- */
  const openProvider = (p: Provider) => {
    setNotice(null);
    setProviderModal(p);
  };

  const handleProviderSuccess = async (provider: Provider, profile: ProviderProfile) => {
    setProviderModal(null);
    const existing = await signInWithProvider(provider, profile, form.remember);
    if (existing.ok) {
      onAuthed(existing.user, false, provider);
      return;
    }
    // no account for this profile yet: collect name, number and password
    const fromLogin = mode === "login";
    setMode("signup");
    setSocial({ provider, profile });
    setForm((f) => ({ ...f, name: profile.name, email: profile.email }));
    setErrors({});
    setNotice(fromLogin ? { kind: "info", text: `No VeriFlow account for ${profile.email} yet. Finish setting one up below.` } : null);
    go("social", "fwd");
  };

  const submitSocial = async (e: FormEvent) => {
    e.preventDefault();
    if (loading || !social) return;
    const errs = validate();
    if (Object.keys(errs).length) return fail(errs);
    setErrors({});
    setLoading(true);
    const phone = toE164(form.country, form.phone);
    const avail = await checkAvailable(social.profile.email, phone);
    if (!avail.ok) {
      setLoading(false);
      return fail({ [avail.field === "email" ? "form" : avail.field]: avail.error } as Errors);
    }
    const res = await createAccount(
      {
        name: form.name,
        email: social.profile.email,
        phone,
        password: form.password,
        provider: { name: social.provider, id: social.profile.id },
      },
      form.remember
    );
    setLoading(false);
    if (!res.ok) return fail({ [res.field === "email" ? "form" : res.field]: res.error } as Errors);
    onAuthed(res.user, true, social.provider);
  };

  const cancelSocial = () => {
    setSocial(null);
    setNotice(null);
    setErrors({});
    go("details", "back");
  };

  /* ---- one-time code delivery ---- */
  const destination = () => (channel === "sms" ? toE164(form.country, form.phone) : form.email.trim().toLowerCase());

  const dispatchCode = async (isResend: boolean) => {
    const { code } = await sendOtp(channel, destination());
    const id = ++toastId.current;
    activeSend.current = id;
    setAutofill(null);
    // let the screen transition settle, then "deliver" the message
    later(() => {
      if (activeSend.current === id) setToast({ id, code, channel });
    }, isResend ? 120 : 380);
  };

  const sendFromMethod = async () => {
    if (loading) return;
    setLoading(true);
    await dispatchCode(false);
    setLoading(false);
    go("otp", "fwd");
  };

  const resend = async () => {
    await dispatchCode(true);
    setResendCount((c) => c + 1);
  };

  const handleVerify = async (code: string): Promise<VerifyResult> => {
    const r = verifyOtp(code);
    if (!r.ok) {
      const messages = {
        none: "No active code. Request a new one.",
        expired: "That code has expired. Request a new one.",
        locked: "Too many attempts. Request a new code.",
        wrong: `Incorrect code. ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? "" : "s"} left.`,
      };
      return { ok: false, message: messages[r.reason], locked: r.reason !== "wrong" };
    }
    const res = await createAccount(
      { name: form.name, email: form.email, phone: toE164(form.country, form.phone), password: form.password },
      form.remember
    );
    if (!res.ok) {
      go("details", "back");
      setErrors({ [res.field]: res.error } as Errors);
      return { ok: false, message: res.error, locked: true };
    }
    return {
      ok: true,
      commit: () => {
        setToast(null);
        onAuthed(res.user, true, channel);
      },
    };
  };

  const signup = mode === "signup";
  const showTabs = step === "details" && !forgot;

  return (
    <div className="flex min-h-screen bg-[#faf8ff]">
      <BrandPanel />

      <main className="relative flex min-w-0 flex-1 flex-col px-5 py-8 sm:px-10">
        <div className="light-grid pointer-events-none absolute inset-0" />

        <div className="relative flex items-center justify-between">
          <a href="#top" className="inline-flex items-center gap-2 text-[14px] font-bold text-muted transition hover:text-brand-600">
            <span aria-hidden>←</span> Back to site
          </a>
          <span className="lg:hidden">
            <Logo />
          </span>
        </div>

        <div className="relative mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center py-8">
          {session ? (
            <VerifiedScreen user={session} fresh={!!justVerified?.fresh} via={justVerified?.via} onSignOut={onSignOut} />
          ) : (
            <>
              <div className="pop-card">
                <div
                  className={`rounded-[26px] border border-brand-100 bg-white p-7 shadow-[0_30px_70px_-40px_rgba(59,7,100,0.4)] sm:p-9 ${shake ? "shake" : ""}`}
                  onAnimationEnd={(e) => {
                    if (e.animationName === "shakeX") setShake(false);
                  }}
                >
                  {showTabs && (
                    <div className="relative grid grid-cols-2 rounded-2xl bg-brand-50 p-1.5">
                      <span
                        aria-hidden
                        className="absolute inset-y-1.5 left-1.5 w-[calc(50%-6px)] rounded-xl bg-white shadow-[0_4px_12px_-6px_rgba(124,58,237,0.5)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                        style={{ transform: `translateX(${signup ? "0%" : "100%"})` }}
                      />
                      {(["signup", "login"] as Mode[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => switchMode(m)}
                          className={`relative z-10 rounded-xl py-2.5 text-[14px] font-bold transition-colors duration-200 ${
                            mode === m ? "text-brand-700" : "text-muted hover:text-brand-600"
                          }`}
                        >
                          {m === "signup" ? "Create account" : "Log in"}
                        </button>
                      ))}
                    </div>
                  )}

                  {signup && !forgot && (
                    <div className={showTabs ? "mt-6" : ""}>
                      {step === "social" ? <Stepper steps={SOCIAL_STEPS} index={1} /> : <Stepper steps={SIGNUP_STEPS} index={STEP_INDEX[step]} />}
                    </div>
                  )}

                  <div key={`${mode}-${step}-${forgot}`} className={`${showTabs || signup ? "mt-7" : ""} ${dir === "fwd" ? "step-fwd" : "step-back"}`}>
                    {forgot ? (
                      <ForgotStep onBack={() => setForgot(false)} />
                    ) : step === "social" && social ? (
                      <SocialStep
                        provider={social.provider}
                        profile={social.profile}
                        form={form}
                        errors={errors}
                        loading={loading}
                        notice={notice}
                        onField={onField}
                        onSubmit={submitSocial}
                        onSwitchAccount={() => openProvider(social.provider)}
                        onCancel={cancelSocial}
                      />
                    ) : step === "method" ? (
                      <MethodStep
                        channel={channel}
                        onChannel={setChannel}
                        phoneMasked={maskPhone(form.country, form.phone)}
                        emailMasked={maskEmail(form.email)}
                        loading={loading}
                        onSend={sendFromMethod}
                        onBack={() => go("details", "back")}
                      />
                    ) : step === "otp" ? (
                      <OtpStep
                        channel={channel}
                        masked={channel === "sms" ? maskPhone(form.country, form.phone) : maskEmail(form.email)}
                        resendCount={resendCount}
                        autofill={autofill}
                        onVerify={handleVerify}
                        onResend={resend}
                        onChangeMethod={() => go("method", "back")}
                        onEditDetails={() => go("details", "back")}
                      />
                    ) : (
                      <DetailsStep
                        mode={mode}
                        form={form}
                        errors={errors}
                        loading={loading}
                        notice={notice}
                        onField={onField}
                        onSubmit={submitDetails}
                        onForgot={() => {
                          setForgot(true);
                          setErrors({});
                        }}
                        onSocial={openProvider}
                      />
                    )}
                  </div>
                </div>
              </div>

              <p className="mt-6 text-center text-[12.5px] text-muted/70">
                Preview build · accounts, codes and GitHub/Google sign-ins stay in your browser, nothing is sent to a server
              </p>
            </>
          )}
        </div>
      </main>

      {toast && !session && (
        <DeliveryToast
          key={toast.id}
          channel={toast.channel}
          code={toast.code}
          onAutofill={() => setAutofill({ code: toast.code, nonce: Date.now() })}
          onClose={() => setToast(null)}
        />
      )}

      {providerModal && !session && (
        <ProviderModal
          key={providerModal}
          provider={providerModal}
          onSuccess={(profile) => handleProviderSuccess(providerModal, profile)}
          onCancel={() => setProviderModal(null)}
        />
      )}
    </div>
  );
}
