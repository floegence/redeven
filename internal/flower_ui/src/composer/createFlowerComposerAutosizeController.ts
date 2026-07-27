export type FlowerComposerAutosizeController = Readonly<{
  schedule: () => void;
  measure: () => void;
  suspend: () => void;
  resume: () => void;
  dispose: () => void;
}>;

export type FlowerComposerAutosizeControllerOptions = Readonly<{
  minLines?: number;
  maxLines?: number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  resizeObserver?: typeof ResizeObserver;
  window?: Window;
  document?: Document;
}>;

const pixels = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function createFlowerComposerAutosizeController(
  element: HTMLTextAreaElement,
  options: FlowerComposerAutosizeControllerOptions = {},
): FlowerComposerAutosizeController {
  const minLines = Math.max(1, Math.floor(options.minLines ?? 1));
  const maxLines = Math.max(minLines, Math.floor(options.maxLines ?? 5));
  const ownerWindow = options.window ?? element.ownerDocument.defaultView ?? window;
  const ownerDocument = options.document ?? element.ownerDocument;
  const requestFrame = options.requestFrame ?? ownerWindow.requestAnimationFrame.bind(ownerWindow);
  const cancelFrame = options.cancelFrame ?? ownerWindow.cancelAnimationFrame.bind(ownerWindow);
  const ResizeObserverConstructor: typeof ResizeObserver | undefined = options.resizeObserver
    ?? globalThis.ResizeObserver;
  let frame = 0;
  let suspended = false;
  let disposed = false;
  let observedWidth = element.getBoundingClientRect().width;

  const clearInlineSizing = () => {
    element.style.removeProperty('height');
    element.style.removeProperty('overflow-y');
    element.removeAttribute('data-flower-composer-scrollable');
  };
  const measure = () => {
    if (disposed || suspended) return;
    const style = ownerWindow.getComputedStyle(element);
    const fontSize = pixels(style.fontSize) || 16;
    const lineHeight = pixels(style.lineHeight) || fontSize * 1.2;
    const padding = pixels(style.paddingTop) + pixels(style.paddingBottom);
    const borders = pixels(style.borderTopWidth) + pixels(style.borderBottomWidth);
    const minimumContentBox = minLines * lineHeight;
    const maximumScrollBox = maxLines * lineHeight + padding;

    element.style.height = '0px';
    element.style.overflowY = 'hidden';
    const naturalScrollHeight = Math.max(element.scrollHeight, minimumContentBox + padding);
    const scrollable = naturalScrollHeight > maximumScrollBox + 0.5;
    const clampedScrollBox = Math.min(naturalScrollHeight, maximumScrollBox);
    const cssHeight = style.boxSizing === 'border-box'
      ? clampedScrollBox + borders
      : Math.max(minimumContentBox, clampedScrollBox - padding);

    element.style.height = `${Math.ceil(cssHeight)}px`;
    element.style.overflowY = scrollable ? 'auto' : 'hidden';
    if (scrollable) element.setAttribute('data-flower-composer-scrollable', 'true');
    else element.removeAttribute('data-flower-composer-scrollable');
  };
  const schedule = () => {
    if (disposed || suspended || frame) return;
    frame = requestFrame(() => {
      frame = 0;
      measure();
    });
  };
  const resizeObserver = ResizeObserverConstructor
    ? new ResizeObserverConstructor((entries) => {
      const width = entries[0]?.contentRect?.width ?? element.getBoundingClientRect().width;
      if (Math.abs(width - observedWidth) < 0.5) return;
      observedWidth = width;
      schedule();
    })
    : null;
  const handleWindowResize = () => schedule();
  resizeObserver?.observe(element);
  ownerWindow.addEventListener('resize', handleWindowResize);
  void ownerDocument.fonts?.ready.then(schedule).catch(() => undefined);
  schedule();

  return {
    schedule,
    measure,
    suspend: () => {
      if (disposed || suspended) return;
      suspended = true;
      if (frame) cancelFrame(frame);
      frame = 0;
      clearInlineSizing();
    },
    resume: () => {
      if (disposed || !suspended) return;
      suspended = false;
      observedWidth = element.getBoundingClientRect().width;
      schedule();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (frame) cancelFrame(frame);
      frame = 0;
      resizeObserver?.disconnect();
      ownerWindow.removeEventListener('resize', handleWindowResize);
      clearInlineSizing();
    },
  };
}
