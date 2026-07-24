import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';

export const MAX_ACTIVITY_PLUGIN_WINDOWS = (
  ENV_APP_FLOATING_LAYER.pluginWindowCeiling - ENV_APP_FLOATING_LAYER.pluginWindow + 1
);

export function activityPluginWindowZIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_ACTIVITY_PLUGIN_WINDOWS) {
    throw new RangeError(`Activity plugin window index ${index} is outside the supported stack`);
  }
  return ENV_APP_FLOATING_LAYER.pluginWindow + index;
}

export function bringActivityPluginWindowToFront<T extends { instanceID: string }>(
  windows: readonly T[],
  instanceID: string,
): readonly T[] {
  const index = windows.findIndex((window) => window.instanceID === instanceID);
  if (index < 0 || index === windows.length - 1) return windows;
  return [...windows.slice(0, index), ...windows.slice(index + 1), windows[index]];
}
