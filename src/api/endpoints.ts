// Typed wrappers for every MACI backend endpoint used by the Web UI.
// Workbench calls use the 120 s timeout, Experiments calls 10 s, health 5 s.

import { apiRequest, jsonInit, TIMEOUTS } from './client';
import type {
  CacheInfo,
  CancelRunResponse,
  CreateRepairSessionResponse,
  DatasetInfo,
  GeneratedCodeFile,
  HealthResponse,
  RepairIteration,
  RepairSessionRequest,
  RepairSessionView,
  RunDetail,
  RunListItem,
  RunStatus,
  StartRunRequest,
  StartRunResponse,
  TrajectoryPage,
  VerificationResult,
} from './types';

/** Operation names shown in error states (23.1). */
export const OPERATIONS = {
  verify: 'verification',
  repair: 'repair',
  health: 'health check',
  experiments: 'experiments',
} as const;

export interface RequestOptions {
  signal?: AbortSignal;
}

const seg = encodeURIComponent;

// ── Workbench ────────────────────────────────────────────────

/** POST /api/verification */
export function verify(files: GeneratedCodeFile[], opts: RequestOptions = {}): Promise<VerificationResult> {
  return apiRequest<VerificationResult>(
    OPERATIONS.verify,
    '/api/verification',
    jsonInit('POST', { files }, opts.signal),
    TIMEOUTS.workbench,
  );
}

/** POST /api/optimization/repair-sessions → 202 {sessionId, effectiveConfig} */
export function createRepairSession(
  request: RepairSessionRequest,
  opts: RequestOptions = {},
): Promise<CreateRepairSessionResponse> {
  return apiRequest<CreateRepairSessionResponse>(
    OPERATIONS.repair,
    '/api/optimization/repair-sessions',
    jsonInit('POST', request, opts.signal),
    TIMEOUTS.workbench,
  );
}

/** GET /api/optimization/repair-sessions/{id} */
export function getRepairSession(sessionId: string, opts: RequestOptions = {}): Promise<RepairSessionView> {
  return apiRequest<RepairSessionView>(
    OPERATIONS.repair,
    `/api/optimization/repair-sessions/${seg(sessionId)}`,
    { method: 'GET', signal: opts.signal },
    TIMEOUTS.workbench,
  );
}

/** GET /api/optimization/repair-sessions/{id}/iterations/{n} */
export function getRepairIteration(
  sessionId: string,
  iteration: number,
  opts: RequestOptions = {},
): Promise<RepairIteration> {
  return apiRequest<RepairIteration>(
    OPERATIONS.repair,
    `/api/optimization/repair-sessions/${seg(sessionId)}/iterations/${seg(String(iteration))}`,
    { method: 'GET', signal: opts.signal },
    TIMEOUTS.workbench,
  );
}

// ── Health ───────────────────────────────────────────────────

/** GET /api/health (5 s timeout, 23.6) */
export function health(opts: RequestOptions = {}): Promise<HealthResponse> {
  return apiRequest<HealthResponse>(
    OPERATIONS.health,
    '/api/health',
    { method: 'GET', signal: opts.signal },
    TIMEOUTS.health,
  );
}

// ── Experiments ──────────────────────────────────────────────

function experimentsGet<T>(path: string, opts: RequestOptions): Promise<T> {
  return apiRequest<T>(OPERATIONS.experiments, path, { method: 'GET', signal: opts.signal }, TIMEOUTS.experiments);
}

export const experiments = {
  /** GET /api/experiments/datasets */
  listDatasets(opts: RequestOptions = {}): Promise<DatasetInfo[]> {
    return experimentsGet<DatasetInfo[]>('/api/experiments/datasets', opts);
  },

  /** GET /api/experiments/caches */
  listCaches(opts: RequestOptions = {}): Promise<CacheInfo[]> {
    return experimentsGet<CacheInfo[]>('/api/experiments/caches', opts);
  },

  /** POST /api/experiments/runs → 202 {runId} | 400 {error, invalidFields} | 409 {error, activeRunId} */
  startRun(request: StartRunRequest, opts: RequestOptions = {}): Promise<StartRunResponse> {
    return apiRequest<StartRunResponse>(
      OPERATIONS.experiments,
      '/api/experiments/runs',
      jsonInit('POST', request, opts.signal),
      TIMEOUTS.experiments,
    );
  },

  /** GET /api/experiments/runs (newest first) */
  listRuns(opts: RequestOptions = {}): Promise<RunListItem[]> {
    return experimentsGet<RunListItem[]>('/api/experiments/runs', opts);
  },

  /** GET /api/experiments/runs/{id} */
  getRun(runId: string, opts: RequestOptions = {}): Promise<RunDetail> {
    return experimentsGet<RunDetail>(`/api/experiments/runs/${seg(runId)}`, opts);
  },

  /** GET /api/experiments/runs/{id}/status */
  getRunStatus(runId: string, opts: RequestOptions = {}): Promise<RunStatus> {
    return experimentsGet<RunStatus>(`/api/experiments/runs/${seg(runId)}/status`, opts);
  },

  /** POST /api/experiments/runs/{id}/cancel */
  cancelRun(runId: string, opts: RequestOptions = {}): Promise<CancelRunResponse> {
    return apiRequest<CancelRunResponse>(
      OPERATIONS.experiments,
      `/api/experiments/runs/${seg(runId)}/cancel`,
      { method: 'POST', signal: opts.signal },
      TIMEOUTS.experiments,
    );
  },

  /** GET /api/experiments/runs/{id}/trajectories?page=N (50 entries per page; page ≥ 1) */
  getTrajectories(runId: string, page: number, opts: RequestOptions = {}): Promise<TrajectoryPage> {
    const query = new URLSearchParams({ page: String(page) });
    return experimentsGet<TrajectoryPage>(`/api/experiments/runs/${seg(runId)}/trajectories?${query}`, opts);
  },
};
