"""Regression tests covering the executable entry points, not just their DTOs."""
import json
from pathlib import Path
import subprocess
import sys

import pytest

from scripts.generate_reports import analyze_run
from scripts.prepare_benchmark_suites import apps_suite, plus_suite
from tivr.config import build_config
from tivr.run_benchmark import run

ROOT = Path(__file__).resolve().parents[2]


def test_missing_model_rounds_cannot_be_published(tmp_path):
    with pytest.raises(ValueError, match='Round 0 snapshot'):
        analyze_run(str(ROOT / 'data/experiments.db'), 'deepseek-reasoner_dou_42_20261113_031237', str(tmp_path))
    assert not list(tmp_path.iterdir())


def test_mock_run_and_paired_ablation(tmp_path):
    dataset = tmp_path / 'tasks.jsonl'
    dataset.write_text(json.dumps({'task_id': 'example', 'prompt': 'def twice(x):',
                                   'hidden_tests': 'from solution import twice\ndef test_twice(): assert twice(12) == 24'}))
    args = [str(dataset), '--runs-root', str(tmp_path), '--mock', '--k', '1']
    run(build_config(args + ['--run-id', 'control']))
    run(build_config(args + ['--run-id', 'ablation', '--mode', 'dou_no_bt', '--generation-cache', str(tmp_path/'control/generation_cache.json')]))
    manifests = [json.loads((tmp_path / name / 'manifest.json').read_text()) for name in ['control', 'ablation']]
    assert all(m['completed'] and m['llm_mode'] == 'mock' for m in manifests)
    assert manifests[0]['repair_sample']['task_ids'] == manifests[1]['repair_sample']['task_ids'] == ['example']


def exercise(tmp_path, suite, code):
    (tmp_path/'test_solution.py').write_text(suite)
    (tmp_path/'solution.py').write_text(code)
    # Execute the single generated test rather than importing the repository's tests.
    return subprocess.run([sys.executable, '-B', '-c', "import test_solution as t; next(v for k,v in vars(t).items() if k.startswith('test_'))()"], cwd=tmp_path).returncode


def test_apps_function_and_stdio(tmp_path):
    for stdin in (False, True):
        record = dict(starter_code='def f(x):', inputs=['5\n'] if stdin else [[5]], outputs=['6\n'] if stdin else [[6]])
        suite = apps_suite(record)
        code = 'def f(): print(int(input())+1)' if stdin else 'def f(x): return x+1'
        assert exercise(tmp_path, suite, code) == 0
        assert exercise(tmp_path, suite, code.replace('+1', '+2')) != 0


def test_plus_only_failure(tmp_path):
    pytest.importorskip('evalplus.data.mbpp')  # optional offline preparation dependency
    record = dict(task_id='HumanEval/fixture', entry_point='f', prompt='def f(x):\n', canonical_solution='    return x',
                  base_input=[[1]], plus_input=[[2]], atol=0)
    suite = plus_suite(record, 'humaneval_plus')
    assert exercise(tmp_path, suite, 'def f(x): return x') == 0
    assert exercise(tmp_path, suite, 'def f(x): return 1') != 0
