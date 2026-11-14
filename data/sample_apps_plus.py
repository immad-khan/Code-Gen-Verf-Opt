import json
import os
import random
import subprocess
import sys
import time

COMMIT_HASH = "7e6e10c47fceead83be7bd09b7ad81eb075b87ce"
RAW_FILE = "data/apps_plus_raw.json"
IDS_FILE = "data/apps_plus_ids.json"
SELECTED_FILE = "data/apps_plus_selected.jsonl"
REPLACEMENTS_FILE = "data/apps_plus_replacements.log"
TIMEOUT_SEC = 3 # Hard process timeout per problem

def validate_problem_subprocess(prob):
    script_path = os.path.abspath("C:/Users/Immad Ahmed/.gemini/antigravity/brain/e1ee168c-3f8f-41a6-8c46-ba08496cb45e/scratch/run_single_prob.py")
    try:
        proc = subprocess.run(
            [sys.executable, script_path],
            input=json.dumps(prob),
            text=True,
            capture_output=True,
            timeout=TIMEOUT_SEC
        )
        if proc.returncode == 0 and "PASS" in proc.stdout:
            return True, "PASS"
        else:
            err = proc.stdout.strip() or proc.stderr.strip() or f"Exited with code {proc.returncode}"
            return False, err
    except subprocess.TimeoutExpired:
        return False, f"TimeoutExpired (> {TIMEOUT_SEC}s)"
    except Exception as e:
        return False, f"Subprocess error: {e}"

def main():
    print(f"--> Loading APPS+ raw dataset from {RAW_FILE}...", flush=True)
    with open(RAW_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    print(f"Total problems loaded: {len(data)}", flush=True)
    
    tiers = {
        "introductory": [],
        "interview": [],
        "competition": []
    }
    
    for idx, prob in enumerate(data):
        prob["original_index"] = idx
        prob["problem_id"] = f"apps_plus_{idx:04d}"
        diff = prob.get("difficulty", "none")
        if diff in tiers:
            tiers[diff].append(prob)
            
    print("Problems per tier in raw dataset:", flush=True)
    for diff, probs in tiers.items():
        print(f"  - {diff}: {len(probs)} problems", flush=True)
        if len(probs) < 200:
            print(f"[FATAL] Tier '{diff}' has {len(probs)} problems, which is less than the required 200!", flush=True)
            sys.exit(1)
            
    rng = random.Random(42)
    selected_problems = []
    replacements_log = []
    
    for diff in ["introductory", "interview", "competition"]:
        print(f"\n--> Selecting and validating 200 '{diff}' problems (seed=42)...", flush=True)
        candidates = list(tiers[diff])
        rng.shuffle(candidates)
        
        tier_selected = []
        attempted = 0
        
        for cand in candidates:
            attempted += 1
            ok, msg = validate_problem_subprocess(cand)
            if ok:
                tier_selected.append(cand)
                if len(tier_selected) % 25 == 0:
                    print(f"    [{diff}] Validated {len(tier_selected)}/200 problems (attempted {attempted})...", flush=True)
                if len(tier_selected) == 200:
                    break
            else:
                log_entry = f"[{diff}] Dropped problem {cand['problem_id']} (orig_idx={cand['original_index']}): {msg}. Replaced with next in seed order."
                replacements_log.append(log_entry)
                print(f"    [DROP] {log_entry}", flush=True)
                
        if len(tier_selected) < 200:
            print(f"[FATAL] Could not validate 200 problems for tier '{diff}' (only {len(tier_selected)} passed)!", flush=True)
            sys.exit(1)
            
        print(f"  [OK] Successfully validated exactly 200 '{diff}' problems (attempted {attempted}, dropped {attempted - 200}).", flush=True)
        selected_problems.extend(tier_selected)
        
    print(f"\n=======================================================", flush=True)
    print(f"TOTAL SELECTED & VALIDATED: {len(selected_problems)} problems", flush=True)
    print(f"Total replacements logged: {len(replacements_log)}", flush=True)
    print(f"=======================================================", flush=True)
    
    ids_data = {
        "dataset": "APPS+",
        "source": "https://github.com/Ablustrund/APPS_Plus",
        "commit": COMMIT_HASH,
        "seed": 42,
        "target_per_tier": 200,
        "total_selected": len(selected_problems),
        "tiers": {
            "introductory": [p["problem_id"] for p in selected_problems if p["difficulty"] == "introductory"],
            "interview": [p["problem_id"] for p in selected_problems if p["difficulty"] == "interview"],
            "competition": [p["problem_id"] for p in selected_problems if p["difficulty"] == "competition"]
        }
    }
    
    with open(IDS_FILE, "w", encoding="utf-8") as f:
        json.dump(ids_data, f, indent=2)
    print(f"[SAVED] Problem IDs saved to {IDS_FILE}", flush=True)
    
    with open(SELECTED_FILE, "w", encoding="utf-8") as f:
        for p in selected_problems:
            f.write(json.dumps(p) + "\n")
    print(f"[SAVED] Selected problems saved to {SELECTED_FILE}", flush=True)
    
    with open(REPLACEMENTS_FILE, "w", encoding="utf-8") as f:
        f.write(f"APPS+ CANONICAL VALIDATION REPLACEMENTS LOG (Commit {COMMIT_HASH}, Seed 42)\n")
        f.write("="*70 + "\n\n")
        if not replacements_log:
            f.write("Zero replacements needed! All 600 initial candidates passed canonical validation.\n")
        else:
            for line in replacements_log:
                f.write(line + "\n")
    print(f"[SAVED] Replacements log saved to {REPLACEMENTS_FILE}", flush=True)

if __name__ == "__main__":
    main()
