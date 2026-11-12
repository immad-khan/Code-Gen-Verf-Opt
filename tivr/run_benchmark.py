"""
run_benchmark.py — evaluate TIVR on a benchmark and print the numbers that
go head-to-head with Dou et al.
"""
from __future__ import annotations
import argparse
import collections
import json
from pathlib import Path

from .repair_loop import LLMClient, run_task


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tasks", help="tasks.jsonl path")
    ap.add_argument("--k", type=int, default=2, help="iteration budget")
    ap.add_argument("--mode", default="full",
                    choices=["full", "evidence_only", "taxonomy_only", "generic"])
    ap.add_argument("--limit", type=int, default=0, help="0 = all tasks")
    ap.add_argument("--out", default="runs")
    args = ap.parse_args()

    tasks = [json.loads(l) for l in Path(args.tasks).read_text().splitlines() if l.strip()]
    if args.limit:
        tasks = tasks[: args.limit]

    llm = LLMClient()
    results = []
    for n, t in enumerate(tasks, 1):
        r = run_task(t["task_id"], t["prompt"], t["visible_tests"],
                     t["hidden_tests"], llm, k=args.k,
                     feedback_mode=args.mode, log_dir=args.out)
        results.append(r)
        print(f"[{n}/{len(tasks)}] {r.task_id}: initial="
              f"{'PASS' if r.initial_pass else 'FAIL'} final="
              f"{'PASS' if r.final_pass else 'FAIL'} iters={r.iterations_used}")

    total = len(results)
    initially_failing = [r for r in results if not r.initial_pass]
    repaired = [r for r in initially_failing if r.final_pass]
    cat_seen = collections.Counter(c for r in results for c in r.diagnoses_seen)
    cat_fixed = collections.Counter(
        c for r in repaired for c in set(r.diagnoses_seen))

    summary = {
        "mode": args.mode, "k": args.k, "model": llm.model, "tasks": total,
        "pass@1_before_repair": round(sum(r.initial_pass for r in results) / total, 4),
        "pass@1_after_repair": round(sum(r.final_pass for r in results) / total, 4),
        # THE Dou et al. comparator (their GPT-4 @ k=2 = 0.292):
        "repair_success_rate": round(len(repaired) / max(len(initially_failing), 1), 4),
        "initially_failing": len(initially_failing),
        "repaired": len(repaired),
        "per_category_seen": dict(cat_seen),
        "per_category_repair_rate": {
            c: round(cat_fixed[c] / cat_seen[c], 3) for c in cat_seen},
        "total_llm_calls": llm.total_calls,
        "total_prompt_tokens": llm.total_prompt_tokens,
        "total_completion_tokens": llm.total_completion_tokens,
    }
    Path(args.out).mkdir(parents=True, exist_ok=True)
    out = Path(args.out) / f"summary_{args.mode}_k{args.k}.json"
    out.write_text(json.dumps(summary, indent=2))
    print("\n" + json.dumps(summary, indent=2))
    print(f"\nSaved -> {out}")


if __name__ == "__main__":
    main()
