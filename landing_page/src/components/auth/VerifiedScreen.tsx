import type { CSSProperties } from "react";
import { APP_URL } from "../../data";
import type { AuthVia, Provider, SessionUser } from "../../auth";

const PROVIDER_LABEL: Record<Provider, string> = { github: "GitHub", google: "Google" };
const isProvider = (v: AuthVia): v is Provider => v === "github" || v === "google";

const COLORS = ["#7c3aed", "#a78bfa", "#c026d3", "#10b981", "#f59e0b", "#d8c8ff"];
const PIECES = Array.from({ length: 22 }, (_, i) => {
  const a = (i / 22) * Math.PI * 2 + (i % 2) * 0.16;
  const dist = 98 + (i % 4) * 22;
  return {
    x: Math.cos(a) * dist,
    y: Math.sin(a) * dist - 8,
    r: (i * 47) % 360,
    color: COLORS[i % COLORS.length],
    w: 6 + (i % 3) * 2,
    h: 10 + (i % 2) * 4,
    delay: 380 + (i % 5) * 24,
  };
});

type Props = {
  user: SessionUser;
  fresh: boolean;
  via?: AuthVia;
  onSignOut: () => void;
};

export function VerifiedScreen({ user, fresh, via, onSignOut }: Props) {
  const first = user.name.trim().split(" ")[0] || "there";
  const hasApp = APP_URL.length > 0;
  const d = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
  const provider = via && isProvider(via) ? via : null;

  const rows: [string, string][] = [["Account", user.email]];
  if (user.phone) rows.push(["Mobile", user.phone]);
  if (fresh && via) {
    rows.push(provider ? ["Signed up with", PROVIDER_LABEL[provider]] : ["Verified by", via === "sms" ? "Text message code" : "Email code"]);
  } else if (provider) {
    rows.push(["Signed in with", PROVIDER_LABEL[provider]]);
  }

  const subtitle = !fresh
    ? "You're signed in and ready to go."
    : provider
      ? `Your account is ready and linked to your ${PROVIDER_LABEL[provider]} account.`
      : "Your account is ready and your contact details are confirmed.";

  return (
    <div className="pop-card">
      <div className="relative overflow-hidden rounded-[26px] border border-brand-100 bg-white p-8 text-center shadow-[0_30px_70px_-40px_rgba(59,7,100,0.4)] sm:p-10">
        <div className="relative mx-auto h-[124px] w-[124px]">
          <div
            className="glow-pulse absolute inset-[-28px] rounded-full"
            style={{ background: "radial-gradient(circle, rgba(16,185,129,0.22) 0%, rgba(16,185,129,0) 66%)" }}
          />
          {fresh &&
            PIECES.map((p, i) => (
              <span
                key={i}
                className="confetti"
                style={
                  {
                    "--x": `${p.x}px`,
                    "--y": `${p.y}px`,
                    "--r": `${p.r}deg`,
                    width: p.w,
                    height: p.h,
                    background: p.color,
                    animationDelay: `${p.delay}ms`,
                  } as CSSProperties
                }
              />
            ))}
          <svg viewBox="0 0 124 124" className="relative h-full w-full -rotate-90">
            <circle cx="62" cy="62" r="54" fill="#ecfdf5" stroke="#d1fae5" strokeWidth="6" />
            <circle cx="62" cy="62" r="54" fill="none" stroke="#10b981" strokeWidth="6" strokeLinecap="round" pathLength={1} className="draw-path" />
          </svg>
          <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-[52px] w-[52px] text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l5 5L19 7.5" pathLength={1} className="draw-path" style={d(380)} />
          </svg>
        </div>

        <h1 className="auth-in mt-7 text-[28px] font-extrabold leading-tight text-ink" style={d(300)}>
          {fresh ? `You're verified, ${first}!` : `Welcome back, ${first}!`}
        </h1>
        <p className="auth-in mt-2 text-[15px] leading-relaxed text-muted" style={d(350)}>
          {subtitle}
        </p>

        <dl className="mt-6 divide-y divide-brand-50 overflow-hidden rounded-2xl border border-brand-100 bg-[#fbfaff] text-left">
          {rows.map(([k, v], i) => (
            <div key={k} className="auth-in flex items-center justify-between gap-4 px-4 py-3" style={d(420 + i * 60)}>
              <dt className="text-[12.5px] font-bold uppercase tracking-wider text-muted">{k}</dt>
              <dd className="truncate text-[14px] font-bold text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        <a href={hasApp ? APP_URL : "#top"} className="btn btn-primary auth-in mt-7 w-full px-6 py-3.5 text-[15px]" style={d(560)}>
          {hasApp ? "Continue to VeriFlow" : "Back to home"} <span aria-hidden>→</span>
        </a>
        <button onClick={onSignOut} className="auth-in mt-4 text-[13.5px] font-bold text-muted transition hover:text-brand-600" style={d(620)}>
          Sign out
        </button>
      </div>
    </div>
  );
}
