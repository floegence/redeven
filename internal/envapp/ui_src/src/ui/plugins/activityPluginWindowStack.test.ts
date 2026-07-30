import { describe, expect, it } from 'vitest';

import {
  MAX_ACTIVITY_PLUGIN_WINDOWS,
  bringActivityPluginWindowToFront,
} from './activityPluginWindowStack';

describe('Activity plugin window stack', () => {
  it('moves a repeated target to the last DOM position without replacing its identity', () => {
    const windows = Array.from({ length: 18 }, (_, index) => ({
      instanceID: `window_${index}`,
      marker: { index },
    }));

    const reordered = bringActivityPluginWindowToFront(windows, 'window_3');

    expect(reordered).toHaveLength(windows.length);
    expect(reordered.at(-1)).toBe(windows[3]);
    expect(new Set(reordered.map((window) => window.marker))).toHaveLength(windows.length);
  });

  it('retains the nine-window capacity independently from global layer allocation', () => {
    expect(MAX_ACTIVITY_PLUGIN_WINDOWS).toBe(9);
  });
});
