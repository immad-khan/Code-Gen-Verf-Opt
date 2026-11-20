"""Prepare scored mbpp tasks from the trusted local dataset; do not overwrite raw inputs."""
from scripts.prepare_benchmark_suites import main

if __name__ == '__main__':
    main(['--dataset', 'mbpp_plus', '--tasks-out', 'data/mbpp_tasks.jsonl'])
