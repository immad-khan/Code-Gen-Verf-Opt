import React, { useId } from 'react';
import { Play } from 'lucide-react';
import type { CacheInfo, DatasetInfo } from '../../api/types';
import { FOCUS_RING } from '../common';
import { cn } from '../../utils/cn';
import {
  FEEDBACK_REGIMES,
  GENERATION_PROMPT_STYLES,
  REPAIR_MODES_ALL,
  START_RUN_LABELS,
  experimentsErrorText,
  type StartRunField,
  type StartRunFormValues,
  type StartRunRejection,
} from './experimentsModel';

export interface StartRunFormProps {
  values: StartRunFormValues;
  onChange: (values: StartRunFormValues) => void;
  onSubmit: () => void;
  /** True while the start request is in flight; disables the submit control (28.2). */
  submitting: boolean;
  /** Extra reason to disable submission, e.g. offline or a run already active. */
  disabledReason?: string | null;
  datasets: ReadonlyArray<DatasetInfo>;
  caches: ReadonlyArray<CacheInfo>;
  /** Client-side validation messages per field. */
  fieldErrors?: Partial<Record<StartRunField, string>>;
  /** The last rejection from the Experiments API (27.9). */
  rejection?: StartRunRejection | null;
}

const CONTROL = cn(
  'w-full rounded-md border border-slate-500 bg-white px-2 py-1.5 text-sm text-slate-900',
  'disabled:cursor-not-allowed disabled:bg-slate-100',
  FOCUS_RING,
);

export function datasetOptionLabel(d: DatasetInfo): string {
  return `${d.fileName} — ${d.taskCount} tasks — SHA-256 ${d.sha256}`;
}

export function cacheOptionLabel(c: CacheInfo): string {
  return `${c.path} — ${c.model}, ${c.llmMode}, ${c.generationPromptStyle} prompts, dataset SHA-256 ${c.datasetSha256}`;
}

/**
 * Start-run form with one control per Experiments API start-run field (27.1).
 * Values are controlled by the parent so they survive a rejection (27.9).
 */
export const StartRunForm: React.FC<StartRunFormProps> = ({
  values,
  onChange,
  onSubmit,
  submitting,
  disabledReason,
  datasets,
  caches,
  fieldErrors = {},
  rejection,
}) => {
  const baseId = useId();
  const id = (field: StartRunField) => `${baseId}-${field}`;
  const errId = (field: StartRunField) => `${baseId}-${field}-error`;
  const set = <F extends StartRunField>(field: F, value: StartRunFormValues[F]) => onChange({ ...values, [field]: value });

  const serverFieldErrors = new Map<string, string>();
  for (const f of rejection?.invalidFields ?? []) serverFieldErrors.set(f.field, f.message);
  const errorFor = (field: StartRunField) => fieldErrors[field] ?? serverFieldErrors.get(field);

  const describedBy = (field: StartRunField) => (errorFor(field) ? errId(field) : undefined);
  const fieldError = (field: StartRunField) => {
    const message = errorFor(field);
    return message ? (
      <p id={errId(field)} className="mt-1 text-xs font-medium text-rose-800">
        {message}
      </p>
    ) : null;
  };
  const label = (field: StartRunField) => (
    <label htmlFor={id(field)} className="mb-1 block text-sm font-medium text-slate-800">
      {START_RUN_LABELS[field]}
    </label>
  );

  const numberInput = (field: 'k' | 'temperature' | 'sampleSize' | 'seed', min: number, max: number, step: string) => (
    <div>
      {label(field)}
      <input
        id={id(field)}
        type="number"
        inputMode={step === '1' ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step={step}
        value={values[field]}
        onChange={(e) => set(field, e.target.value)}
        disabled={submitting}
        aria-invalid={errorFor(field) ? true : undefined}
        aria-describedby={describedBy(field)}
        className={CONTROL}
      />
      {fieldError(field)}
    </div>
  );

  const selectedDataset = datasets.find((d) => d.fileName === values.dataset);
  const submitDisabled = submitting || !!disabledReason;
  const rejectionText = rejection ? experimentsErrorText(rejection.error) : null;

  return (
    <form
      noValidate
      aria-labelledby={`${baseId}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitDisabled) onSubmit();
      }}
      className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-4"
    >
      <h4 id={`${baseId}-title`} className="text-sm font-semibold text-slate-900">
        Start a run
      </h4>

      {rejection && rejectionText ? (
        <div role="alert" className="rounded-lg border border-rose-700 bg-rose-50 p-3 text-sm text-rose-950">
          <p className="font-semibold">Start run rejected</p>
          <p className="mt-1 break-words">{rejectionText.message}</p>
          {rejection.invalidFields.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {rejection.invalidFields.map((f) => (
                <li key={`${f.field}:${f.message}`}>{`${f.field}: ${f.message}`}</li>
              ))}
            </ul>
          ) : null}
          {rejection.activeRunId ? <p className="mt-1">{`Active run: ${rejection.activeRunId}`}</p> : null}
        </div>
      ) : null}

      <div>
        {label('dataset')}
        <select
          id={id('dataset')}
          value={values.dataset}
          onChange={(e) => set('dataset', e.target.value)}
          disabled={submitting}
          aria-invalid={errorFor('dataset') ? true : undefined}
          aria-describedby={describedBy('dataset')}
          className={CONTROL}
        >
          <option value="">{datasets.length === 0 ? 'No prepared datasets' : 'Choose a prepared dataset'}</option>
          {datasets.map((d) => (
            <option key={d.fileName} value={d.fileName}>
              {datasetOptionLabel(d)}
            </option>
          ))}
        </select>
        {selectedDataset ? (
          <p className="mt-1 text-xs text-slate-700 break-all">
            {`${selectedDataset.taskCount} tasks · SHA-256 ${selectedDataset.sha256}`}
          </p>
        ) : null}
        {fieldError('dataset')}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          {label('repairMode')}
          <select
            id={id('repairMode')}
            value={values.repairMode}
            onChange={(e) => set('repairMode', e.target.value as StartRunFormValues['repairMode'])}
            disabled={submitting}
            aria-describedby={describedBy('repairMode')}
            className={CONTROL}
          >
            {REPAIR_MODES_ALL.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {fieldError('repairMode')}
        </div>
        <div>
          {label('feedbackRegime')}
          <select
            id={id('feedbackRegime')}
            value={values.feedbackRegime}
            onChange={(e) => set('feedbackRegime', e.target.value as StartRunFormValues['feedbackRegime'])}
            disabled={submitting}
            aria-describedby={describedBy('feedbackRegime')}
            className={CONTROL}
          >
            {FEEDBACK_REGIMES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {fieldError('feedbackRegime')}
        </div>
        {numberInput('k', 1, 10, '1')}
        {numberInput('temperature', 0, 2, '0.1')}
        <div>
          {label('generationPromptStyle')}
          <select
            id={id('generationPromptStyle')}
            value={values.generationPromptStyle}
            onChange={(e) => set('generationPromptStyle', e.target.value as StartRunFormValues['generationPromptStyle'])}
            disabled={submitting}
            aria-describedby={describedBy('generationPromptStyle')}
            className={CONTROL}
          >
            {GENERATION_PROMPT_STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {fieldError('generationPromptStyle')}
        </div>
        {numberInput('sampleSize', 1, 10_000, '1')}
        {numberInput('seed', 0, 2_147_483_647, '1')}
      </div>

      <div>
        {label('generationCache')}
        <select
          id={id('generationCache')}
          value={values.generationCache}
          onChange={(e) => set('generationCache', e.target.value)}
          disabled={submitting}
          aria-describedby={describedBy('generationCache')}
          className={CONTROL}
        >
          <option value="">No cache (generate code)</option>
          {caches.map((c) => (
            <option key={c.path} value={c.path}>
              {cacheOptionLabel(c)}
            </option>
          ))}
        </select>
        {fieldError('generationCache')}
      </div>

      <div className="flex items-center gap-2">
        <input
          id={id('mock')}
          type="checkbox"
          checked={values.mock}
          onChange={(e) => set('mock', e.target.checked)}
          disabled={submitting}
          aria-describedby={`${baseId}-mock-hint`}
          className={cn('h-4 w-4 accent-indigo-700', FOCUS_RING)}
        />
        <label htmlFor={id('mock')} className="text-sm font-medium text-slate-800">
          {START_RUN_LABELS.mock}
        </label>
        <span id={`${baseId}-mock-hint`} className="text-xs text-slate-700">
          Uses the offline mock LLM client; results are labelled mock.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitDisabled}
          aria-busy={submitting || undefined}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white',
            'hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer',
            FOCUS_RING,
          )}
        >
          <Play aria-hidden="true" focusable="false" className="h-4 w-4" />
          <span>{submitting ? 'Starting run…' : 'Start run'}</span>
        </button>
        {disabledReason && !submitting ? <span className="text-sm text-slate-700">{disabledReason}</span> : null}
      </div>
    </form>
  );
};
