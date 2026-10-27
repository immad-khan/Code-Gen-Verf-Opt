import { rounds } from "../data";
import { Reveal } from "./motion";

const bar: Record<(typeof rounds)[number]["tone"], string> = {
  slate: "bg-[#3d4663]",
  purple: "bg-brand-600",
  magenta: "bg-[#c026d3]",
};

const badge: Record<(typeof rounds)[number]["tone"], string> = {
  slate: "bg-[#3d4663] text-white",
  purple: "bg-brand-600 text-white shadow-[0_14px_30px_-12px_rgba(124,58,237,0.8)]",
  magenta: "bg-gradient-to-br from-[#c026d3] to-[#a21caf] text-white shadow-[0_14px_30px_-12px_rgba(192,38,211,0.7)]",
};

const chip: Record<(typeof rounds)[number]["tone"], string> = {
  slate: "bg-slate-100 text-slate-600",
  purple: "bg-brand-50 text-brand-700",
  magenta: "bg-fuchsia-50 text-fuchsia-700",
};

export function Workflow() {
  return (
    <section id="workflow" className="relative overflow-hidden bg-[#f7f4ff] py-24">
      <div className="light-grid absolute inset-0 opacity-80" />
      <div className="relative mx-auto max-w-4xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-brand-600">The optimization loop</p>
          <h2 className="mt-4 text-[2.3rem] font-extrabold leading-[1.12] text-ink sm:text-[2.75rem]">
            Verify → Repair → Verify, twice over
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            VeriFlow doesn't just find bugs — it closes the loop. Diagnostics feed the LLM, new code is generated, and it's re-verified across two bounded rounds.
          </p>
        </Reveal>

        <div className="mt-14 space-y-5">
          {rounds.map((r, i) => {
            const pct = Math.round((r.passed / r.total) * 100);
            return (
              <Reveal key={r.code} delay={i * 90}>
                <article className="rounded-[28px] border border-brand-100/80 bg-white px-6 py-10 text-center shadow-[0_18px_50px_-36px_rgba(59,7,100,0.35)] sm:px-12 sm:py-12">
                  <div className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl text-[22px] font-extrabold tracking-tight ${badge[r.tone]}`}>
                    {r.code}
                  </div>
                  <h3 className="mt-6 text-[22px] font-extrabold text-ink">{r.title}</h3>
                  <p className="mx-auto mt-3 max-w-xl text-[15.5px] leading-relaxed text-muted">{r.desc}</p>
                  <div className="mx-auto mt-8 max-w-2xl">
                    <div className="mb-2 flex items-center justify-between text-[13px]">
                      <span className="font-medium text-muted">pytest pass rate</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${chip[r.tone]}`}>
                        {r.passed} / {r.total} tests
                      </span>
                    </div>
                    <div className="h-[10px] overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`bar-fill h-full rounded-full ${bar[r.tone]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
