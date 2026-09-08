import { describe, expect, it } from 'vitest';
import { mergeThreadTitle, threadTitleSnapshot, type ThreadTitleSnapshot } from './threadTitleSnapshot';

const pending: ThreadTitleSnapshot = { title: 'First request', title_status: 'pending', title_generation: 2 };
const ready: ThreadTitleSnapshot = { title: 'Generated title', title_status: 'ready', title_generation: 2 };
const failed: ThreadTitleSnapshot = { ...pending, title_status: 'failed' };

describe('canonical title snapshots', () => {
  it.each([ready, failed])('settles pending and rejects its late replay: $title_status', (terminal) => {
    expect(mergeThreadTitle(pending, terminal)).toEqual(terminal);
    expect(mergeThreadTitle(terminal, pending)).toEqual(terminal);
    expect(mergeThreadTitle(terminal, terminal)).toEqual(terminal);
  });

  it('orders retries and manual names by generation, independently of terminal status', () => {
    const retry = { ...pending, title_generation: 3 };
    const manual = { title: 'Manual title', title_status: 'ready' as const, title_generation: 4 };
    expect(mergeThreadTitle(failed, retry)).toEqual(retry);
    expect(mergeThreadTitle(retry, failed)).toEqual(retry);
    expect(mergeThreadTitle(retry, manual)).toEqual(manual);
    expect(mergeThreadTitle(manual, ready)).toEqual(manual);
    expect(mergeThreadTitle(manual, retry)).toEqual(manual);
  });

  it.each([failed, { ...ready, title: 'Conflicting text' }])('rejects conflicting terminal snapshots', (conflict) => {
    expect(() => mergeThreadTitle(ready, conflict)).toThrow('Flower contract error: conflicting title snapshots');
  });

  it('admits an explicitly unset title and never regresses a named snapshot to unset', () => {
    const unset = { title: '', title_status: 'unset' as const, title_generation: 0 };
    expect(mergeThreadTitle(undefined, unset)).toEqual(unset);
    expect(mergeThreadTitle(ready, unset)).toEqual(ready);
  });

  it.each([undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '2', NaN])('rejects invalid or missing generation %s', (generation) => {
    expect(() => threadTitleSnapshot({ ...ready, title_generation: generation as number })).toThrow('Flower contract error');
  });

  it.each([
    { ...ready, title_generation: 0 },
    { ...pending, title: '' },
    { ...ready, title_status: 'unset' as const },
    { title: 'Invented', title_status: 'unset' as const, title_generation: 0 },
  ])('rejects inconsistent state', (snapshot) => {
    expect(() => threadTitleSnapshot(snapshot)).toThrow('Flower contract error');
  });
});
