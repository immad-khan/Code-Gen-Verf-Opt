import { bugMatrix } from "../data";
import { CountUp, Reveal } from "./motion";

function cellTone(n: number) {
  if (n === 0) return "bg-emerald-100 text-emerald-700";
  if (n === 1) return "bg-amber-100 text-amber-700";
  if (n === 2) return "bg-orange-100 text-orange-600";
  return "bg-rose-100 text-rose-600";
}

const before = [
  "import pyquickmath  # × hallucinated",
  "",
  "def avg(nums):",
  "    total = sum(nums)",
  "    return total / len(nums)",
  "# × ZeroDivisionError on []",
  "# × 8/12 tests pass",
];

const after = [
  "from statistics import mean  # ✓ real",
  "",
  "def avg(nums: list[float]) -> float:",
  "    if not nums:",
  "        return 0.0",
  "    return mean(nums)",
  "# ✓ guarded · typed · 12/12 pass",
];

export function Results() {
  return (
    <section id="results" className="bg-[#f7f4ff] py-24">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-brand-600">Final results</p>
          <h2 className="mt-4 text-[2.3rem] font-extrabold leading-[1.12] text-ink sm:text-[2.75rem]">
            Proof the bugs are actually gone
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            A comprehensive comparison report — Repair Success Rate, the Bug Evolution Matrix, and a side-by-side before/after diff.
          </p>
        </Reveal>

        <div className="mt-12 space-y-5">
          <Reveal>
            <article className="rounded-[24px] border border-brand-100 bg-white p-8 sm:p-10">
              <p className="text-[15px] font-semibold text-muted">Repair Success Rate (RSR)</p>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <CountUp to={100} suffix="%" className="text-[64px] font-extrabold leading-none tracking-tight text-brand-600" />
                <span className="mb-3 text-[15px] font-bold text-emerald-600">↑ from 66%</span>
              </div>
              <p className="mt-1 text-[15px] text-muted">10 of 10 injected defects eliminated across V₀ → V₂.</p>
            </article>
          </Reveal>

          <Reveal delay={120}>
            <article className="rounded-[24px] border border-brand-100 bg-white p-8 sm:p-10">
              <h3 className="text-[20px] font-extrabold text-ink">Bug Evolution Matrix</h3>
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left">
                  <thead>
                    <tr className="text-[13px] font-semibold text-muted">
                      <th className="pb-4 font-semibold">Category</th>
                      {["V₀", "V₁", "V₂"].map((h) => (
                        <th key={h} className="w-24 pb-4 text-center font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bugMatrix.map((row) => (
                      <tr key={row.code} className="border-t border-brand-50">
                        <td className="py-3.5 text-[15px] font-semibold text-ink">
                          {row.code} {row.name}
                        </td>
                        {row.v.map((n, i) => (
                          <td key={i} className="py-3.5 text-center">
                            <span className={`inline-grid h-8 w-8 place-items-center rounded-lg text-[13px] font-extrabold ${cellTone(n)}`}>
                              {n}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </Reveal>

          <Reveal delay={240}>
            <article className="overflow-hidden rounded-[24px] border border-brand-100 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 px-8 pt-8 sm:px-10">
                <h3 className="text-[20px] font-extrabold text-ink">Before / After diff</h3>
                <span className="rounded-full bg-brand-50 px-3 py-1 text-[12px] font-bold text-brand-600">V₀ → V₂</span>
              </div>
              <div className="mt-5 grid md:grid-cols-2">
                <div>
                  <div className="bg-rose-50 px-6 py-2.5 text-[13px] font-bold italic text-rose-500 sm:px-10">
                    − G₀ (initial)
                  </div>
                  <pre className="overflow-x-auto px-6 py-5 font-mono text-[13px] leading-[1.85] text-[#3a3f55] sm:px-10">
                    {before.map((l, i) => (
                      <div key={i} className={l.includes("×") ? "text-rose-500" : ""}>
                        {l || "\u00a0"}
                      </div>
                    ))}
                  </pre>
                </div>
                <div className="border-t border-brand-50 md:border-l md:border-t-0">
                  <div className="bg-emerald-50 px-6 py-2.5 text-[13px] font-bold italic text-emerald-600 sm:px-10">
                    + R₂ (repaired)
                  </div>
                  <pre className="overflow-x-auto px-6 py-5 font-mono text-[13px] leading-[1.85] text-[#3a3f55] sm:px-10">
                    {after.map((l, i) => (
                      <div key={i} className={l.includes("✓") ? "text-emerald-600" : ""}>
                        {l || "\u00a0"}
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
