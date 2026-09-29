import { afterEach, expect, it, vi } from 'vitest';
import { markBrowserTrace } from './browserPerformanceTrace';

const marks = new Map<string, { startTime: number; detail: Record<string, unknown> }>();
afterEach(() => { marks.clear(); vi.unstubAllGlobals(); });

it('retains only the latest content-free mark for each product browser stage', () => {
  vi.stubGlobal('performance', {
    clearMarks: (name: string) => { marks.delete(name); },
    mark: (name: string, value: { startTime: number; detail: Record<string, unknown> }) => { marks.set(name, value); },
  });
  const first = { stage: 'selection_intent', target: 'opaque-target', generation: 3, at: 42, action: 'tab_select', request: 8 } as const;
  markBrowserTrace(first);
  markBrowserTrace({ ...first, at: 58, request: 9 });
  markBrowserTrace({ stage: 'usable_paint', target: first.target, generation: 3, at: 91, duration: 49 });
  expect([...marks.keys()]).toEqual(['redeven:browser:selection_intent', 'redeven:browser:usable_paint']);
  expect(marks.get('redeven:browser:selection_intent')).toEqual({ startTime: 58, detail: { target: 'opaque-target', generation: 3, request: 9, action: 'tab_select' } });
  expect(marks.get('redeven:browser:usable_paint')).toEqual({ startTime: 91, detail: { target: 'opaque-target', generation: 3, duration: 49 } });
  expect(JSON.stringify([...marks])).not.toMatch(/url|text|input|dom|private/i);
});

it('ignores unknown stages and unusable timestamps', () => {
  const mark = vi.fn(), clearMarks = vi.fn();
  vi.stubGlobal('performance', { mark, clearMarks });
  markBrowserTrace({ stage: 'unknown' as never, target: 'opaque-target', generation: 1, at: 1 });
  markBrowserTrace({ stage: 'control', target: 'opaque-target', generation: 1, at: Number.NaN });
  expect(mark).not.toHaveBeenCalled();
  expect(clearMarks).not.toHaveBeenCalled();
});
