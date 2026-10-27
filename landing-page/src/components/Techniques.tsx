import { techniques } from "../data";
import { Reveal } from "./motion";

export function Techniques() {
  return (
    <section id="verification" className="bg-white py-24">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.2em] text-brand-600">Verification</p>
          <h2 className="mt-3 text-[2.4rem] font-extrabold leading-[1.1] text-ink sm:text-[2.8rem]">
            Seven techniques. One verdict.
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            Each check maps to a bug category from the base paper's taxonomy, so every failure is traceable and fixable.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {techniques.map((t, i) => (
            <Reveal key={t.n} className="h-full" delay={(i % 3) * 90 + Math.floor(i / 3) * 60}>
            <article
              className="group flex h-full flex-col rounded-2xl border border-brand-100 bg-[#fbfaff] p-6 transition hover:-translate-y-0.5 hover:border-brand-200 hover:bg-white hover:shadow-[0_18px_40px_-28px_rgba(124,58,237,0.45)]"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-100 text-[13px] font-extrabold text-brand-700">
                  {String(t.n).padStart(2, "0")}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${
                    t.tag === "Paper" ? "bg-emerald-50 text-emerald-700" : "bg-brand-600 text-white"
                  }`}
                >
                  {t.tag === "Paper" ? "From paper" : "Extension"}
                </span>
              </div>
              <h3 className="mt-4 text-[18px] font-extrabold leading-snug text-ink">{t.title}</h3>
              <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted">{t.desc}</p>
              <div className="mt-5 space-y-1.5 border-t border-brand-100 pt-4">
                <p className="text-[12px] text-ink/70">
                  <span className="font-bold text-brand-600">Covers </span>
                  {t.category}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md bg-white px-2 py-0.5 font-mono text-[11px] font-medium text-brand-700 ring-1 ring-brand-100">{t.tool}</code>
                  {t.file.includes(":L") && <code className="font-mono text-[10px] text-muted/70">{t.file}</code>}
                </div>
              </div>
            </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
