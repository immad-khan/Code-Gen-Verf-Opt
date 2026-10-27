// Pure helpers shared by the Workbench stage components (Requirements 23, 25, 28).
// Kept free of JSX so they can be unit-tested in the Node test environment.

import { toApiErrorView } from '../../api/client';
import type { FindingLocation } from '../../api/types';
import {
  STAGE_LABELS,
  STAGES,
  type OperationStageId,
  type StageId,
  type StageStatus,
  type SucceedAction,
  type WorkbenchAction,
  type WorkbenchState,
} from '../../state/workbench';

export const STATUS_LABELS: Record<StageStatus, string> = {
  locked: 'Locked',
  available: 'Available',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
};

export interface StepperItem {
  id: StageId;
  /** 1-based position in the fixed stage order. */
  position: number;
  label: string;
  status: StageStatus;
  statusLabel: string;
  current: boolean;
  /** Locked stages cannot be navigated to (25.4). */
  disabled: boolean;
}

/** One item per stage, in the fixed order Generate → Verify → Diagnose → Repair → Report (25.3). */
export function stepperItems(state: Pick<WorkbenchState, 'stages' | 'current'>): StepperItem[] {
  return STAGES.map((id, index) => {
    const status = state.stages[id].status;
    return {
      id,
      position: index + 1,
      label: STAGE_LABELS[id],
      status,
      statusLabel: STATUS_LABELS[status],
      current: state.current === id,
      disabled: status === 'locked',
    };
  });
}

/** "app/main.py, line 12", "app/main.py" (no line), or null when there is no location. */
export function formatLocation(location: { file: string | null; line: number | null } | FindingLocation | null): string | null {
  if (!location || !location.file) return null;
  return location.line != null ? `${location.file}, line ${location.line}` : location.file;
}

/** Result type that SUCCEED carries for an operation stage. */
export type StageResult<S extends OperationStageId> = Extract<SucceedAction, { stage: S }>['result'];

let requestCounter = 0;

/** Unique token for one stage request, so late responses of superseded requests are dropped (23.4). */
export function nextRequestId(stage: OperationStageId): string {
  requestCounter += 1;
  return `${stage}-${requestCounter}`;
}

export type StageOutcome<S extends OperationStageId> =
  | { ok: true; result: StageResult<S> }
  | { ok: false; error: ReturnType<typeof toApiErrorView> };

/**
 * Runs one stage operation: START, then SUCCEED with the returned result or
 * FAIL with the error (named after `operation`). Nothing is fabricated on
 * failure; the reducer keeps files and inputs unchanged (23.2, 25.5).
 */
export async function runStageOperation<S extends OperationStageId>(
  dispatch: (action: WorkbenchAction) => void,
  stage: S,
  operation: string,
  run: () => Promise<StageResult<S>>,
  requestId: string = nextRequestId(stage),
): Promise<StageOutcome<S>> {
  dispatch({ type: 'START', stage, requestId });
  try {
    const result = await run();
    dispatch({ type: 'SUCCEED', stage, result, requestId } as SucceedAction);
    return { ok: true, result };
  } catch (error) {
    const view = toApiErrorView(error, operation);
    dispatch({ type: 'FAIL', stage, error: view, requestId });
    return { ok: false, error: view };
  }
}

/** Why the Verify action is disabled, or null when it can start (23.7, 28.2). */
export function verifyBlockedReason(input: {
  status: StageStatus;
  offline: boolean;
  fileCount: number;
}): string | null {
  if (input.status === 'locked') return 'Complete the Generate stage first.';
  if (input.status === 'running') return 'Verification is running.';
  if (input.offline) return 'The MACI backend is offline. Verification is unavailable until it reconnects.';
  if (input.fileCount === 0) return 'There are no working files to verify.';
  return null;
}
