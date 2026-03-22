export type RovingTabOrientation = 'horizontal' | 'vertical';

export function buildTabElementId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

export function buildTabPanelElementId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

export function resolveRovingTabTargetId<T extends string>(
  ids: readonly T[],
  currentId: T,
  key: string,
  orientation: RovingTabOrientation,
): T | null {
  if (ids.length === 0) {
    return null;
  }

  const currentIndex = Math.max(0, ids.indexOf(currentId));

  switch (key) {
    case 'Home':
      return ids[0] ?? null;
    case 'End':
      return ids[ids.length - 1] ?? null;
    case 'ArrowLeft':
      if (orientation !== 'horizontal') return null;
      return ids[(currentIndex - 1 + ids.length) % ids.length] ?? null;
    case 'ArrowRight':
      if (orientation !== 'horizontal') return null;
      return ids[(currentIndex + 1) % ids.length] ?? null;
    case 'ArrowUp':
      if (orientation !== 'vertical') return null;
      return ids[(currentIndex - 1 + ids.length) % ids.length] ?? null;
    case 'ArrowDown':
      if (orientation !== 'vertical') return null;
      return ids[(currentIndex + 1) % ids.length] ?? null;
    default:
      return null;
  }
}
