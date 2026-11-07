import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { TRY_URL, techniques } from "../data";
import { subscribeNewsletter } from "../auth";
import { Logo } from "./Header";
import { Reveal } from "./motion";

export function CTA() {
  return (
    <section id="try" className="bg-white px-5 pb-16 pt-8">
      <Reveal dir="scale">
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[32px] bg-gradient-to-br from-[#8b5cf6] via-[#7c3aed] to-[#6d28d9] px-6 py-16 text-center shadow-[0_30px_80px_-30px_rgba(109,40,217,0.7)] sm:px-12 sm:py-20">
          <div className="cta-grid absolute inset-0" />
          <div className="absolute -left-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-24 -right-10 h-72 w-72 rounded-full bg-[#c026d3]/30 blur-3xl" />
          <div className="relative">
            <h2 className="text-[2.2rem] font-extrabold leading-[1.12] text-white sm:text-[2.7rem]">
              Ready to verify your LLM code?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-white/85">
              Run the full VeriFlow pipeline — prompt, generate, verify, repair, and compare — and watch the bugs disappear.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <a href={TRY_URL} className="btn btn-white px-7 py-3.5 text-[15px]">
                Try it out <span aria-hidden>→</span>
              </a>
              <a href="#verification" className="btn btn-ghost px-7 py-3.5 text-[15px]">
                Read the method
              </a>
            </div>
            <p className="mt-6 text-[13px] font-medium text-white/70">
              Opens the main VeriFlow workspace · 8-screen guided pipeline
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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
          <button ref={closeRef} onClick={onClose} aria-label="Close dialog"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 transition hover:bg-brand-100">
            ✕
          </button>
        </div>
        <div className="mt-4 max-h-[60vh] overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
}

const SERVICES = [
  "AST parser · ast.parse()",
  "Import resolver · importlib",
  "Test sandbox · pytest",
  "Trace analyzer · runtime",
  "Type checker · mypy",
  "Metrics engine · radon",
  "Security scanner · semgrep",
];

function StatusModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="System status" onClose={onClose}>
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-[14px] font-extrabold text-emerald-700">All 7 verifiers operational</span>
      </div>
      <ul className="mt-4 divide-y divide-brand-50">
        {SERVICES.map((s) => (
          <li key={s} className="flex items-center justify-between py-3">
            <span className="font-mono text-[13px] text-ink/80">{s}</span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11.5px] font-extrabold text-emerald-700">Operational</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-muted/70">Sandbox status shown for this preview build.</p>
    </Modal>
  );
}

const LEGAL: Record<"terms" | "privacy", { title: string; body: string[] }> = {
  terms: {
    title: "Terms of service",
    body: [
      "VeriFlow is a research preview that verifies and repairs LLM-generated Python. You keep full ownership of any code you submit, generate, or repair with the tool.",
      "Verification results — pass rates, complexity metrics, and security findings — are diagnostics, not guarantees. Always review repaired code before running it in production or on sensitive data.",
      "The sandbox executes generated code in isolation, but you agree not to submit code intended to attack third-party systems, mine cryptocurrency, or process data you don't have rights to.",
      "This preview stores accounts, including the phone number you verify with, locally in your browser. Clearing site data removes them permanently.",
    ],
  },
  privacy: {
    title: "Privacy policy",
    body: [
      "This preview keeps everything on your device: accounts, phone numbers, sessions, and newsletter sign-ups are stored in your browser's local storage and are never transmitted to a server.",
      "Passwords are stored only as SHA-256 hashes. We never see or store your plaintext password.",
      "One-time codes are generated in your browser and shown in an on-screen demo inbox. No SMS or email is sent from this preview.",
      "GitHub and Google sign-in are simulated in this preview. No request is made to either provider and no provider credentials are collected.",
      "In the full product, submitted code is sent to the LLM provider you configure, under your own API key and their data policy. VeriFlow adds no additional training or retention on your code.",
      "You can erase all local data at any time by clearing this site's storage in your browser settings.",
    ],
  },
};

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
    <form onSubmit={submit} noValidate>
      <label htmlFor="newsletter" className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-brand-300">
        Research updates
      </label>
      <p className="mt-2 text-[13.5px] leading-relaxed text-brand-100/60">
        New verification techniques and benchmark results, once a month.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          id="newsletter"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setState(null); }}
          placeholder="you@lab.dev"
          className="w-full min-w-0 rounded-full border border-white/15 bg-white/[0.07] px-4 py-2.5 text-[14px] text-white placeholder:text-brand-100/40 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <button type="submit" className="btn btn-primary shrink-0 px-5 py-2.5 text-[13px]">Join</button>
      </div>
      {state && (
        <p className={`mt-2 text-[12.5px] font-semibold ${state.ok ? "text-emerald-300" : "text-rose-300"}`}>{state.msg}</p>
      )}
    </form>
  );
}

export function Footer() {
  const [modal, setModal] = useState<"status" | "terms" | "privacy" | null>(null);
  const year = new Date().getFullYear();

  const productLinks: [string, string][] = [
    ["Verification engine", "#verification"],
    ["Optimization loop", "#workflow"],
    ["8-screen pipeline", "#pipeline"],
    ["Final results", "#results"],
    ["Try it out", TRY_URL],
  ];
  const resourceLinks: [string, string][] = [
    ["Bug taxonomy A.1 – C.4", "#verification"],
    ["Bug evolution matrix", "#results"],
    ["Before / after diff", "#results"],
    ["Get started", TRY_URL],
  ];

  return (
    <footer className="relative overflow-hidden bg-[#170b2e] text-white">
      <div className="cta-grid absolute inset-0 opacity-40" />
      <div className="absolute -top-32 left-1/4 h-64 w-96 rounded-full bg-brand-600/20 blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/60 to-transparent" />

      <div className="relative mx-auto max-w-6xl px-5 pb-10 pt-16">
        <div className="grid gap-12 lg:grid-cols-[1.35fr_0.8fr_0.8fr_1.05fr]">
          <div>
            <Logo dark />
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-brand-100/60">
              Verify LLM-generated Python with seven real techniques, repair it across two bounded rounds, and prove what changed.
            </p>
            <button
              onClick={() => setModal("status")}
              className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[13px] font-bold text-emerald-300 transition hover:border-emerald-400/60 hover:bg-emerald-400/15"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              All verifiers operational
            </button>
            <p className="mt-5 text-[13px] text-brand-100/50">
              Questions? <a href="mailto:hello@veriflow.dev" className="font-bold text-brand-300 transition hover:text-white">hello@veriflow.dev</a>
            </p>
          </div>

          <nav aria-label="Product">
            <h4 className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-brand-300">Product</h4>
            <ul className="mt-4 space-y-2.5">
              {productLinks.map(([label, href]) => (
                <li key={label}>
                  <a href={href} className="group inline-flex items-center gap-1.5 text-[14px] text-brand-100/65 transition hover:text-white">
                    <span className="h-px w-0 bg-brand-400 transition-all group-hover:w-3" />
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Verification stack">
            <h4 className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-brand-300">The stack</h4>
            <ul className="mt-4 space-y-2.5">
              {techniques.slice(0, 6).map((t) => (
                <li key={t.n}>
                  <a href="#verification" className="group inline-flex items-center gap-2 font-mono text-[13px] text-brand-100/65 transition hover:text-white">
                    <span className="text-brand-500 transition group-hover:text-brand-300">{String(t.n).padStart(2, "0")}</span>
                    {t.tool}
                  </a>
                </li>
              ))}
              <li>
                <a href="#verification" className="font-mono text-[13px] text-brand-300 transition hover:text-white">07 semgrep →</a>
              </li>
            </ul>
          </nav>

          <div className="space-y-8">
            <nav aria-label="Resources">
              <h4 className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-brand-300">Research</h4>
              <ul className="mt-4 space-y-2.5">
                {resourceLinks.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="group inline-flex items-center gap-1.5 text-[14px] text-brand-100/65 transition hover:text-white">
                      <span className="h-px w-0 bg-brand-400 transition-all group-hover:w-3" />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <Newsletter />
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-5 border-t border-white/10 pt-7 md:flex-row">
          <p className="text-center text-[13px] text-brand-100/50 md:text-left">
            © {year} VeriFlow · Built on the Dou et al. LLM-code verification methodology
          </p>
          <div className="flex items-center gap-6">
            <button onClick={() => setModal("terms")} className="text-[13px] font-semibold text-brand-100/60 transition hover:text-white">Terms</button>
            <button onClick={() => setModal("privacy")} className="text-[13px] font-semibold text-brand-100/60 transition hover:text-white">Privacy</button>
            <button onClick={() => setModal("status")} className="text-[13px] font-semibold text-brand-100/60 transition hover:text-white">Status</button>
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label="Back to top"
              className="btn btn-primary h-11 w-11 p-0 text-[16px]"
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {modal === "status" && <StatusModal onClose={() => setModal(null)} />}
      {(modal === "terms" || modal === "privacy") && (
        <Modal title={LEGAL[modal].title} onClose={() => setModal(null)}>
          <div className="space-y-3.5">
            {LEGAL[modal].body.map((p, i) => (
              <p key={i} className="text-[14px] leading-relaxed text-muted">{p}</p>
            ))}
          </div>
        </Modal>
      )}
    </footer>
  );
}
