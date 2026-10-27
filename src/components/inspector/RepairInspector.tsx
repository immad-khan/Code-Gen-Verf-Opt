import React, { useId, useState } from 'react';
import type { GeneratedCodeFile, RepairIteration, VerificationResult } from '../../api/types';
import { cn } from '../../utils/cn';
import { ErrorState, LoadingState } from '../common/AsyncState';
import { FOCUS_RING } from '../common/asyncStateModel';
import { EvolutionChart } from './EvolutionChart';
import { InitialCandidateDetail, IterationDetail } from './IterationDetail';
import {
  ITERATION_LOAD_FAILED_TEXT,
  evolutionPoints,
  resolveSelection,
  transitionLabel,
  type IterationLoader,
  type IterationLoadFailure,
} from './inspectorModel';
import { useRepairIterations } from './useRepairIterations';

// ---------------------------------------------------------------------------
// Presentational view
// ---------------------------------------------------------------------------

export interface RepairInspectorViewProps {
  /** Initial verification (iteration 0); null until the session has verified the input. */
  initial: VerificationResult | null;
  /** Initial candidate code; defaults to iteration 1's `filesBefore`. */
  initialFiles?: readonly GeneratedCodeFile[];
  /** Loaded iterations (any order; shown ascending). */
  iterations: readonly RepairIteration[];
  /** Iteration shown in detail; null selects the last loaded iteration. */
  selected: number | null;
  onSelect: (iteration: number) => void;
  /** True while iteration data is being fetched. */
  loading?: boolean;
  /** Last iteration-load failure; loaded iterations stay on screen (26.9). */
  failure?: IterationLoadFailure | null;
  onRetry?: () => void;
  /** True while the repair loop is still running. */
  running?: boolean;
}

export const RepairInspectorView: React.FC<RepairInspectorViewProps> = ({
  initial,
  initialFiles,
  iterations,
  selected,
  onSelect,
  loading = false,
  failure = null,
  onRetry,
  running = false,
}) => {
  const ordered = [...iterations].sort((a, b) => a.iteration - b.iteration);
  const current = resolveSelection(selected, ordered);
  const selectedIteration = ordered.find((it) => it.iteration === current) ?? null;
  const startFiles = initialFiles ?? ordered[0]?.filesBefore ?? [];
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-lg font-semibold text-slate-900">
          Repair Inspector
        </h3>
        {running ? <span className="text-sm text-slate-700">Repair in progress</span> : null}
      </div>

      {failure ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-rose-900">{ITERATION_LOAD_FAILED_TEXT}</p>
          <ErrorState error={failure.error} onRetry={onRetry} retryDisabled={loading} />
        </div>
      ) : null}
      {loading ? <LoadingState label="Loading iteration data" /> : null}

      {initial === null ? (
        <p className="text-sm text-slate-700">The initial verification of this repair session is not available yet.</p>
      ) : (
        <>
          <EvolutionChart points={evolutionPoints(initial, ordered)} />

          <nav aria-label="Repair iterations">
            <ol className="flex flex-wrap gap-2">
              <li>
                <IterationButton
                  label="Iteration 0"
                  detail={`initial candidate, ${initial.primaryState}`}
                  pressed={current === 0}
                  onClick={() => onSelect(0)}
                />
              </li>
              {ordered.map((it) => (
                <li key={it.iteration}>
                  <IterationButton
                    label={`Iteration ${it.iteration}`}
                    detail={transitionLabel(it.transition)}
                    pressed={current === it.iteration}
                    onClick={() => onSelect(it.iteration)}
                  />
                </li>
              ))}
            </ol>
          </nav>

          {selectedIteration ? (
            <IterationDetail iteration={selectedIteration} />
          ) : (
            <InitialCandidateDetail initial={initial} files={startFiles} />
          )}
        </>
      )}
    </section>
  );
};

interface IterationButtonProps {
  label: string;
  detail: string;
  pressed: boolean;
  onClick: () => void;
}

const IterationButton: React.FC<IterationButtonProps> = ({ label, detail, pressed, onClick }) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={onClick}
    className={cn(
      'inline-flex flex-col items-start rounded-lg border px-3 py-1.5 text-left text-sm cursor-pointer',
      pressed
        ? 'border-indigo-700 bg-indigo-700 text-white'
        : 'border-slate-500 bg-white text-slate-900 hover:bg-slate-100',
      FOCUS_RING,
    )}
  >
    <span className="font-semibold">{label}</span>
    <span className="font-mono text-xs">{detail}</span>
  </button>
);

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export interface RepairInspectorProps {
  sessionId: string;
  /** Initial verification from the session view (`partial.initial` or `result.initial`). */
  initial: VerificationResult | null;
  /** Number of executed iterations reported by the session. */
  iterationsCompleted: number;
  /** Iterations already in the session view; missing ones are fetched individually. */
  iterations?: readonly RepairIteration[];
  initialFiles?: readonly GeneratedCodeFile[];
  running?: boolean;
  /** Override for GET .../iterations/{n} (tests). */
  loadIteration?: IterationLoader;
}

/**
 * Repair Inspector for a completed or in-progress repair session (Requirement 26):
 * iterations 0..last in ascending order, per-iteration detail, and the bug
 * evolution chart with its table alternative.
 */
export const RepairInspector: React.FC<RepairInspectorProps> = ({
  sessionId,
  initial,
  iterationsCompleted,
  iterations: preloaded,
  initialFiles,
  running,
  loadIteration,
}) => {
  const [selected, setSelected] = useState<number | null>(null);
  const { iterations, loading, failure, retry } = useRepairIterations({
    sessionId,
    iterationsCompleted,
    preloaded,
    loader: loadIteration,
  });

  return (
    <RepairInspectorView
      initial={initial}
      initialFiles={initialFiles}
      iterations={iterations}
      selected={selected}
      onSelect={setSelected}
      loading={loading}
      failure={failure}
      onRetry={retry}
      running={running}
    />
  );
};
