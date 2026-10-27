import { TRY_URL } from "../data";
import { CountUp, Reveal, useParallax } from "./motion";

const checks = [
  { name: "Syntax / AST", res: "1 error" },
  { name: "Import check", res: "1 hallucinated" },
  { name: "pytest", res: "8/12 passed" },
  { name: "Runtime errors", res: "3 found" },
  { name: "mypy", res: "2 issues" },
  { name: "radon", res: "CC 9 · MI 58" },
  { name: "semgrep", res: "1 finding" },
];

function CodeCard() {
  const lines: { t: string; err?: string }[] = [
    { t: "import pyquickmath", err: "A.3 · No module named 'pyquickmath'" },
    { t: "" },
    { t: "def avg(nums):" },
    { t: "    total = sum(nums)" },
    { t: "    return total / len(nums)", err: "B.5 · ZeroDivisionError on []" },
  ];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#2a2440] bg-[#161326] shadow-[0_30px_70px_-28px_rgba(42,18,99,0.5)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-3 font-mono text-[11px] text-white/40">llm_generated.py</span>
        <span className="ml-auto rounded-full bg-rose-400/12 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-rose-300">
          V₀ · failing
        </span>
      </div>
      <div className="relative px-4 py-4 font-mono text-[13px] leading-[1.9]">
        <div className="animate-scan pointer-events-none absolute left-0 right-0 h-9 bg-gradient-to-b from-transparent via-brand-400/18 to-transparent" />
        {lines.map((l, i) => (
          <div key={i}>
            <div className={`flex gap-3 rounded px-1 ${l.err ? "bg-rose-400/[0.08]" : ""}`}>
              <span className="w-4 select-none text-right text-white/20">{i + 1}</span>
              <span className={l.err ? "text-rose-200" : "text-[#ddd6ff]"}>{l.t || "\u00a0"}</span>
            </div>
            {l.err && (
              <div className="ml-8 flex items-center gap-1.5 py-0.5 text-[11px] text-rose-300/85">
                <span aria-hidden>↳</span>
                {l.err}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportCard() {
  return (
    <div className="rounded-2xl border border-brand-100 bg-white p-4 shadow-[0_22px_50px_-24px_rgba(42,18,99,0.35)]">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[13px] font-bold text-ink">Verification · Round 0</span>
        <span className="rounded-full bg-brand-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-600">7 checks</span>
      </div>
      <ul className="space-y-1">
        {checks.map((c) => (
          <li key={c.name} className="flex items-center justify-between rounded-lg bg-brand-50/80 px-2.5 py-1.5 text-[12.5px]">
            <span className="flex items-center gap-1.5 font-semibold text-ink/80">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              {c.name}
            </span>
            <span className="font-mono text-[10.5px] text-muted">{c.res}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Hero() {
  const cardRef = useParallax(-0.045);
  const reportRef = useParallax(0.055);
  return (
    <section id="top" className="relative overflow-hidden bg-[#faf8ff]">
      <div className="light-grid absolute inset-0" />
      <div className="absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-brand-300/25 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-28 pt-16 lg:grid-cols-2 lg:pt-20">
        <div>
          <Reveal dir="fade">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-600">
              The optimization loop
            </span>
          </Reveal>
          <Reveal dir="up" delay={90}>
            <h1 className="mt-6 text-[2.7rem] font-extrabold leading-[1.05] text-ink sm:text-[3.4rem]">
              Find what's wrong with{" "}
              <span className="text-brand-600">LLM Python</span>
              . Then fix it.
            </h1>
          </Reveal>
          <Reveal dir="up" delay={180}>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-muted">
              VeriFlow runs generated code through 7 real verification techniques, feeds the diagnostics back to the model, and repeats for two bounded repair rounds.
            </p>
          </Reveal>
          <Reveal dir="up" delay={270}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href={TRY_URL} className="btn btn-primary px-6 py-3.5 text-[15px]">
                Try it out <span aria-hidden>→</span>
              </a>
              <a href="#workflow" className="btn btn-secondary px-6 py-3.5 text-[15px]">
                See how it works
              </a>
            </div>
          </Reveal>
          <Reveal dir="up" delay={360}>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-5">
              {[
                [7, "verification techniques"],
                [2, "repair rounds"],
                [8, "guided screens"],
              ].map(([a, b]) => (
                <div key={b as string}>
                  <dt>
                    <CountUp to={a as number} className="text-[28px] font-extrabold leading-none text-ink" />
                  </dt>
                  <dd className="mt-1.5 text-[12px] leading-snug text-muted">{b}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
        <Reveal dir="scale" delay={220}>
          <div className="relative">
            <div ref={cardRef}>
              <div className="animate-float">
                <CodeCard />
              </div>
            </div>
            <div className="mt-4 sm:absolute sm:-bottom-16 sm:-right-3 sm:mt-0 sm:w-[270px]">
              <Reveal dir="down" delay={480}>
                <div ref={reportRef}>
                  <ReportCard />
                </div>
              </Reveal>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
