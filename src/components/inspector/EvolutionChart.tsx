import React, { useId } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { DataTable, type DataTableColumn } from '../common/DataTable';
import { PRIMARY_STATES, stateValue, type EvolutionPoint } from './inspectorModel';

export interface EvolutionChartProps {
  /** One point per executed iteration, 0 to the last (see `evolutionPoints`). */
  points: readonly EvolutionPoint[];
  title?: string;
  /** Heading element for the chart title (defaults to h4). */
  headingLevel?: 'h3' | 'h4' | 'h5';
}

const COLUMNS: ReadonlyArray<DataTableColumn<EvolutionPoint>> = [
  { key: 'iteration', header: 'Iteration', cell: (p) => (p.iteration === 0 ? '0 (initial candidate)' : p.iteration), rowHeader: true },
  { key: 'state', header: 'Primary_State', cell: (p) => p.state },
];

const formatState = (value: unknown): string =>
  typeof value === 'number' && PRIMARY_STATES[value] !== undefined ? PRIMARY_STATES[value] : String(value);

/**
 * Bug evolution chart: iterations 0..last on the x axis, Primary_State
 * (A, B, C, PASS) on the y axis, one point per executed iteration (26.8).
 * The sibling table holds the same values for assistive technologies (28.9);
 * an iteration whose state could not be determined has no point and reads
 * "not available" in the table.
 */
export const EvolutionChart: React.FC<EvolutionChartProps> = ({
  points,
  title = 'Bug evolution',
  headingLevel = 'h4',
}) => {
  const headingId = useId();
  const Heading = headingLevel;
  const data = points.map((p) => ({ iteration: p.iteration, state: stateValue(p.state) }));
  const lastIteration = points.reduce((max, p) => Math.max(max, p.iteration), 0);
  const ticks = Array.from({ length: lastIteration + 1 }, (_, i) => i);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <Heading id={headingId} className="text-sm font-semibold text-slate-900">
        {title}
      </Heading>
      {/* The chart is described as one image; its values are in the table below. */}
      <div
        role="img"
        aria-label={`${title} chart: Primary_State by iteration, 0 to ${lastIteration}. The same values are in the table that follows.`}
        className="w-full"
      >
        <LineChart
          responsive
          accessibilityLayer={false}
          data={data}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
          style={{ width: '100%', height: 220 }}
        >
          <CartesianGrid stroke="#cbd5e1" strokeDasharray="3 3" />
          <XAxis
            dataKey="iteration"
            type="number"
            domain={[0, Math.max(lastIteration, 1)]}
            ticks={ticks}
            allowDecimals={false}
            stroke="#334155"
            label={{ value: 'Iteration', position: 'insideBottom', offset: -4, fill: '#334155' }}
          />
          <YAxis
            type="number"
            domain={[0, PRIMARY_STATES.length - 1]}
            ticks={PRIMARY_STATES.map((_, i) => i)}
            tickFormatter={formatState}
            allowDecimals={false}
            width={48}
            stroke="#334155"
          />
          <Tooltip
            formatter={(value) => [formatState(value), 'Primary_State']}
            labelFormatter={(label) => `Iteration ${String(label)}`}
          />
          <Line
            type="linear"
            dataKey="state"
            stroke="#4338ca"
            strokeWidth={2}
            dot={{ r: 5, fill: '#4338ca' }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </div>
      <DataTable
        caption={`${title}: Primary_State by iteration`}
        columns={COLUMNS}
        rows={points}
        rowKey={(p) => String(p.iteration)}
      />
    </section>
  );
};
