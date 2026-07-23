import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';

export function activityPluginWindowZIndex(index: number): number {
  return Math.min(
    ENV_APP_FLOATING_LAYER.pluginWindow + Math.max(0, index),
    ENV_APP_FLOATING_LAYER.pluginWindowCeiling,
  );
}

export function bringActivityPluginWindowToFront<T extends { instanceID: string }>(
  windows: readonly T[],
  instanceID: string,
): readonly T[] {
  const index = windows.findIndex((window) => window.instanceID === instanceID);
  if (index < 0 || index === windows.length - 1) return windows;
  return [...windows.slice(0, index), ...windows.slice(index + 1), windows[index]];
}
