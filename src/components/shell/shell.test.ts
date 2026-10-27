import { describe, expect, it } from 'vitest';
import { announceReducer, INITIAL_LIVE_REGION_STATE } from './liveRegion';
import { isSection, SECTION_LABELS, SECTIONS } from './sections';

describe('sections', () => {
  it('has exactly Workbench and Experiments', () => {
    expect(SECTIONS.map((s) => SECTION_LABELS[s])).toEqual(['Workbench', 'Experiments']);
    expect(isSection('workbench')).toBe(true);
    expect(isSection('settings')).toBe(false);
  });
});

describe('announceReducer', () => {
  it('routes messages by politeness with a fresh id per call', () => {
    const a = announceReducer(INITIAL_LIVE_REGION_STATE, 'Verify complete', 'polite');
    const b = announceReducer(a, 'Verification failed: timeout', 'assertive');
    const c = announceReducer(b, 'Verify complete', 'polite');
    expect(b.polite).toEqual({ id: 1, message: 'Verify complete' });
    expect(b.assertive).toEqual({ id: 2, message: 'Verification failed: timeout' });
    // Same text again is a new announcement (new id), so it is read again.
    expect(c.polite).toEqual({ id: 3, message: 'Verify complete' });
    expect(c.assertive).toBe(b.assertive);
  });

  it('ignores blank messages', () => {
    expect(announceReducer(INITIAL_LIVE_REGION_STATE, '   ', 'assertive')).toBe(INITIAL_LIVE_REGION_STATE);
  });
});
