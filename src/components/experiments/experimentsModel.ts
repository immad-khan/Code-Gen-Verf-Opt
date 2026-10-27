// Pure helpers behind the Experiments View (Requirement 27). Kept free of React
// so they can be tested in the Node test environment.

import { ApiError, type ApiErrorView, toApiErrorView } from '../../api/client';
import type {
  FeedbackRegime,
  GenerationPromptStyle,
  InvalidField,
  LlmMode,
  RepairModeAll,
  RunProvenance,
  RunStatus,
  RunStatusValue,
  StartRunRequest,
} from '../../api/types';
import { OPERATIONS } from '../../api/endpoints';

/** Active-run status refresh interval; must be ≤ 3 s (27.2). */
export const ACTIVE_RUN_POLL_MS = 2_000;
/** Runner output lines shown for the active run (27.2). */
export const OUTPUT_TAIL_LINES = 200;
/** Trajectory entries per page (27.8). */
export const TRAJECTORY_PAGE_SIZE = 50;
/** Number of runs that can be compared at once (27.6). */
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 10;

export const REPAIR_MODES_ALL: ReadonlyArray<RepairModeAll> = [
  'dou',
  'dou_no_bt',
  'generic',
  'evidence_only',
  'taxonomy_only',
  'full',
  'intervenor',
  'dou_intervenor',
];
export const FEEDBACK_REGIMES: ReadonlyArray<FeedbackRegime> = ['dou', 'strict'];
export const GENERATION_PROMPT_STYLES: ReadonlyArray<GenerationPromptStyle> = ['dou', 'tivr'];

// ─────────────────────────────────────────────────────────────
// Start-run form (27.1, 27.9)
// ─────────────────────────────────────────────────────────────

/** Raw form values. Numbers are kept as entered so they survive a rejection unchanged (27.9). */
export interface StartRunFormValues {
  dataset: string;
  repairMode: RepairModeAll;
  feedbackRegime: FeedbackRegime;
  k: string;
  temperature: string;
  generationPromptStyle: GenerationPromptStyle;
  sampleSize: string;
  seed: string;
  /** '' means no cache (generate fresh). */
  generationCache: string;
  mock: boolean;
}

export type StartRunField = keyof StartRunFormValues;

/** Defaults match the Experiments API defaults. */
export const DEFAULT_START_RUN_VALUES: StartRunFormValues = {
  dataset: '',
  repairMode: 'dou',
  feedbackRegime: 'dou',
  k: '2',
  temperature: '0.1',
  generationPromptStyle: 'dou',
  sampleSize: '120',
  seed: '0',
  generationCache: '',
  mock: false,
};

export const START_RUN_LABELS: Record<StartRunField, string> = {
  dataset: 'Dataset',
  repairMode: 'Repair mode',
  feedbackRegime: 'Feedback regime',
  k: 'Iterations (k)',
  temperature: 'Temperature',
  generationPromptStyle: 'Generation prompt style',
  sampleSize: 'Sample size',
  seed: 'Sample seed',
  generationCache: 'Generation cache',
  mock: 'Mock mode',
};

export type StartRunValidation =
  | { ok: true; request: StartRunRequest }
  | { ok: false; errors: Partial<Record<StartRunField, string>> };

function parseInteger(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

function parseDecimal(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Checks the entered values against the Experiments API ranges and builds the request body. */
export function validateStartRunForm(values: StartRunFormValues): StartRunValidation {
  const errors: Partial<Record<StartRunField, string>> = {};
  if (values.dataset.trim() === '') errors.dataset = 'Dataset: choose a prepared dataset.';
  const k = parseInteger(values.k, 1, 10);
  if (k === null) errors.k = 'Iterations (k): enter a whole number from 1 to 10.';
  const temperature = parseDecimal(values.temperature, 0, 2);
  if (temperature === null) errors.temperature = 'Temperature: enter a number from 0.0 to 2.0.';
  const sampleSize = parseInteger(values.sampleSize, 1, 10_000);
  if (sampleSize === null) errors.sampleSize = 'Sample size: enter a whole number from 1 to 10000.';
  const seed = parseInteger(values.seed, 0, 2_147_483_647);
  if (seed === null) errors.seed = 'Sample seed: enter a whole number from 0 to 2147483647.';

  if (Object.keys(errors).length > 0 || k === null || temperature === null || sampleSize === null || seed === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    request: {
      dataset: values.dataset,
      repairMode: values.repairMode,
      feedbackRegime: values.feedbackRegime,
      k,
      temperature,
      generationPromptStyle: values.generationPromptStyle,
      sampleSize,
      seed,
      generationCache: values.generationCache === '' ? null : values.generationCache,
      mock: values.mock,
    },
  };
}

/** A rejected start-run request (27.9). */
export interface StartRunRejection {
  error: ApiErrorView;
  invalidFields: InvalidField[];
  activeRunId: string | null;
}

/** Extracts the rejection reason, field errors, and conflicting run from a failed start-run request. */
export function toStartRunRejection(error: unknown): StartRunRejection {
  const view = toApiErrorView(error, OPERATIONS.experiments);
  let invalidFields: InvalidField[] = [];
  let activeRunId: string | null = null;
  if (error instanceof ApiError && error.body && typeof error.body === 'object') {
    const body = error.body as { invalidFields?: unknown; activeRunId?: unknown };
    if (Array.isArray(body.invalidFields)) {
      invalidFields = body.invalidFields.filter(
        (f): f is InvalidField =>
          !!f && typeof f === 'object' && typeof (f as InvalidField).field === 'string' &&
          typeof (f as InvalidField).message === 'string',
      );
    }
    if (typeof body.activeRunId === 'string') activeRunId = body.activeRunId;
  }
  return { error: view, invalidFields, activeRunId };
}

// ─────────────────────────────────────────────────────────────
// Errors (27.11)
// ─────────────────────────────────────────────────────────────

/** Error text for a failed Experiments API request. Network failures and timeouts say the API is unreachable. */
export function experimentsErrorText(error: ApiErrorView): { title: string; message: string } {
  const unreachable = error.kind === 'network' || error.kind === 'timeout';
  const title = unreachable ? 'Experiments API unreachable' : 'Experiments API request failed';
  const fallback = unreachable
    ? 'The Experiments API did not respond within 10 seconds or could not be reached.'
    : 'The Experiments API returned an error without a message.';
  const message = error.message.trim() !== '' ? error.message : fallback;
  return { title, message };
}

// ─────────────────────────────────────────────────────────────
// Runs
// ─────────────────────────────────────────────────────────────

export function isRunActive(status: RunStatusValue | null | undefined): boolean {
  return status === 'running';
}

/** Badge tone for a run status (the status text itself carries the meaning). */
export function runStatusTone(status: RunStatusValue): 'info' | 'success' | 'danger' | 'warning' {
  switch (status) {
    case 'running':
      return 'info';
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return 'warning';
  }
}

export type RunBadgeKind = 'mock' | 'legacy';

/** Status badges for a run (27.4): `mock` for llm_mode mock, `legacy` for legacy provenance. */
export function runBadges(llmMode: LlmMode | null | undefined, provenance: RunProvenance | null | undefined): RunBadgeKind[] {
  const badges: RunBadgeKind[] = [];
  if (llmMode === 'mock') badges.push('mock');
  if (provenance === 'legacy') badges.push('legacy');
  return badges;
}

/** Toggles a run in the comparison selection, never exceeding COMPARE_MAX runs. */
export function toggleSelection(selected: ReadonlyArray<string>, runId: string, max = COMPARE_MAX): string[] {
  if (selected.includes(runId)) return selected.filter((id) => id !== runId);
  if (selected.length >= max) return [...selected];
  return [...selected, runId];
}

/** "37 / 164 tasks", or null when the counts are unknown. */
export function progressText(status: Pick<RunStatus, 'completed' | 'total'>): string | null {
  if (status.completed == null || status.total == null) return null;
  return `${status.completed} / ${status.total} tasks`;
}

/** The last OUTPUT_TAIL_LINES lines of runner output. */
export function outputTail(lines: ReadonlyArray<string> | null | undefined): string[] {
  if (!lines) return [];
  return lines.slice(Math.max(0, lines.length - OUTPUT_TAIL_LINES));
}

/** Number of trajectory pages (at least 1). */
export function pageCount(total: number, pageSize = TRAJECTORY_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0 || pageSize <= 0) return 1;
  return Math.ceil(total / pageSize);
}
