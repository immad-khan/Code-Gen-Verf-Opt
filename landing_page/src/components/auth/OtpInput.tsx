import { useEffect, useRef, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from "react";
import { OTP_LENGTH } from "../../auth";

export type OtpStatus = "idle" | "verifying" | "error" | "success";

type Props = {
  cells: string[];
  onChange: (cells: string[]) => void;
  onComplete: (code: string) => void;
  status: OtpStatus;
  disabled?: boolean;
  /** bump to move focus back to the first box (after a reset) */
  focusKey: number;
};

export function OtpInput({ cells, onChange, onComplete, status, disabled, focusKey }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, [focusKey]);

  const fill = (start: number, digits: string) => {
    const next = [...cells];
    let idx = start;
    for (const ch of digits) {
      if (idx >= OTP_LENGTH) break;
      next[idx++] = ch;
    }
    onChange(next);
    refs.current[Math.min(idx, OTP_LENGTH - 1)]?.focus();
    if (next.every(Boolean)) onComplete(next.join(""));
  };

  const handleChange = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      const next = [...cells];
      next[i] = "";
      onChange(next);
      return;
    }
    fill(i, digits); // also handles SMS autofill that drops the whole code into one box
  };

  const handleKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !cells[i] && i > 0) {
      e.preventDefault();
      const next = [...cells];
      next[i - 1] = "";
      onChange(next);
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < OTP_LENGTH - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = e.clipboardData.getData("text").replace(/\D/g, "");
    if (digits) fill(digits.length >= OTP_LENGTH ? 0 : i, digits);
  };

  return (
    <div
      role="group"
      aria-label="One-time code"
      className={`flex justify-between gap-2 sm:gap-3 ${status === "error" ? "otp-shake" : ""}`}
    >
      {cells.map((value, i) => (
        <div key={i} className="otp-enter min-w-0 flex-1" style={{ animationDelay: `${i * 35}ms` }}>
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={value}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
            disabled={disabled}
            data-filled={value !== ""}
            data-status={status}
            style={{ "--i": i } as CSSProperties}
            className="otp-cell"
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKey(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      ))}
    </div>
  );
}
