import type { ReactNode } from "react";
import type { OtpChannel } from "../../auth";
import { OTP_TTL_MIN } from "../../auth";
import { CheckIcon, MailIcon, SmsIcon, Spinner } from "./icons";

type Props = {
  channel: OtpChannel;
  onChannel: (c: OtpChannel) => void;
  phoneMasked: string;
  emailMasked: string;
  loading: boolean;
  onSend: () => void;
  onBack: () => void;
};

export function MethodStep({ channel, onChannel, phoneMasked, emailMasked, loading, onSend, onBack }: Props) {
  const options: { id: OtpChannel; title: string; to: string; hint: string; icon: ReactNode }[] = [
    { id: "sms", title: "Text message", to: phoneMasked, hint: "Usually arrives in seconds", icon: <SmsIcon className="h-[22px] w-[22px]" /> },
    { id: "email", title: "Email", to: emailMasked, hint: "Check your inbox and spam folder", icon: <MailIcon className="h-[22px] w-[22px]" /> },
  ];

  return (
    <div>
      <h1 className="text-[26px] font-extrabold leading-tight text-ink">Verify it's you</h1>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">
        We'll send a 6-digit one-time code. Choose where you'd like to receive it.
      </p>

      <div role="radiogroup" aria-label="Where should we send your code?" className="mt-6 space-y-3">
        {options.map((o, i) => {
          const active = channel === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChannel(o.id)}
              style={{ animationDelay: `${60 + i * 60}ms` }}
              className={`auth-in flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all duration-200 ${
                active
                  ? "border-brand-500 bg-brand-50/70 shadow-[0_14px_30px_-20px_rgba(124,58,237,0.7)]"
                  : "border-brand-100 bg-white hover:-translate-y-0.5 hover:border-brand-300"
              }`}
            >
              <span
                className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl transition-colors duration-200 ${
                  active ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-600"
                }`}
              >
                {o.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-extrabold text-ink">{o.title}</span>
                <span className="mt-0.5 block truncate font-mono text-[13px] text-ink/70">{o.to}</span>
                <span className="mt-0.5 block text-[12px] text-muted">{o.hint}</span>
              </span>
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors duration-200 ${
                  active ? "border-brand-600 bg-brand-600 text-white" : "border-brand-200 text-transparent"
                }`}
              >
                {active && <CheckIcon className="pop-in h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Codes work once and expire after {OTP_TTL_MIN} minutes.
      </p>

      <button onClick={onSend} disabled={loading} className="btn btn-primary mt-6 w-full px-6 py-3.5 text-[15px] disabled:cursor-not-allowed disabled:opacity-80">
        {loading ? (
          <>
            <Spinner />
            Sending code…
          </>
        ) : (
          <>Send code {channel === "sms" ? "by text" : "by email"} →</>
        )}
      </button>

      <button onClick={onBack} className="mt-5 text-[14px] font-bold text-brand-600 hover:text-brand-700">
        ← Edit details
      </button>
    </div>
  );
}
