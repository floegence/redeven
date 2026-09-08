import type { RuntimeWorkbenchLayoutSnapshot } from './runtimeWorkbenchLayout';

type SharedLayout = Pick<RuntimeWorkbenchLayoutSnapshot, 'widgets' | 'sticky_notes' | 'annotations' | 'background_layers'>;

// Merge unsaved field changes onto the new authoritative snapshot. Remote
// removal wins over local editing, so a stale renderer cannot revive a widget.
export function mergeWorkbenchLayoutChanges(base: SharedLayout, local: SharedLayout, remote: SharedLayout): SharedLayout {
  const merge = <T extends object>(before: readonly T[], desired: readonly T[], latest: readonly T[], key: (item: T) => string): T[] => {
    const old = new Map((before ?? []).map((item) => [key(item), item]));
    const mine = new Map((desired ?? []).map((item) => [key(item), item]));
    const result = (latest ?? []).flatMap((item) => {
      const id = key(item);
      const previous = old.get(id);
      const next = mine.get(id);
      if (!previous) return [item];
      if (!next) return [];
      const merged = { ...item };
      for (const field of Object.keys(next) as (keyof T)[]) {
        if (JSON.stringify(previous[field]) !== JSON.stringify(next[field])) merged[field] = next[field];
      }
      return [merged];
    });
    const existing = new Set((latest ?? []).map(key));
    for (const item of desired ?? []) if (!old.has(key(item)) && !existing.has(key(item))) result.push(item);
    return result;
  };
  return {
    widgets: merge(base.widgets, local.widgets, remote.widgets, (item) => item.widget_id),
    sticky_notes: merge(base.sticky_notes, local.sticky_notes, remote.sticky_notes, (item) => item.id),
    annotations: merge(base.annotations, local.annotations, remote.annotations, (item) => item.id),
    background_layers: merge(base.background_layers, local.background_layers, remote.background_layers, (item) => item.id),
  };
}
