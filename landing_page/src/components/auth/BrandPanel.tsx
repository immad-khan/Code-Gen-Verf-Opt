import type { CSSProperties } from "react";
import { Logo } from "../Header";
import { ShieldIcon } from "./icons";

const chips = ["G₀", "V₀", "R₁", "V₁", "R₂", "V₂"];
const d = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#1e0a3c] lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[46%] lg:shrink-0 lg:flex-col lg:justify-between lg:self-start lg:p-12">
      <div className="cta-grid absolute inset-0 opacity-60" />
      {/* gradient blobs: transform-only animation, no blur filters, so they stay cheap */}
      <div
        className="blob-a absolute -left-32 top-0 h-[460px] w-[460px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(124,58,237,0.55) 0%, rgba(124,58,237,0) 68%)" }}
      />
      <div
        className="blob-b absolute -bottom-32 -right-24 h-[520px] w-[520px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(192,38,211,0.34) 0%, rgba(192,38,211,0) 68%)" }}
      />

      <div className="auth-in relative" style={d(40)}>
        <Logo dark />
      </div>

      <div className="relative">
        <p className="auth-in text-[12px] font-extrabold uppercase tracking-[0.22em] text-brand-300" style={d(80)}>
          The optimization loop
        </p>
        <h2 className="auth-in mt-4 max-w-md text-[2.3rem] font-extrabold leading-[1.12] text-white" style={d(130)}>
          Ship LLM code you can actually trust.
        </h2>
        <p className="auth-in mt-4 max-w-md text-[15.5px] leading-relaxed text-brand-100/70" style={d(180)}>
          Seven verification techniques, two bounded repair rounds, and a comparison report that proves what changed.
        </p>

        <div className="auth-in mt-8 flex items-center gap-2" style={d(230)}>
          {chips.map((c, i) => (
            <div key={c} className="flex items-center gap-2">
              <span
                className={`chip-bob grid h-11 w-11 place-items-center rounded-xl font-mono text-[13px] font-semibold ${
                  c.startsWith("V")
                    ? "bg-brand-500 text-white"
                    : c.startsWith("R")
                      ? "bg-white text-brand-900"
                      : "bg-white/10 text-brand-200 ring-1 ring-white/20"
                }`}
                style={{ animationDelay: `${i * 0.3}s` }}
              >
                {c}
              </span>
              {i < chips.length - 1 && <span className="h-px w-3 bg-white/25" />}
            </div>
          ))}
        </div>

        <div className="auth-in mt-9 flex max-w-md items-start gap-3.5 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10" style={d(280)}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/25 text-brand-200">
            <ShieldIcon />
          </span>
          <div>
            <p className="text-[14px] font-extrabold text-white">Every account is verified</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-brand-100/60">
              Confirm with a one-time code by SMS or email, or connect your GitHub or Google account.
            </p>
          </div>
        </div>

        <div className="auth-in mt-4 grid max-w-md grid-cols-3 gap-3" style={d(330)}>
          {[
            ["7", "real checks per round"],
            ["2", "bounded repairs"],
            ["100%", "sample RSR after V₂"],
          ].map(([a, b]) => (
            <div key={b} className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
              <div className="text-[22px] font-extrabold text-white">{a}</div>
              <div className="mt-1 text-[11.5px] leading-snug text-brand-100/60">{b}</div>
            </div>
          ))}
        </div>
      </div>

      <p className="auth-in relative text-[12.5px] text-brand-100/50" style={d(380)}>
        Methodology grounded in the Dou et al. LLM-code verification study · categories A.1 – C.4
      </p>
    </aside>
  );
}
