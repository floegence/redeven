export type ActivityFlowerPlacement = 'collapsed' | 'expanded' | 'full_page';

type FlowerFrameRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type ActivityFlowerViewport = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  safeArea?: Readonly<{
    top: number;
    right: number;
    bottom: number;
    left: number;
  }>;
}>;

export type ActivityFlowerFrame = FlowerFrameRect;

export function resolveActivityFlowerFrame(input: Readonly<{
  placement: ActivityFlowerPlacement;
  viewport: ActivityFlowerViewport;
  anchor?: FlowerFrameRect | null;
  fullPageHost?: FlowerFrameRect | null;
}>): ActivityFlowerFrame | null {
  if (input.placement === 'collapsed') return null;

  if (input.placement === 'full_page') {
    const host = input.fullPageHost;
    if (!host || host.width <= 0 || host.height <= 0) return null;
    return { left: host.left, top: host.top, width: host.width, height: host.height };
  }

  const anchor = input.anchor;
  if (!anchor || anchor.width <= 0) return null;
  const inset = 12;
  const safeArea = input.viewport.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const compact = input.viewport.width < 640;
  const viewportLeft = input.viewport.left + safeArea.left;
  const viewportTop = input.viewport.top + safeArea.top;
  const viewportRight = input.viewport.left + input.viewport.width - safeArea.right;
  const viewportBottom = input.viewport.top + input.viewport.height - safeArea.bottom;
  const availableWidth = Math.max(0, viewportRight - viewportLeft - inset * 2);
  const width = compact
    ? availableWidth
    : Math.min(544, anchor.width, availableWidth);
  const desiredLeft = anchor.left + (anchor.width - width) / 2;
  const left = Math.max(
    viewportLeft + inset,
    Math.min(desiredLeft, viewportRight - inset - width),
  );
  const anchorTop = Math.min(anchor.top, viewportBottom);
  const availableHeight = Math.max(0, anchorTop - viewportTop - inset - 8);
  const height = Math.min(544, availableHeight);

  return {
    left,
    top: Math.max(viewportTop + inset, anchorTop - 8 - height),
    width,
    height,
  };
}

export function activityFlowerFrameStyle(frame: ActivityFlowerFrame): Record<string, string> {
  return {
    left: `${frame.left}px`,
    top: `${frame.top}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
  };
}
