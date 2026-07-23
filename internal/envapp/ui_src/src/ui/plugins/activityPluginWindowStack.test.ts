import { describe, expect, it } from 'vitest';

import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';
import {
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

  it('keeps the active last DOM sibling on top after z-index allocation reaches its ceiling', () => {
    const zIndexes = Array.from({ length: 18 }, (_, index) => activityPluginWindowZIndex(index));

    expect(zIndexes.at(-1)).toBe(ENV_APP_FLOATING_LAYER.pluginWindowCeiling);
    expect(zIndexes.at(-2)).toBe(ENV_APP_FLOATING_LAYER.pluginWindowCeiling);
    expect(zIndexes[0]).toBeGreaterThan(ENV_APP_FLOATING_LAYER.previewWindow);
    expect(ENV_APP_FLOATING_LAYER.floatingWindowModal).toBeGreaterThan(zIndexes.at(-1)!);
  });
});
