import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApiErrorView } from '../../api/client';
import { AsyncState, EmptyState, ErrorState, LoadingState } from './AsyncState';
import { Badge } from './Badge';
import { DataTable } from './DataTable';
import { NOT_AVAILABLE_TEXT, NotAvailable } from './NotAvailable';
import { RetryButton } from './RetryButton';
import { emptyStateText, errorStateText, resolveAsyncView } from './asyncStateModel';

const noop = () => {};
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

const httpError: ApiErrorView = {
  kind: 'http',
  operation: 'verification',
  message: 'files must not be empty',
  status: 400,
};

describe('errorStateText', () => {
  it('shows the backend message when present (28.4)', () => {
    expect(errorStateText(httpError)).toEqual({
      title: 'Verification failed: server error',
      message: 'files must not be empty',
    });
  });

  it('states network vs server error when the message is missing (28.5)', () => {
    expect(errorStateText({ kind: 'network', operation: 'health check', message: '' }).message).toMatch(
      /^Network error/,
    );
    expect(errorStateText({ kind: 'timeout', operation: 'x', message: '  ' }).message).toMatch(/^Network error/);
    const server = errorStateText({ kind: 'http', operation: 'repair session', message: '', status: 503 });
    expect(server.title).toBe('Repair session failed: server error');
    expect(server.message).toMatch(/^Server error.*HTTP 503/);
  });
});

describe('resolveAsyncView', () => {
  it('shows loading while in flight and keeps loaded content (28.1, 27.11)', () => {
    expect(resolveAsyncView({ loading: true, isEmpty: false })).toEqual({
      showLoading: true,
      showError: false,
      showEmpty: false,
      showContent: true,
    });
  });

  it('shows the error over existing content and never the empty state with an error', () => {
    expect(resolveAsyncView({ loading: false, error: httpError, isEmpty: false })).toMatchObject({
      showError: true,
      showContent: true,
      showEmpty: false,
    });
    expect(resolveAsyncView({ loading: false, error: httpError, isEmpty: true })).toMatchObject({
      showError: true,
      showEmpty: false,
    });
  });

  it('hides a stale error while retrying and shows empty only when idle with no data', () => {
    expect(resolveAsyncView({ loading: true, error: httpError, isEmpty: true })).toEqual({
      showLoading: true,
      showError: false,
      showEmpty: false,
      showContent: false,
    });
    expect(resolveAsyncView({ loading: false, error: null, isEmpty: true }).showEmpty).toBe(true);
  });
});

describe('state components', () => {
  it('LoadingState is a status region with its label', () => {
    const out = html(<LoadingState label="Running verification" />);
    expect(out).toContain('role="status"');
    expect(out).toContain('Running verification…');
  });

  it('ErrorState renders the message and a named retry control; role="alert" only when live', () => {
    const quiet = html(<ErrorState error={httpError} onRetry={noop} />);
    expect(quiet).toContain('files must not be empty');
    expect(quiet).toContain('aria-label="Retry verification"');
    expect(quiet).not.toContain('role="alert"');
    expect(html(<ErrorState error={httpError} onRetry={noop} live />)).toContain('role="alert"');
    expect(html(<ErrorState error={httpError} />)).not.toContain('<button');
  });

  it('EmptyState names the producing stage and offers a control (28.3)', () => {
    const out = html(
      <EmptyState
        subject="verification results"
        producer="the Verify stage"
        action={{ label: 'Go to Verify', onClick: noop }}
      />,
    );
    expect(out).toContain(emptyStateText('verification results', 'the Verify stage'));
    expect(out).toMatch(/<button type="button"[^>]*>Go to Verify<\/button>/);
  });

  it('AsyncState renders content only when there is data and marks itself busy while loading', () => {
    const empty = { subject: 'runs', producer: 'the Start run action', action: { label: 'Start a run', onClick: noop } };
    const loading = html(
      <AsyncState loading isEmpty={false} empty={empty}>
        <p>table</p>
      </AsyncState>,
    );
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('role="status"');
    expect(loading).toContain('<p>table</p>');

    let called = false;
    const idleEmpty = html(
      <AsyncState loading={false} isEmpty empty={empty}>
        {() => {
          called = true;
          return <p>table</p>;
        }}
      </AsyncState>,
    );
    expect(called).toBe(false);
    expect(idleEmpty).toContain('Start a run');
    expect(idleEmpty).not.toContain('aria-busy');
  });

  it('RetryButton is disabled while busy and hides its icon', () => {
    const out = html(<RetryButton onRetry={noop} busy />);
    expect(out).toContain('disabled=""');
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain('aria-label');
  });

  it('Badge and NotAvailable render text, not color alone', () => {
    expect(html(<Badge tone="warning" description="mock LLM client">mock</Badge>)).toMatch(
      /<span>mock<\/span><span class="sr-only"> \(mock LLM client\)<\/span>/,
    );
    expect(html(<NotAvailable />)).toContain(NOT_AVAILABLE_TEXT);
  });
});

describe('DataTable', () => {
  type Row = { iteration: number; pass: number | null };
  const columns = [
    { key: 'it', header: 'Iteration', cell: (r: Row) => r.iteration, rowHeader: true },
    { key: 'pass', header: 'PASS', cell: (r: Row) => r.pass, align: 'right' as const },
  ];

  it('uses <th scope="col"> headers, a caption-labelled region, and "not available" for nulls (28.9)', () => {
    const out = html(
      <DataTable
        caption="Evolution by iteration"
        columns={columns}
        rows={[
          { iteration: 0, pass: 3 },
          { iteration: 1, pass: null },
        ]}
        rowKey={(r) => String(r.iteration)}
      />,
    );
    expect(out.match(/<th scope="col"/g)).toHaveLength(2);
    expect(out.match(/<th scope="row"/g)).toHaveLength(2);
    const captionId = /<caption id="([^"]+)"/.exec(out)?.[1];
    expect(captionId).toBeTruthy();
    expect(out).toContain(`role="region" aria-labelledby="${captionId}" tabindex="0"`);
    expect(out).toContain(NOT_AVAILABLE_TEXT);
    expect(out).toContain('>3<');
  });

  it('shows the empty message in a single spanning cell', () => {
    const out = html(<DataTable caption="Runs" columns={columns} rows={[]} rowKey={() => 'x'} emptyMessage="No runs." />);
    expect(out).toContain('<td colSpan="2"');
    expect(out).toContain('No runs.');
  });
});
