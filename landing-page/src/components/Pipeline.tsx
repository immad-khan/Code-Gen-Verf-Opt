import { useEffect, useRef } from "react";
import { pipeline } from "../data";
import { Reveal } from "./motion";

export function Pipeline() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  // the spine draws itself as the section scrolls through the viewport
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const w = wrapRef.current;
      const l = lineRef.current;
      if (!w || !l) return;
      const r = w.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (window.innerHeight * 0.85 - r.top) / r.height));
      l.style.transform = `scaleY(${p})`;
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section id="pipeline" className="bg-white py-24">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-[2.3rem] font-extrabold leading-[1.12] text-ink sm:text-[2.75rem]">
            8 screens, from prompt to proof
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            Each stage maps to a phase from the base-paper methodology (Dou et al.).
          </p>
        </Reveal>

        <div ref={wrapRef} className="relative mx-auto mt-16 max-w-4xl">
          <div
            ref={lineRef}
            className="pipe-line absolute bottom-8 left-1/2 top-8 hidden w-[3px] -translate-x-1/2 rounded-full bg-gradient-to-b from-brand-200 via-brand-400 to-brand-700 md:block"
          />

          <ol>
            {pipeline.map((s, i) => {
              const left = i % 2 === 0;
              return (
                <li key={s.n} className="relative md:grid md:grid-cols-[1fr_88px_1fr] md:items-center md:py-3">
                  <div className={`mb-6 md:mb-0 ${left ? "md:col-start-1" : "md:col-start-3"}`}>
                    <Reveal dir={left ? "left" : "right"} delay={80}>
                      <article className="rounded-2xl border border-brand-100 bg-[#fbfaff] p-6 shadow-[0_10px_30px_-24px_rgba(59,7,100,0.3)]">
                        <div className={`flex items-center gap-3 ${left ? "md:justify-end" : ""}`}>
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-[13px] font-extrabold text-white md:hidden">
                            {s.n}
                          </span>
                          <span className="inline-flex rounded-full bg-brand-50 px-3 py-1 text-[12px] font-bold text-brand-600">
                            {s.phase}
                          </span>
                        </div>
                        <h3 className={`mt-3 text-[20px] font-extrabold text-ink ${left ? "md:text-right" : ""}`}>{s.title}</h3>
                        <p className={`mt-1.5 text-[14.5px] leading-relaxed text-muted ${left ? "md:text-right" : ""}`}>{s.desc}</p>
                      </article>
                    </Reveal>
                  </div>

                  <div className="relative z-10 hidden md:flex md:col-start-2 md:row-start-1 md:justify-center">
                    <Reveal dir="scale" delay={140}>
                      <span className="grid h-[56px] w-[56px] place-items-center rounded-full bg-gradient-to-br from-[#9d6cff] to-[#7c3aed] text-[18px] font-extrabold text-white shadow-[0_10px_24px_-8px_rgba(124,58,237,0.85),inset_0_1px_0_rgba(255,255,255,0.35)] ring-[6px] ring-white">
                        {s.n}
                      </span>
                    </Reveal>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
