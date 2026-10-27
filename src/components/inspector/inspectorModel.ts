// Pure helpers behind the Repair Inspector (Requirement 26). Kept free of
// React so they can be tested in the Node test environment.

import { toApiErrorView, type ApiErrorView } from '../../api/client';
import type {
  GeneratedCodeFile,
  IterationTransition,
  PrimaryState,
  RepairIteration,
  VerificationResult,
} from '../../api/types';
import { computeLineDiff, type DiffLine, type DiffResult } from '../../utils/diff';
import { NOT_AVAILABLE_TEXT } from '../common/NotAvailable';

/** Primary_State values in chart order (bottom to top) (26.8). */
export const PRIMARY_STATES: readonly PrimaryState[] = ['A', 'B', 'C', 'PASS'];

/** Arrow used in "<from> → <to>" transitions (26.7). */
export const TRANSITION_ARROW = '→';

/** Labels for sections that are missing from an LLM response (26.4). */
export const NO_CRITIQUE_TEXT = 'The response contained no critique text.';
export const NO_EXTRACTABLE_CODE = 'The response contained no extractable code.';
/** Label for a file whose code did not change in an iteration (26.6). */
export const NO_CHANGES_TEXT = 'No changes';
/** Message shown when iteration data fails to load (26.9). */
export const ITERATION_LOAD_FAILED_TEXT = 'The iteration data could not be loaded.';

// ---------------------------------------------------------------------------
// Diff lines
// ---------------------------------------------------------------------------

/** Visible text prefix for a diff line (26.5): `+` added, `−` (U+2212) removed, space unchanged. */
export function diffLinePrefix(type: DiffLine['type']): string {
  switch (type) {
    case 'added':
      return '+';
    case 'removed':
      return '\u2212';
    default:
      return ' ';
  }
}

/** Visually hidden label read before an added/removed line; null for unchanged lines (26.5). */
export function diffLineLabel(type: DiffLine['type']): string | null {
  switch (type) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Identity of a file across iterations. */
export function fileKey(file: Pick<GeneratedCodeFile, 'path' | 'name'>): string {
  return file.path || file.name;
}

export interface FileChange {
  path: string;
  /** Content at the end of iteration i−1; null when the file did not exist. */
  before: string | null;
  /** Content at the end of iteration i; null when the file no longer exists. */
  after: string | null;
  diff: DiffResult;
  changed: boolean;
}

/**
 * Pairs files before and after an iteration by path and diffs each pair.
 * Order: files in `before` order, then files that only exist afterwards.
 */
export function fileChanges(before: readonly GeneratedCodeFile[], after: readonly GeneratedCodeFile[]): FileChange[] {
  const afterByKey = new Map(after.map((f) => [fileKey(f), f] as const));
  const seen = new Set<string>();
  const changes: FileChange[] = [];

  const push = (path: string, b: string | null, a: string | null) => {
    const diff = computeLineDiff(b ?? '', a ?? '');
    // A file that appears or disappears counts as changed even if empty.
    const changed = b !== a;
    changes.push({ path, before: b, after: a, diff, changed });
  };

  for (const file of before) {
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    push(key, file.content, afterByKey.get(key)?.content ?? null);
  }
  for (const file of after) {
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    push(key, null, file.content);
  }
  return changes;
}

/** Files whose code the LLM response changed or added in this iteration. */
export function extractedCodeFiles(iteration: Pick<RepairIteration, 'filesBefore' | 'filesAfter'>): GeneratedCodeFile[] {
  const beforeByKey = new Map(iteration.filesBefore.map((f) => [fileKey(f), f.content] as const));
  return iteration.filesAfter.filter((f) => beforeByKey.get(fileKey(f)) !== f.content);
}

/** True when the response had no critique text (null or whitespace only) (26.4). */
export function hasNoCritique(critiqueText: string | null): boolean {
  return critiqueText === null || critiqueText.trim() === '';
}

// ---------------------------------------------------------------------------
// States and transitions
// ---------------------------------------------------------------------------

/** Primary_State at the end of an iteration, or null when it could not be determined. */
export function iterationState(iteration: Pick<RepairIteration, 'transition'>): PrimaryState | null {
  return iteration.transition.available ? iteration.transition.to : null;
}

/** "<state at i−1> → <state at i>" (26.7); an undetermined state reads "not available". */
export function transitionLabel(transition: Pick<IterationTransition, 'from' | 'to' | 'available'>): string {
  const to = transition.available && transition.to ? transition.to : NOT_AVAILABLE_TEXT;
  return `${transition.from} ${TRANSITION_ARROW} ${to}`;
}

export interface EvolutionPoint {
  iteration: number;
  /** null when the Primary_State could not be determined (no point plotted). */
  state: PrimaryState | null;
}

/** One point per executed iteration, 0 (initial candidate) to the last (26.8). */
export function evolutionPoints(
  initial: Pick<VerificationResult, 'primaryState'>,
  iterations: readonly Pick<RepairIteration, 'iteration' | 'transition'>[],
): EvolutionPoint[] {
  return [
    { iteration: 0, state: initial.primaryState },
    ...sortIterations(iterations).map((it) => ({ iteration: it.iteration, state: iterationState(it) })),
  ];
}

/** Chart y-value for a state (index in PRIMARY_STATES), or null. */
export function stateValue(state: PrimaryState | null): number | null {
  if (state === null) return null;
  const index = PRIMARY_STATES.indexOf(state);
  return index < 0 ? null : index;
}

// ---------------------------------------------------------------------------
// Iteration collection and loading
// ---------------------------------------------------------------------------

function sortIterations<T extends { iteration: number }>(iterations: readonly T[]): T[] {
  return [...iterations].sort((a, b) => a.iteration - b.iteration);
}

/**
 * Union of iteration lists keyed by iteration number, in ascending order
 * (26.1). Later lists win for the same iteration number.
 */
export function mergeIterations(...lists: ReadonlyArray<readonly RepairIteration[]>): RepairIteration[] {
  const byNumber = new Map<number, RepairIteration>();
  for (const list of lists) for (const it of list) byNumber.set(it.iteration, it);
  return sortIterations([...byNumber.values()]);
}

/** Executed iterations (1..completed) not present in `iterations`, ascending. */
export function missingIterations(iterations: readonly Pick<RepairIteration, 'iteration'>[], completed: number): number[] {
  const have = new Set(iterations.map((it) => it.iteration));
  const missing: number[] = [];
  for (let n = 1; n <= Math.floor(completed); n++) if (!have.has(n)) missing.push(n);
  return missing;
}

/** The selected iteration if it exists, otherwise the last executed one (0 when none). */
export function resolveSelection(selected: number | null, iterations: readonly Pick<RepairIteration, 'iteration'>[]): number {
  if (selected === 0) return 0;
  if (selected !== null && iterations.some((it) => it.iteration === selected)) return selected;
  return iterations.length === 0 ? 0 : Math.max(...iterations.map((it) => it.iteration));
}

export type IterationLoader = (
  sessionId: string,
  iteration: number,
  opts: { signal?: AbortSignal },
) => Promise<RepairIteration>;

export interface IterationLoadFailure {
  iteration: number;
  error: ApiErrorView;
}

export type IterationLoadOutcome =
  | { status: 'done' }
  | { status: 'failed'; failure: IterationLoadFailure }
  | { status: 'aborted' };

/**
 * Loads `numbers` in order, reporting each loaded iteration through
 * `onLoaded` as it arrives. Stops at the first failure so iterations already
 * loaded stay available and a retry resumes from the failed one (26.9).
 */
export async function loadIterations(
  sessionId: string,
  numbers: readonly number[],
  loader: IterationLoader,
  onLoaded: (iteration: RepairIteration) => void,
  signal?: AbortSignal,
): Promise<IterationLoadOutcome> {
  for (const n of numbers) {
    if (signal?.aborted) return { status: 'aborted' };
    try {
      const loaded = await loader(sessionId, n, { signal });
      if (signal?.aborted) return { status: 'aborted' };
      onLoaded(loaded);
    } catch (error) {
      if (signal?.aborted) return { status: 'aborted' };
      return { status: 'failed', failure: { iteration: n, error: iterationLoadError(error, n) } };
    }
  }
  return { status: 'done' };
}

/** Error view naming the iteration whose data could not be loaded (26.9). */
export function iterationLoadError(error: unknown, iteration: number): ApiErrorView {
  const operation = `loading iteration ${iteration} data`;
  return { ...toApiErrorView(error, operation), operation };
}
