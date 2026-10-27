import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type Dir = "up" | "down" | "left" | "right" | "scale" | "fade";

/**
 * Scroll reveal wrapper. Children animate in when entering the viewport
 * and animate out again when leaving, so content continually
 * arrives on screen and departs on screen.
 */
export function Reveal({
  children,
  dir = "up",
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  dir?: Dir;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) el.classList.toggle("is-in", e.isIntersecting);
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      data-dir={dir}
      className={`reveal ${className}`}
      style={{ "--rd": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** Counts from 0 to `to` once, when scrolled into view. */
export function CountUp({
  to,
  suffix = "",
  duration = 1100,
  className = "",
}: {
  to: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || started.current) return;
        started.current = true;
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = `${Math.round(to * eased)}${suffix}`;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, suffix, duration]);
  return (
    <span ref={ref} className={className}>
      0{suffix}
    </span>
  );
}

/** Subtle vertical parallax tied to scroll position. */
export function useParallax(factor: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      el.style.transform = `translateY(${window.scrollY * factor}px)`;
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [factor]);
  return ref;
}
