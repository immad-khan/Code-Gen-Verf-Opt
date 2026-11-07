import { useEffect, useRef, useState } from "react";
import { OTP_LENGTH, OTP_TTL_MIN, RESEND_COOLDOWN_S, type OtpChannel } from "../../auth";
import { OtpInput, type OtpStatus } from "./OtpInput";
import { Spinner } from "./icons";

export type VerifyResult = { ok: true; commit: () => void } | { ok: false; message: string; locked?: boolean };

type Props = {
  channel: OtpChannel;
  masked: string;
  /** increments every time a fresh code is sent */
  resendCount: number;
  /** set when the demo-inbox "Autofill" button is pressed */
  autofill: { code: string; nonce: number } | null;
  onVerify: (code: string) => Promise<VerifyResult>;
  onResend: () => Promise<void>;
  onChangeMethod: () => void;
  onEditDetails: () => void;
};

const empty = () => Array<string>(OTP_LENGTH).fill("");
const RING = 2 * Math.PI * 9;

export function OtpStep({ channel, masked, resendCount, autofill, onVerify, onResend, onChangeMethod, onEditDetails }: Props) {
  const [cells, setCells] = useState<string[]>(empty);
  const [status, setStatus] = useState<OtpStatus>("idle");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [locked, setLocked] = useState(false);
  const [left, setLeft] = useState(RESEND_COOLDOWN_S);
  const [resending, setResending] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const busy = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastResend = useRef(resendCount);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // cooldown ring + reset whenever a new code goes out
  useEffect(() => {
    setLeft(RESEND_COOLDOWN_S);
    const t = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    if (lastResend.current !== resendCount) {
      lastResend.current = resendCount;
      busy.current = false;
      setCells(empty());
      setStatus("idle");
      setLocked(false);
      setMessage({ kind: "info", text: "A new code is on its way." });
      setFocusKey((k) => k + 1);
    }
    return () => clearInterval(t);
  }, [resendCount]);

  const submit = async (code: string) => {
    if (busy.current) return;
    busy.current = true;
    setStatus("verifying");
    setMessage(null);
    const res = await onVerify(code);
    if (res.ok) {
      setStatus("success");
      later(res.commit, 650); // let the green success state land before moving on
      return;
    }
    setStatus("error");
    setMessage({ kind: "error", text: res.message });
    setLocked(!!res.locked);
    later(() => {
      setCells(empty());
      setStatus("idle");
      busy.current = false;
      setFocusKey((k) => k + 1);
    }, 650);
  };

  // demo inbox -> autofill
  useEffect(() => {
    if (!autofill || busy.current || locked) return;
    setCells(autofill.code.split(""));
    later(() => submit(autofill.code), 240);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autofill?.nonce]);

  const resend = async () => {
    if (left > 0 || resending) return;
    setResending(true);
    await onResend();
    setResending(false);
  };

  const complete = cells.every(Boolean);
  const mm = String(Math.floor(left / 60));
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div>
      <h1 className="text-[26px] font-extrabold leading-tight text-ink">Enter your code</h1>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">
        We sent a {OTP_LENGTH}-digit code by {channel === "sms" ? "text message" : "email"} to{" "}
        <span className="whitespace-nowrap font-bold text-ink">{masked}</span>.
      </p>

      <div className="mt-7">
        <OtpInput
          cells={cells}
          onChange={setCells}
          onComplete={submit}
          status={status}
          disabled={status !== "idle" || locked}
          focusKey={focusKey}
        />
      </div>

      <div className="mt-3 min-h-[22px]" aria-live="polite">
        {message && (
          <p className={`text-[13px] font-semibold ${message.kind === "error" ? "text-rose-500" : "text-brand-600"}`} role={message.kind === "error" ? "alert" : undefined}>
            {message.text}
          </p>
        )}
      </div>

      <button
        onClick={() => submit(cells.join(""))}
        disabled={!complete || status !== "idle" || locked}
        className="btn btn-primary mt-3 w-full px-6 py-3.5 text-[15px] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "verifying" ? (
          <>
            <Spinner />
            Verifying…
          </>
        ) : status === "success" ? (
          "Verified ✓"
        ) : (
          "Verify & create account"
        )}
      </button>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {left > 0 ? (
          <span className="flex items-center gap-2 text-[13.5px] font-semibold text-muted">
            <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-90" aria-hidden>
              <circle cx="12" cy="12" r="9" fill="none" stroke="#ede5ff" strokeWidth="3" />
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="#7c3aed"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - left / RESEND_COOLDOWN_S)}
                className="transition-[stroke-dashoffset] duration-1000 ease-linear"
              />
            </svg>
            Resend code in {mm}:{ss}
          </span>
        ) : (
          <button onClick={resend} disabled={resending} className="inline-flex items-center gap-2 text-[14px] font-extrabold text-brand-600 hover:text-brand-700 disabled:opacity-60">
            {resending && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />}
            Resend code
          </button>
        )}
        <span className="text-[12.5px] text-muted/80">Expires in {OTP_TTL_MIN} min</span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-brand-50 pt-4 text-[13.5px] font-bold">
        <button onClick={onChangeMethod} className="text-brand-600 hover:text-brand-700">
          Use a different method
        </button>
        <button onClick={onEditDetails} className="text-muted hover:text-brand-600">
          Edit details
        </button>
      </div>
    </div>
  );
}
