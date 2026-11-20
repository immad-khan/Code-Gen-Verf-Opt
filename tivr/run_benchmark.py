"""Generate once, freeze a seeded failing cohort, then repair against a fixed oracle."""
from __future__ import annotations

from dataclasses import asdict
import json
import os

from .cache import build_cache, load_cache_for_run, make_entry, write_cache
from .config import parse_config
from .extract import extract
from .llm_client import client_from_env
from .metrics import ProgramOutcome, build_summary
from .prompts import build_repair_prompt, dou_feedback, generation_prompt, lesson_from, render
from .rundir import Manifest, Redactor, RunDir, generate_run_id, sha256_file
from .sampling import select_repair_sample
from .taxonomy import primary_state
from .verifier import ProjectVerifier


def read_tasks(path):
    tasks = {}
    for line in path.read_text(encoding='utf8').splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if not all(isinstance(row.get(k), str) and row[k].strip() for k in ('task_id', 'prompt', 'hidden_tests')):
            raise ValueError('Expected task_id, prompt and non-empty hidden_tests; raw benchmark inputs are not executable suites.')
        if row['task_id'] in tasks:
            raise ValueError(f"Duplicate task: {row['task_id']}")
        tasks[row['task_id']] = row
    if not tasks:
        raise ValueError('Empty benchmark')
    return tasks


def run(cfg):
    tasks = read_tasks(cfg.dataset)
    digest = sha256_file(cfg.dataset)
    client = client_from_env(cfg.decoding, model=cfg.model, mock=cfg.mock, retries=cfg.llm_retries)
    verifier = ProjectVerifier()
    run_id = cfg.run_id or generate_run_id(cfg.mode, cfg.feedback_regime)
    rd = RunDir.create(cfg.runs_root, run_id, Redactor(os.getenv('TIVR_API_KEY')))
    manifest = Manifest.start(rd, cfg, dataset_sha256=digest, task_count=len(tasks),
                              api_host=client.api_host, taxonomy_version=verifier.definition.version)

    def score(task, code, fenced):
        report = verifier.verify_candidate(code, task['hidden_tests'], had_code_block=fenced)
        if not report.complete() or (report.gate_passed() and not report.tests_passed):
            raise RuntimeError(f"No complete benchmark verdict for {task['task_id']}")
        return report

    try:
        if cfg.generation_cache:
            cache = load_cache_for_run(cfg.generation_cache, cfg, dataset_sha256=digest)
            entries = cache['entries']
            if cache['taxonomy_version'] != verifier.definition.version or sorted(e['task_id'] for e in entries) != sorted(tasks):
                raise ValueError('Cache taxonomy or task IDs do not match the benchmark')
            path = cfg.generation_cache
        else:
            entries = []
            for i, task in enumerate(tasks.values()):
                rd.write_progress('generation', i, len(tasks))
                prompt = generation_prompt(cfg.generation_prompt_style, task)
                raw = client.chat(prompt, phase='generation')
                candidate = extract(raw)
                report = score(task, candidate.code, candidate.had_code_block)
                entries.append(make_entry(task_id=task['task_id'], prompt=prompt, raw_response=raw,
                                          code=candidate.code, had_code_block=candidate.had_code_block,
                                          usage=asdict(client.calls[-1]), hidden={'passed': report.gate_passed(),
                                          'state': primary_state(report)[0]}))
            path = write_cache(rd, build_cache(cfg, dataset_sha256=digest, taxonomy_version=verifier.definition.version, entries=entries))
        manifest.set_generation_cache(path, sha256_file(path), bool(cfg.generation_cache))
        by_id = {entry['task_id']: entry for entry in entries}
        ids = select_repair_sample((e['task_id'] for e in entries if not e['hidden']['passed']), cfg.sample_size, cfg.seed)
        manifest.record_sample(requested=cfg.sample_size, actual=len(ids), seed=cfg.seed, cache_dataset_sha256=digest, task_ids=ids)
        outcomes = []
        for i, task_id in enumerate(ids):
            rd.write_progress('repair', i, len(ids))
            task, entry = tasks[task_id], by_id[task_id]
            code = entry['code']
            hidden = score(task, code, entry['had_code_block'])
            if hidden.gate_passed():
                raise RuntimeError(f'Cached failure not reproducible: {task_id}')
            state, unmapped = primary_state(hidden)
            states, flags, history = [state], [unmapped], []
            category = hidden.diagnoses[0].category if hidden.diagnoses else 'UNMAPPED'
            visible = task.get('visible_tests', '')
            for iteration in range(1, cfg.k + 1):
                feedback = hidden if cfg.feedback_regime == 'dou' else verifier.verify_candidate(code, visible, suite='visible')
                if cfg.feedback_regime == 'strict' and feedback.gate_passed():
                    break
                if cfg.mode in ('intervenor', 'dou_intervenor'):
                    teacher = render('intervenor_teacher', {'prompt': task['prompt'], 'solution': code, 'error log': dou_feedback(feedback)})
                    if cfg.mode == 'dou_intervenor':
                        teacher += '\n' + verifier.definition.checklist_text()
                    advice = client.chat(teacher, phase='repair')
                    prompt = render('intervenor_student', {'prompt': task['prompt'], 'solution': code, 'suggestions': advice})
                else:
                    prompt = build_repair_prompt(cfg.mode, task, code, feedback, iteration, cfg.k, history)
                raw = client.chat(prompt, phase='repair')
                candidate = extract(raw)
                code = candidate.code
                hidden = score(task, code, candidate.had_code_block)
                state, unmapped = primary_state(hidden)
                states.append(state)
                flags.append(unmapped)
                rd.append_trajectory({'task_id': task_id, 'iteration': iteration, 'prompt': prompt,
                                      'raw_response': raw, 'code': code, 'hidden': hidden.to_dict()})
                if hidden.gate_passed():
                    break
                history.append(lesson_from(feedback, iteration))
            outcome = ProgramOutcome(task_id, tuple(states), category, tuple(flags), len(states)-1,
                                     empty_visible_suite=not visible.strip())
            outcomes.append(outcome)
            rd.append_program(outcome.to_dict())
        summary = build_summary(outcomes, entries, client.calls, cfg, run_id=run_id, definition=verifier.definition,
                                dataset_sha256=digest, api_host=client.api_host)
        rd.write_summary(summary)
        rd.write_progress('done', len(ids), len(ids))
        manifest.finish()
        rd.print(f'Saved {cfg.llm_mode} results to {rd.root}')
    except (Exception, KeyboardInterrupt) as exc:
        manifest.terminate('interrupted' if isinstance(exc, KeyboardInterrupt) else 'error', str(exc))
        raise


if __name__ == '__main__':
    run(parse_config())
