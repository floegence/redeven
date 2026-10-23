import { afterEach, expect, it, vi } from 'vitest';
import { scheduleThreadSelectionCommit } from './threadSelectionSchedule';
afterEach(() => vi.useRealTimers());
function fixture(hidden = false) {
  const document = new EventTarget() as EventTarget & { visibilityState: string }; document.visibilityState = hidden ? 'hidden' : 'visible';
  const frames = new Map<number, FrameRequestCallback>(); let id = 0;
  const presented = vi.fn(); const commit = vi.fn();
  const cancel = scheduleThreadSelectionCommit({ document: document as Document,
    requestFrame: callback => { frames.set(++id, callback); return id; }, cancelFrame: key => { frames.delete(key); }, presented, commit });
  const frame = () => { const entries = [...frames]; frames.clear(); for (const [, fn] of entries) fn(0); };
  return { document, frames, frame, presented, commit, cancel };
}
it('commits once after a feedback rendering opportunity without extra frame delays', async () => {
  vi.useFakeTimers(); const f = fixture();
  f.frame(); expect(f.commit).not.toHaveBeenCalled(); expect(f.presented).not.toHaveBeenCalled();
  f.frame(); expect(f.presented).toHaveBeenCalledOnce(); await vi.runAllTimersAsync(); expect(f.commit).toHaveBeenCalledOnce();
  f.document.dispatchEvent(new Event('visibilitychange')); expect(f.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('commits hidden selections without waiting for animation frames', async () => {
  vi.useFakeTimers(); const f = fixture(true); await vi.runAllTimersAsync();
  expect(f.commit).toHaveBeenCalledOnce(); expect(f.presented).not.toHaveBeenCalled();
});
it('recovers when hidden during feedback and cancels obsolete selection work', async () => {
  vi.useFakeTimers(); const f = fixture(); f.frame();
  f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange'));
  await vi.runAllTimersAsync(); expect(f.commit).toHaveBeenCalledOnce(); expect(f.frames.size).toBe(0);
  const g = fixture(true); g.cancel(); await vi.runAllTimersAsync(); expect(g.commit).not.toHaveBeenCalled();
});
