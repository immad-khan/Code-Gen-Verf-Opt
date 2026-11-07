import { CheckIcon } from "./icons";

const DEFAULT_STEPS = ["Details", "Method", "Verify"];

export function Stepper({ index, steps = DEFAULT_STEPS }: { index: number; steps?: string[] }) {
  return (
    <ol className="flex items-center" aria-label="Sign-up progress">
      {steps.map((label, i) => {
        const state = i < index ? "done" : i === index ? "active" : "todo";
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none" aria-current={state === "active" ? "step" : undefined}>
            <div className="flex items-center gap-2">
              <span
                className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-extrabold transition-all duration-300 ${
                  state === "done"
                    ? "bg-emerald-500 text-white"
                    : state === "active"
                      ? "bg-brand-600 text-white ring-4 ring-brand-100"
                      : "bg-brand-50 text-brand-400 ring-1 ring-brand-100"
                }`}
              >
                {state === "done" ? <CheckIcon className="pop-in h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={`text-[12.5px] font-bold transition-colors duration-300 ${state === "todo" ? "text-muted/60" : "text-ink"}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className="relative mx-3 h-[3px] flex-1 overflow-hidden rounded-full bg-brand-100">
                <span
                  className="absolute inset-0 origin-left rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-transform duration-500 ease-out"
                  style={{ transform: `scaleX(${i < index ? 1 : 0})` }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
