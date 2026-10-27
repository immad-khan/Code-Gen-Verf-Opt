// Workbench state as a pure reducer (design D10, §Workbench reducer).
//
// Stages run in the fixed order Generate → Verify → Diagnose → Repair → Report
// (25.3). Each stage has exactly one status. A stage other than Generate is
// locked whenever its predecessor is not complete (25.4). Starting a stage or
// changing the working files discards every later result (25.6). Failures keep
// the files and inputs (25.5). Results are stored only for the request that is
// currently running for that stage (23.4).
//
// The state holds no section information: it lives above the Workbench /
// Experiments switch, so switching sections never touches it (25.2).

import type { ApiErrorView } from '../api/client';
import type { GeneratedCodeFile, RepairSessionView, VerificationResult } from '../api/types';
import { DEFAULT_REPAIR_SETTINGS, type RepairSettings } from '../lib/repairSettings';

export const STAGES = ['generate', 'verify', 'diagnose', 'repair', 'report'] as const;
export type StageId = (typeof STAGES)[number];
export type StageStatus = 'locked' | 'available' | 'running' | 'complete' | 'failed';

/** Stages backed by a backend/LLM operation (START → SUCCEED/FAIL). */
export type OperationStageId = 'generate' | 'verify' | 'repair';
/** View-only stages, completed by ACKNOWLEDGE. */
export type ViewStageId = 'diagnose' | 'report';

export const STAGE_LABELS: Record<StageId, string> = {
  generate: 'Generate',
  verify: 'Verify',
  diagnose: 'Diagnose',
  repair: 'Repair',
  report: 'Report',
};

/** Output of the Generate stage (real LLM output). */
export interface GenerateResult {
  /** The prompt that produced these files; used as the repair `originalPrompt`. */
  prompt: string;
  files: GeneratedCodeFile[];
  modelUsed?: string;
}

export interface StageState {
  status: StageStatus;
  error?: ApiErrorView;
  /** Token of the in-flight request, when START supplied one. */
  requestId?: string;
}

export interface WorkbenchResults {
  generate?: GenerateResult;
  verify?: VerificationResult;
  repair?: RepairSessionView;
}

export interface WorkbenchState {
  files: GeneratedCodeFile[];
  prompt: string;
  current: StageId;
  stages: Record<StageId, StageState>;
  results: WorkbenchResults;
  repairSettings: RepairSettings;
  /** Inline confirmation after APPLY_REPAIR (25.12); null otherwise. */
  notice: string | null;
}

export type SucceedAction =
  | { type: 'SUCCEED'; stage: 'generate'; result: GenerateResult; requestId?: string }
  | { type: 'SUCCEED'; stage: 'verify'; result: VerificationResult; requestId?: string }
  | { type: 'SUCCEED'; stage: 'repair'; result: RepairSessionView; requestId?: string };

export type WorkbenchAction =
  | { type: 'START'; stage: OperationStageId; requestId?: string }
  | SucceedAction
  | { type: 'FAIL'; stage: OperationStageId; error: ApiErrorView; requestId?: string }
  | { type: 'ACKNOWLEDGE'; stage: ViewStageId }
  | { type: 'EDIT_FILES'; files: GeneratedCodeFile[] }
  | { type: 'APPLY_REPAIR'; files: GeneratedCodeFile[] }
  | { type: 'SELECT'; stage: StageId }
  | { type: 'SET_REPAIR_SETTINGS'; settings: Partial<RepairSettings> };

export const REPAIR_APPLIED_MESSAGE = 'Repaired code applied';

/** Which result slot (if any) each stage owns. */
const RESULT_KEY: Record<StageId, keyof WorkbenchResults | null> = {
  generate: 'generate',
  verify: 'verify',
  diagnose: null,
  repair: 'repair',
  report: null,
};

export function stageIndex(stage: StageId): number {
  return STAGES.indexOf(stage);
}

export function createInitialState(
  init: Partial<Pick<WorkbenchState, 'files' | 'prompt' | 'repairSettings'>> = {},
): WorkbenchState {
  return normalize({
    files: init.files ?? [],
    prompt: init.prompt ?? '',
    current: 'generate',
    stages: {
      generate: { status: 'available' },
      verify: { status: 'locked' },
      diagnose: { status: 'locked' },
      repair: { status: 'locked' },
      report: { status: 'locked' },
    },
    results: {},
    repairSettings: { ...DEFAULT_REPAIR_SETTINGS, ...init.repairSettings },
    notice: null,
  });
}

/**
 * Enforces the stepper invariants:
 * - Generate is never locked;
 * - a later stage is locked iff its predecessor is not complete, and a locked
 *   stage whose predecessor is complete becomes available;
 * - the current stage is never locked (falls back to the nearest earlier unlocked stage).
 */
function normalize(state: WorkbenchState): WorkbenchState {
  const stages = { ...state.stages };
  if (stages.generate.status === 'locked') stages.generate = { status: 'available' };
  for (let i = 1; i < STAGES.length; i++) {
    const id = STAGES[i];
    const predecessorComplete = stages[STAGES[i - 1]].status === 'complete';
    if (!predecessorComplete) {
      if (stages[id].status !== 'locked') stages[id] = { status: 'locked' };
    } else if (stages[id].status === 'locked') {
      stages[id] = { status: 'available' };
    }
  }
  let current = state.current;
  for (let i = stageIndex(current); stages[current].status === 'locked' && i > 0; ) {
    i -= 1;
    current = STAGES[i];
  }
  return { ...state, stages, current };
}

/** Locks every stage after `stage` and discards their results (25.6). */
function invalidateAfter(state: WorkbenchState, stage: StageId): WorkbenchState {
  const from = stageIndex(stage) + 1;
  const stages = { ...state.stages };
  const results = { ...state.results };
  for (let i = from; i < STAGES.length; i++) {
    const id = STAGES[i];
    stages[id] = { status: 'locked' };
    const key = RESULT_KEY[id];
    if (key) delete results[key];
  }
  return { ...state, stages, results };
}

function clearResult(results: WorkbenchResults, stage: StageId): WorkbenchResults {
  const key = RESULT_KEY[stage];
  if (!key || !(key in results)) return results;
  const next = { ...results };
  delete next[key];
  return next;
}

/** True when a SUCCEED/FAIL belongs to the request currently running for `stage`. */
function isCurrentRequest(state: WorkbenchState, stage: StageId, requestId: string | undefined): boolean {
  const s = state.stages[stage];
  if (s.status !== 'running') return false;
  if (s.requestId !== undefined && requestId !== s.requestId) return false;
  return true;
}

/** Replaces the working files and invalidates from Verify onward. */
function replaceFiles(state: WorkbenchState, files: GeneratedCodeFile[]): WorkbenchState {
  return invalidateAfter({ ...state, files }, 'generate');
}

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'START': {
      const status = state.stages[action.stage].status;
      if (status === 'locked' || status === 'running') return state;
      const invalidated = invalidateAfter(state, action.stage);
      const stage: StageState = { status: 'running' };
      if (action.requestId !== undefined) stage.requestId = action.requestId;
      return normalize({
        ...invalidated,
        stages: { ...invalidated.stages, [action.stage]: stage },
        // A re-run never shows the earlier request's result (23.4).
        results: clearResult(invalidated.results, action.stage),
        notice: null,
      });
    }

    case 'SUCCEED': {
      if (!isCurrentRequest(state, action.stage, action.requestId)) return state;
      const stages = { ...state.stages, [action.stage]: { status: 'complete' } as StageState };
      let next: WorkbenchState;
      switch (action.stage) {
        case 'generate':
          next = {
            ...state,
            stages,
            files: action.result.files,
            prompt: action.result.prompt,
            results: { ...state.results, generate: action.result },
          };
          break;
        case 'verify':
          next = { ...state, stages, results: { ...state.results, verify: action.result } };
          break;
        case 'repair':
          next = { ...state, stages, results: { ...state.results, repair: action.result } };
          break;
      }
      return normalize(next);
    }

    case 'FAIL': {
      if (!isCurrentRequest(state, action.stage, action.requestId)) return state;
      // Files, prompt, and settings stay unchanged (25.5, 23.2).
      return normalize({
        ...state,
        stages: { ...state.stages, [action.stage]: { status: 'failed', error: action.error } },
        results: clearResult(state.results, action.stage),
      });
    }

    case 'ACKNOWLEDGE': {
      if (state.stages[action.stage].status !== 'available') return state;
      return normalize({
        ...state,
        stages: { ...state.stages, [action.stage]: { status: 'complete' } },
      });
    }

    case 'EDIT_FILES':
      return normalize({ ...replaceFiles(state, action.files), notice: null });

    case 'APPLY_REPAIR': {
      if (state.stages.repair.status !== 'complete') return state;
      return normalize({ ...replaceFiles(state, action.files), notice: REPAIR_APPLIED_MESSAGE });
    }

    case 'SELECT': {
      if (state.stages[action.stage].status === 'locked' || state.current === action.stage) return state;
      return { ...state, current: action.stage };
    }

    case 'SET_REPAIR_SETTINGS': {
      // Controls are disabled while the repair runs (25.8).
      if (state.stages.repair.status === 'running') return state;
      return { ...state, repairSettings: { ...state.repairSettings, ...action.settings } };
    }

    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────

export function canSelect(state: WorkbenchState, stage: StageId): boolean {
  return state.stages[stage].status !== 'locked';
}

export function canStart(state: WorkbenchState, stage: OperationStageId): boolean {
  const status = state.stages[stage].status;
  return status === 'available' || status === 'complete' || status === 'failed';
}

export function runningStage(state: WorkbenchState): StageId | null {
  return STAGES.find((id) => state.stages[id].status === 'running') ?? null;
}

export function stageError(state: WorkbenchState, stage: StageId): ApiErrorView | undefined {
  return state.stages[stage].status === 'failed' ? state.stages[stage].error : undefined;
}
