import React, { useId } from 'react';
import { cn } from '../../utils/cn';
import { Badge } from '../common/Badge';
import { FOCUS_RING } from '../common/asyncStateModel';
import { NO_CHANGES_TEXT, diffLineLabel, diffLinePrefix, type FileChange } from './inspectorModel';

export interface FileDiffProps {
  change: FileChange;
  /** Heading element for the file name (defaults to h5). */
  headingLevel?: 'h4' | 'h5' | 'h6';
}

const LINE_CLASSES = {
  added: 'bg-emerald-50 text-emerald-950',
  removed: 'bg-rose-50 text-rose-950',
  unchanged: 'text-slate-800',
} as const;

function changeSummary(change: FileChange): string {
  if (change.before === null) return 'New file';
  if (change.after === null) return 'File removed';
  const { additions, deletions } = change.diff;
  return `${additions} added, ${deletions} removed`;
}

/**
 * Line diff of one file between the end of iteration i−1 and the end of
 * iteration i. Each added/removed line carries a `+`/`−` text prefix and a
 * visually hidden "added"/"removed" label in addition to its color (26.5). An
 * unchanged file shows a "No changes" label instead of an empty diff (26.6).
 */
export const FileDiff: React.FC<FileDiffProps> = ({ change, headingLevel = 'h5' }) => {
  const headingId = useId();
  const Heading = headingLevel;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Heading id={headingId} className="font-mono text-sm font-semibold text-slate-900 break-all">
          {change.path}
        </Heading>
        {change.changed ? (
          <span className="text-xs text-slate-700">{changeSummary(change)}</span>
        ) : (
          <Badge tone="neutral">{NO_CHANGES_TEXT}</Badge>
        )}
      </div>
      {change.changed ? (
        change.diff.lines.length === 0 ? (
          <p className="text-sm text-slate-700">The file is empty.</p>
        ) : (
          <div
            role="region"
            aria-label={`Line diff of ${change.path}`}
            tabIndex={0}
            className={cn('max-h-96 overflow-auto rounded-lg border border-slate-300 bg-white', FOCUS_RING)}
          >
            <pre className="min-w-max py-1 font-mono text-xs leading-5">
              <code>
                {change.diff.lines.map((line, index) => {
                  const label = diffLineLabel(line.type);
                  return (
                    <span key={index} className={cn('flex px-2', LINE_CLASSES[line.type])}>
                      <span aria-hidden="true" className="w-10 shrink-0 select-none pr-2 text-right text-slate-600">
                        {line.oldLineNumber ?? ''}
                      </span>
                      <span aria-hidden="true" className="w-10 shrink-0 select-none pr-2 text-right text-slate-600">
                        {line.newLineNumber ?? ''}
                      </span>
                      <span aria-hidden="true" className="w-4 shrink-0 select-none font-bold">
                        {diffLinePrefix(line.type)}
                      </span>
                      {label ? <span className="sr-only">{`${label}: `}</span> : null}
                      <span className="whitespace-pre">{line.text}</span>
                    </span>
                  );
                })}
              </code>
            </pre>
          </div>
        )
      ) : null}
    </section>
  );
};
