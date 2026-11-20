"""Smoke-check *prepared* suites against trusted canonical programs, never model results."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path('data'))
    parser.add_argument('--task', action='append')
    parser.add_argument('--timeout', type=int, default=60)
    args = parser.parse_args()
    seen, failed = set(), []
    for dataset in ('humaneval_plus', 'mbpp_plus', 'apps_plus_selected'):
        for line in (args.data / f'{dataset}.jsonl').read_text().splitlines():
            row = json.loads(line)
            task = row.get('task_id') or row['problem_id']
            if args.task and task not in args.task:
                continue
            seen.add(task)
            suite = args.data / 'suites-v1' / (sha256(line.encode()).hexdigest() + '.py')
            code = (row['prompt'] if dataset == 'humaneval_plus' else '') + row['canonical_solution']
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'solution.py').write_text(code, encoding='utf8')
                (root / 'test_solution.py').write_bytes(suite.read_bytes())
                try:
                    res = subprocess.run([sys.executable, '-B', '-m', 'pytest', '-q', '--tb=line', 'test_solution.py'],
                                         cwd=root, timeout=args.timeout, capture_output=True, text=True)
                    if res.returncode:
                        failed.append(task)
                        print(task, res.stdout[-500:], flush=True)
                except subprocess.TimeoutExpired:
                    failed.append(task)
                    print(task, 'timeout', flush=True)
    if args.task and set(args.task) - seen:
        parser.error(f'Unknown task IDs: {set(args.task) - seen}')
    print(f'Canonical smoke check only: {len(seen)} programs, {len(failed)} failures')
    return int(not seen or bool(failed))


if __name__ == '__main__':
    sys.exit(main())
