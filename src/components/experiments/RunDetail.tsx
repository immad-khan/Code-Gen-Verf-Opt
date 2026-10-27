import React from 'react';
import type { Rate, RunDetail as RunDetailDto, RunSummary } from '../../api/types';
import { Badge, DataTable, type DataTableColumn } from '../common';
import { NOT_AVAILABLE, formatCount, formatNumber, formatRate, formatText, rateAt } from '../../lib/format';
import { EvolutionMatrix } from './EvolutionMatrix';
import { RunBadges } from './ExperimentsError';
import { FormattedValue } from './FormattedValue';
import { runStatusTone } from './experimentsModel';

/** Per-category table rows: the 12 taxonomy categories plus UNMAPPED (27.5). */
export const CATEGORY_KEYS: ReadonlyArray<string> = [
  'A.1', 'A.2', 'A.3',
  'B.1', 'B.2', 'B.3', 'B.4', 'B.5',
  'C.1', 'C.2', 'C.3', 'C.4',
  'UNMAPPED',
];

/** Number of repair iterations of a run: k from the summary or manifest, else the largest iteration reported. */
export function runIterations(detail: Pick<RunDetailDto, 'manifest' | 'summary'>): number {
  const k = detail.summary?.config?.k ?? detail.manifest?.k;
  if (typeof k === 'number' && Number.isInteger(k) && k > 0) return k;
  const s = detail.summary;
  if (!s) return 0;
  const its = [
    ...(s.rsr ?? []).map((r) => r.iteration),
    ...(s.per_primary_type ?? []).map((r) => r.iteration),
    ...(s.bug_evolution ?? []).map((m) => m.iteration),
  ].filter((n) => Number.isInteger(n));
  return its.length > 0 ? Math.max(...its) : 0;
}

const range = (from: number, to: number) => (to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i));

const rateCell = (rate: Rate | null | undefined) => <FormattedValue text={formatRate(rate, { withCounts: true })} />;

const Field: React.FC<{ label: string; text: string; mono?: boolean }> = ({ label, text, mono }) => (
  <>
    <dt className="font-medium text-slate-700">{label}</dt>
    <dd className={mono ? 'font-mono text-xs break-all text-slate-900' : 'text-slate-900'}>
      <FormattedValue text={text} />
    </dd>
  </>
);

const H: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-sm font-semibold text-slate-900">{children}</h4>
);

export interface RunDetailProps {
  detail: RunDetailDto;
}

/**
 * Selected-run metrics (27.5): RSR_i, conditional repair rates, per-primary-type
 * rates, the per-category table, each Bug_Evolution_Matrix (chart + table), and
 * cost totals. Anything missing from the Run_Summary shows "not available".
 */
export const RunDetail: React.FC<RunDetailProps> = ({ detail }) => {
  const { manifest } = detail;
  const summary: RunSummary | null = detail.summary;
  const k = runIterations(detail);
  const iterations = range(1, k);
  const llmMode = summary?.llm_mode ?? manifest?.llm_mode ?? null;

  type ItRow = { iteration: number };
  const itRows: ItRow[] = iterations.map((iteration) => ({ iteration }));
  const iterationColumn: DataTableColumn<ItRow> = {
    key: 'iteration',
    header: 'Iteration',
    rowHeader: true,
    cell: (r) => r.iteration,
  };

  const rsrColumns: DataTableColumn<ItRow>[] = [
    iterationColumn,
    { key: 'rsr', header: 'RSR (repaired / sample)', align: 'right', cell: (r) => rateCell(rateAt(summary?.rsr, r.iteration)) },
  ];

  const conditionalRows = itRows.filter((r) => r.iteration >= 2);
  const conditionalColumns: DataTableColumn<ItRow>[] = [
    iterationColumn,
    {
      key: 'cond',
      header: 'Conditional repair rate (repaired / still failing)',
      align: 'right',
      cell: (r) => rateCell(rateAt(summary?.conditional_repair_rate, r.iteration)),
    },
  ];

  const perType = (iteration: number) => summary?.per_primary_type?.find((p) => p.iteration === iteration);
  const perTypeColumns: DataTableColumn<ItRow>[] = [
    iterationColumn,
    ...(['A', 'B', 'C'] as const).map(
      (t): DataTableColumn<ItRow> => ({
        key: t,
        header: `Type ${t}`,
        align: 'right',
        cell: (r) => rateCell(perType(r.iteration)?.[t]),
      }),
    ),
  ];

  type CatRow = { category: string };
  const categoryColumns: DataTableColumn<CatRow>[] = [
    { key: 'category', header: 'Category', rowHeader: true, cell: (r) => r.category },
    { key: 'rate', header: 'Repair rate (repaired / programs)', align: 'right', cell: (r) => rateCell(summary?.per_category?.[r.category]) },
  ];

  const cost = summary?.cost;
  type CostRow = { label: string; total: number | null | undefined; perProgram: number | null | undefined };
  const costRows: CostRow[] = [
    { label: 'LLM calls', total: cost?.llm_calls, perProgram: cost?.per_program?.llm_calls },
    { label: 'Calls without usage data', total: cost?.calls_without_usage, perProgram: undefined },
    { label: 'Prompt tokens', total: cost?.prompt_tokens, perProgram: cost?.per_program?.prompt_tokens },
    { label: 'Completion tokens', total: cost?.completion_tokens, perProgram: cost?.per_program?.completion_tokens },
  ];
  const costColumns: DataTableColumn<CostRow>[] = [
    { key: 'label', header: 'Measure', rowHeader: true, cell: (r) => r.label },
    { key: 'total', header: 'Total', align: 'right', cell: (r) => <FormattedValue text={formatCount(r.total)} /> },
    { key: 'per', header: 'Per program', align: 'right', cell: (r) => <FormattedValue text={formatNumber(r.perProgram, 1)} /> },
  ];

  const empty = `${NOT_AVAILABLE}: the Run_Summary has no iterations`;

  return (
    <article aria-labelledby="run-detail-title" className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 id="run-detail-title" className="font-mono text-base font-semibold break-all text-slate-900">
          {detail.runId}
        </h3>
        <Badge tone={runStatusTone(detail.status)}>{detail.status}</Badge>
        <RunBadges llmMode={llmMode} provenance={detail.provenance} />
      </header>

      {!summary ? <p className="text-sm text-slate-800">This run has no Run_Summary; its metrics are not available.</p> : null}
      {!manifest ? <p className="text-sm text-slate-800">This run has no manifest; its configuration is not available.</p> : null}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <Field label="Dataset" text={formatText(summary?.dataset?.path ?? manifest?.dataset_path)} />
        <Field label="Dataset SHA-256" text={formatText(summary?.dataset?.sha256 ?? manifest?.dataset_sha256)} mono />
        <Field label="Tasks" text={formatCount(summary?.dataset?.task_count ?? manifest?.task_count)} />
        <Field label="Repair mode" text={formatText(summary?.config?.repair_mode ?? manifest?.repair_mode)} />
        <Field label="Feedback regime" text={formatText(summary?.config?.feedback_regime ?? manifest?.feedback_regime)} />
        <Field label="k" text={formatCount(summary?.config?.k ?? manifest?.k)} />
        <Field label="Model" text={formatText(summary?.config?.model ?? manifest?.model)} />
        <Field label="Temperature" text={formatNumber(summary?.config?.temperature ?? manifest?.decoding?.temperature, 2)} />
        <Field
          label="Generation prompt style"
          text={formatText(summary?.config?.generation_prompt_style ?? manifest?.generation_prompt_style)}
        />
        <Field label="Sample size (actual)" text={formatCount(summary?.sample?.actual ?? manifest?.repair_sample?.actual)} />
        <Field label="Sample seed" text={formatCount(summary?.config?.seed ?? manifest?.seed)} />
        <Field label="llm_mode" text={formatText(llmMode)} />
        <Field label="Generation cache" text={formatText(manifest?.generation_cache?.path)} mono />
        <Field label="Generation cache SHA-256" text={formatText(manifest?.generation_cache?.sha256)} mono />
        <Field label="Started" text={formatText(manifest?.start_time)} />
        <Field label="Ended" text={formatText(manifest?.end_time)} />
        {manifest?.termination ? <Field label="Termination" text={manifest.termination} /> : null}
        {manifest?.error ? <Field label="Error" text={manifest.error} /> : null}
      </dl>

      <section className="flex flex-col gap-2">
        <H>pass@1</H>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <Field label="Before repair" text={formatRate(summary?.pass_at_1?.before, { withCounts: true })} />
          <Field label="After repair" text={formatRate(summary?.pass_at_1?.after, { withCounts: true })} />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <H>Repair success rate per iteration</H>
        <DataTable caption="RSR_i" columns={rsrColumns} rows={itRows} rowKey={(r) => String(r.iteration)} emptyMessage={empty} />
      </section>

      <section className="flex flex-col gap-2">
        <H>Conditional repair rates</H>
        <DataTable
          caption="Conditional repair rate per iteration (iteration 2 onward)"
          columns={conditionalColumns}
          rows={conditionalRows}
          rowKey={(r) => String(r.iteration)}
          emptyMessage={`${NOT_AVAILABLE}: conditional rates need k ≥ 2`}
        />
      </section>

      <section className="flex flex-col gap-2">
        <H>Repair rate per primary type</H>
        <DataTable
          caption="Repair rate per primary type and iteration"
          columns={perTypeColumns}
          rows={itRows}
          rowKey={(r) => String(r.iteration)}
          emptyMessage={empty}
        />
      </section>

      <section className="flex flex-col gap-2">
        <H>Repair rate per category</H>
        <DataTable
          caption="Repair rate per initial category"
          columns={categoryColumns}
          rows={CATEGORY_KEYS.map((category) => ({ category }))}
          rowKey={(r) => r.category}
        />
      </section>

      <section className="flex flex-col gap-4">
        <H>Bug evolution</H>
        {iterations.length === 0 ? <p className="text-sm text-slate-700">{empty}</p> : null}
        {iterations.map((iteration) => {
          const matrix = summary?.bug_evolution?.find((m) => m.iteration === iteration);
          return matrix ? (
            <EvolutionMatrix key={iteration} matrix={matrix} />
          ) : (
            <p key={iteration} className="text-sm text-slate-800">
              {`Bug evolution, iteration ${iteration}: `}
              <FormattedValue text={NOT_AVAILABLE} />
            </p>
          );
        })}
      </section>

      <section className="flex flex-col gap-2">
        <H>Cost (repair loop)</H>
        <DataTable caption="Cost totals" columns={costColumns} rows={costRows} rowKey={(r) => r.label} />
      </section>
    </article>
  );
};
