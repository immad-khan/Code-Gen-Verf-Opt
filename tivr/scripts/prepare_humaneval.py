"""Prepare scored humaneval tasks from the trusted local dataset; do not overwrite raw inputs."""
from scripts.prepare_benchmark_suites import main

if __name__ == '__main__':
    main(['--dataset', 'humaneval_plus', '--tasks-out', 'data/humaneval_tasks.jsonl'])
