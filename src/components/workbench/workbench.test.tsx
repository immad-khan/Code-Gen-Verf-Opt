import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError, type ApiErrorView } from '../../api/client';
import type { GeneratedCodeFile, VerificationResult } from '../../api/types';
import {
  createInitialState,
  workbenchReducer,
  type WorkbenchAction,
  type WorkbenchState,
} from '../../state/workbench';
import { CodeFileViewer } from '../Step2CodeOutput';
import { DiagnoseStageView, NO_ADVISORY_FINDINGS, NO_CORRECTNESS_FINDINGS } from './DiagnoseStage';
import { GenerateStageView } from './GenerateStage';
import { Stepper } from './Stepper';
import { formatLocation, runStageOperation, stepperItems, verifyBlockedReason } from './stageModel';
import { VerifyStageView } from './VerifyStage';

const noop = () => {};
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

const file: GeneratedCodeFile = {
  name: 'main.py',
  path: 'app/main.py',
  language: 'python',
  content: 'def add(a, b):\n    return a - b\n',
  description: 'Adds numbers',
  category: 'other',
};

const verification: VerificationResult = {
  techniques: [
    { id: 'syntax', name: 'Syntax', status: 'pass', complete: true, details: '' },
    { id: 'tests', name: 'Tests', status: 'fail', complete: true, details: '1 failed' },
  ],
  correctnessFindings: [
    {
      technique: 'tests',
      signal: 'assertion',
      exception: 'AssertionError',
      message: 'assert add(1, 2) == 3',
      evidence: 'E   assert -1 == 3',
      location: { file: 'app/main.py', line: 2 },
      category: 'C.2',
      primaryType: 'C',
      categoryName: 'Incorrect logic',
      repairHint: null,
      confidence: 0.9,
      occurrences: 1,
    },
  ],
  advisoryFindings: [{ technique: 'quality', message: 'Missing docstring', file: 'app/main.py', line: 1 }],
  gatePassed: false,
  complete: true,
  incompleteTechniques: [],
  primaryState: 'C',
  testsPassed: 0,
  testsFailed: 1,
  durationMs: 1234,
};

const httpError: ApiErrorView = { kind: 'http', operation: 'verification', message: 'files must not be empty', status: 400 };

/** Real reducer behind a dispatch function. */
function createStore(initial: WorkbenchState) {
  let state = initial;
  return {
    get state() {
      return state;
    },
    dispatch: (action: WorkbenchAction) => {
      state = workbenchReducer(state, action);
    },
  };
}

function generatedState(): WorkbenchState {
  let s = createInitialState();
  s = workbenchReducer(s, { type: 'START', stage: 'generate' });
  return workbenchReducer(s, { type: 'SUCCEED', stage: 'generate', result: { prompt: 'p', files: [file] } });
}

describe('stepperItems / Stepper', () => {
  it('lists the five stages in fixed order with one status each; locked stages are disabled (25.3, 25.4)', () => {
    const items = stepperItems(generatedState());
    expect(items.map((i) => i.label)).toEqual(['Generate', 'Verify', 'Diagnose', 'Repair', 'Report']);
    expect(items.map((i) => i.status)).toEqual(['complete', 'available', 'locked', 'locked', 'locked']);
    expect(items.map((i) => i.disabled)).toEqual([false, false, true, true, true]);
    expect(items.filter((i) => i.current).map((i) => i.id)).toEqual(['generate']);
  });

  it('renders disabled buttons for locked stages and aria-current on the current stage', () => {
    const out = html(<Stepper state={generatedState()} onSelect={noop} />);
    expect(out.match(/<button/g)).toHaveLength(5);
    expect(out.match(/disabled=""/g)).toHaveLength(3);
    expect(out).toContain('aria-current="step"');
    expect(out).toContain('aria-label="Stage 2: Verify, available"');
    expect(out).toContain('aria-label="Stage 4: Repair, locked"');
  });
});

describe('runStageOperation with the Workbench reducer', () => {
  it('stores the backend result on success and unlocks the next stage', async () => {
    const store = createStore(generatedState());
    const outcome = await runStageOperation(store.dispatch, 'verify', 'verification', async () => verification);
    expect(outcome.ok).toBe(true);
    expect(store.state.stages.verify.status).toBe('complete');
    expect(store.state.results.verify).toBe(verification);
    expect(store.state.stages.diagnose.status).toBe('available');
  });

  it('fails with the error, shows no result, and keeps the files so a retry resends them (23.2, 25.5)', async () => {
    const store = createStore(generatedState());
    await runStageOperation(store.dispatch, 'verify', 'verification', async () => verification);
    const sent: GeneratedCodeFile[][] = [];
    const failing = async () => {
      sent.push(store.state.files);
      throw new ApiError('timeout', 'verification', 'Timed out: the MACI backend did not respond within 120 s.');
    };
    const outcome = await runStageOperation(store.dispatch, 'verify', 'verification', failing);
    expect(outcome.ok).toBe(false);
    expect(store.state.stages.verify).toMatchObject({
      status: 'failed',
      error: { kind: 'timeout', operation: 'verification' },
    });
    expect(store.state.results.verify).toBeUndefined();
    expect(store.state.stages.diagnose.status).toBe('locked');
    expect(store.state.files).toEqual([file]);

    await runStageOperation(store.dispatch, 'verify', 'verification', failing);
    expect(sent[1]).toEqual(sent[0]);
  });

  it('names non-API failures after the operation', async () => {
    const store = createStore(createInitialState());
    await runStageOperation(store.dispatch, 'generate', 'code generation', async () => {
      throw new Error('Rate limits exceeded');
    });
    expect(store.state.stages.generate.error).toEqual({
      kind: 'unknown',
      operation: 'code generation',
      message: 'Rate limits exceeded',
    });
  });

  it('drops a late response from a superseded request (23.4)', async () => {
    const store = createStore(generatedState());
    let resolveFirst!: (r: VerificationResult) => void;
    const first = runStageOperation(
      store.dispatch,
      'verify',
      'verification',
      () => new Promise<VerificationResult>((r) => (resolveFirst = r)),
      'verify-a',
    );
    // A file edit invalidates the running request; a new one starts.
    store.dispatch({ type: 'EDIT_FILES', files: [{ ...file, content: 'x = 1\n' }] });
    const second = runStageOperation(store.dispatch, 'verify', 'verification', async () => verification, 'verify-b');
    await second;
    resolveFirst({ ...verification, gatePassed: true });
    await first;
    expect(store.state.results.verify).toBe(verification);
  });
});

describe('verifyBlockedReason', () => {
  it('blocks while locked, running, offline, or without files (23.7, 28.2)', () => {
    expect(verifyBlockedReason({ status: 'locked', offline: false, fileCount: 1 })).toMatch(/Generate/);
    expect(verifyBlockedReason({ status: 'running', offline: false, fileCount: 1 })).toMatch(/running/);
    expect(verifyBlockedReason({ status: 'failed', offline: true, fileCount: 1 })).toMatch(/offline/);
    expect(verifyBlockedReason({ status: 'available', offline: false, fileCount: 0 })).toMatch(/no working files/);
    expect(verifyBlockedReason({ status: 'complete', offline: false, fileCount: 1 })).toBeNull();
  });
});

describe('VerifyStageView', () => {
  const base = { fileCount: 1, onVerify: noop, onContinue: noop };

  it('disables the action while offline and explains why', () => {
    const out = html(<VerifyStageView {...base} status="available" offline />);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>.*Run verification/);
    expect(out).toContain('The MACI backend is offline');
  });

  it('shows a loading indicator and disables the action while running (28.1, 28.2)', () => {
    const out = html(<VerifyStageView {...base} status="running" offline={false} />);
    expect(out).toContain('Running verification…');
    expect(out).toContain('aria-busy="true"');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>.*Run verification/);
  });

  it('shows the inline error with a retry control and no result data (23.1, 23.2)', () => {
    const out = html(<VerifyStageView {...base} status="failed" offline={false} error={httpError} />);
    expect(out).toContain('Verification failed: server error');
    expect(out).toContain('files must not be empty');
    expect(out).toContain('aria-label="Retry verification"');
    expect(out).not.toContain('Correctness gate');
    expect(out).not.toContain('Continue to Diagnose');
  });

  it('disables retry while offline', () => {
    const out = html(<VerifyStageView {...base} status="failed" offline error={httpError} />);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Retry verification"/);
  });

  it('shows the returned result when complete', () => {
    const out = html(<VerifyStageView {...base} status="complete" offline={false} result={verification} />);
    expect(out).toContain('Correctness gate');
    expect(out).toContain('<span>failed</span>');
    expect(out).toContain('0 passed · 1 failed');
    expect(out).toContain('Verification techniques');
    expect(out).toContain('Continue to Diagnose');
  });
});

describe('DiagnoseStageView', () => {
  it('lists correctness findings with category, primary type, evidence, and location (25.7)', () => {
    const out = html(<DiagnoseStageView status="available" result={verification} onContinue={noop} onGoToVerify={noop} />);
    expect(out).toContain('Correctness findings (1)');
    expect(out).toContain('C.2 — Incorrect logic');
    expect(out).toMatch(/Primary type<\/dt><dd[^>]*>C<\/dd>/);
    expect(out).toContain('E   assert -1 == 3');
    expect(out).toContain('app/main.py, line 2');
    expect(out).toContain('Continue to repair');
  });

  it('shows advisory findings in a separate panel without a taxonomy category', () => {
    const out = html(<DiagnoseStageView status="available" result={verification} onContinue={noop} onGoToVerify={noop} />);
    const advisory = out.slice(out.indexOf('Advisory findings (1)'));
    expect(advisory).toContain('Missing docstring');
    expect(advisory).toContain('Quality');
    expect(advisory).not.toContain('Taxonomy category');
    expect(advisory).not.toContain('C.2');
  });

  it('shows "no findings" messages for empty lists', () => {
    const clean = { ...verification, correctnessFindings: [], advisoryFindings: [], gatePassed: true, primaryState: 'PASS' as const };
    const out = html(<DiagnoseStageView status="available" result={clean} onContinue={noop} onGoToVerify={noop} />);
    expect(out).toContain(NO_CORRECTNESS_FINDINGS);
    expect(out).toContain(NO_ADVISORY_FINDINGS);
  });

  it('shows "not available" for an unmapped finding without location, never a made-up value', () => {
    const unmapped = {
      ...verification,
      correctnessFindings: [
        { ...verification.correctnessFindings[0], category: 'UNMAPPED', primaryType: null, categoryName: null, location: null },
      ],
    };
    const out = html(<DiagnoseStageView status="available" result={unmapped} onContinue={noop} onGoToVerify={noop} />);
    expect(out).toContain('UNMAPPED');
    expect(out.match(/not available/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('shows an empty state pointing to Verify when there is no result (28.3)', () => {
    const out = html(<DiagnoseStageView status="locked" onContinue={noop} onGoToVerify={noop} />);
    expect(out).toContain('No findings to show yet. This data comes from the Verify stage.');
    expect(out).toContain('Go to Verify');
  });

  it('Continue acknowledges Diagnose and unlocks Repair in the reducer', () => {
    let s = generatedState();
    s = workbenchReducer(s, { type: 'START', stage: 'verify' });
    s = workbenchReducer(s, { type: 'SUCCEED', stage: 'verify', result: verification });
    s = workbenchReducer(s, { type: 'SELECT', stage: 'diagnose' });
    // Same dispatch sequence DiagnoseStage uses for Continue.
    s = workbenchReducer(s, { type: 'ACKNOWLEDGE', stage: 'diagnose' });
    s = workbenchReducer(s, { type: 'SELECT', stage: 'repair' });
    expect(s.stages.diagnose.status).toBe('complete');
    expect(s.stages.repair.status).toBe('available');
    expect(s.current).toBe('repair');
  });
});

describe('GenerateStageView', () => {
  const base = { onPromptChange: noop, onGenerate: noop, onRetry: noop, onContinue: noop };

  it('keeps the prompt and shows an inline error with retry on failure', () => {
    const error: ApiErrorView = { kind: 'unknown', operation: 'code generation', message: 'Rate limits exceeded' };
    const out = html(<GenerateStageView {...base} status="failed" error={error} prompt="Build a CLI" files={[file]} />);
    expect(out).toContain('Build a CLI');
    expect(out).toContain('Rate limits exceeded');
    expect(out).toContain('aria-label="Retry code generation"');
    expect(out).not.toContain('Working files');
  });

  it('shows loading while running', () => {
    const out = html(<GenerateStageView {...base} status="running" prompt="Build a CLI" files={[]} />);
    expect(out).toContain('Generating code…');
    expect(out).toContain('aria-busy="true"');
  });

  it('shows the file viewer and Continue once complete', () => {
    const out = html(
      <GenerateStageView {...base} status="complete" prompt="Build a CLI" files={[file]} modelUsed="GROQ · llama" />,
    );
    expect(out).toContain('1 file · generated by GROQ · llama');
    expect(out).toContain('Continue to Verify');
    expect(out).toContain('File Tree');
  });
});

describe('CodeFileViewer', () => {
  it('has no sandbox tab', () => {
    const out = html(<CodeFileViewer files={[file]} agentLogs={[]} />);
    expect(out).toContain('File Tree');
    expect(out).toContain('Agent Logs');
    expect(out).not.toMatch(/Sandbox/i);
    expect(html(<CodeFileViewer files={[file]} />)).not.toContain('Agent Logs');
  });
});

describe('formatLocation', () => {
  it('formats file and line, file only, or null', () => {
    expect(formatLocation({ file: 'a.py', line: 3 })).toBe('a.py, line 3');
    expect(formatLocation({ file: 'a.py', line: null })).toBe('a.py');
    expect(formatLocation({ file: null, line: 3 })).toBeNull();
    expect(formatLocation(null)).toBeNull();
  });
});
