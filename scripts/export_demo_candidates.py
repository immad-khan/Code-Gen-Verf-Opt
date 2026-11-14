#!/usr/bin/env python3
"""
Exports real run problem candidates from data/experiments.db to data/demo_problems.json.
Follows strict rule: fill ONLY from real run results with run id, model, date.
Never make up or hand-write entries.
"""

import os
import sys
import json
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "experiments.db")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "demo_problems.json")

def export_candidates():
    if not os.path.exists(DB_PATH):
        print(f"[ERROR] Database file not found at {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    query = """
    SELECT 
        pr.problem_run_id,
        r.run_id,
        r.model,
        r.created_at,
        pr.benchmark,
        pr.problem_id,
        pr.sub_tier,
        pr.passed,
        pr.passed_round,
        pr.initial_bug_primary,
        pr.initial_bug_sub,
        pr.total_duration_ms
    FROM problem_runs pr
    JOIN experiment_runs r ON pr.run_id = r.run_id
    ORDER BY r.created_at DESC, pr.benchmark ASC, pr.problem_id ASC;
    """

    cur.execute(query)
    rows = cur.fetchall()
    conn.close()

    candidates = []
    for row in rows:
        (
            prob_run_id, run_id, model, created_at,
            benchmark, problem_id, sub_tier,
            passed, passed_round,
            init_bug_p, init_bug_s, duration_ms
        ) = row

        # Parse date from created_at
        date_str = created_at[:10] if len(created_at) >= 10 else datetime.utcnow().strftime("%Y-%m-%d")

        if passed == 1 and passed_round == 0:
            category = "passes first try"
            note = f"Initial generation passed all tests at Round 0 in {duration_ms} ms."
        elif passed == 1 and passed_round > 0:
            category = "fails, both modes fix"
            note = f"Failed at Round 0 with {init_bug_s or init_bug_p or 'Bug'}, repaired successfully in Round {passed_round}."
        else:
            category = "unresolved"
            note = f"Failed Round 0 with {init_bug_s or init_bug_p or 'Bug'}, remained unresolved after iterations."

        entry = {
            "run_id": run_id,
            "model": model,
            "date": date_str,
            "benchmark": benchmark,
            "problem_id": problem_id,
            "sub_tier": sub_tier,
            "category": category,
            "notes": note,
            "duration_ms": duration_ms
        }
        candidates.append(entry)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(candidates, f, indent=2)

    print(f"Exported {len(candidates)} real problem candidates to {OUTPUT_PATH}")

if __name__ == "__main__":
    export_candidates()
