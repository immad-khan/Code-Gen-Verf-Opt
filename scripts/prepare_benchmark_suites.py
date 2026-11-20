"""Build self-contained pytest suites from the pinned, trusted repository datasets.

Run offline after installing requirements-prepare.txt. Never run on user uploads:
EvalPlus expected outputs are computed by executing the trusted canonical code here,
not by shipping that code to the model or to the test runner.
"""
import argparse
import base64
import marshal
import zlib
import ast
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

# Comparison exceptions in EvalPlus 0.3.1, evalplus/eval/__init__.py.
COMPARE = '''
import base64
import marshal
import zlib
import hashlib
import math
import numpy as np
from solution import {entry} as candidate

inf, nan = math.inf, math.nan

def test_{entry}():
    cases = marshal.loads(zlib.decompress(base64.b85decode({cases})))
    for args, expected, hashed in cases:
        out = candidate(*args)
        if hashed:
            assert isinstance(out, str) and hashlib.sha256(out.encode()).digest() == expected
            continue
        {comparison}
'''


def plus_suite(row, dataset):
    from evalplus.data.mbpp import mbpp_deserialize_inputs
    from evalplus.eval._special_oracle import (
        MBPP_OUTPUT_NOT_NONE_TASKS, MBPP_OUTPUT_SET_EQ_TASKS,
        _digit_distance_nums, _surface_Area,
    )
    entry = row['entry_point']
    extra = row['plus_input']
    if row['task_id'] == 'Mbpp/793' and extra == {}:
        extra = []  # Pinned v0.1.0 has no extended cases for this task.
    inputs = row['base_input'] + extra
    if not inputs or not entry.isidentifier():
        raise ValueError(f"Invalid EvalPlus record: {row['task_id']}")
    code = row['canonical_solution']
    if dataset == 'mbpp_plus':
        inputs = mbpp_deserialize_inputs(row['task_id'], inputs)
    else:
        code = row['prompt'] + code
    scope = {}
    exec(code, scope)
    cases = []
    comparison = 'assert out == expected'
    for args in inputs:
        expected = scope[entry](*deepcopy(args))
        if dataset == 'mbpp_plus' and entry in MBPP_OUTPUT_NOT_NONE_TASKS:
            expected = expected is not None
            comparison = 'assert (out if isinstance(out, bool) else out is not None) == expected'
        elif dataset == 'mbpp_plus' and entry in MBPP_OUTPUT_SET_EQ_TASKS:
            comparison = 'assert set(out) == set(expected)'
        elif dataset == 'humaneval_plus' and entry == 'find_zero':
            comparison = f'assert abs(sum(c * out**i for i, c in enumerate(args[0]))) <= {row["atol"]!r}'
        elif dataset == 'mbpp_plus' and entry == 'are_equivalent':
            comparison = 'pass  # Official oracle accepts any non-raising return.'
        elif dataset == 'mbpp_plus' and entry == 'sum_div':
            comparison = 'assert out == expected or out == 0'
        elif dataset == 'mbpp_plus' and entry in ('surface_Area', 'digit_distance_nums'):
            alt = (_surface_Area if entry == 'surface_Area' else _digit_distance_nums)(*args)
            expected = (expected, alt)
            comparison = 'assert out in expected'
        else:
            comparison = ('if out != expected:\n'
                          f'            tol = {row["atol"]!r} or (1e-6 if isinstance(expected, float) or (isinstance(expected, (list, tuple)) and expected and all(isinstance(x, float) for x in expected)) else 0)\n'
                          '            assert tol and type(out) is type(expected) and np.shape(out) == np.shape(expected) and np.allclose(out, expected, rtol=1e-7, atol=tol)')
        if isinstance(expected, dict):
            expected = dict(expected)  # e.g. Counter is equal to its contents
        hashed = isinstance(expected, str) and len(expected) > 4096
        cases.append((args, hashlib.sha256(expected.encode()).digest() if hashed else expected, hashed))
    return COMPARE.format(entry=entry, cases=repr(base64.b85encode(zlib.compress(marshal.dumps(cases)))), comparison=comparison)


def literal(value):
    if isinstance(value, str):
        try:
            return ast.literal_eval(value)
        except (SyntaxError, ValueError):
            pass
    return value


def apps_suite(row):
    inputs, outputs = row['inputs'], row['outputs']
    if not inputs or len(inputs) != len(outputs):
        raise ValueError(f"Invalid APPS cases: {row['problem_id']}")
    entry = re.search(r'\bdef (\w+)\s*\(', row['starter_code']).group(1)
    if isinstance(inputs[0], list):
        cases = [([literal(arg) for arg in args], literal(expected[0])) for args, expected in zip(inputs, outputs, strict=True)]
        return f'from solution import {entry}\n\ndef test_{entry}():\n    for args, expected in {cases!r}:\n        assert {entry}(*args) == expected\n'
    # A fresh interpreter per case supports both top-level scripts and the dataset's named zero-argument wrappers.
    driver = f"import solution; fn = getattr(solution, '{entry}', None) or getattr(solution, 'main'); fn()"
    return f'''import subprocess
import sys

def test_stdio():
    for stdin, expected in {list(zip(inputs, outputs))!r}:
        run = subprocess.run([sys.executable, '-B', 'solution.py'], input=stdin, text=True, capture_output=True)
        if run.returncode == 0 and not run.stdout and expected.strip():
            run = subprocess.run([sys.executable, '-B', '-c', {driver!r}], input=stdin, text=True, capture_output=True)
        assert run.returncode == 0, run.stderr
        assert run.stdout.strip() == expected.strip()
'''


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path('data'))
    parser.add_argument('--task', action='append', help='Prepare just these task IDs (fixtures); default: all.')
    parser.add_argument('--tasks-out', type=Path, help='Also write a Task_Record JSONL for the paired TIVR runner.')
    datasets = ('humaneval_plus', 'mbpp_plus', 'apps_plus_selected')
    parser.add_argument('--dataset', choices=datasets, action='append')
    args = parser.parse_args(argv)
    out = args.data / 'suites-v1'
    out.mkdir(exist_ok=True)
    raw_paths = {(args.data / f'{name}.jsonl').resolve() for name in datasets}
    if args.tasks_out and args.tasks_out.resolve() in raw_paths:
        parser.error('Task_Record output must not overwrite a raw benchmark dataset')
    tasks_path = args.tasks_out.with_suffix('.tmp') if args.tasks_out else None
    if tasks_path:
        tasks_path.write_text('', encoding='utf8')
    for dataset in args.dataset or datasets:
        for line in (args.data / f'{dataset}.jsonl').read_text().splitlines():
            digest = hashlib.sha256(line.encode()).hexdigest()
            row = json.loads(line)
            if args.task and (row.get('task_id') or row.get('problem_id')) not in args.task:
                continue
            suite = apps_suite(row) if dataset.startswith('apps') else plus_suite(row, dataset)
            compile(suite, '<suite>', 'exec')
            path = out / f'{digest}.py'
            tmp = path.with_suffix('.tmp')
            tmp.write_text(suite, encoding='utf8')
            tmp.replace(path)
            if tasks_path:
                task = {'task_id': row.get('task_id') or row['problem_id'], 'prompt': row['prompt'], 'hidden_tests': suite}
                with tasks_path.open('a', encoding='utf8') as stream:
                    stream.write(json.dumps(task) + '\n')
        print(f'Prepared {dataset}', flush=True)
    if tasks_path:
        tasks_path.replace(args.tasks_out)


if __name__ == '__main__':
    main()
