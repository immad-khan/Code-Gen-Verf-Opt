# Running a paper-aligned comparison

**Separate three results:** the web workbench gives evidence for one program; the C# Docker runner records benchmark rounds in SQLite; `tivr.run_benchmark` is the paired-cohort experiment CLI. An improvement in static findings is not a repaired program. The 29.2% in Dou et al. Table 6 is **their GPT-4 result (35/120)**, not a target for an arbitrary single run.

## Prepare once (Python 3.11)

From the repository root, using an isolated environment:

```sh
python -m pip install -r requirements-prepare.txt
PYTHONHASHSEED=0 python scripts/prepare_benchmark_suites.py --tasks-out /tmp/paper-tasks.jsonl
```

Use only the trusted, checked-in dataset records: the preparation step executes the reference implementations offline. It builds all 164 + 399 + 600 suites in `data/suites-v1/`, keyed by the SHA-256 of the original JSONL line. These generated assets are intentionally not versioned. A missing suite is an error, never a fallback to a few base assertions. There are no model calls in preparation. To prepare only the .NET integration fixtures, add `--task HumanEval/0 --task apps_plus_0581 --task apps_plus_5341`.

The two C# paths now load the same pytest source. EvalPlus cases use expected outputs from **all** supplied base and Plus inputs (including the special return-value oracles). The pinned Mbpp/793 record contains zero extended inputs. APPS+ function tasks compare returns, while script tasks compare stdout. A pytest function may cover many inputs: the UI's pytest count is **not** the number of benchmark cases. Per-run process limits and the workbench's extra checks are not the paper's original evaluation environment.

For the deployed picker, point the backend at the same prepared `data/` (e.g. read-only mount `/app/data`) and build the UI with `VITE_ENABLE_BENCHMARKS=true`. The normal custom-prompt flow does not require the datasets. Run generated code only in an isolated worker/environment: the Python runner and the ASP.NET verification pipeline use local subprocesses, not a security boundary.

## Compare on the same initially incorrect programs

```sh
# Offline wiring test, never include mock results in model comparisons:
python -m tivr.run_benchmark test_tasks.jsonl --mock --run-id smoke --runs-root /tmp/tivr-runs

# Live: configure TIVR_API_KEY and TIVR_MODEL in the runner environment first.
python -m tivr.run_benchmark /tmp/paper-tasks.jsonl --mode dou --feedback-regime dou --k 2 --sample-size 120 --seed 42 --run-id baseline
python -m tivr.run_benchmark /tmp/paper-tasks.jsonl --mode dou_no_bt --feedback-regime dou --k 2 --sample-size 120 --seed 42 --generation-cache runs/baseline/generation_cache.json --run-id without-taxonomy
```

Use new run IDs on subsequent runs. Keep the dataset, cache, model/version, decoding settings, seed, and feedback regime fixed. The manifest records the selected IDs **before** repair. The summary counts initially failing **programs** that reach PASS within the budget, carrying forward earlier successes; no eligible programs means no measurable RSR. `strict` is a separate visible-feedback experiment and needs visible tests; the prepared paper-task export supplies the hidden benchmark oracle for `dou`. A small cohort is a pilot. Do not report a mock run, a canonical smoke check, or a run with missing model evidence as model accuracy.

## Validate changes

```sh
npm ci && npm run typecheck && npm test && npm run build
python -m pip install -r requirements-dev.txt
python -m pytest -q
dotnet test VeriFlow.slnx  # .NET 10; prepare the integration fixtures first
```

The mounted UI uses `src/App.tsx` and `src/services/`. The separate `src/components/experiments`, session inspector and `src/api/endpoints.ts` are prototype interfaces, **not shipped server routes**. Run batch experiments with the CLI, not those prototype screens. This workflow does not reproduce expert annotation, RWPB, or a nine-model study by itself.

Provider keys are no longer synced to an account by email. If you used an older deployment, rotate previously stored provider keys and purge the legacy credential columns/backups according to your retention policy.
