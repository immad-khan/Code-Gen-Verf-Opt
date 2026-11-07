import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Logo } from "../Header";

type Kind = "gen" | "verify" | "repair";
type Tone = "cmd" | "info" | "ok" | "warn" | "err";

const RING: { id: string; kind: Kind; name: string }[] = [
  { id: "G₀", kind: "gen", name: "generate" },
  { id: "V₀", kind: "verify", name: "verify · initial" },
  { id: "R₁", kind: "repair", name: "repair · round 1" },
  { id: "V₁", kind: "verify", name: "verify · round 1" },
  { id: "R₂", kind: "repair", name: "repair · round 2" },
  { id: "V₂", kind: "verify", name: "verify · final" },
];

// tests passing once each node has run
const PASSED = [0, 8, 8, 11, 11, 12];

const LOG: { t: string; tone: Tone }[][] = [
  [{ t: "llm ▸ generated avg.py · 24 LOC", tone: "cmd" }],
  [
    { t: "ast.parse ✗ expected ':' · A.1", tone: "err" },
    { t: "importlib ✗ pyquickmath · A.3", tone: "err" },
    { t: "pytest 8/12 · ZeroDivisionError · B.5", tone: "warn" },
  ],
  [{ t: "repair ▸ self-critique built from V₀ traces", tone: "cmd" }],
  [
    { t: "pytest 11/12 · empty-edge case · C.2", tone: "warn" },
    { t: "findings 10 → 2", tone: "ok" },
  ],
  [{ t: "repair ▸ episodic memory of V₀ + V₁", tone: "cmd" }],
  [
    { t: "pytest 12/12 ✓", tone: "ok" },
    { t: "findings 2 → 0 · bugs eradicated", tone: "ok" },
  ],
];

const TONE: Record<Tone, string> = {
  cmd: "text-brand-300",
  info: "text-slate-300",
  ok: "text-emerald-300",
  warn: "text-amber-300",
  err: "text-rose-300",
};

const NODE_STYLE: Record<Kind, string> = {
  gen: "bg-white/10 text-brand-100 ring-1 ring-white/20",
  verify: "bg-brand-500 text-white shadow-[0_10px_24px_-8px_rgba(139,92,246,0.9)]",
  repair: "bg-white text-brand-900 shadow-[0_10px_24px_-10px_rgba(255,255,255,0.55)]",
};

const TAXONOMY = ["A.1 Syntax", "A.2 Indent", "A.3 Imports", "B.1–B.5 Runtime", "C.1–C.4 Functional"];

const SIZE = 264;
const CENTER = SIZE / 2;
const R = 106; // orbit radius for nodes
const R_INNER = 78; // radius of the pass-rate ring
const NODE = 40;
const ease = (on: boolean) => (on ? "stroke-dasharray 0.9s cubic-bezier(0.22, 1, 0.36, 1)" : "none");

function Dial({ step }: { step: number }) {
  const passed = PASSED[step];
  const pct = passed / 12;
  const outerLen = 2 * Math.PI * R;
  const innerLen = 2 * Math.PI * R_INNER;
  const animate = step !== 0; // snap back to zero when the loop restarts

  return (
    <div className="relative mx-auto shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
        <defs>
          <linearGradient id="vf-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c4b5fd" />
            <stop offset="100%" stopColor="#e879f9" />
          </linearGradient>
        </defs>

        {/* slow-turning dotted orbit */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1"
          strokeDasharray="1.5 6"
          className="orbit"
          style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
        />
        {/* loop progress along the orbit */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R}
          fill="none"
          stroke="url(#vf-ring)"
          strokeWidth="3"
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
          strokeDasharray={`${(outerLen * step) / 6} ${outerLen}`}
          style={{ transition: ease(animate) }}
        />

        {/* pass-rate ring */}
        <circle cx={CENTER} cy={CENTER} r={R_INNER} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R_INNER}
          fill="none"
          stroke="url(#vf-ring)"
          strokeWidth="8"
          strokeLinecap="round"
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
          strokeDasharray={`${innerLen * pct} ${innerLen}`}
          style={{ transition: ease(animate) }}
        />
      </svg>

      {RING.map((n, i) => {
        const a = (-90 + i * 60) * (Math.PI / 180);
        const x = CENTER + R * Math.cos(a) - NODE / 2;
        const y = CENTER + R * Math.sin(a) - NODE / 2;
        const active = i === step;
        return (
          <span
            key={n.id}
            className={`absolute grid place-items-center rounded-2xl font-mono text-[12px] font-bold transition-all duration-500 ${NODE_STYLE[n.kind]} ${
              active ? "stage-active scale-125 opacity-100" : "opacity-70"
            }`}
            style={{ left: x, top: y, width: NODE, height: NODE }}
          >
            {n.id}
          </span>
        );
      })}

      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-[46px] font-extrabold leading-none tracking-tight tabular-nums">
            <span key={passed} className="pop-in inline-block">
              {passed}
            </span>
            <span className="text-[20px] font-bold text-white/35">/12</span>
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-brand-200/65">tests passing</div>
        </div>
      </div>
    </div>
  );
}

function Terminal({ step, cycle }: { step: number; cycle: number }) {
  const lines = LOG.slice(0, step + 1).flatMap((group, gi) =>
    group.map((line, li) => ({ ...line, key: `${cycle}-${gi}-${li}` }))
  );
  const shown = lines.slice(-3);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0418]/60 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur-md">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-rose-400/80" />
        <span className="h-2 w-2 rounded-full bg-amber-300/80" />
        <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
        <span className="ml-2 min-w-0 truncate font-mono text-[11px] text-white/45">veriflow run · {RING[step].name}</span>
      </div>
      <div className="min-h-[104px] space-y-1.5 px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed">
        {shown.map((l) => (
          <p key={l.key} className={`log-in flex gap-2 ${TONE[l.tone]}`}>
            <span className="select-none text-white/25">›</span>
            <span className="min-w-0">{l.t}</span>
          </p>
        ))}
        <span className="inline-block h-3.5 w-1.5 animate-pulse bg-brand-300 align-middle" />
      </div>
    </div>
  );
}

export function BrandPanel() {
  const asideRef = useRef<HTMLElement>(null);
  const frame = useRef(0);
  const [tick, setTick] = useState(0);

  // the loop advances on its own; respects reduced-motion by staying on the first frame
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1800);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // cursor spotlight, updated once per frame
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const el = asideRef.current;
    if (!el) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${clientX - r.left}px`);
      el.style.setProperty("--my", `${clientY - r.top}px`);
    });
  };

  const step = tick % 6;
  const cycle = Math.floor(tick / 6);
  const d = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

  return (
    <aside
      ref={asideRef}
      onPointerMove={onMove}
      className="relative hidden h-screen sticky top-0 overflow-hidden bg-[#140830] text-white lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:px-8 lg:py-7 xl:px-12 xl:py-8"
    >
      {/* background layers */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(900px circle at 0% 0%, rgba(124,58,237,0.45), transparent 55%), radial-gradient(700px circle at 100% 100%, rgba(192,38,211,0.28), transparent 55%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(520px circle at var(--mx, 35%) var(--my, 20%), rgba(196,181,253,0.16), transparent 60%)" }}
      />
      <div
        className="cta-grid absolute inset-0 opacity-[0.3]"
        style={{ maskImage: "radial-gradient(ellipse at top, black, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse at top, black, transparent 75%)" }}
      />
      <div
        className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
        style={{ backgroundImage: "var(--noise)", backgroundSize: "180px 180px" }}
      />
      <div className="aurora absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-brand-600/30 blur-3xl" />
      <div className="aurora-slow absolute -right-24 bottom-10 h-80 w-80 rounded-full bg-fuchsia-600/20 blur-3xl" />

      {/* header */}
      <div className="relative flex items-center justify-between">
        <div className="auth-in" style={d(40)}>
          <Logo dark />
        </div>
        <span
          className="auth-in hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-brand-100/80 xl:inline-flex"
          style={d(120)}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          Preview build
        </span>
      </div>

      {/* hero */}
      <div className="relative mt-4 xl:mt-6">
        <span
          className="auth-in inline-flex items-center gap-2 rounded-full border border-brand-400/25 bg-brand-500/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand-200"
          style={d(120)}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-300 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-300" />
          </span>
          Verify · Repair · Verify
        </span>
        <h2 className="auth-in mt-3 text-[1.85rem] font-extrabold leading-[1.08] tracking-[-0.03em] xl:text-[2.35rem]" style={d(180)}>
          Ship LLM code you can{" "}
          <span className="bg-gradient-to-r from-[#ede4ff] via-[#c4b5fd] to-[#f0abfc] bg-clip-text text-transparent">actually trust.</span>
        </h2>
        <p className="auth-in mt-2 max-w-md text-[13.5px] leading-relaxed text-brand-100/65 xl:text-[14.5px]" style={d(240)}>
          Seven real checks, two bounded repair rounds, and a report that proves what changed.
        </p>
      </div>

      {/* live loop */}
      <div className="relative mt-4 flex flex-col items-center gap-4 xl:mt-6 xl:flex-row xl:gap-6">
        <div className="auth-in shrink-0 scale-90 xl:scale-95 origin-center" style={d(300)}>
          <Dial step={step} />
        </div>
        <div className="auth-in min-w-0 w-full flex-1" style={d(380)}>
          <Terminal step={step} cycle={cycle} />
        </div>
      </div>

      {/* footer */}
      <div className="relative mt-4 xl:mt-6">
        <div className="auth-in flex flex-wrap gap-2" style={d(440)}>
          {TAXONOMY.map((t) => (
            <span key={t} className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10.5px] text-brand-100/70">
              {t}
            </span>
          ))}
        </div>
        <p
          className="auth-in mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-[11.5px] text-brand-100/45 xl:mt-4 xl:pt-4"
          style={d(500)}
        >
          <span>Based on the Dou et al. LLM-code verification study</span>
          <span className="shrink-0 font-mono">A.1 – C.4</span>
        </p>
      </div>
    </aside>
  );
}
