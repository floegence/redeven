import { describe, expect, it } from 'vitest';

import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';
import {
  MAX_ACTIVITY_PLUGIN_WINDOWS,
  activityPluginWindowZIndex,
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

  it('allocates a unique z-index for every supported Activity plugin window', () => {
    const zIndexes = Array.from(
      { length: MAX_ACTIVITY_PLUGIN_WINDOWS },
      (_, index) => activityPluginWindowZIndex(index),
    );

    expect(zIndexes.at(-1)).toBe(ENV_APP_FLOATING_LAYER.pluginWindowCeiling);
    expect(new Set(zIndexes)).toHaveLength(MAX_ACTIVITY_PLUGIN_WINDOWS);
    expect(zIndexes[0]).toBeGreaterThan(ENV_APP_FLOATING_LAYER.previewWindow);
    expect(ENV_APP_FLOATING_LAYER.floatingWindowModal).toBeGreaterThan(zIndexes.at(-1)!);
    expect(() => activityPluginWindowZIndex(MAX_ACTIVITY_PLUGIN_WINDOWS)).toThrow(RangeError);
  });
});
