# TIVR — Taxonomy-guided Iterative Verification and Repair
### System design for extending Dou et al. (Sci China Inf Sci, 2026)

## 1. Thesis — what exactly you are extending

Dou et al. built the bug taxonomy (3 primary / 10 secondary), showed LLM code fails often, and repaired with **taxonomy-informed self-critique prompts**, reaching **29.2% repair success at 2 iterations (GPT-4)**. Their feedback is what the *model believes* about its own bug. Olausson et al. (ICLR 2024) proved self-generated feedback is the bottleneck of self-repair.

**TIVR's delta:** the bug category is no longer self-guessed — it is **machine-verified**. Seven verification techniques produce concrete evidence (tracebacks, failing asserts, unresolved imports), a rule-based mapper assigns the Dou taxonomy category from that evidence, and the repair prompt delivers *category + evidence + category-specific fix guidance*. Same single agent, same 2-iteration budget as Dou → direct head-to-head, where every gain is attributable to feedback quality.

One sentence for the paper: *"We replace self-critique with verified, taxonomy-grounded, evidence-backed feedback inside Dou et al.'s exact repair budget."*

## 2. Architecture

```
                       ┌────────────────────────────────────────────┐
                       │                 TIVR pipeline               │
 task spec ──────────► │ 1 GENERATOR (LLM) ── candidate code         │
 (+ visible tests)     │        │                                    │
                       │        ▼                                    │
                       │ 2 VERIFIER  (your 7 techniques, fail-fast)  │
                       │    syntax → imports → pytest+runtime →      │
                       │    mypy → radon → semgrep                   │
                       │        │  VerificationReport (JSON)         │
                       │        ▼                                    │
                       │ 3 TAXONOMY MAPPER (rules: signal→Dou cat.)  │
                       │        │  diagnoses + repair priority       │
                       │        ▼                                    │
                       │ 4 FEEDBACK COMPOSER (category+evidence+hint)│
                       │        │  repair prompt                     │
                       │        ▼                                    │
                       │ 5 REPAIRER (same LLM) ── new candidate ──►──┤
                       │        loop back to 2, at most k=2 times    │
                       └────────┬───────────────────────────────────┘
                                ▼
                       6 SCORER: hidden tests only → pass@1, RSR
                       7 LOGGER: trajectories.jsonl (every prompt,
                         code, report — your paper's qualitative data)
```

File map: `schemas.py` (2's output format) · `verifier.py` (2) · `taxonomy.py` (3) · `feedback.py` (4) · `repair_loop.py` (1,5,6,7) · `run_benchmark.py` (experiments).

## 3. Where your existing code plugs in

Your seven techniques are the stage bodies of `verifier.py`. Each `_stage_*` method there is a compact reference implementation with the same contract (`-> list[Finding]`, metrics via `self.metrics`). Keep mine or paste yours in — the orchestration is what matters. Two corrections to your current implementation:

1. **Technique 2 safety bug:** `importlib.import_module()` *executes* the imported module's top-level code — with LLM-generated imports that is arbitrary code execution inside your process. Use `importlib.util.find_spec()` (resolves without executing), as in `verifier.py`.
2. **Technique 4 coupling:** runtime-error detection should not be a separate pytest pass; parse exception types out of the *same* pytest output (one subprocess, half the runtime), distinguishing `AssertionError` (wrong output → Functional) from real exceptions (crash → Runtime). This distinction is exactly what the taxonomy mapper needs.

## 4. Verification mechanism — the spec

**Ordering + fail-fast.** Syntax first: if it fails, stop (every other tool would re-report the same break, and mixed feedback confuses the repairer). Imports second: if unresolved, *skip pytest* (it would fail with ImportError noise) but still run mypy/radon/semgrep (static). Then pytest+runtime, then the static trio.

**Severity policy** (in `schemas.py`):
| severity | sources | effect |
|---|---|---|
| blocking | syntax fail, unresolved import, failing test, runtime crash, timeout | drives the repair loop; defines FAIL |
| major | mypy errors, semgrep ERROR | reported, does **not** gate pass@1 (keeps comparability with Dou) |
| advisory | radon rank < B, MI < 65, semgrep WARNING/INFO | reported only |

**Sandboxing.** Generated code never runs in-process. pytest in a subprocess, temp dir, 60 s hard timeout (timeout itself is a blocking finding → maps to F4 non-termination). For anything beyond benchmarks: `docker run --network=none --memory=512m --cpus=1`.

**Feedback hygiene.** Max 3 findings per stage into the prompt, evidence trimmed to 20 lines (head + tail). More evidence ≠ better repair — Olausson's result is precisely that feedback quality, not quantity, is the limit.

## 5. Output — the VerificationReport

Everything downstream consumes this JSON; nothing re-parses tool output.

```json
{
  "verdict": "FAIL",
  "iteration": 0,
  "findings": [
    {"technique": "runtime", "severity": "blocking",
     "signal": "runtime:TypeError:test_mixed_types",
     "message": "test_mixed_types failed with TypeError",
     "evidence": "def test_mixed_types():\n>  assert merge([1,'2'])...\nE  TypeError: '<' not supported between 'str' and 'int'",
     "location": "", "taxonomy_id": "R3"}
  ],
  "diagnoses": [
    {"taxonomy_id": "R3", "primary": "Runtime Error",
     "secondary": "Type mismatch", "confidence": 0.85,
     "evidence_summary": "test_mixed_types failed with TypeError",
     "repair_hint": "An operation receives an incompatible type...",
     "source_signals": ["runtime:TypeError:test_mixed_types"]}
  ],
  "repair_priority": ["R3"],
  "metrics": {"tests_passed": 4, "tests_failed": 1, "cc_worst": 5,
              "cc_rank": "A", "mi": 78.2, "mi_rank": "A", "loc": 22,
              "comment_ratio": 0.09, "api_count": 3},
  "timing": {"syntax": 0.001, "imports": 0.004, "tests": 1.92,
             "types": 2.1, "quality": 0.03, "security": 4.8}
}
```

## 6. Taxonomy mapping (the novelty — `taxonomy.py`)

Rule table (first match wins): SyntaxError-truncated→S2 · any syntax→S1 · ModuleNotFound→R2 · Attribute/ImportError→R2 · Name/UnboundLocal→R1 · TypeError→R3 · Index/Key/Value/ZeroDivision→R4 · Timeout/Recursion→F4 · plain AssertionError→F2, then refined: ≥80% of tests failing→F1 (misunderstood requirement), only boundary-named tests failing→F3 (missing edge case). Repair priority: structural before semantic (S→R→F).

⚠️ **Before any experiment:** open Dou et al.'s taxonomy figure and replace my best-effort `primary`/`secondary` strings with the paper's exact 3+10 names. IDs and rules don't change — only display strings. This is a 15-minute task and it is mandatory: your paper claims to use *their* taxonomy.

## 7. Feedback composer (`feedback.py`)

The repair prompt = task + current code + **verified diagnosis** (category, confidence) + **evidence** (trimmed traceback/assert) + **category-specific hint** + one-line **lesson memory** from the previous failed iteration (Reflexion, minimal form) + strict output-format instruction. `feedback_mode` switches implement the ablations below with zero extra code.

## 8. Repair loop (`repair_loop.py`)

Single agent, temperature 0, budget **k=2** (Dou's setting). Loop: verify → if blocking findings and budget left → compose → repair → re-verify. Model-agnostic client (env vars) → run the same experiment on DeepSeek-chat (cheap), Qwen2.5-Coder via Ollama (free), and one GPT-class model if budget allows.

## 9. Evaluation protocol — how you beat 29.2% *credibly*

**Test split (non-negotiable):** `visible_tests` (docstring examples) drive the loop; `hidden_tests` (EvalPlus-extended suites / held-out RWPB tests) do the scoring and are never shown to the model. Check what Dou fed their repair prompts and mirror it for the head-to-head run.

**Benchmarks:** RWPB (the head-to-head; get it from Dou's artifact), HumanEval+ and MBPP+ via `pip install evalplus` for generality and leakage-aware scoring.

**Metrics:** pass@1 before repair; pass@1 after k=1 and k=2; **Repair Success Rate** = repaired / initially-failing (the 29.2% comparator); per-taxonomy-category RSR (a table Dou has and you can beat per-cell); tokens + LLM calls per solved task (your cost-frontier argument vs multi-agent).

**Conditions (the ablation grid = the paper's Table of record):**
| id | condition | run flag |
|---|---|---|
| B0 | no repair | k=0 |
| B1 | generic execution feedback (Self-Debug-style) | `--mode generic` |
| B2 | taxonomy self-critique, no evidence (≈ Dou) | `--mode taxonomy_only` |
| A1 | evidence only, no taxonomy | `--mode evidence_only` |
| OURS | verified taxonomy + evidence + hints | `--mode full` |

If OURS > A1 and OURS > B2, you have isolated the contribution of *verified taxonomy mapping* — that comparison **is** the paper.

## 10. Reading list — time-boxed, extraction-targeted (~8 h total)

1. **Dou et al.** re-read, 2–3 h: exact taxonomy names (→ `taxonomy.py`), their repair prompt text (→ B2 baseline verbatim), RWPB construction + artifact link, what their repair prompt contained (test results or not — decides your head-to-head config).
2. **Olausson et al., ICLR 2024**, 1.5 h: intro + feedback-quality experiments. Gives you the motivation paragraph and the pass@t-style cost accounting.
3. **Self-Debug (Chen et al.)**, 1 h: Section on feedback formats + ablation — evidence that unit-test feedback > simple feedback justifies your evidence block; their numbers are your B1 sanity check.
4. **Reflexion**, 30–45 min: skim the memory mechanism; you implement the minimal version (`lesson_from`).
5. **EvalPlus**, 30 min docs > paper: install, dump HumanEval+/MBPP+ tests.
6. **CodeT**, 1 h — *only for v2* (self-generated visible tests when no examples exist; removes the oracle assumption entirely, a strong future-work/extra section).
7. **LDB**, optional v2: block-level traces as richer evidence.

These are simultaneously your SLR Tier-1 queue — every hour here fills both the tool and the extraction sheets.

## 11. Build order (you're short on time)

* **Day 1:** drop `tivr/` into your project; swap your 7 technique bodies into `verifier.py` (or keep mine); run the smoke test on hand-written buggy snippets; fix the taxonomy strings from Dou's paper.
* **Day 2:** wire your LLM key; run `run_benchmark.py` on 10 HumanEval+ tasks end-to-end; read the trajectories JSONL — verify the prompts look right.
* **Day 3:** build `tasks.jsonl` for full HumanEval+ and MBPP+; convert RWPB from Dou's artifact.
* **Day 4–5:** full runs, `--mode full` and the four ablation modes, k∈{1,2}.
* **Week 2:** per-category analysis, cost table, failure reading (trajectories), write-up. The results tables map one-to-one onto your SLR's Gap 1–4 claims.

## 12. Trade-offs and threats (state these in the paper)

* **Rule-based mapper vs LLM classifier:** rules are deterministic, free, auditable — but coarse for functional bugs (F1/F2/F3 separation is heuristic). Mitigation: report mapper confusion against a 30-sample manual labeling; an LLM-as-mapper is an ablation, not the default (it would reintroduce the self-assessment bottleneck).
* **Visible-test dependence:** with few docstring examples the loop signal is weak — exactly the CodeT v2 upgrade path.
* **Sandbox:** subprocess+timeout is fine for benchmark code; anything internet-sourced needs the Docker jail.
* **Comparability:** any deviation from Dou's repair-prompt information content must be declared; that's why B2 replicates their prompt verbatim.
