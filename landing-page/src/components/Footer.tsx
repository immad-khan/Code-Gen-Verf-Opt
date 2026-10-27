import { TRY_URL } from "../data";
import { Logo } from "./Header";
import { Reveal } from "./motion";

export function CTA() {
  return (
    <section id="try" className="bg-white px-5 pb-8 pt-8">
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

export function Footer() {
  return (
    <footer className="border-t border-brand-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
        <Logo />
        <nav className="flex flex-wrap items-center justify-center gap-6 text-[14px] text-muted">
          <a href="#verification" className="hover:text-brand-600">Verification</a>
          <a href="#workflow" className="hover:text-brand-600">Workflow</a>
          <a href="#pipeline" className="hover:text-brand-600">Pipeline</a>
          <a href="#results" className="hover:text-brand-600">Results</a>
        </nav>
        <p className="text-[13px] text-muted/80">© {new Date().getFullYear()} VeriFlow</p>
      </div>
    </footer>
  );
}
