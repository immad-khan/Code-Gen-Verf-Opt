# MACI Project Walkthrough — The Full Picture

## What MACI Is

**MACI** (Multi-Agent Code Intelligence) is a web-based tool that:
1. Takes a natural-language prompt from the user
2. Generates a full Python project (FastAPI + Pydantic + pytest) via an LLM
3. Verifies the generated code for correctness, security, and quality

It has a **React/Vite frontend** and a **C#/.NET backend**.

---

## Current Architecture

```mermaid
graph LR
    subgraph Frontend ["React + Vite (TypeScript)"]
        S1["Step 1: Prompt Input"]
        S2["Step 2: Code Output"]
        S3["Step 3: Verification Report"]
        AI["aiService.ts — LLM calls"]
        AN["analyzer.ts — Client-side analysis"]
    end
    subgraph Backend ["C# .NET Backend (port 5000)"]
        VC["VerificationController"]
        VS["VerificationService.cs (43 KB)"]
    end
    S1 -->|prompt| AI -->|generated code| S2 --> S3
    S2 -->|files[]| VC --> VS -->|VerificationResponse| S3
    S1 --> AN -->|findings, technique matrix| S3
```

### Frontend (3-step pipeline)

| Step | Component | What it does |
|------|-----------|-------------|
| 1 | [Step1Input.tsx](file:///d:/Desktop/MACI/src/components/Step1Input.tsx) | Textarea for NL prompt; sends to LLM via `aiService.ts` |
| 2 | [Step2CodeOutput.tsx](file:///d:/Desktop/MACI/src/components/Step2CodeOutput.tsx) | Shows generated files (tree view, source viewer, sandbox tab, agent logs) |
| 3 | [Step3Verification.tsx](file:///d:/Desktop/MACI/src/components/Step3Verification.tsx) | Full audit report: findings, technique matrix, security checklist, merge gate, radar chart, recommended tests, CI/CD YAML |

Supporting components: `Header`, `PipelineNav`, `ProcessingOverlay`, `ExportModal`, `ApiSettingsModal`, `PrintReport`, `VisualFileTree`, `PythonApiHarness`.

### Backend (C# .NET)

- [VerificationService.cs](file:///d:/Desktop/MACI/Backend/Services/VerificationService.cs) (43 KB) — the heavy lifter. Runs the 7 verification techniques (AST parsing, import checks, pytest, runtime analysis, mypy, radon, semgrep) against generated Python code.
- [VerificationController.cs](file:///d:/Desktop/MACI/Backend/Controllers/VerificationController.cs) — REST endpoint at `POST /api/verification`.
- [AiService.cs](file:///d:/Desktop/MACI/Backend/Services/AiService.cs) — server-side LLM proxy.

### Client-side analysis

[analyzer.ts](file:///d:/Desktop/MACI/src/analyzer.ts) (43 KB) performs a parallel client-side pass: pattern-based security scanning, style checks, and produces the `findings[]`, `techniqueMatrix[]`, and `securityChecklist[]` that populate the Step 3 report. This runs even if the backend is offline.

---

## The `files/` Folder — TIVR Research Framework

The `files/` directory contains a **complete research framework** called **TIVR** (Taxonomy-guided Iterative Verification and Repair). This is the academic/thesis component of the project.

### What TIVR is about

> **One-sentence thesis:** *Replace LLM self-critique with verified, taxonomy-grounded, evidence-backed feedback inside Dou et al.'s exact repair budget.*

Dou et al. (2026) built a 3-primary / 10-secondary bug taxonomy for LLM-generated code and repaired bugs via taxonomy-informed self-critique, reaching **29.2% repair success at k=2 iterations (GPT-4)**. TIVR's contribution is that the bug category is **machine-verified** (not self-guessed) using 7 verification techniques that produce concrete evidence.

### TIVR Pipeline

```
task spec → 1. GENERATOR (LLM) → candidate code
                    ↓
            2. VERIFIER (7 techniques, fail-fast)
                    ↓
            3. TAXONOMY MAPPER (signal → Dou category)
                    ↓
            4. FEEDBACK COMPOSER (category + evidence + hint)
                    ↓
            5. REPAIRER (same LLM) → new candidate → loop to 2 (max k=2)
                    ↓
            6. SCORER (hidden tests → pass@1, RSR)
            7. LOGGER (trajectories.jsonl)
```

### File Map

| File | Role | TIVR Stage |
|------|------|------------|
| [schemas.py](file:///d:/Desktop/MACI/files/schemas.py) | Data structures: `Finding`, `TaxonomyDiagnosis`, `VerificationReport` | Stage 2 output format |
| [verifier.py](file:///d:/Desktop/MACI/files/verifier.py) | 7 verification techniques in a fail-fast pipeline | Stage 2 |
| [taxonomy.py](file:///d:/Desktop/MACI/files/taxonomy.py) | Rule-based signal→Dou-category mapper | Stage 3 |
| [feedback.py](file:///d:/Desktop/MACI/files/feedback.py) | Composes repair prompts with diagnosis + evidence + hints; implements ablation modes | Stage 4 |
| [repair_loop.py](file:///d:/Desktop/MACI/files/repair_loop.py) | Bounded generate→verify→repair loop (k=2); LLM client; trajectory logging | Stages 1,5,6,7 |
| [run_benchmark.py](file:///d:/Desktop/MACI/files/run_benchmark.py) | CLI runner for HumanEval+/MBPP+/RWPB benchmarks; computes pass@1, RSR, per-category rates | Experiments |
| [DESIGN.md](file:///d:/Desktop/MACI/files/DESIGN.md) | Full system design document (12 sections) | Master plan |

### Dou Taxonomy (10 bug categories)

| ID | Primary | Secondary | Typical Signal |
|----|---------|-----------|----------------|
| S1 | Syntax Error | Syntax rule violation | `SyntaxError` |
| S2 | Syntax Error | Incomplete generation | Truncated/unclosed code |
| R1 | Runtime Error | Undefined name / reference | `NameError`, `UnboundLocalError` |
| R2 | Runtime Error | API misuse / hallucinated API | `ModuleNotFoundError`, `AttributeError` |
| R3 | Runtime Error | Type mismatch | `TypeError` |
| R4 | Runtime Error | Invalid value / index / key | `IndexError`, `KeyError`, `ZeroDivisionError` |
| F1 | Functional Error | Misunderstood requirement | ≥80% tests failing |
| F2 | Functional Error | Logic error | Assertion failures (some tests) |
| F3 | Functional Error | Missing edge case | Only boundary-named tests fail |
| F4 | Functional Error | Performance / non-termination | `Timeout`, `RecursionError` |

### Ablation Grid (the paper's main experiment table)

| ID | Condition | `--mode` flag |
|----|-----------|---------------|
| B0 | No repair (baseline) | k=0 |
| B1 | Generic execution feedback (Self-Debug-style) | `generic` |
| B2 | Taxonomy self-critique, no evidence (≈ Dou) | `taxonomy_only` |
| A1 | Evidence only, no taxonomy | `evidence_only` |
| **OURS** | **Verified taxonomy + evidence + hints** | `full` |

> If OURS > A1 and OURS > B2 → the contribution of *verified taxonomy mapping* is isolated. That comparison **is** the paper.

---

## How the Two Connect

The TIVR Python framework in `files/` is the **research-grade implementation** of the same verification pipeline that the C# backend already partially implements. Here's the mapping:

| TIVR Stage | Current Codebase Equivalent |
|---|---|
| `verifier.py` (7 techniques) | `Backend/Services/VerificationService.cs` (same 7 techniques, reimplemented in C#) |
| `taxonomy.py` (signal→category mapper) | **Not yet integrated** — the C# backend returns raw `CodeMetrics` but no taxonomy mapping |
| `feedback.py` (repair prompts) | **Not yet integrated** — `aiService.ts` does generation but no iterative repair loop |
| `repair_loop.py` (bounded repair) | **Not yet integrated** — the frontend does one-shot generation only |
| `run_benchmark.py` | **Standalone CLI** — designed to run against HumanEval+/MBPP+/RWPB benchmarks independently |
| `schemas.py` | `src/services/verificationService.ts` has parallel TypeScript interfaces (`VerificationResponse`, `CodeMetrics`) |

### What's already working
- ✅ Frontend 3-step pipeline (prompt → code → verification report)
- ✅ LLM code generation via Groq/OpenAI/Anthropic/Gemini
- ✅ Client-side static analysis (`analyzer.ts`)
- ✅ C# backend verification (7 techniques: AST, imports, pytest, runtime, mypy, radon, semgrep)
- ✅ Rich verification report UI (findings, technique matrix, security checklist, merge gate, export, print)

### What's missing / next steps (from DESIGN.md §11)

> [!IMPORTANT]
> The DESIGN.md lays out a **5-day build plan**. Here's what remains:

1. **Day 1:** Drop `tivr/` into the project as a Python package; wire the 7 technique bodies into `verifier.py` (or keep the reference implementations); run smoke tests on hand-written buggy snippets; **fix the taxonomy strings from Dou's actual paper** (mandatory — see the ⚠️ warning in taxonomy.py)
2. **Day 2:** Wire your LLM API key; run `run_benchmark.py` on 10 HumanEval+ tasks end-to-end; inspect the `trajectories.jsonl` to verify prompts look correct
3. **Day 3:** Build `tasks.jsonl` for full HumanEval+ and MBPP+; convert RWPB from Dou's artifact
4. **Day 4–5:** Full runs across all 5 ablation modes (B0, B1, B2, A1, OURS) at k∈{1,2}
5. **Week 2:** Per-category analysis, cost table, failure reading from trajectories, paper write-up

### Key design decisions to be aware of

> [!WARNING]
> **Two safety issues called out in DESIGN.md:**
> 1. **Technique 2 (imports):** `importlib.import_module()` *executes* the imported module's top-level code — use `importlib.util.find_spec()` instead (already fixed in `verifier.py`)
> 2. **Technique 4 (runtime):** Should not be a separate pytest pass — parse exception types from the *same* pytest output to distinguish `AssertionError` (wrong output → Functional) from real exceptions (crash → Runtime)

> [!NOTE]
> The `tivr_framework/tivr/` directory is a copy of the same Python files — it already has a `__pycache__/`, suggesting it has been run at least once.

---

## Summary

The project is a **two-layer system**:
- **Layer 1 (UI/Demo):** The React frontend + C# backend — a polished web app that generates and verifies Python code, producing a rich audit report.
- **Layer 2 (Research/Thesis):** The TIVR Python framework in `files/` — a standalone benchmark runner that implements the iterative verify→diagnose→repair loop needed to produce the experimental results for a paper extending Dou et al.'s work.

The gap is that **Layer 2 isn't wired into Layer 1 yet** — the taxonomy mapper, iterative repair loop, and ablation modes exist only in the Python framework, not in the web UI. The immediate next step from the DESIGN.md plan is to get the Python framework running standalone on benchmark tasks.
