import { useEffect, useRef, useState } from "react";
import { APP_URL, TRY_URL } from "../data";
import type { SessionUser } from "../auth";

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <a href="#top" className="flex items-center gap-2.5">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#9d6cff] to-[#7c3aed] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_16px_-8px_rgba(124,58,237,0.8)]">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-white" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l5 5L19 7.5" />
        </svg>
      </span>
      <span className={`text-[1.35rem] font-extrabold tracking-tight ${dark ? "text-white" : "text-ink"}`}>
        Veri<span className={dark ? "text-brand-300" : "text-brand-600"}>Flow</span>
      </span>
    </a>
  );
}

function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const p = max > 0 ? h.scrollTop / max : 0;
      if (ref.current) ref.current.style.transform = `scaleX(${p})`;
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
    <div className="fixed inset-x-0 top-0 z-[70] h-[3px]">
      <div
        ref={ref}
        className="h-full origin-left bg-gradient-to-r from-brand-400 via-brand-600 to-fuchsia-500"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}

const NAV = [
  ["Verification", "verification"],
  ["Workflow", "workflow"],
  ["Pipeline", "pipeline"],
  ["Results", "results"],
] as const;

export function Header({ user }: { user: SessionUser | null }) {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-38% 0px -55% 0px" }
    );
    for (const [, id] of NAV) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-brand-100/80 bg-white/80 backdrop-blur-xl">
      <ScrollProgress />
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-3 px-5">
        <Logo />
        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map(([label, id]) => (
            <a
              key={id}
              href={`#${id}`}
              className={`relative text-[15px] transition ${
                active === id ? "font-bold text-brand-600" : "font-medium text-[#4b5168] hover:text-brand-600"
              }`}
            >
              {label}
              <span
                className={`absolute -bottom-[6px] left-1/2 h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-brand-500 transition ${
                  active === id ? "opacity-100" : "opacity-0"
                }`}
              />
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a href={user ? APP_URL || "#verified" : TRY_URL} className="btn btn-primary px-5 py-2.5 text-[14px]">
            {user ? "Open VeriFlow" : "Try it out"}
          </a>
        </div>
      </div>
    </header>
  );
}
