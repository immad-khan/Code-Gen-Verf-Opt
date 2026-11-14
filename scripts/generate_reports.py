#!/usr/bin/env python3
"""
VeriFlow Baseline Reproduction Reporting Script (Dou et al., Sci China Inf Sci 2026)
Generates comprehensive CSV and Markdown reports from SQLite experiment storage:
1. Pass rates per benchmark (HumanEval+, MBPP+, APPS+ tiers) vs Paper R1 Targets
2. Bug distribution table (A.1 to C.4) with counts, frequencies, and resolution rates
3. Repair Success Rate (RSR): Overall and per primary type (All vs Fixed 120 sample)
4. Bug evolution matrix (R0 -> R1 -> R2 transition paths)
5. Code quality & complexity stats vs canonical solutions (LOC, radon cyclomatic complexity, API calls)
6. Token costs and latency analysis
"""

import sys
import os
import json
import sqlite3
import random
import csv
from typing import Dict, List, Any, Optional

try:
    from radon.complexity import cc_visit
except ImportError:
    cc_visit = None

PAPER_TARGETS = {
    "humaneval_plus": {"name": "HumanEval+", "target_r0": 93.3, "target_final": 93.3},
    "mbpp_plus": {"name": "MBPP+", "target_r0": 81.2, "target_final": 81.2},
    "apps_plus_intro": {"name": "APPS+ (Introductory)", "target_r0": 87.5, "target_final": 87.5},
    "apps_plus_interview": {"name": "APPS+ (Interview)", "target_r0": 66.7, "target_final": 66.7},
    "apps_plus_competition": {"name": "APPS+ (Competition)", "target_r0": 55.0, "target_final": 55.0},
    "apps_plus_total": {"name": "APPS+ (Total)", "target_r0": 71.2, "target_final": 71.2},
    "overall": {"name": "Overall Benchmark Total", "target_r0": 80.6, "target_final": 80.6},
}

TAXONOMY = [
    ("A", "A.1", "Incomplete syntax structure"),
    ("A", "A.2", "Incorrect indentation"),
    ("A", "A.3", "Undefined symbols (syntax-level)"),
    ("A", "A.4", "Other syntax errors"),
    ("B", "B.1", "API usage error"),
    ("B", "B.2", "Definition missing"),
    ("B", "B.3", "Boundary condition"),
    ("B", "B.4", "Input-output / argument mismatch"),
    ("B", "B.5", "Timeout / infinite loop"),
    ("B", "B.6", "Other runtime errors"),
    ("C", "C.1", "Misunderstanding and logic error"),
    ("C", "C.2", "Boundary and special condition"),
    ("C", "C.3", "Algorithmic / computational flaw"),
    ("C", "C.4", "Prompt constraint violation"),
]

def compute_code_metrics(code: str):
    lines = code.strip().splitlines()
    loc = len(lines)
    comment_lines = sum(1 for l in lines if l.strip().startswith("#"))
    comment_ratio = (comment_lines / loc * 100.0) if loc > 0 else 0.0
    
    cc_score = 1.0
    if cc_visit:
        try:
            blocks = cc_visit(code)
            if blocks:
                cc_score = sum(b.complexity for b in blocks) / len(blocks)
        except Exception:
            pass

    import ast
    api_calls = 0
    try:
        tree = ast.parse(code)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                api_calls += 1
    except Exception:
        pass

    return {
        "loc": loc,
        "cc": round(cc_score, 2),
        "comment_ratio": round(comment_ratio, 1),
        "api_calls": api_calls
    }

def analyze_run(db_path: str, run_id: Optional[str] = None, output_dir: str = "reports"):
    os.makedirs(output_dir, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    if not run_id:
        cursor.execute("SELECT run_id, created_at, model, mode, iterations, seed FROM experiment_runs ORDER BY created_at DESC LIMIT 1")
        run_row = cursor.fetchone()
        if not run_row:
            print(f"[ERROR] No experiment runs found in {db_path}")
            return
        run_id = run_row["run_id"]
    else:
        cursor.execute("SELECT run_id, created_at, model, mode, iterations, seed FROM experiment_runs WHERE run_id = ?", (run_id,))
        run_row = cursor.fetchone()

    print(f"--> Analyzing Experiment Run: {run_id}")
    model_name = run_row["model"] if run_row else "deepseek-reasoner"
    mode_name = run_row["mode"] if run_row else "dou"
    seed = run_row["seed"] if run_row else 42

    # Fetch problem runs
    cursor.execute("""
        SELECT problem_run_id, benchmark, problem_id, sub_tier, passed, passed_round,
               initial_bug_primary, initial_bug_sub, final_bug_primary, final_bug_sub,
               total_duration_ms, completed_at
        FROM problem_runs
        WHERE run_id = ?
    """, (run_id,))
    problems = [dict(row) for row in cursor.fetchall()]

    if not problems:
        print(f"[WARN] No problems recorded for run {run_id}.")
        return

    # Fetch problem rounds
    cursor.execute("""
        SELECT pr.problem_run_id, pr.round_number, pr.passed, pr.bug_primary, pr.bug_sub,
               pr.token_count, pr.duration_ms, pr.code_snapshot
        FROM problem_rounds pr
        JOIN problem_runs p ON pr.problem_run_id = p.problem_run_id
        WHERE p.run_id = ?
        ORDER BY pr.problem_run_id, pr.round_number
    """, (run_id,))
    rounds_by_prob: Dict[str, List[Dict[str, Any]]] = {}
    for r in cursor.fetchall():
        pid = r["problem_run_id"]
        rounds_by_prob.setdefault(pid, []).append(dict(r))

    # 1. PASS RATES PER BENCHMARK
    pass_rate_rows = []
    
    def calc_group_stats(group_problems):
        n = len(group_problems)
        if n == 0:
            return {"n": 0, "r0_pass": 0, "r0_rate": 0.0, "r1_pass": 0, "r1_rate": 0.0, "r2_pass": 0, "r2_rate": 0.0}
        r0_pass = sum(1 for p in group_problems if p["passed_round"] == 0)
        r1_pass = sum(1 for p in group_problems if p["passed"] and p["passed_round"] <= 1)
        r2_pass = sum(1 for p in group_problems if p["passed"] and p["passed_round"] <= 2)
        return {
            "n": n,
            "r0_pass": r0_pass,
            "r0_rate": (r0_pass / n) * 100.0,
            "r1_pass": r1_pass,
            "r1_rate": (r1_pass / n) * 100.0,
            "r2_pass": r2_pass,
            "r2_rate": (r2_pass / n) * 100.0
        }

    bm_groups = {
        "humaneval_plus": [p for p in problems if p["benchmark"] == "humaneval_plus"],
        "mbpp_plus": [p for p in problems if p["benchmark"] == "mbpp_plus"],
        "apps_plus_intro": [p for p in problems if p["benchmark"] == "apps_plus" and (p["sub_tier"] or "").lower() == "introductory"],
        "apps_plus_interview": [p for p in problems if p["benchmark"] == "apps_plus" and (p["sub_tier"] or "").lower() == "interview"],
        "apps_plus_competition": [p for p in problems if p["benchmark"] == "apps_plus" and (p["sub_tier"] or "").lower() == "competition"],
        "apps_plus_total": [p for p in problems if p["benchmark"] == "apps_plus"],
        "overall": problems
    }

    pass_rate_csv_data = []
    for key, group in bm_groups.items():
        stats = calc_group_stats(group)
        meta = PAPER_TARGETS.get(key, {"name": key, "target_r0": None, "target_final": None})
        target_r0 = meta["target_r0"]
        delta = (stats["r0_rate"] - target_r0) if target_r0 is not None and stats["n"] > 0 else None
        
        row = {
            "Benchmark": meta["name"],
            "Count (N)": stats["n"],
            "Pass@Round 0 (%)": round(stats["r0_rate"], 1),
            "Pass after Iter 1 (%)": round(stats["r1_rate"], 1),
            "Pass after Iter 2 (%)": round(stats["r2_rate"], 1),
            "Paper Target (R1) (%)": target_r0 if target_r0 is not None else "N/A",
            "Delta vs Paper (%)": f"{delta:+.1f}%" if delta is not None else "N/A"
        }
        pass_rate_csv_data.append(row)

    # Save pass_rates.csv
    pass_rate_csv_path = os.path.join(output_dir, "pass_rates.csv")
    with open(pass_rate_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(pass_rate_csv_data[0].keys()))
        writer.writeheader()
        writer.writerows(pass_rate_csv_data)

    # 2. BUG DISTRIBUTION TABLE (A.1 to C.4)
    total_probs = len(problems)
    failing_r0_probs = [p for p in problems if p["passed_round"] != 0]
    total_failing_r0 = len(failing_r0_probs)

    bug_dist_data = []
    for cat, code, name in TAXONOMY:
        init_count = sum(1 for p in problems if p.get("initial_bug_sub") == code or (p.get("initial_bug_primary") == cat and not p.get("initial_bug_sub")))
        final_count = sum(1 for p in problems if not p["passed"] and (p.get("final_bug_sub") == code or (p.get("final_bug_primary") == cat and not p.get("final_bug_sub"))))
        fixed_count = sum(1 for p in problems if p["passed"] and p["passed_round"] > 0 and (p.get("initial_bug_sub") == code or (p.get("initial_bug_primary") == cat and not p.get("initial_bug_sub"))))
        
        pct_fail = (init_count / total_failing_r0 * 100.0) if total_failing_r0 > 0 else 0.0
        pct_all = (init_count / total_probs * 100.0) if total_probs > 0 else 0.0
        res_rate = (fixed_count / init_count * 100.0) if init_count > 0 else 0.0

        bug_dist_data.append({
            "Category": cat,
            "Code": code,
            "Description": name,
            "Initial Count (R0)": init_count,
            "Initial % of Failures": f"{pct_fail:.1f}%",
            "Initial % of All Problems": f"{pct_all:.1f}%",
            "Final Unresolved (R2)": final_count,
            "Fixed Count": fixed_count,
            "Resolution Rate": f"{res_rate:.1f}%" if init_count > 0 else "N/A"
        })

    bug_dist_csv_path = os.path.join(output_dir, "bug_distribution.csv")
    with open(bug_dist_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(bug_dist_data[0].keys()))
        writer.writeheader()
        writer.writerows(bug_dist_data)

    # 3. REPAIR SUCCESS RATE (RSR)
    # Overall and per primary type (All vs Fixed 120 sample)
    def calc_rsr(prob_list):
        failing = [p for p in prob_list if p["passed_round"] != 0]
        if not failing:
            return {"failing_n": 0, "fixed_r1": 0, "rsr_r1": "N/A", "fixed_r2": 0, "rsr_r2": "N/A"}
        fixed_r1 = sum(1 for p in failing if p["passed"] and p["passed_round"] == 1)
        fixed_r2 = sum(1 for p in failing if p["passed"] and p["passed_round"] <= 2)
        n = len(failing)
        return {
            "failing_n": n,
            "fixed_r1": fixed_r1,
            "rsr_r1": f"{(fixed_r1 / n) * 100.0:.1f}%",
            "fixed_r2": fixed_r2,
            "rsr_r2": f"{(fixed_r2 / n) * 100.0:.1f}%"
        }

    # Sample of 120 failing problems (seed 42)
    random.seed(seed)
    sample_failing = list(failing_r0_probs)
    if len(sample_failing) > 120:
        sample_120 = random.sample(sample_failing, 120)
    else:
        sample_120 = sample_failing

    rsr_rows = [
        {"Cohort": "All Failing Problems (Overall)", **calc_rsr(problems)},
        {"Cohort": "Fixed 120 Failing Sample (Seed 42)", **calc_rsr(sample_120)},
        {"Cohort": "Type A (Syntax) Failures", **calc_rsr([p for p in problems if p.get("initial_bug_primary") == "A"])},
        {"Cohort": "Type B (Runtime) Failures", **calc_rsr([p for p in problems if p.get("initial_bug_primary") == "B"])},
        {"Cohort": "Type C (Logic) Failures", **calc_rsr([p for p in problems if p.get("initial_bug_primary") == "C"])},
    ]

    rsr_csv_path = os.path.join(output_dir, "repair_success_rate.csv")
    with open(rsr_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rsr_rows[0].keys()))
        writer.writeheader()
        writer.writerows(rsr_rows)

    # 4. BUG EVOLUTION MATRIX (Figure 7)
    # Track states: Passed, Type A, Type B, Type C
    states = ["Passed", "Type A", "Type B", "Type C"]
    evolution_matrix = {s_from: {s_to: 0 for s_to in states} for s_from in states}

    for p in problems:
        pid = p["problem_run_id"]
        pr_rounds = rounds_by_prob.get(pid, [])
        if not pr_rounds:
            continue
        # R0 state
        r0 = pr_rounds[0] if len(pr_rounds) > 0 else None
        r1 = pr_rounds[1] if len(pr_rounds) > 1 else None
        
        s0 = "Passed" if r0 and r0["passed"] else f"Type {r0['bug_primary']}" if r0 and r0.get("bug_primary") in ("A","B","C") else "Type B"
        if r1:
            s1 = "Passed" if r1["passed"] else f"Type {r1['bug_primary']}" if r1.get("bug_primary") in ("A","B","C") else "Type B"
        else:
            s1 = s0  # Unchanged if round 1 didn't run

        if s0 in evolution_matrix and s1 in evolution_matrix[s0]:
            evolution_matrix[s0][s1] += 1

    evo_csv_path = os.path.join(output_dir, "bug_evolution_matrix.csv")
    with open(evo_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["R0 \\ R1 Transition"] + states)
        for s_from in states:
            writer.writerow([s_from] + [evolution_matrix[s_from][s_to] for s_to in states])

    # 5. CODE STATS VS CANONICAL SOLUTION
    canonicals = {}
    for ds_path in ["data/humaneval_plus.jsonl", "data/mbpp_plus.jsonl", "data/apps_plus_selected.jsonl"]:
        if os.path.exists(ds_path):
            with open(ds_path, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        p_data = json.loads(line)
                        p_id = p_data.get("task_id") or p_data.get("problem_id")
                        c_code = p_data.get("canonical_solution") or p_data.get("code")
                        if p_id and c_code:
                            canonicals[p_id] = c_code
                    except Exception:
                        pass

    gen_locs, canon_locs = [], []
    gen_ccs, canon_ccs = [], []
    gen_apis, canon_apis = [], []
    gen_comms, canon_comms = [], []

    for p in problems:
        prob_id = p["problem_id"]
        canon_code = canonicals.get(prob_id, "")
        pr_rounds = rounds_by_prob.get(p["problem_run_id"], [])
        latest_code = pr_rounds[-1]["code_snapshot"] if pr_rounds else canon_code

        c_metrics = compute_code_metrics(canon_code) if canon_code else None
        g_metrics = compute_code_metrics(latest_code) if latest_code else None

        if g_metrics and c_metrics:
            gen_locs.append(g_metrics["loc"])
            canon_locs.append(c_metrics["loc"])
            gen_ccs.append(g_metrics["cc"])
            canon_ccs.append(c_metrics["cc"])
            gen_apis.append(g_metrics["api_calls"])
            canon_apis.append(c_metrics["api_calls"])
            gen_comms.append(g_metrics["comment_ratio"])
            canon_comms.append(c_metrics["comment_ratio"])

    def avg_val(lst):
        return round(sum(lst) / len(lst), 2) if lst else 0.0

    code_stats_summary = [
        {"Metric": "Lines of Code (LOC)", "Generated Mean": avg_val(gen_locs), "Canonical Mean": avg_val(canon_locs)},
        {"Metric": "Cyclomatic Complexity (radon cc)", "Generated Mean": avg_val(gen_ccs), "Canonical Mean": avg_val(canon_ccs)},
        {"Metric": "API / Function Calls", "Generated Mean": avg_val(gen_apis), "Canonical Mean": avg_val(canon_apis)},
        {"Metric": "Comment Ratio (%)", "Generated Mean": f"{avg_val(gen_comms)}%", "Canonical Mean": f"{avg_val(canon_comms)}%"}
    ]

    code_stats_csv_path = os.path.join(output_dir, "code_statistics.csv")
    with open(code_stats_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["Metric", "Generated Mean", "Canonical Mean"])
        writer.writeheader()
        writer.writerows(code_stats_summary)

    # 6. TOKEN & RESOURCE USAGE SUMMARY
    cursor.execute("""
        SELECT SUM(token_count) as total_tokens, AVG(token_count) as avg_tokens_per_round,
               SUM(duration_ms) as total_duration_ms, AVG(duration_ms) as avg_duration_per_round
        FROM problem_rounds
        JOIN problem_runs ON problem_rounds.problem_run_id = problem_runs.problem_run_id
        WHERE problem_runs.run_id = ?
    """, (run_id,))
    token_stats = dict(cursor.fetchone() or {})
    total_tok = token_stats.get("total_tokens") or 0
    avg_tok = token_stats.get("avg_tokens_per_round") or 0.0
    total_ms = sum(p["total_duration_ms"] for p in problems)
    avg_prob_ms = (total_ms / len(problems)) if problems else 0.0

    # Pricing for DeepSeek-R1 (deepseek-reasoner):
    # Standard: $0.55 / 1M prompt tokens (cache miss), $2.19 / 1M output tokens
    # Approximate split: 40% prompt, 60% generation+thinking
    prompt_tokens_est = int(total_tok * 0.40)
    completion_tokens_est = int(total_tok * 0.60)
    est_cost_usd = (prompt_tokens_est / 1_000_000 * 0.55) + (completion_tokens_est / 1_000_000 * 2.19)

    token_summary = [
        {"Metric": "Model Used", "Value": model_name},
        {"Metric": "Repair Mode", "Value": mode_name},
        {"Metric": "Total Problems Executed", "Value": len(problems)},
        {"Metric": "Total Rounds Executed", "Value": sum(len(v) for v in rounds_by_prob.values())},
        {"Metric": "Total Tokens Consumed", "Value": f"{total_tok:,}"},
        {"Metric": "Average Tokens / Problem", "Value": f"{(total_tok / len(problems)):,.1f}" if problems else "0"},
        {"Metric": "Estimated Total Cost (USD)", "Value": f"${est_cost_usd:.4f}"},
        {"Metric": "Total Execution Time", "Value": f"{total_ms / 1000.0:.2f} s ({total_ms / 60000.0:.2f} min)"},
        {"Metric": "Average Time / Problem", "Value": f"{avg_prob_ms / 1000.0:.2f} s"}
    ]

    token_csv_path = os.path.join(output_dir, "token_and_cost_summary.csv")
    with open(token_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["Metric", "Value"])
        writer.writeheader()
        writer.writerows(token_summary)

    # 6. GENERATE EXPERIMENT_REPORT.MD
    md_path = os.path.join(output_dir, "EXPERIMENT_REPORT.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# VeriFlow Baseline Reproduction Report\n\n")
        f.write(f"> **Reference Paper**: Dou et al., *\"What is wrong with your code generated by LLMs? An extensive study\"*, Sci China Inf Sci 2026, 69(1):112107.\n\n")
        f.write(f"- **Target Model**: `{model_name}`\n")
        f.write(f"- **Repair Mode**: `{mode_name}` (Exact Paper Baseline Figure 6, n=2 iterations, latest feedback only)\n")
        f.write(f"- **Execution Sandbox**: Docker Python 3.11 (`veriflow-sandbox:3.11`, `--network none`, `--memory 4g`, `:ro` tests)\n")
        f.write(f"- **Run ID**: `{run_id}`\n")
        f.write(f"- **Timestamp**: `{run_row['created_at'] if run_row else 'N/A'}`\n\n")
        
        f.write(f"## 1. Benchmark Pass Rates vs Paper DeepSeek-R1 Baseline\n\n")
        f.write(f"| Benchmark | Count (N) | Pass@Round 0 (%) | Pass after Iter 1 (%) | Pass after Iter 2 (%) | Paper Target (R1) | Delta vs Paper |\n")
        f.write(f"| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n")
        for row in pass_rate_csv_data:
            f.write(f"| {row['Benchmark']} | {row['Count (N)']} | {row['Pass@Round 0 (%)']}% | {row['Pass after Iter 1 (%)']}% | {row['Pass after Iter 2 (%)']}% | {row['Paper Target (R1) (%)']}% | {row['Delta vs Paper (%)']} |\n")
        f.write("\n\n")

        f.write(f"## 2. Bug Distribution & Resolution (Taxonomy A.1 to C.4)\n\n")
        f.write(f"| Cat | Code | Sub-Category Description | Initial Count (R0) | % of Failures | % of All Problems | Final Unresolved | Fixed | Resolution Rate |\n")
        f.write(f"| :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n")
        for row in bug_dist_data:
            f.write(f"| {row['Category']} | `{row['Code']}` | {row['Description']} | {row['Initial Count (R0)']} | {row['Initial % of Failures']} | {row['Initial % of All Problems']} | {row['Final Unresolved (R2)']} | {row['Fixed Count']} | {row['Resolution Rate']} |\n")
        f.write("\n\n")

        f.write(f"## 3. Repair Success Rate (RSR)\n\n")
        f.write(f"$$\\text{{RSR}} = \\frac{{\\text{{Fixed Problems}}}}{{\\text{{Initial Failing Problems}}}}$$\n\n")
        f.write(f"| Cohort | Failing Problems (N) | Fixed after Iter 1 | RSR after Iter 1 | Fixed after Iter 2 | RSR after Iter 2 |\n")
        f.write(f"| :--- | :---: | :---: | :---: | :---: | :---: |\n")
        for row in rsr_rows:
            f.write(f"| {row['Cohort']} | {row['failing_n']} | {row['fixed_r1']} | {row['rsr_r1']} | {row['fixed_r2']} | {row['rsr_r2']} |\n")
        f.write("\n\n")

        f.write(f"## 4. Bug Evolution Matrix (Figure 7: R0 -> R1 Transition)\n\n")
        f.write(f"| R0 State \\ R1 Destination | Passed | Type A (Syntax) | Type B (Runtime) | Type C (Logic) |\n")
        f.write(f"| :--- | :---: | :---: | :---: | :---: |\n")
        for s_from in states:
            f.write(f"| **{s_from}** | {evolution_matrix[s_from]['Passed']} | {evolution_matrix[s_from]['Type A']} | {evolution_matrix[s_from]['Type B']} | {evolution_matrix[s_from]['Type C']} |\n")
        f.write("\n\n")

        f.write(f"## 5. Code Quality & Complexity vs Canonical Solutions\n\n")
        f.write(f"| Code Metric | Generated Solutions (Mean) | Canonical Solutions (Mean) |\n")
        f.write(f"| :--- | :---: | :---: |\n")
        for row in code_stats_summary:
            f.write(f"| {row['Metric']} | {row['Generated Mean']} | {row['Canonical Mean']} |\n")
        f.write("\n\n")

        f.write(f"## 6. Resource Utilization & Token Costs\n\n")
        f.write(f"| Metric | Value |\n")
        f.write(f"| :--- | :--- |\n")
        for row in token_summary:
            f.write(f"| {row['Metric']} | {row['Value']} |\n")
        f.write("\n")

    print(f"--> Reports generated successfully in '{output_dir}/':")
    print(f"    - {pass_rate_csv_path}")
    print(f"    - {bug_dist_csv_path}")
    print(f"    - {rsr_csv_path}")
    print(f"    - {evo_csv_path}")
    print(f"    - {token_csv_path}")
    print(f"    - {md_path}")

if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else "data/experiments.db"
    r_id = sys.argv[2] if len(sys.argv) > 2 else None
    analyze_run(db, r_id)
