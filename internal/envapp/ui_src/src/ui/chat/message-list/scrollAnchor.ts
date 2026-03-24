export interface ViewportAnchor {
  messageId: string;
  offsetWithinItem: number;
}

export interface CaptureViewportAnchorArgs {
  messageIds: string[];
  visibleRangeStart: number;
  scrollTop: number;
  getItemOffset: (index: number) => number;
  getItemHeight: (index: number) => number;
}

export function captureViewportAnchor(args: CaptureViewportAnchorArgs): ViewportAnchor | null {
  const { messageIds, visibleRangeStart, scrollTop, getItemOffset, getItemHeight } = args;
  if (messageIds.length === 0) {
    return null;
  }

  let index = Math.max(0, Math.min(visibleRangeStart, messageIds.length - 1));
  while (index < messageIds.length) {
    const start = getItemOffset(index);
    const end = start + Math.max(1, getItemHeight(index));
    if (end > scrollTop + 0.5) {
      return {
        messageId: messageIds[index],
        offsetWithinItem: Math.max(0, scrollTop - start),
      };
    }
    index += 1;
  }

  const fallbackIndex = messageIds.length - 1;
  const fallbackStart = getItemOffset(fallbackIndex);
  return {
    messageId: messageIds[fallbackIndex],
    offsetWithinItem: Math.max(0, scrollTop - fallbackStart),
  };
}

export function resolveViewportAnchorScrollTop(
  anchor: ViewportAnchor | null,
  messageIndexById: Map<string, number>,
  getItemOffset: (index: number) => number,
): number | null {
  if (!anchor) {
    return null;
  }
  const index = messageIndexById.get(anchor.messageId);
  if (index === undefined) {
    return null;
  }
  return Math.max(0, getItemOffset(index) + anchor.offsetWithinItem);
}
