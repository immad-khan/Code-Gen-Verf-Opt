// Property 39: Workbench reducer invariants.
// **Validates: Requirements 25.3, 25.4, 25.5, 25.6, 23.4**
//
// Random action sequences (optionally after a random-length prefix of the
// happy path, so the deep stages are reached) are folded through the pure
// reducer. The stepper invariants are checked after every step, together with
// per-action postconditions for FAIL, START, EDIT_FILES, APPLY_REPAIR, SELECT,
// SUCCEED and SET_REPAIR_SETTINGS.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ApiErrorView } from '../api/client';
import type { GeneratedCodeFile, RepairSessionView, VerificationResult } from '../api/types';
import { REPAIR_MODES } from '../lib/repairSettings';
import {
  STAGES,
  createInitialState,
  workbenchReducer,
  type GenerateResult,
  type OperationStageId,
  type StageId,
  type StageStatus,
  type WorkbenchAction,
  type WorkbenchResults,
  type WorkbenchState,
} from './workbench';

const NUM_RUNS = 200;

const STATUSES: readonly StageStatus[] = ['locked', 'available', 'running', 'complete', 'failed'];
const OPERATION_STAGES: readonly OperationStageId[] = ['generate', 'verify', 'repair'];
const RESULT_KEY: Partial<Record<StageId, keyof WorkbenchResults>> = {
  generate: 'generate',
  verify: 'verify',
  repair: 'repair',
};

// ─────────────────────────────────────────────────────────────
// Generators
// ─────────────────────────────────────────────────────────────

const fileArb: fc.Arbitrary<GeneratedCodeFile> = fc
  .record({ name: fc.constantFrom('main.py', 'util.py'), content: fc.string({ maxLength: 16 }) })
  .map(({ name, content }) => ({ name, path: name, language: 'python', content, description: '', category: 'other' }));

const filesArb = fc.array(fileArb, { maxLength: 3 });

const requestIdArb = fc.option(fc.constantFrom('r1', 'r2'), { nil: undefined });

const generateResultArb: fc.Arbitrary<GenerateResult> = fc.record({
  prompt: fc.string({ maxLength: 12 }),
  files: filesArb,
});

const verificationArb: fc.Arbitrary<VerificationResult> = fc.boolean().map((gatePassed) => ({
  techniques: [],
  correctnessFindings: [],
  advisoryFindings: [],
  gatePassed,
  complete: true,
  incompleteTechniques: [],
  primaryState: gatePassed ? 'PASS' : 'C',
  testsPassed: gatePassed ? 1 : 0,
  testsFailed: gatePassed ? 0 : 1,
  durationMs: 1,
}));

const repairViewArb: fc.Arbitrary<RepairSessionView> = fc.string({ maxLength: 6 }).map((sessionId) => ({
  sessionId,
  status: 'completed',
  effectiveConfig: { repairMode: 'dou', k: 2, temperature: 0.1 },
  iterationsCompleted: 1,
  partial: null,
  result: null,
  error: null,
}));

const errorArb: fc.Arbitrary<ApiErrorView> = fc.record({
  kind: fc.constantFrom('network', 'timeout', 'http', 'unknown') as fc.Arbitrary<ApiErrorView['kind']>,
  operation: fc.constantFrom('generation', 'verification', 'repair'),
  message: fc.string({ maxLength: 12 }),
});

const settingsArb = fc.record(
  {
    mode: fc.constantFrom(...REPAIR_MODES),
    k: fc.constantFrom('1', '2', '3', '0', '9', '', 'x'),
    temperature: fc.constantFrom('0', '0.1', '1', '1.5', '-1', ''),
  },
  { requiredKeys: [] },
);

const actionArb: fc.Arbitrary<WorkbenchAction> = fc.oneof(
  { arbitrary: fc.record({ type: fc.constant('START' as const), stage: fc.constantFrom(...OPERATION_STAGES), requestId: requestIdArb }), weight: 4 },
  {
    arbitrary: fc.oneof(
      fc.record({ type: fc.constant('SUCCEED' as const), stage: fc.constant('generate' as const), result: generateResultArb, requestId: requestIdArb }),
      fc.record({ type: fc.constant('SUCCEED' as const), stage: fc.constant('verify' as const), result: verificationArb, requestId: requestIdArb }),
      fc.record({ type: fc.constant('SUCCEED' as const), stage: fc.constant('repair' as const), result: repairViewArb, requestId: requestIdArb }),
    ),
    weight: 4,
  },
  { arbitrary: fc.record({ type: fc.constant('FAIL' as const), stage: fc.constantFrom(...OPERATION_STAGES), error: errorArb, requestId: requestIdArb }), weight: 2 },
  { arbitrary: fc.record({ type: fc.constant('ACKNOWLEDGE' as const), stage: fc.constantFrom('diagnose' as const, 'report' as const) }), weight: 3 },
  { arbitrary: fc.record({ type: fc.constant('EDIT_FILES' as const), files: filesArb }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('APPLY_REPAIR' as const), files: filesArb }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant('SELECT' as const), stage: fc.constantFrom(...STAGES) }), weight: 3 },
  { arbitrary: fc.record({ type: fc.constant('SET_REPAIR_SETTINGS' as const), settings: settingsArb }), weight: 2 },
);

const HAPPY_PATH: WorkbenchAction[] = [
  { type: 'START', stage: 'generate' },
  { type: 'SUCCEED', stage: 'generate', result: { prompt: 'p', files: [] } },
  { type: 'START', stage: 'verify' },
  {
    type: 'SUCCEED',
    stage: 'verify',
    result: {
      techniques: [],
      correctnessFindings: [],
      advisoryFindings: [],
      gatePassed: false,
      complete: true,
      incompleteTechniques: [],
      primaryState: 'C',
      testsPassed: 0,
      testsFailed: 1,
      durationMs: 1,
    },
  },
  { type: 'ACKNOWLEDGE', stage: 'diagnose' },
  { type: 'START', stage: 'repair' },
  {
    type: 'SUCCEED',
    stage: 'repair',
    result: {
      sessionId: 's',
      status: 'completed',
      effectiveConfig: { repairMode: 'dou', k: 2, temperature: 0.1 },
      iterationsCompleted: 1,
      partial: null,
      result: null,
      error: null,
    },
  },
  { type: 'ACKNOWLEDGE', stage: 'report' },
];

/** A random-length happy-path prefix followed by random actions. */
const sequenceArb: fc.Arbitrary<WorkbenchAction[]> = fc
  .tuple(fc.integer({ min: 0, max: HAPPY_PATH.length }), fc.array(actionArb, { maxLength: 40 }))
  .map(([prefix, rest]) => [...HAPPY_PATH.slice(0, prefix), ...rest]);

// ─────────────────────────────────────────────────────────────
// Invariants and postconditions
// ─────────────────────────────────────────────────────────────

function assertStepperInvariants(state: WorkbenchState): void {
  // Exactly one status per stage, from the allowed set (25.3).
  expect(Object.keys(state.stages).sort()).toEqual([...STAGES].sort());
  for (const id of STAGES) expect(STATUSES).toContain(state.stages[id].status);

  // Generate is never locked; stage i>0 is locked iff its predecessor is not complete (25.4).
  expect(state.stages.generate.status).not.toBe('locked');
  for (let i = 1; i < STAGES.length; i++) {
    const predecessorComplete = state.stages[STAGES[i - 1]].status === 'complete';
    expect(state.stages[STAGES[i]].status === 'locked').toBe(!predecessorComplete);
  }

  // At most one stage is running.
  expect(STAGES.filter((id) => state.stages[id].status === 'running').length).toBeLessThanOrEqual(1);

  // The current stage is never locked.
  expect(state.stages[state.current].status).not.toBe('locked');

  // Results exist only for complete stages: nothing stale or from another request (23.4).
  for (const id of STAGES) {
    const key = RESULT_KEY[id];
    if (key && state.results[key] !== undefined) expect(state.stages[id].status).toBe('complete');
  }
  // Only failed stages carry an error.
  for (const id of STAGES) {
    if (state.stages[id].status !== 'failed') expect(state.stages[id].error).toBeUndefined();
  }
}

function isCurrentRequest(state: WorkbenchState, stage: StageId, requestId: string | undefined): boolean {
  const s = state.stages[stage];
  return s.status === 'running' && (s.requestId === undefined || s.requestId === requestId);
}

function laterStages(stage: StageId): StageId[] {
  return STAGES.slice(STAGES.indexOf(stage) + 1);
}

/** After EDIT_FILES / accepted APPLY_REPAIR: files replaced, Verify onward invalidated (25.6). */
function assertFilesReplaced(prev: WorkbenchState, next: WorkbenchState, files: GeneratedCodeFile[]): void {
  expect(next.files).toBe(files);
  expect(next.prompt).toBe(prev.prompt);
  expect(next.stages.generate).toEqual(prev.stages.generate);
  expect(next.results.generate).toBe(prev.results.generate);
  expect(next.results.verify).toBeUndefined();
  expect(next.results.repair).toBeUndefined();
  // Only the stage after the latest complete stage is available.
  expect(next.stages.verify.status).toBe(prev.stages.generate.status === 'complete' ? 'available' : 'locked');
  for (const id of laterStages('verify')) expect(next.stages[id].status).toBe('locked');
}

function assertPostconditions(prev: WorkbenchState, action: WorkbenchAction, next: WorkbenchState): void {
  // Settings change only through SET_REPAIR_SETTINGS, and never while the repair runs (25.8).
  if (action.type !== 'SET_REPAIR_SETTINGS' || prev.stages.repair.status === 'running') {
    expect(next.repairSettings).toEqual(prev.repairSettings);
  }

  switch (action.type) {
    case 'START': {
      const status = prev.stages[action.stage].status;
      if (status === 'locked' || status === 'running') {
        expect(next).toBe(prev);
        break;
      }
      // The stage runs, its own and every later result is discarded, later stages lock (25.6, 23.4).
      expect(next.stages[action.stage].status).toBe('running');
      expect(next.results[RESULT_KEY[action.stage]!]).toBeUndefined();
      for (const id of laterStages(action.stage)) {
        expect(next.stages[id].status).toBe('locked');
        const key = RESULT_KEY[id];
        if (key) expect(next.results[key]).toBeUndefined();
      }
      for (const id of STAGES.slice(0, STAGES.indexOf(action.stage))) {
        expect(next.stages[id]).toEqual(prev.stages[id]);
      }
      expect(next.files).toBe(prev.files);
      expect(next.prompt).toBe(prev.prompt);
      break;
    }

    case 'SUCCEED': {
      if (!isCurrentRequest(prev, action.stage, action.requestId)) {
        // Results only from the request currently running for the stage (23.4).
        expect(next).toBe(prev);
        break;
      }
      expect(next.stages[action.stage].status).toBe('complete');
      expect(next.results[action.stage]).toBe(action.result);
      break;
    }

    case 'FAIL': {
      // Files, prompt and settings are kept whether or not the failure applies (25.5, 23.2).
      expect(next.files).toBe(prev.files);
      expect(next.prompt).toBe(prev.prompt);
      expect(next.repairSettings).toBe(prev.repairSettings);
      if (!isCurrentRequest(prev, action.stage, action.requestId)) {
        expect(next).toBe(prev);
        break;
      }
      expect(next.stages[action.stage]).toEqual({ status: 'failed', error: action.error });
      expect(next.results[action.stage]).toBeUndefined();
      break;
    }

    case 'ACKNOWLEDGE': {
      if (prev.stages[action.stage].status !== 'available') expect(next).toBe(prev);
      else expect(next.stages[action.stage].status).toBe('complete');
      break;
    }

    case 'EDIT_FILES':
      assertFilesReplaced(prev, next, action.files);
      break;

    case 'APPLY_REPAIR':
      if (prev.stages.repair.status !== 'complete') expect(next).toBe(prev);
      else assertFilesReplaced(prev, next, action.files);
      break;

    case 'SELECT':
      // Navigation to a locked stage is ignored (25.4).
      if (prev.stages[action.stage].status === 'locked') expect(next).toBe(prev);
      else expect(next.current).toBe(action.stage);
      expect(next.stages).toEqual(prev.stages);
      expect(next.results).toEqual(prev.results);
      break;

    case 'SET_REPAIR_SETTINGS':
      if (prev.stages.repair.status === 'running') expect(next).toBe(prev);
      else expect(next.repairSettings).toEqual({ ...prev.repairSettings, ...action.settings });
      expect(next.stages).toEqual(prev.stages);
      break;
  }
}

describe('Property 39: Workbench reducer invariants', () => {
  it('holds the stepper invariants and action postconditions after every step', () => {
    fc.assert(
      fc.property(sequenceArb, (actions) => {
        let state = createInitialState();
        assertStepperInvariants(state);
        for (const action of actions) {
          const next = workbenchReducer(state, action);
          assertStepperInvariants(next);
          assertPostconditions(state, action, next);
          state = next;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
