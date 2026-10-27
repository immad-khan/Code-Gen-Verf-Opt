import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import type { GeneratedCodeFile, MappedFinding, RepairIteration, VerificationResult } from '../../api/types';
import { NOT_AVAILABLE_TEXT } from '../common/NotAvailable';
import { EvolutionChart } from './EvolutionChart';
import { FileDiff } from './FileDiff';
import { IterationDetail } from './IterationDetail';
import { RepairInspectorView } from './RepairInspector';
import {
  ITERATION_LOAD_FAILED_TEXT,
  NO_CHANGES_TEXT,
  NO_CRITIQUE_TEXT,
  NO_EXTRACTABLE_CODE,
  diffLineLabel,
  diffLinePrefix,
  evolutionPoints,
  extractedCodeFiles,
  fileChanges,
  iterationLoadError,
  loadIterations,
  mergeIterations,
  missingIterations,
  resolveSelection,
  transitionLabel,
  type IterationLoader,
} from './inspectorModel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

function file(path: string, content: string): GeneratedCodeFile {
  return { name: path.split('/').pop() ?? path, path, language: 'python', content, description: '', category: 'service' };
}

function finding(category: string, message: string): MappedFinding {
  return {
    technique: 'tests',
    signal: 'test_failure',
    exception: 'AssertionError',
    message,
    evidence: '',
    location: { file: 'app/main.py', line: 3 },
    category,
    primaryType: category === 'UNMAPPED' ? null : (category[0] as 'A' | 'B' | 'C'),
    categoryName: category === 'B.2' ? 'Logic error' : null,
    repairHint: null,
    confidence: null,
    occurrences: 1,
  };
}

function verification(primaryState: VerificationResult['primaryState'], findings: MappedFinding[] = []): VerificationResult {
  return {
    techniques: [],
    correctnessFindings: findings,
    advisoryFindings: [],
    gatePassed: primaryState === 'PASS',
    complete: true,
    incompleteTechniques: [],
    primaryState,
    testsPassed: primaryState === 'PASS' ? 3 : 2,
    testsFailed: primaryState === 'PASS' ? 0 : 1,
    durationMs: 10,
  };
}

const LONG_PROMPT = `${'x'.repeat(5000)}\nEND-OF-PROMPT`;

function iteration(n: number, overrides: Partial<RepairIteration> = {}): RepairIteration {
  return {
    iteration: n,
    prompt: `prompt ${n}`,
    rawResponse: `critique ${n}\n\`\`\`python\nreturn ${n}\n\`\`\``,
    critiqueText: `critique ${n}`,
    noExtractableCode: false,
    filesBefore: [file('app/main.py', `return ${n - 1}`), file('tests/test_main.py', 'assert True')],
    filesAfter: [file('app/main.py', `return ${n}`), file('tests/test_main.py', 'assert True')],
    verification: verification('PASS'),
    verificationComplete: true,
    transition: { from: 'B', to: 'PASS', available: true, failure: null },
    categoriesBefore: ['B.2'],
    categoriesAfter: [],
    introduced: [],
    resolved: ['B.2'],
    durationMs: 100,
    ...overrides,
  };
}

const initial = verification('B', [finding('B.2', 'expected 3, got 2')]);

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

describe('inspector model', () => {
  it('diff prefixes and hidden labels mark added and removed lines (26.5)', () => {
    expect(diffLinePrefix('added')).toBe('+');
    expect(diffLinePrefix('removed')).toBe('\u2212');
    expect(diffLinePrefix('unchanged')).toBe(' ');
    expect(diffLineLabel('added')).toBe('added');
    expect(diffLineLabel('removed')).toBe('removed');
    expect(diffLineLabel('unchanged')).toBeNull();
  });

  it('pairs files by path and flags unchanged, new, and removed files (26.5, 26.6)', () => {
    const changes = fileChanges(
      [file('a.py', 'x = 1'), file('b.py', 'same'), file('gone.py', 'bye')],
      [file('b.py', 'same'), file('a.py', 'x = 2'), file('new.py', 'hi')],
    );
    expect(changes.map((c) => [c.path, c.changed])).toEqual([
      ['a.py', true],
      ['b.py', false],
      ['gone.py', true],
      ['new.py', true],
    ]);
    expect(changes[2]).toMatchObject({ before: 'bye', after: null });
    expect(changes[3]).toMatchObject({ before: null, after: 'hi' });
    expect(changes[1].diff.isModified).toBe(false);
  });

  it('extracted code is the files the response changed', () => {
    expect(extractedCodeFiles(iteration(1)).map((f) => f.path)).toEqual(['app/main.py']);
  });

  it('formats transitions as "X → Y", with "not available" for undetermined states (26.7)', () => {
    expect(transitionLabel({ from: 'A', to: 'PASS', available: true })).toBe('A → PASS');
    expect(transitionLabel({ from: 'C', to: null, available: false })).toBe(`C → ${NOT_AVAILABLE_TEXT}`);
  });

  it('builds one evolution point per executed iteration, 0..last in order (26.1, 26.8)', () => {
    const points = evolutionPoints(initial, [
      iteration(2, { transition: { from: 'C', to: 'PASS', available: true, failure: null } }),
      iteration(1, { transition: { from: 'B', to: 'C', available: true, failure: null } }),
      iteration(3, { transition: { from: 'A', to: null, available: false, failure: 'timeout' } }),
    ]);
    expect(points).toEqual([
      { iteration: 0, state: 'B' },
      { iteration: 1, state: 'C' },
      { iteration: 2, state: 'PASS' },
      { iteration: 3, state: null },
    ]);
  });

  it('merges, finds missing iterations, and resolves selection', () => {
    const merged = mergeIterations([iteration(3), iteration(1)], [iteration(1, { prompt: 'newer' })]);
    expect(merged.map((it) => it.iteration)).toEqual([1, 3]);
    expect(merged[0].prompt).toBe('newer');
    expect(missingIterations(merged, 4)).toEqual([2, 4]);
    expect(missingIterations([], 0)).toEqual([]);
    expect(resolveSelection(null, merged)).toBe(3);
    expect(resolveSelection(0, merged)).toBe(0);
    expect(resolveSelection(1, merged)).toBe(1);
    expect(resolveSelection(2, merged)).toBe(3);
    expect(resolveSelection(null, [])).toBe(0);
  });

  it('loads iterations in order and stops at the first failure, keeping loaded ones (26.9)', async () => {
    const loader = vi.fn<IterationLoader>(async (_id, n) => {
      if (n === 3) throw new ApiError('network', 'repair', 'Network error: the MACI backend is unreachable.');
      return iteration(n);
    });
    const loaded: number[] = [];
    const outcome = await loadIterations('s1', [1, 2, 3, 4], loader, (it) => loaded.push(it.iteration));
    expect(loaded).toEqual([1, 2]);
    expect(loader).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({
      status: 'failed',
      failure: {
        iteration: 3,
        error: {
          kind: 'network',
          operation: 'loading iteration 3 data',
          message: 'Network error: the MACI backend is unreachable.',
          status: undefined,
        },
      },
    });

    // Retry resumes from the failed iteration.
    const retried: number[] = [];
    const ok = vi.fn<IterationLoader>(async (_id, n) => iteration(n));
    expect(await loadIterations('s1', [3, 4], ok, (it) => retried.push(it.iteration))).toEqual({ status: 'done' });
    expect(retried).toEqual([3, 4]);
  });

  it('reports an aborted load without an error', async () => {
    const controller = new AbortController();
    const loader: IterationLoader = async (_id, n) => {
      controller.abort();
      return iteration(n);
    };
    const onLoaded = vi.fn();
    expect(await loadIterations('s1', [1, 2], loader, onLoaded, controller.signal)).toEqual({ status: 'aborted' });
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('names the iteration in non-ApiError failures', () => {
    expect(iterationLoadError(new Error('boom'), 2)).toEqual({
      kind: 'unknown',
      operation: 'loading iteration 2 data',
      message: 'boom',
    });
  });
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

describe('FileDiff', () => {
  it('prefixes added/removed lines with text and hidden labels (26.5)', () => {
    const [change] = fileChanges([file('a.py', 'keep\nold')], [file('a.py', 'keep\nnew')]);
    const out = html(<FileDiff change={change} />);
    expect(out).toContain('a.py');
    expect(out).toContain('1 added, 1 removed');
    expect(out).toMatch(/aria-hidden="true"[^>]*>\u2212<\/span><span class="sr-only">removed: <\/span><span[^>]*>old<\/span>/);
    expect(out).toMatch(/aria-hidden="true"[^>]*>\+<\/span><span class="sr-only">added: <\/span><span[^>]*>new<\/span>/);
    expect(out).toContain('aria-label="Line diff of a.py"');
    expect(out).not.toContain(NO_CHANGES_TEXT);
  });

  it('shows a "No changes" label instead of an empty diff (26.6)', () => {
    const [change] = fileChanges([file('a.py', 'same')], [file('a.py', 'same')]);
    const out = html(<FileDiff change={change} />);
    expect(out).toContain(NO_CHANGES_TEXT);
    expect(out).not.toContain('Line diff of');
  });
});

describe('EvolutionChart', () => {
  it('has a table alternative with column headers and the same values (26.8, 28.9)', () => {
    const out = html(
      <EvolutionChart
        points={[
          { iteration: 0, state: 'A' },
          { iteration: 1, state: 'C' },
          { iteration: 2, state: null },
        ]}
      />,
    );
    expect(out).toContain('role="img"');
    expect(out).toContain('<th scope="col"');
    expect(out).toContain('>Primary_State</th>');
    expect(out).toMatch(/<th scope="row"[^>]*>0 \(initial candidate\)<\/th><td[^>]*>A<\/td>/);
    expect(out).toMatch(/<th scope="row"[^>]*>1<\/th><td[^>]*>C<\/td>/);
    expect(out).toMatch(/<th scope="row"[^>]*>2<\/th><td[^>]*>.*not available/);
  });
});

describe('IterationDetail', () => {
  it('shows the full prompt and raw response, labelled critique and code, diffs, findings, gate, and transition', () => {
    const it2 = iteration(2, {
      prompt: LONG_PROMPT,
      verification: verification('B', [finding('B.2', 'expected 3, got 2'), finding('UNMAPPED', 'odd')]),
      transition: { from: 'A', to: 'B', available: true, failure: null },
    });
    const out = html(<IterationDetail iteration={it2} />);
    expect(out).toContain(LONG_PROMPT); // 26.2: no truncation
    expect(out).toContain('Critique prompt sent to the LLM');
    expect(out).toContain('Raw LLM response');
    expect(out).toContain('```python'); // raw response verbatim
    expect(out).toContain('>Critique text</h5>');
    expect(out).toContain('>critique 2</pre>');
    expect(out).toContain('>Extracted code</h5>');
    expect(out).toContain('>return 2</pre>');
    expect(out).toContain('A → B');
    expect(out).toContain('Correctness gate');
    expect(out).toContain('>failed</span>');
    expect(out).toContain('B.2 Logic error');
    expect(out).toContain('UNMAPPED');
    expect(out).toContain('app/main.py:3');
    // Unchanged test file is labelled, changed file has a diff.
    expect(out).toContain(NO_CHANGES_TEXT);
    expect(out).toContain('aria-label="Line diff of app/main.py"');
    expect(out).not.toContain(NO_CRITIQUE_TEXT);
    expect(out).not.toContain(NO_EXTRACTABLE_CODE);
  });

  it('labels missing critique text and missing code (26.4)', () => {
    const empty = iteration(1, {
      rawResponse: '',
      critiqueText: null,
      noExtractableCode: true,
      filesAfter: iteration(1).filesBefore,
      verification: verification('B'),
      transition: { from: 'B', to: 'B', available: true, failure: null },
    });
    const out = html(<IterationDetail iteration={empty} />);
    expect(out).toContain(NO_CRITIQUE_TEXT);
    expect(out).toContain(NO_EXTRACTABLE_CODE);
    expect(out).toContain('B → B');
    expect(out).toContain('No correctness findings.');
    expect(html(<IterationDetail iteration={iteration(1, { critiqueText: '   ' })} />)).toContain(NO_CRITIQUE_TEXT);
  });

  it('shows an undetermined state as not available with the reason', () => {
    const out = html(
      <IterationDetail
        iteration={iteration(1, {
          verificationComplete: false,
          transition: { from: 'C', to: null, available: false, failure: 'verification timed out' },
        })}
      />,
    );
    expect(out).toContain(`C → ${NOT_AVAILABLE_TEXT}`);
    expect(out).toContain('State not available: verification timed out');
    expect(out).toContain('Verification incomplete');
  });
});

describe('RepairInspectorView', () => {
  const its = [
    iteration(2, { transition: { from: 'C', to: 'PASS', available: true, failure: null } }),
    iteration(1, { transition: { from: 'B', to: 'C', available: true, failure: null } }),
  ];

  it('lists iterations 0..last in ascending order and shows the selected one (26.1)', () => {
    const out = html(<RepairInspectorView initial={initial} iterations={its} selected={1} onSelect={noop} />);
    const labels = [...out.matchAll(/<span class="font-semibold">(Iteration \d+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Iteration 0', 'Iteration 1', 'Iteration 2']);
    expect(out).toContain('initial candidate, B');
    expect(out).toContain('B → C');
    expect(out).toMatch(/aria-pressed="true"[^>]*><span class="font-semibold">Iteration 1</);
    expect(out).toContain('aria-label="Iteration 1 details"');
    expect(out).toContain('Bug evolution');
  });

  it('defaults to the last iteration and shows iteration 0 details on request', () => {
    expect(html(<RepairInspectorView initial={initial} iterations={its} selected={null} onSelect={noop} />)).toContain(
      'aria-label="Iteration 2 details"',
    );
    const zero = html(<RepairInspectorView initial={initial} iterations={its} selected={0} onSelect={noop} />);
    expect(zero).toContain('Iteration 0 (initial candidate)');
    expect(zero).toContain('expected 3, got 2');
    expect(zero).toContain('>return 0</pre>'); // initial code from iteration 1's filesBefore
  });

  it('shows the load failure with retry while keeping loaded iterations (26.9)', () => {
    const out = html(
      <RepairInspectorView
        initial={initial}
        iterations={[its[1]]}
        selected={null}
        onSelect={noop}
        failure={{
          iteration: 2,
          error: { kind: 'network', operation: 'loading iteration 2 data', message: 'Network error: unreachable.' },
        }}
        onRetry={noop}
      />,
    );
    expect(out).toContain(ITERATION_LOAD_FAILED_TEXT);
    expect(out).toContain('Loading iteration 2 data failed: network error');
    expect(out).toContain('aria-label="Retry loading iteration 2 data"');
    expect(out).toContain('aria-label="Iteration 1 details"');
  });

  it('shows a loading indicator while fetching and waits for the initial verification', () => {
    expect(
      html(<RepairInspectorView initial={initial} iterations={[]} selected={null} onSelect={noop} loading running />),
    ).toContain('Loading iteration data…');
    expect(html(<RepairInspectorView initial={null} iterations={[]} selected={null} onSelect={noop} />)).toContain(
      'not available yet',
    );
  });
});
