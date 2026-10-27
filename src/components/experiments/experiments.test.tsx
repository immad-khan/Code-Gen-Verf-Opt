import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import type {
  BugEvolutionMatrix,
  RunDetail as RunDetailDto,
  RunListItem,
  RunStatus,
  RunSummary,
  TrajectoryEntry,
  TrajectoryPage,
} from '../../api/types';
import { NOT_AVAILABLE } from '../../lib/format';
import { PAPER_REFERENCE_SOURCE } from '../../lib/paperReference';
import { AblationTable } from './AblationTable';
import { ActiveRunStatusView } from './ActiveRunPanel';
import { EvolutionMatrix, evolutionRows } from './EvolutionMatrix';
import { ExperimentsError } from './ExperimentsError';
import { ExperimentsView } from './ExperimentsView';
import { RunDetail, runIterations } from './RunDetail';
import { RunList } from './RunList';
import { StartRunForm } from './StartRunForm';
import { TrajectoryPageView } from './TrajectoryBrowser';
import {
  ACTIVE_RUN_POLL_MS,
  COMPARE_MAX,
  DEFAULT_START_RUN_VALUES,
  experimentsErrorText,
  outputTail,
  pageCount,
  runBadges,
  toStartRunRejection,
  toggleSelection,
  validateStartRunForm,
} from './experimentsModel';

const noop = () => {};
const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const SHA = 'a'.repeat(64);

function run(overrides: Partial<RunListItem> = {}): RunListItem {
  return {
    runId: 'run-a',
    provenance: 'manifest',
    status: 'completed',
    startTime: '2026-01-01T12:00:00Z',
    repairMode: 'dou',
    feedbackRegime: 'dou',
    k: 2,
    model: 'gpt-4',
    sampleSize: 120,
    llmMode: 'live',
    datasetSha256: SHA,
    generationCacheSha256: 'c'.repeat(64),
    seed: 0,
    rsr: [
      { iteration: 1, num: 29, den: 120, pct: 24.2 },
      { iteration: 2, num: 35, den: 120, pct: 29.2 },
    ],
    ...overrides,
  };
}

const matrix: BugEvolutionMatrix = {
  iteration: 1,
  states: ['A', 'B', 'C', 'PASS'],
  counts: [
    [0, 0, 0, 3],
    [0, 20, 2, 6],
    [0, 1, 68, 20],
    [0, 0, 0, 0],
  ],
  row_percentages: [
    [0, 0, 0, 100],
    [0, 71.42857142857143, 7.142857142857143, 21.428571428571427],
    [0, 1.1235955056179776, 76.40449438202248, 22.47191011235955],
    [null, null, null, null],
  ],
};

function summary(): RunSummary {
  const r = (num: number, den: number) => ({ num, den, pct: den === 0 ? null : Math.round((1000 * num) / den) / 10 });
  return {
    schema: 'tivr.run_summary.v1',
    run_id: 'run-a',
    llm_mode: 'mock',
    taxonomy_version: '1.0.0',
    dataset: { path: 'data/humaneval_plus.jsonl', sha256: SHA, task_count: 164 },
    config: {
      repair_mode: 'dou',
      feedback_regime: 'dou',
      k: 2,
      model: 'gpt-4',
      api_host: null,
      temperature: 0.1,
      top_p: null,
      max_tokens: null,
      generation_prompt_style: 'dou',
      seed: 0,
    },
    sample: { requested: 120, actual: 120 },
    pass_at_1: { before: r(120, 164), after: r(155, 164) },
    rsr: [
      { iteration: 1, ...r(29, 120) },
      { iteration: 2, ...r(35, 120) },
    ],
    conditional_repair_rate: [{ iteration: 2, ...r(6, 91) }],
    per_primary_type: [{ iteration: 1, A: r(3, 3), B: r(6, 28), C: r(20, 89) }],
    per_category: { 'A.1': r(2, 2), 'C.2': r(0, 0) },
    bug_evolution: [matrix],
    unmapped_as_c_by_iteration: [0, 1, 0],
    empty_visible_suite_programs: 0,
    cost: {
      llm_calls: 240,
      calls_without_usage: 0,
      prompt_tokens: 210000,
      completion_tokens: 64000,
      per_program: { llm_calls: 2, prompt_tokens: 1750, completion_tokens: 533.3333333333334 },
    },
  };
}

describe('start-run form model', () => {
  it('builds a request from the defaults once a dataset is chosen', () => {
    const v = validateStartRunForm({ ...DEFAULT_START_RUN_VALUES, dataset: 'humaneval_plus.jsonl' });
    expect(v).toEqual({
      ok: true,
      request: {
        dataset: 'humaneval_plus.jsonl',
        repairMode: 'dou',
        feedbackRegime: 'dou',
        k: 2,
        temperature: 0.1,
        generationPromptStyle: 'dou',
        sampleSize: 120,
        seed: 0,
        generationCache: null,
        mock: false,
      },
    });
  });

  it('names each invalid control', () => {
    const v = validateStartRunForm({ ...DEFAULT_START_RUN_VALUES, k: '11', temperature: 'x', sampleSize: '0', seed: '-1' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(Object.keys(v.errors).sort()).toEqual(['dataset', 'k', 'sampleSize', 'seed', 'temperature']);
  });

  it('extracts the rejection reason, invalid fields, and active run', () => {
    const conflict = new ApiError('http', 'experiments', 'a run is already active', 409, {
      error: 'a run is already active',
      activeRunId: 'run-x',
    });
    expect(toStartRunRejection(conflict)).toMatchObject({
      error: { message: 'a run is already active', status: 409 },
      activeRunId: 'run-x',
      invalidFields: [],
    });
    const invalid = new ApiError('http', 'experiments', 'invalid configuration', 400, {
      error: 'invalid configuration',
      invalidFields: [{ field: 'dataset', message: 'path is outside the data directory' }],
    });
    expect(toStartRunRejection(invalid).invalidFields).toEqual([
      { field: 'dataset', message: 'path is outside the data directory' },
    ]);
  });
});

describe('StartRunForm', () => {
  const datasets = [{ fileName: 'humaneval_plus.jsonl', taskCount: 164, sha256: SHA }];
  const caches = [
    { path: 'caches/gpt4.json', datasetSha256: SHA, model: 'gpt-4', llmMode: 'live' as const, generationPromptStyle: 'dou' as const },
  ];

  it('has one labelled control per start-run field and lists datasets with task count and SHA-256', () => {
    const out = html(
      <StartRunForm
        values={DEFAULT_START_RUN_VALUES}
        onChange={noop}
        onSubmit={noop}
        submitting={false}
        datasets={datasets}
        caches={caches}
      />,
    );
    for (const label of [
      'Dataset',
      'Repair mode',
      'Feedback regime',
      'Iterations (k)',
      'Temperature',
      'Generation prompt style',
      'Sample size',
      'Sample seed',
      'Generation cache',
      'Mock mode',
    ]) {
      expect(out).toMatch(new RegExp(`<label for="[^"]+"[^>]*>${label.replace(/[()]/g, '\\$&')}</label>`));
    }
    expect(out.match(/<label /g)).toHaveLength(10);
    expect(out).toContain(`humaneval_plus.jsonl — 164 tasks — SHA-256 ${SHA}`);
    expect(out).toContain('caches/gpt4.json');
    expect(out).toContain('value="dou_intervenor"');
  });

  it('keeps entered values and shows the rejection reason (27.9)', () => {
    const values = { ...DEFAULT_START_RUN_VALUES, dataset: 'humaneval_plus.jsonl', k: '3', seed: '42', mock: true };
    const rejection = toStartRunRejection(
      new ApiError('http', 'experiments', 'a run is already active', 409, { error: 'a run is already active', activeRunId: 'run-x' }),
    );
    const out = html(
      <StartRunForm
        values={values}
        onChange={noop}
        onSubmit={noop}
        submitting={false}
        datasets={datasets}
        caches={caches}
        rejection={rejection}
      />,
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain('a run is already active');
    expect(out).toContain('Active run: run-x');
    expect(out).toContain('value="3"');
    expect(out).toContain('value="42"');
    expect(out).toContain('checked=""');
    expect(out).toMatch(/<option value="humaneval_plus.jsonl" selected="">/);
  });

  it('disables submission while the request is in flight (28.2)', () => {
    const out = html(
      <StartRunForm values={DEFAULT_START_RUN_VALUES} onChange={noop} onSubmit={noop} submitting datasets={[]} caches={[]} />,
    );
    expect(out).toMatch(/<button type="submit" disabled=""/);
    expect(out).toContain('Starting run…');
  });
});

describe('active run', () => {
  const status = (s: Partial<RunStatus> = {}): RunStatus => ({
    runId: 'run-a',
    status: 'running',
    phase: 'repair',
    completed: 37,
    total: 120,
    outputTail: Array.from({ length: 250 }, (_, i) => `line ${i + 1}`),
    exitCode: null,
    launchError: null,
    ...s,
  });

  it('polls at most every 3 seconds and keeps the last 200 lines', () => {
    expect(ACTIVE_RUN_POLL_MS).toBeLessThanOrEqual(3000);
    const tail = outputTail(status().outputTail);
    expect(tail).toHaveLength(200);
    expect(tail[0]).toBe('line 51');
  });

  it('shows status, completed/total, and output; a cancel control while running', () => {
    const out = html(<ActiveRunStatusView runId="run-a" status={status()} polling error={null} onRetry={noop} onCancel={noop} />);
    expect(out).toContain('Active run');
    expect(out).toContain('>running<');
    expect(out).toContain('37 / 120 tasks');
    expect(out).toContain('line 250');
    expect(out).not.toContain('line 50\n');
    expect(out).toContain('Cancel run');
  });

  it('shows the final status once the run ends', () => {
    const out = html(
      <ActiveRunStatusView
        runId="run-a"
        status={status({ status: 'failed', exitCode: 1 })}
        polling={false}
        error={null}
        onRetry={noop}
        onCancel={noop}
        onDismiss={noop}
      />,
    );
    expect(out).toContain('Last run');
    expect(out).toContain('>failed<');
    expect(out).not.toContain('Cancel run');
  });
});

describe('RunList', () => {
  it('lists configuration, RSR_i, and mock/legacy badges with "not available" for gaps', () => {
    const runs = [
      run({ llmMode: 'mock' }),
      run({ runId: 'legacy-1', provenance: 'legacy', repairMode: null, model: null, k: null, sampleSize: null, llmMode: null, rsr: null }),
    ];
    const out = html(<RunList runs={runs} selectedRunId={null} onSelectRun={noop} comparison={[]} onToggleCompare={noop} />);
    for (const header of ['Repair mode', 'Feedback regime', '>k<', 'Model', 'Sample size', 'llm_mode', 'Provenance', 'RSR_1', 'RSR_2']) {
      expect(out).toContain(header);
    }
    expect(out).toContain('24.2%');
    expect(out).toContain('29.2%');
    expect(out).toContain('<span>mock</span>');
    expect(out).toContain('<span>legacy</span>');
    expect(out.split(NOT_AVAILABLE).length - 1).toBeGreaterThanOrEqual(7);
    expect(out).not.toMatch(/>0\.0%</);
  });

  it('runBadges and toggleSelection follow the rules', () => {
    expect(runBadges('mock', 'legacy')).toEqual(['mock', 'legacy']);
    expect(runBadges('live', 'manifest')).toEqual([]);
    const ten = Array.from({ length: COMPARE_MAX }, (_, i) => `r${i}`);
    expect(toggleSelection(ten, 'extra')).toEqual(ten);
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('RunDetail', () => {
  const detail: RunDetailDto = { runId: 'run-a', provenance: 'manifest', status: 'completed', manifest: null, summary: summary() };

  it('shows RSR, conditional, per-type, per-category, evolution, and cost', () => {
    const out = html(<RunDetail detail={detail} />);
    expect(runIterations(detail)).toBe(2);
    expect(out).toContain('24.2% (29/120)');
    expect(out).toContain('6.6% (6/91)');
    expect(out).toContain('100.0% (3/3)');
    expect(out).toContain('Type A');
    expect(out).toContain('C.4');
    expect(out).toContain('UNMAPPED');
    expect(out).toContain('Bug evolution, iteration 1');
    expect(out).toContain('240');
    expect(out).toContain('533.3');
    expect(out).toContain('<span>mock</span>');
    // Iteration 2 has no evolution matrix or per-type rates → placeholder, never zero.
    expect(out).toContain('Bug evolution, iteration 2: ');
  });

  it('shows "not available" for every metric when the summary is missing', () => {
    const out = html(<RunDetail detail={{ runId: 'legacy-1', provenance: 'legacy', status: 'completed', manifest: null, summary: null }} />);
    expect(out).toContain('no Run_Summary');
    expect(out).toContain('<span>legacy</span>');
    expect(out).toContain(NOT_AVAILABLE);
    expect(out).not.toMatch(/>0\.0%/);
  });
});

describe('EvolutionMatrix', () => {
  it('renders a chart plus a 4×4 table with A, B, C, and PASS rows and columns', () => {
    const out = html(<EvolutionMatrix matrix={matrix} />);
    expect(out).toContain('role="img"');
    expect(out.match(/<th scope="col"/g)).toHaveLength(5);
    expect(out.match(/<th scope="row"/g)).toHaveLength(4);
    for (const label of ['A (syntax)', 'B (runtime)', 'C (functional)', 'PASS']) expect(out).toContain(label);
    expect(out).toContain('20 (71.4%)');
    // PASS row has no programs → percentages not available.
    expect(out).toContain(`0 (<span class="italic text-slate-600">${NOT_AVAILABLE}`);
  });

  it('reorders states into A, B, C, PASS', () => {
    const rows = evolutionRows({
      states: ['PASS', 'C', 'B', 'A'],
      counts: [
        [1, 0, 0, 0],
        [0, 2, 0, 0],
        [0, 0, 3, 0],
        [0, 0, 0, 4],
      ],
      row_percentages: [
        [100, 0, 0, 0],
        [0, 100, 0, 0],
        [0, 0, 100, 0],
        [0, 0, 0, 100],
      ],
    });
    expect(rows.map((r) => r.from)).toEqual(['A', 'B', 'C', 'PASS']);
    expect(rows[0].cells[0].count).toBe(4);
    expect(rows[3].cells[3].count).toBe(1);
  });
});

describe('AblationTable', () => {
  it('asks for 2–10 runs when fewer are selected', () => {
    expect(html(<AblationTable runs={[run()]} />)).toContain('Select between 2 and 10 runs');
  });

  it('shows RSR_1/RSR_2, paper rows labelled Dou et al. GPT-4, and RSR_2 n/a when k < 2', () => {
    const out = html(
      <AblationTable runs={[run(), run({ runId: 'run-k1', k: 1, rsr: [{ iteration: 1, num: 26, den: 120, pct: 21.7 }], llmMode: 'mock' })]} />,
    );
    expect(out).toContain('24.2%');
    expect(out).toContain('21.7%');
    expect(out.split(PAPER_REFERENCE_SOURCE).length - 1).toBe(5);
    for (const v of ['23.3%', '27.5%', '22.5%', '28.3%', '24.1%', '25.8%']) expect(out).toContain(v);
    expect(out).toContain('RSR_2 needs k ≥ 2');
    expect(out).toContain('<span>mock</span>');
    expect(out).not.toContain('not directly comparable');
  });

  it('puts comparability warnings above the table, naming the field and each value', () => {
    const out = html(<AblationTable runs={[run(), run({ runId: 'run-b', seed: 7, feedbackRegime: 'strict' })]} />);
    const warning = out.indexOf('not directly comparable');
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(out.indexOf('<table'));
    expect(out).toContain('Sample seed differs:');
    expect(out).toContain('Feedback regime differs:');
    expect(out).toContain('7</li>');
    expect(out).not.toContain('Dataset SHA-256 differs');
  });
});

describe('TrajectoryPageView', () => {
  const entry: TrajectoryEntry = {
    schema: 'tivr.trajectory.v1',
    run_id: 'run-a',
    task_id: 'HumanEval/12',
    iteration: 1,
    llm_mode: 'live',
    repair_mode: 'dou',
    feedback_regime: 'dou',
    prompt: 'PROMPT TEXT',
    raw_response: 'RAW RESPONSE',
    critique_text: '',
    extracted_code: 'def f():\n    return 2',
    had_code_block: true,
    code_before: 'def f():\n    return 1',
    feedback_report: null,
    hidden_result: { passed: true, primary_state: 'PASS', categories: [], unmapped_as_c: false },
    primary_state_before: 'C',
    primary_state: 'PASS',
    empty_visible_suite: false,
    usage: null,
  };

  it('shows iteration, prompt, response, diff, and Primary_State with page navigation', () => {
    const page: TrajectoryPage = { page: 2, pageSize: 50, total: 120, entries: [entry] };
    const out = html(<TrajectoryPageView data={page} page={2} onPage={noop} loading={false} />);
    expect(out).toContain('HumanEval/12 · iteration 1');
    expect(out).toContain('PROMPT TEXT');
    expect(out).toContain('RAW RESPONSE');
    expect(out).toContain('Primary_State: C → <strong>PASS</strong>');
    expect(out).toContain('<span class="sr-only">removed: </span><span aria-hidden="true">− </span>    return 1');
    expect(out).toContain('<span class="sr-only">added: </span><span aria-hidden="true">+ </span>    return 2');
    expect(out).toContain('Page 2 of 3 · 120 entries');
    expect(pageCount(120)).toBe(3);
    expect(pageCount(0)).toBe(1);
  });
});

describe('Experiments errors and view', () => {
  it('labels timeouts and network failures as the Experiments API being unreachable, with retry', () => {
    const timeout = { kind: 'timeout' as const, operation: 'experiments', message: 'Timed out: no response within 10 s.' };
    expect(experimentsErrorText(timeout).title).toBe('Experiments API unreachable');
    expect(experimentsErrorText({ ...timeout, kind: 'http', message: '' }).title).toBe('Experiments API request failed');
    const out = html(<ExperimentsError error={timeout} onRetry={noop} subject="run list" />);
    expect(out).toContain('Experiments API unreachable (run list)');
    expect(out).toContain('Timed out: no response within 10 s.');
    expect(out).toContain('aria-label="Retry run list"');
  });

  it('renders the initial view with loading indicators and the start form', () => {
    const out = html(<ExperimentsView />);
    expect(out).toContain('Experiments');
    expect(out).toContain('Loading runs…');
    expect(out).toContain('Start run');
    expect(out).toContain('No run is active');
  });
});
