import React from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BugEvolutionMatrix, PrimaryState } from '../../api/types';
import { DataTable, type DataTableColumn } from '../common';
import { formatPercent } from '../../lib/format';
import { FormattedValue } from './FormattedValue';

/** Fixed row/column order of every Bug_Evolution_Matrix (27.5). */
export const MATRIX_STATES: ReadonlyArray<PrimaryState> = ['A', 'B', 'C', 'PASS'];

export const STATE_LABELS: Record<PrimaryState, string> = {
  A: 'A (syntax)',
  B: 'B (runtime)',
  C: 'C (functional)',
  PASS: 'PASS',
};

const STATE_COLORS: Record<PrimaryState, string> = {
  A: '#b45309',
  B: '#be123c',
  C: '#4338ca',
  PASS: '#047857',
};

export interface MatrixCell {
  to: PrimaryState;
  count: number | null;
  pct: number | null;
}

export interface MatrixRow {
  from: PrimaryState;
  cells: MatrixCell[];
}

/** Re-orders a matrix into A, B, C, PASS rows and columns; states absent from the matrix give null cells. */
export function evolutionRows(matrix: Pick<BugEvolutionMatrix, 'states' | 'counts' | 'row_percentages'>): MatrixRow[] {
  const index = (s: PrimaryState) => matrix.states.indexOf(s);
  return MATRIX_STATES.map((from) => {
    const r = index(from);
    return {
      from,
      cells: MATRIX_STATES.map((to) => {
        const c = index(to);
        const count = r >= 0 && c >= 0 ? matrix.counts[r]?.[c] : undefined;
        const pct = r >= 0 && c >= 0 ? matrix.row_percentages[r]?.[c] : undefined;
        return {
          to,
          count: typeof count === 'number' && Number.isFinite(count) ? count : null,
          pct: typeof pct === 'number' && Number.isFinite(pct) ? pct : null,
        };
      }),
    };
  });
}

export interface EvolutionMatrixProps {
  matrix: BugEvolutionMatrix;
}

/**
 * One Bug_Evolution_Matrix as a stacked bar chart (rows = state before the
 * iteration, stacks = state after) and as a 4×4 table with labelled A, B, C,
 * and PASS rows and columns, which is the chart's tabular alternative (27.5, 28.9).
 */
export const EvolutionMatrix: React.FC<EvolutionMatrixProps> = ({ matrix }) => {
  const rows = evolutionRows(matrix);
  const chartData = rows.map((row) => {
    const point: Record<string, string | number> = { from: row.from };
    for (const cell of row.cells) point[cell.to] = cell.count ?? 0;
    return point;
  });

  const columns: DataTableColumn<MatrixRow>[] = [
    { key: 'from', header: 'From \\ To', rowHeader: true, cell: (row) => STATE_LABELS[row.from] },
    ...MATRIX_STATES.map(
      (to, ci): DataTableColumn<MatrixRow> => ({
        key: to,
        header: STATE_LABELS[to],
        align: 'right',
        cell: (row) => {
          const cell = row.cells[ci];
          if (cell.count === null) return null;
          return (
            <span>
              {cell.count} (<FormattedValue text={formatPercent(cell.pct)} />)
            </span>
          );
        },
      }),
    ),
  ];

  const title = `Bug evolution, iteration ${matrix.iteration}`;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-semibold text-slate-900">{title}</figcaption>
      <div role="img" aria-label={`${title}: stacked bar chart of program counts; the same values are in the table below.`}>
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 480, height: 220 }}>
          <BarChart data={chartData} accessibilityLayer={false} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="from" label={{ value: 'State before', position: 'insideBottom', offset: -4 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            {MATRIX_STATES.map((to) => (
              <Bar key={to} dataKey={to} name={`→ ${to}`} stackId="to" fill={STATE_COLORS[to]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption={`${title}: program counts (row percentage) from the state before to the state after`}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.from}
      />
    </figure>
  );
};
