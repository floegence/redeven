export const MAX_ACTIVITY_PLUGIN_WINDOWS = 9;

export function bringActivityPluginWindowToFront<T extends { instanceID: string }>(
  windows: readonly T[],
  instanceID: string,
): readonly T[] {
  const index = windows.findIndex((window) => window.instanceID === instanceID);
  if (index < 0 || index === windows.length - 1) return windows;
  return [...windows.slice(0, index), ...windows.slice(index + 1), windows[index]];
}
