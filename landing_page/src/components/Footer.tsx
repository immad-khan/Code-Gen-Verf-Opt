import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { TRY_URL } from "../data";
import { subscribeNewsletter } from "../auth";
import { Reveal } from "./motion";

const TICKER = [
  "Generate · G₀",
  "Verify · V₀",
  "Repair · R₁",
  "Re-verify · V₁",
  "Repair · R₂",
  "Confirm · V₂",
  "A.1 Syntax",
  "A.2 Indentation",
  "A.3 Imports",
  "B.1–B.5 Runtime",
  "C.1–C.4 Functional",
  "pytest",
  "mypy",
  "radon",
  "semgrep",
];

const EXPLORE: [string, string][] = [
  ["Verification", "#verification"],
  ["Optimization loop", "#workflow"],
  ["The pipeline", "#pipeline"],
  ["Results", "#results"],
];

const RESOURCES: [string, string][] = [
  ["Bug taxonomy", "#verification"],
  ["Comparison report", "#results"],
  ["Before and after", "#results"],
  ["Get started", TRY_URL],
];

const LEGAL: Record<"terms" | "privacy", { title: string; body: string[] }> = {
  terms: {
    title: "Terms of service",
    body: [
      "VeriFlow is a research preview that verifies and repairs LLM-generated Python. You keep full ownership of any code you submit, generate, or repair with the tool.",
      "Verification results are diagnostics, not guarantees. Always review repaired code before running it in production or on sensitive data.",
      "This preview stores accounts locally in your browser. Clearing site data removes them permanently.",
    ],
  },
  privacy: {
    title: "Privacy policy",
    body: [
      "This preview keeps accounts, sessions, and newsletter sign-ups in your browser. They are not transmitted to a server.",
      "Passwords are stored only as SHA-256 hashes. One-time codes and GitHub/Google sign-in are simulated in this preview; no SMS or email is sent and no provider request is made.",
      "You can erase local data by clearing this site's storage in your browser settings.",
    ],
  },
};

const tickerMask = {
  maskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)",
  WebkitMaskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)",
} as const;

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[#12082a]/70 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-in relative w-full max-w-lg rounded-[24px] border border-brand-100 bg-white p-7 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[20px] font-extrabold text-ink">{title}</h3>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 transition hover:bg-brand-100"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 max-h-[60vh] space-y-3.5 overflow-y-auto pr-1">
          {children}
        </div>
      </div>
    </div>
  );
}

function Column({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <nav aria-label={title}>
      <h3 className="text-[11.5px] font-extrabold uppercase tracking-[0.2em] text-brand-200/70">{title}</h3>
      <ul className="mt-5 space-y-1">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="footer-link group flex w-fit items-center gap-2 py-1.5 text-[14.5px] font-semibold text-white/60 transition-colors duration-200 hover:text-white">
              <span>{label}</span>
              <span aria-hidden className="translate-x-[-4px] text-brand-300 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">→</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Newsletter() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setState({ ok: false, msg: "Enter a valid email address." });
      return;
    }
    const res = subscribeNewsletter(email);
    setState({ ok: true, msg: res.message });
    setEmail("");
  };

  return (
    <div>
      <h3 className="text-[20px] font-extrabold tracking-[-0.035em] text-white">Notes on better code.</h3>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-white/55">
        Ideas on verification, repair, and building more dependable AI code.
      </p>
      <form onSubmit={submit} noValidate className="mt-5">
        <label htmlFor="newsletter" className="sr-only">Your email address</label>
        <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] p-1.5 pl-5 transition focus-within:border-brand-300/70 focus-within:bg-white/[0.09] focus-within:ring-4 focus-within:ring-brand-500/15">
          <input
            id="newsletter"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setState(null);
            }}
            placeholder="Your email address"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-white outline-none placeholder:text-white/40"
          />
          <button type="submit" className="btn btn-primary shrink-0 px-4 py-2.5 text-[13px]">
            Join <span aria-hidden className="text-[15px]">→</span>
          </button>
        </div>
        <div className="mt-3 min-h-5 pl-5 text-[11.5px] leading-relaxed">
          {state ? (
            <p className={state.ok ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"} role="status">{state.msg}</p>
          ) : (
            <p className="text-white/40">Preview only. Saved on this device; no emails sent.</p>
          )}
        </div>
      </form>
    </div>
  );
}

export function Footer() {
  const [modal, setModal] = useState<"terms" | "privacy" | null>(null);
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden bg-[#0d0717] text-white">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-40 top-32 h-[460px] w-[640px] rounded-full bg-brand-600/20 blur-[120px]" />
        <div className="absolute -right-40 bottom-0 h-[420px] w-[560px] rounded-full bg-fuchsia-600/[0.12] blur-[120px]" />
      </div>

      {/* The ticker and oversized sign-off are the footer's bookends. */}
      <div className="marquee relative overflow-hidden border-y border-white/10 bg-white/[0.02] py-4" style={tickerMask} aria-label="VeriFlow verification workflow">
        <div className="marquee-track flex w-max">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center gap-8 pr-8" aria-hidden={copy === 1}>
              {TICKER.map((item) => (
                <span key={`${copy}-${item}`} className="flex items-center gap-8 whitespace-nowrap font-mono text-[11.5px] uppercase tracking-[0.2em] text-white/50">
                  {item}
                  <span className="text-brand-400">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="relative mx-auto max-w-[1360px] px-5 pb-6 pt-16 sm:px-8 lg:px-10 lg:pt-[76px]">
        <div className="grid gap-x-10 gap-y-12 md:grid-cols-2 lg:grid-cols-[1.38fr_0.72fr_0.9fr_1.32fr] xl:gap-x-14">
          <Reveal dir="left">
            <section aria-labelledby="footer-purpose">
              <p className="flex items-center gap-2.5 text-[11.5px] font-extrabold uppercase tracking-[0.2em] text-brand-200/70">
                <span className="h-2 w-2 rounded-full bg-brand-400 shadow-[0_0_12px_rgba(167,139,250,0.8)]" />
                Our purpose
              </p>
              <h2 id="footer-purpose" className="mt-5 max-w-[390px] text-[2.1rem] font-extrabold leading-[1.08] tracking-[-0.045em] text-white sm:text-[2.35rem]">
                Better code starts
                <span className="block bg-gradient-to-r from-[#c4b5fd] via-[#a78bfa] to-[#e9d5ff] bg-clip-text text-transparent">with a closer look.</span>
              </h2>
              <p className="mt-5 max-w-[390px] text-[14.5px] leading-[1.8] text-white/55">
                From first prompt to final result, make every improvement easier to see and understand.
              </p>
              <a href="#verification" className="mt-6 inline-flex items-center gap-2 text-[14px] font-extrabold text-brand-300 transition hover:text-white">
                Explore the 7 checks
                <span aria-hidden className="inline-block transition-transform duration-200 hover:translate-x-1">→</span>
              </a>
            </section>
          </Reveal>

          <Reveal dir="up" delay={70}>
            <Column title="Explore" links={EXPLORE} />
          </Reveal>

          <Reveal dir="up" delay={120}>
            <Column title="Resources" links={RESOURCES} />
          </Reveal>

          <Reveal dir="right" delay={170}>
            <section aria-labelledby="footer-newsletter">
              <p id="footer-newsletter" className="mb-5 text-[11.5px] font-extrabold uppercase tracking-[0.2em] text-brand-200/70">Stay in the loop</p>
              <Newsletter />
            </section>
          </Reveal>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-center text-[12px] text-white/40 sm:text-left">
            © {year} VeriFlow <span className="mx-1.5 text-white/20">·</span> Research preview based on the Dou et al. methodology
          </p>
          <div className="flex items-center justify-center gap-5">
            <button onClick={() => setModal("terms")} className="text-[12px] font-semibold text-white/45 transition hover:text-white">Terms</button>
            <button onClick={() => setModal("privacy")} className="text-[12px] font-semibold text-white/45 transition hover:text-white">Privacy</button>
            <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="text-[12px] font-bold text-brand-300 transition hover:text-white">
              Back to top ↑
            </button>
          </div>
        </div>
      </div>

      <div aria-hidden className="pointer-events-none select-none overflow-hidden pb-2">
        <p className="wordmark whitespace-nowrap text-center text-[clamp(4rem,16vw,14rem)] font-extrabold leading-[0.9] tracking-[-0.06em]">
          VeriFlow
        </p>
      </div>

      {modal && (
        <Modal title={LEGAL[modal].title} onClose={() => setModal(null)}>
          {LEGAL[modal].body.map((paragraph, i) => (
            <p key={i} className="text-[14px] leading-relaxed text-muted">{paragraph}</p>
          ))}
        </Modal>
      )}
    </footer>
  );
}
