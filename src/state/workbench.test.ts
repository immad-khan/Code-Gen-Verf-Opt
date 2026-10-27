import { describe, expect, it } from 'vitest';
import type { ApiErrorView } from '../api/client';
import type { GeneratedCodeFile, RepairSessionView, VerificationResult } from '../api/types';
import {
  REPAIR_APPLIED_MESSAGE,
  STAGES,
  canSelect,
  createInitialState,
  runningStage,
  workbenchReducer,
  type GenerateResult,
  type StageStatus,
  type WorkbenchAction,
  type WorkbenchState,
} from './workbench';

const file = (content: string): GeneratedCodeFile => ({
  name: 'main.py',
  path: 'main.py',
  language: 'python',
  content,
  description: '',
  category: 'other',
});

const generated: GenerateResult = { prompt: 'Write add(a, b)', files: [file('def add(a, b): return a - b')] };

const verification: VerificationResult = {
  techniques: [],
  correctnessFindings: [],
  advisoryFindings: [],
  gatePassed: false,
  complete: true,
  incompleteTechniques: [],
  primaryState: 'C',
  testsPassed: 0,
  testsFailed: 1,
  durationMs: 12,
};

const repairView: RepairSessionView = {
  sessionId: 's1',
  status: 'completed',
  effectiveConfig: { repairMode: 'dou', k: 2, temperature: 0.1 },
  iterationsCompleted: 1,
  partial: null,
  result: null,
  error: null,
};

const networkError: ApiErrorView = {
  kind: 'network',
  operation: 'verification',
  message: 'Network error: the MACI backend is unreachable at http://localhost:5000.',
};

function run(actions: WorkbenchAction[], state: WorkbenchState = createInitialState()): WorkbenchState {
  return actions.reduce(workbenchReducer, state);
}

function statuses(state: WorkbenchState): StageStatus[] {
  return STAGES.map((id) => state.stages[id].status);
}

/** Generate → Verify → Diagnose → Repair complete, Report available. */
const throughRepair: WorkbenchAction[] = [
  { type: 'START', stage: 'generate' },
  { type: 'SUCCEED', stage: 'generate', result: generated },
  { type: 'START', stage: 'verify' },
  { type: 'SUCCEED', stage: 'verify', result: verification },
  { type: 'ACKNOWLEDGE', stage: 'diagnose' },
  { type: 'START', stage: 'repair' },
  { type: 'SUCCEED', stage: 'repair', result: repairView },
];

describe('workbench reducer: ordering and locking', () => {
  it('starts with Generate available and every later stage locked, in fixed order', () => {
    const state = createInitialState();
    expect(STAGES).toEqual(['generate', 'verify', 'diagnose', 'repair', 'report']);
    expect(statuses(state)).toEqual(['available', 'locked', 'locked', 'locked', 'locked']);
    expect(state.current).toBe('generate');
    expect(state.repairSettings).toEqual({ mode: 'dou', k: '2', temperature: '0.1' });
  });

  it('unlocks each stage only when its predecessor completes', () => {
    let state = run([{ type: 'START', stage: 'generate' }]);
    expect(statuses(state)).toEqual(['running', 'locked', 'locked', 'locked', 'locked']);

    state = run([{ type: 'SUCCEED', stage: 'generate', result: generated }], state);
    expect(statuses(state)).toEqual(['complete', 'available', 'locked', 'locked', 'locked']);
    expect(state.files).toEqual(generated.files);
    expect(state.prompt).toBe(generated.prompt);

    state = run(
      [
        { type: 'START', stage: 'verify' },
        { type: 'SUCCEED', stage: 'verify', result: verification },
      ],
      state,
    );
    expect(statuses(state)).toEqual(['complete', 'complete', 'available', 'locked', 'locked']);

    state = run([{ type: 'ACKNOWLEDGE', stage: 'diagnose' }], state);
    expect(statuses(state)).toEqual(['complete', 'complete', 'complete', 'available', 'locked']);

    state = run(
      [
        { type: 'START', stage: 'repair' },
        { type: 'SUCCEED', stage: 'repair', result: repairView },
        { type: 'ACKNOWLEDGE', stage: 'report' },
      ],
      state,
    );
    expect(statuses(state)).toEqual(['complete', 'complete', 'complete', 'complete', 'complete']);
  });

  it('ignores START, ACKNOWLEDGE and SELECT on locked stages', () => {
    const initial = createInitialState();
    expect(run([{ type: 'START', stage: 'verify' }], initial)).toBe(initial);
    expect(run([{ type: 'ACKNOWLEDGE', stage: 'diagnose' }], initial)).toBe(initial);
    expect(run([{ type: 'SELECT', stage: 'repair' }], initial)).toBe(initial);
    expect(canSelect(initial, 'repair')).toBe(false);
    expect(canSelect(initial, 'generate')).toBe(true);
  });

  it('selects unlocked stages', () => {
    const state = run([...throughRepair, { type: 'SELECT', stage: 'diagnose' }]);
    expect(state.current).toBe('diagnose');
    expect(run([{ type: 'SELECT', stage: 'report' }], state).current).toBe('report');
  });

  it('never locks Generate', () => {
    const state = run([
      { type: 'START', stage: 'generate' },
      { type: 'FAIL', stage: 'generate', error: { ...networkError, operation: 'generation' } },
      { type: 'EDIT_FILES', files: [file('x = 1')] },
    ]);
    expect(state.stages.generate.status).not.toBe('locked');
  });
});

describe('workbench reducer: failure and retry', () => {
  it('marks the stage failed with the error and keeps files, prompt and settings', () => {
    const before = run([
      { type: 'START', stage: 'generate' },
      { type: 'SUCCEED', stage: 'generate', result: generated },
      { type: 'SET_REPAIR_SETTINGS', settings: { mode: 'full', k: '3' } },
      { type: 'START', stage: 'verify' },
    ]);
    const failed = run([{ type: 'FAIL', stage: 'verify', error: networkError }], before);

    expect(failed.stages.verify).toEqual({ status: 'failed', error: networkError });
    expect(failed.results.verify).toBeUndefined();
    expect(failed.files).toBe(before.files);
    expect(failed.prompt).toBe(before.prompt);
    expect(failed.repairSettings).toEqual({ mode: 'full', k: '3', temperature: '0.1' });
    expect(statuses(failed)).toEqual(['complete', 'failed', 'locked', 'locked', 'locked']);

    // Retry clears the error and runs again.
    const retried = run([{ type: 'START', stage: 'verify' }], failed);
    expect(retried.stages.verify).toEqual({ status: 'running' });
    const done = run([{ type: 'SUCCEED', stage: 'verify', result: verification }], retried);
    expect(done.results.verify).toBe(verification);
  });
});

describe('workbench reducer: invalidation', () => {
  it('re-running a stage discards later results and locks later stages', () => {
    const complete = run(throughRepair);
    expect(complete.results.repair).toBe(repairView);

    const rerun = run([{ type: 'START', stage: 'verify' }], complete);
    expect(statuses(rerun)).toEqual(['complete', 'running', 'locked', 'locked', 'locked']);
    expect(rerun.results.verify).toBeUndefined();
    expect(rerun.results.repair).toBeUndefined();
    expect(rerun.results.generate).toBe(generated);
    expect(rerun.files).toBe(complete.files);
  });

  it('re-running Generate invalidates everything after it', () => {
    const rerun = run([...throughRepair, { type: 'START', stage: 'generate' }]);
    expect(statuses(rerun)).toEqual(['running', 'locked', 'locked', 'locked', 'locked']);
    expect(rerun.results).toEqual({});
    expect(rerun.current).toBe('generate');
  });

  it('editing files discards later results; only Verify becomes available', () => {
    const complete = run([...throughRepair, { type: 'SELECT', stage: 'report' }]);
    const edited = run([{ type: 'EDIT_FILES', files: [file('def add(a, b): return a + b')] }], complete);

    expect(statuses(edited)).toEqual(['complete', 'available', 'locked', 'locked', 'locked']);
    expect(edited.results.verify).toBeUndefined();
    expect(edited.results.repair).toBeUndefined();
    expect(edited.files[0].content).toBe('def add(a, b): return a + b');
    // The current stage falls back from the now-locked Report to the nearest unlocked stage.
    expect(edited.current).toBe('verify');
  });

  it('applying the repair replaces files, invalidates from Verify and sets the confirmation', () => {
    const repaired = [file('def add(a, b): return a + b')];
    const applied = run([...throughRepair, { type: 'APPLY_REPAIR', files: repaired }]);
    expect(applied.files).toBe(repaired);
    expect(statuses(applied)).toEqual(['complete', 'available', 'locked', 'locked', 'locked']);
    expect(applied.notice).toBe(REPAIR_APPLIED_MESSAGE);
    expect(applied.results.repair).toBeUndefined();
  });

  it('ignores APPLY_REPAIR before the repair completes', () => {
    const state = run(throughRepair.slice(0, 6));
    expect(run([{ type: 'APPLY_REPAIR', files: [file('y')] }], state)).toBe(state);
  });
});

describe('workbench reducer: results only from the current request', () => {
  it('ignores a result that arrives after the stage was invalidated', () => {
    const state = run([
      { type: 'START', stage: 'generate' },
      { type: 'SUCCEED', stage: 'generate', result: generated },
      { type: 'START', stage: 'verify' },
      { type: 'EDIT_FILES', files: [file('z = 2')] },
      { type: 'SUCCEED', stage: 'verify', result: verification },
    ]);
    expect(state.results.verify).toBeUndefined();
    expect(state.stages.verify.status).toBe('available');
  });

  it('ignores SUCCEED/FAIL carrying a stale request id', () => {
    const state = run([
      { type: 'START', stage: 'generate' },
      { type: 'SUCCEED', stage: 'generate', result: generated },
      { type: 'START', stage: 'verify', requestId: 'r1' },
      { type: 'EDIT_FILES', files: [file('z = 2')] },
      { type: 'START', stage: 'verify', requestId: 'r2' },
      { type: 'SUCCEED', stage: 'verify', result: verification, requestId: 'r1' },
      { type: 'FAIL', stage: 'verify', error: networkError, requestId: 'r1' },
    ]);
    expect(state.stages.verify).toEqual({ status: 'running', requestId: 'r2' });
    expect(state.results.verify).toBeUndefined();

    const done = run([{ type: 'SUCCEED', stage: 'verify', result: verification, requestId: 'r2' }], state);
    expect(done.results.verify).toBe(verification);
  });

  it('allows at most one running stage', () => {
    const state = run([...throughRepair.slice(0, 2), { type: 'START', stage: 'verify' }]);
    expect(runningStage(state)).toBe('verify');
    const regen = run([{ type: 'START', stage: 'generate' }], state);
    expect(STAGES.filter((id) => regen.stages[id].status === 'running')).toEqual(['generate']);
  });
});

describe('workbench reducer: repair settings and section independence', () => {
  it('ignores settings changes while the repair is running', () => {
    const running = run(throughRepair.slice(0, 6));
    expect(run([{ type: 'SET_REPAIR_SETTINGS', settings: { k: '1' } }], running)).toBe(running);
  });

  it('keeps files, statuses and results when only stage selection changes', () => {
    const complete = run(throughRepair);
    const browsed = run(
      [
        { type: 'SELECT', stage: 'generate' },
        { type: 'SELECT', stage: 'verify' },
        { type: 'SELECT', stage: 'report' },
      ],
      complete,
    );
    expect(browsed.files).toBe(complete.files);
    expect(browsed.stages).toEqual(complete.stages);
    expect(browsed.results).toEqual(complete.results);
  });
});
