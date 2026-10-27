import React, { useId } from 'react';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './asyncStateModel';
import { NotAvailable } from './NotAvailable';

export interface DataTableColumn<Row> {
  /** Stable column key. */
  key: string;
  /** Column header text, rendered in `<th scope="col">` (28.9). */
  header: React.ReactNode;
  /** Cell value; `null`/`undefined` renders the "not available" placeholder (27.3). */
  cell: (row: Row, rowIndex: number) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Marks this column's cells as row headers (`<th scope="row">`). Use for the label column. */
  rowHeader?: boolean;
}

export interface DataTableProps<Row> {
  /** Table caption; also the accessible name of the scroll region. */
  caption: string;
  /** Hide the caption visually while keeping it available to assistive technologies. */
  captionHidden?: boolean;
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row, rowIndex: number) => string;
  /** Shown in a single cell when `rows` is empty. */
  emptyMessage?: string;
  className?: string;
}

const ALIGN: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

/**
 * Accessible data table, used on its own and as the tabular alternative for
 * every chart (28.9). Column headers are `<th scope="col">`; the wrapper is a
 * labelled, keyboard-focusable region so wide tables can be scrolled with the
 * keyboard.
 */
export function DataTable<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowKey,
  emptyMessage = 'No rows to show.',
  className,
}: DataTableProps<Row>): React.ReactElement {
  const captionId = useId();
  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className={cn('overflow-x-auto rounded-lg border border-slate-300', FOCUS_RING, className)}
    >
      <table className="w-full border-collapse text-sm text-slate-900">
        <caption id={captionId} className={cn('px-3 py-2 text-left font-semibold', captionHidden && 'sr-only')}>
          {caption}
        </caption>
        <thead className="bg-slate-100">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn('border-b border-slate-300 px-3 py-2 font-semibold', ALIGN[column.align ?? 'left'])}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(columns.length, 1)} className="px-3 py-3 text-slate-700">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowKey(row, rowIndex)} className="border-b border-slate-200 last:border-b-0">
                {columns.map((column) => {
                  const value = column.cell(row, rowIndex);
                  const content = value === null || value === undefined ? <NotAvailable /> : value;
                  const cellClass = cn('px-3 py-2 align-top', ALIGN[column.align ?? 'left']);
                  return column.rowHeader ? (
                    <th key={column.key} scope="row" className={cn(cellClass, 'font-medium')}>
                      {content}
                    </th>
                  ) : (
                    <td key={column.key} className={cellClass}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
