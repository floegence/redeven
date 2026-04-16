export const DESKTOP_EMBEDDED_DRAG_REGION_VERSION = 1;

export type DesktopEmbeddedDragRegionRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type DesktopEmbeddedDragRegionSnapshot = Readonly<{
  version: typeof DESKTOP_EMBEDDED_DRAG_REGION_VERSION;
  regions: readonly DesktopEmbeddedDragRegionRect[];
}>;

export interface DesktopEmbeddedDragRegionsBridge {
  setSnapshot: (snapshot: DesktopEmbeddedDragRegionSnapshot) => void;
  clear: () => void;
}

function normalizeNonNegativeNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return numeric;
}

function normalizePositiveNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric;
}

export function normalizeDesktopEmbeddedDragRegionRect(value: unknown): DesktopEmbeddedDragRegionRect | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopEmbeddedDragRegionRect>;
  const width = normalizePositiveNumber(candidate.width);
  const height = normalizePositiveNumber(candidate.height);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: normalizeNonNegativeNumber(candidate.x),
    y: normalizeNonNegativeNumber(candidate.y),
    width,
    height,
  };
}

export function normalizeDesktopEmbeddedDragRegionSnapshot(
  value: unknown,
): DesktopEmbeddedDragRegionSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopEmbeddedDragRegionSnapshot>;
  if (Number(candidate.version ?? 0) !== DESKTOP_EMBEDDED_DRAG_REGION_VERSION) {
    return null;
  }

  const regions = Array.isArray(candidate.regions)
    ? candidate.regions
      .map((region) => normalizeDesktopEmbeddedDragRegionRect(region))
      .filter((region): region is DesktopEmbeddedDragRegionRect => region !== null)
    : [];

  if (regions.length === 0) {
    return null;
  }

  return {
    version: DESKTOP_EMBEDDED_DRAG_REGION_VERSION,
    regions,
  };
}
