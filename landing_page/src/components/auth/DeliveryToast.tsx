import { OTP_TTL_MIN, type OtpChannel } from "../../auth";
import { MailIcon, SmsIcon } from "./icons";

type Props = {
  channel: OtpChannel;
  code: string;
  onAutofill: () => void;
  onClose: () => void;
};

/**
 * Stand-in for the real SMS / email. The preview build can't deliver messages,
 * so the code "arrives" here, styled like the channel the person picked.
 */
export function DeliveryToast({ channel, code, onAutofill, onClose }: Props) {
  const sms = channel === "sms";
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  return (
    <div
      className="toast-in fixed inset-x-4 bottom-4 z-[90] sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-5 sm:w-[380px]"
      role="status"
      aria-live="polite"
    >
      <div className="overflow-hidden rounded-[22px] border border-black/5 bg-white shadow-[0_24px_60px_-20px_rgba(30,10,60,0.5)]">
        <div className="flex items-start gap-3 p-4">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-white ${
              sms ? "bg-emerald-500" : "bg-gradient-to-br from-brand-400 to-brand-700"
            }`}
          >
            {sms ? <SmsIcon /> : <MailIcon />}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11.5px] font-bold uppercase tracking-wider text-muted">{sms ? "TextBee Gateway" : "Gmail SMTP"} · now</p>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">
                Dispatched
              </span>
            </div>
            <p className="mt-1 truncate text-[14px] font-extrabold text-ink">{sms ? "SMS Sent via TextBee" : "Email Sent via Gmail SMTP"}</p>
            <p className="mt-0.5 text-[13.5px] leading-snug text-muted">
              {sms ? "A 6-digit verification code has been texted to your mobile." : "A 6-digit code was delivered to your inbox."}
            </p>
            <p className="mt-1.5 font-mono text-[24px] font-extrabold tracking-[0.2em] text-brand-700">{spaced}</p>
            <p className="mt-1 text-[12px] text-muted/80">Expires in {OTP_TTL_MIN} minutes. Never share this code.</p>

            <div className="mt-3 flex items-center gap-2">
              <button onClick={onAutofill} className="btn btn-primary px-4 py-2 text-[12.5px]">
                Autofill code
              </button>
              <button onClick={onClose} className="rounded-full px-3 py-2 text-[12.5px] font-bold text-muted transition hover:text-brand-600">
                Dismiss
              </button>
            </div>
          </div>
        </div>
        <p className="border-t border-emerald-50 bg-emerald-50/50 px-4 py-2 text-[11.5px] font-medium text-emerald-800">
          ✓ Real OTP dispatched via {sms ? "TextBee Android SMS Gateway" : "Gmail SMTP (Port 465 / 587 SSL)"}.
        </p>
      </div>
    </div>
  );
}
