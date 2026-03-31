import { createSignal, type Accessor } from 'solid-js';
import type { PreparedText } from '@chenglou/pretext';

import { loadCodexPretextModule, type CodexPretextModule } from './pretextLoader';

type ResizeObserverLike = Readonly<{
  observe: (target: Element) => void;
  disconnect: () => void;
}>;

type ResizeObserverFactory = (callback: ResizeObserverCallback) => ResizeObserverLike | null;
type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;
type FontFaceSetLike = Readonly<{
  ready: Promise<unknown>;
  addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
}>;

export type CodexComposerTypography = Readonly<{
  font: string;
  lineHeightPx: number;
  minHeightPx: number;
  maxHeightPx: number;
  paddingBlockPx: number;
  paddingInlinePx: number;
  unsafeForPretext: boolean;
}>;

export type CodexComposerMeasurementRequest = Readonly<{
  text: string;
  contentWidthPx: number;
  typography: CodexComposerTypography;
}>;

export type CodexComposerAutosizeSnapshot = Readonly<{
  heightPx: number;
  lineCount: number;
  overflowY: 'hidden' | 'auto';
  source: 'pretext' | 'dom-fallback';
}>;

export type CodexComposerInlineStyle = Readonly<{
  height: string;
  overflowY: 'hidden' | 'auto';
}>;

export type CodexComposerAutosizeController = Readonly<{
  setTextarea: (element: HTMLTextAreaElement | null | undefined) => void;
  requestMeasure: (text: string) => void;
  style: Accessor<CodexComposerInlineStyle>;
  snapshot: Accessor<CodexComposerAutosizeSnapshot>;
  dispose: () => void;
}>;

export type CreateCodexComposerAutosizeControllerArgs = Readonly<{
  loadPretext?: () => Promise<CodexPretextModule>;
  createResizeObserver?: ResizeObserverFactory;
  requestAnimationFrame?: RequestFrame;
  cancelAnimationFrame?: CancelFrame;
  getComputedStyle?: (element: Element) => CSSStyleDeclaration;
  fonts?: FontFaceSetLike | null;
}>;

const DEFAULT_MIN_HEIGHT_PX = 56;
const DEFAULT_MAX_HEIGHT_PX = 320;
const DEFAULT_FONT_SIZE_PX = 13;
const DEFAULT_LINE_HEIGHT_MULTIPLIER = 1.5;
const FRAME_PENDING = -1;
const DEFAULT_SNAPSHOT: CodexComposerAutosizeSnapshot = {
  heightPx: DEFAULT_MIN_HEIGHT_PX,
  lineCount: 1,
  overflowY: 'hidden',
  source: 'dom-fallback',
};

function fallbackRequestAnimationFrame(callback: FrameRequestCallback): number {
  callback(0);
  return 0;
}

function fallbackCancelAnimationFrame(): void {
  // No-op fallback for environments without requestAnimationFrame.
}

function defaultResizeObserverFactory(callback: ResizeObserverCallback): ResizeObserverLike | null {
  if (typeof ResizeObserver === 'undefined') return null;
  return new ResizeObserver(callback);
}

function toPx(value: string | null | undefined): number {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 0;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPositivePx(value: string | null | undefined, fallbackPx: number): number {
  const parsed = toPx(value);
  return parsed > 0 ? parsed : fallbackPx;
}

function resolveLineHeightPx(rawValue: string | null | undefined, fontSizePx: number): number {
  const normalized = String(rawValue ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'normal') {
    return Math.round(fontSizePx * DEFAULT_LINE_HEIGHT_MULTIPLIER * 100) / 100;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.round(fontSizePx * DEFAULT_LINE_HEIGHT_MULTIPLIER * 100) / 100;
  }
  if (normalized.endsWith('px')) {
    return parsed;
  }
  return Math.round(fontSizePx * parsed * 100) / 100;
}

function normalizeFontWeight(value: string): string {
  const normalized = String(value ?? '').trim();
  return normalized || '400';
}

function normalizeFontStyle(value: string): string {
  const normalized = String(value ?? '').trim();
  return normalized || 'normal';
}

function normalizeFontFamily(value: string): string {
  const normalized = String(value ?? '').trim();
  return normalized || 'sans-serif';
}

function buildCanvasFont(style: CSSStyleDeclaration, fontSizePx: number): string {
  const fontStyle = normalizeFontStyle(style.fontStyle);
  const fontVariant = normalizeFontStyle(style.fontVariant);
  const fontWeight = normalizeFontWeight(style.fontWeight);
  const fontStretch = normalizeFontStyle((style as CSSStyleDeclaration & { fontStretch?: string }).fontStretch ?? '');
  const fontFamily = normalizeFontFamily(style.fontFamily);
  return [fontStyle, fontVariant, fontWeight, fontStretch, `${fontSizePx}px`, fontFamily]
    .filter(Boolean)
    .join(' ');
}

function readTypography(
  element: HTMLTextAreaElement,
  readStyle: (element: Element) => CSSStyleDeclaration,
): CodexComposerTypography {
  const style = readStyle(element);
  const fontSizePx = toPositivePx(style.fontSize, DEFAULT_FONT_SIZE_PX);
  const lineHeightPx = resolveLineHeightPx(style.lineHeight, fontSizePx);
  const minHeightPx = toPositivePx(style.minHeight, DEFAULT_MIN_HEIGHT_PX);
  const maxHeightPx = toPositivePx(style.maxHeight, DEFAULT_MAX_HEIGHT_PX);
  const paddingBlockPx = toPx(style.paddingTop) + toPx(style.paddingBottom);
  const paddingInlinePx = toPx(style.paddingLeft) + toPx(style.paddingRight);
  const fontFamily = normalizeFontFamily(style.fontFamily);
  return {
    font: buildCanvasFont(style, fontSizePx),
    lineHeightPx,
    minHeightPx,
    maxHeightPx,
    paddingBlockPx,
    paddingInlinePx,
    unsafeForPretext: fontFamily.toLowerCase().includes('system-ui'),
  };
}

function readContentWidthPx(
  element: HTMLTextAreaElement,
  typography: CodexComposerTypography,
  readStyle: (element: Element) => CSSStyleDeclaration,
): number {
  const layoutWidth = element.clientWidth
    || element.getBoundingClientRect().width
    || toPx(readStyle(element).width);
  return Math.max(0, layoutWidth - typography.paddingInlinePx);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function countLinesFromHeight(contentHeightPx: number, lineHeightPx: number): number {
  if (!Number.isFinite(contentHeightPx) || contentHeightPx <= 0) return 1;
  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return 1;
  return Math.max(1, Math.round(contentHeightPx / lineHeightPx));
}

function sameSnapshot(left: CodexComposerAutosizeSnapshot, right: CodexComposerAutosizeSnapshot): boolean {
  return (
    left.heightPx === right.heightPx &&
    left.lineCount === right.lineCount &&
    left.overflowY === right.overflowY &&
    left.source === right.source
  );
}

function snapshotToInlineStyle(snapshot: CodexComposerAutosizeSnapshot): CodexComposerInlineStyle {
  return {
    height: `${snapshot.heightPx}px`,
    overflowY: snapshot.overflowY,
  };
}

export function createCodexComposerAutosizeController(
  args: CreateCodexComposerAutosizeControllerArgs = {},
): CodexComposerAutosizeController {
  const loadPretext = args.loadPretext ?? loadCodexPretextModule;
  const createResizeObserver = args.createResizeObserver ?? defaultResizeObserverFactory;
  const requestFrame = args.requestAnimationFrame ?? globalThis.requestAnimationFrame ?? fallbackRequestAnimationFrame;
  const cancelFrame = args.cancelAnimationFrame ?? globalThis.cancelAnimationFrame ?? fallbackCancelAnimationFrame;
  const readStyle = args.getComputedStyle ?? globalThis.getComputedStyle.bind(globalThis);
  const fontFaceSet = args.fonts ?? (typeof document !== 'undefined' ? document.fonts ?? null : null);

  const [snapshot, setSnapshot] = createSignal<CodexComposerAutosizeSnapshot>(DEFAULT_SNAPSHOT);
  const [style, setStyle] = createSignal<CodexComposerInlineStyle>(snapshotToInlineStyle(DEFAULT_SNAPSHOT));

  let textareaEl: HTMLTextAreaElement | null = null;
  let resizeObserver: ResizeObserverLike | null = null;
  let scheduledFrame: number | null = null;
  let latestText = '';
  let disposed = false;
  let pretextModule: CodexPretextModule | null = null;
  let pretextLoadStarted = false;
  let pretextFailed = false;
  let preparedKey = '';
  let preparedText: PreparedText | null = null;

  const applySnapshot = (next: CodexComposerAutosizeSnapshot): void => {
    if (textareaEl) {
      textareaEl.style.height = `${next.heightPx}px`;
      textareaEl.style.overflowY = next.overflowY;
    }
    setStyle(snapshotToInlineStyle(next));
    setSnapshot((current) => (sameSnapshot(current, next) ? current : next));
  };

  const measureWithDomFallback = (
    textarea: HTMLTextAreaElement,
    typography: CodexComposerTypography,
  ): CodexComposerAutosizeSnapshot => {
    textarea.style.height = 'auto';
    textarea.style.overflowY = 'hidden';
    const naturalHeightPx = Math.max(textarea.scrollHeight, typography.minHeightPx);
    const heightPx = clamp(naturalHeightPx, typography.minHeightPx, typography.maxHeightPx);
    const contentHeightPx = Math.max(0, heightPx - typography.paddingBlockPx);
    return {
      heightPx,
      lineCount: countLinesFromHeight(contentHeightPx, typography.lineHeightPx),
      overflowY: naturalHeightPx > typography.maxHeightPx ? 'auto' : 'hidden',
      source: 'dom-fallback',
    };
  };

  const measureWithPretext = (
    request: CodexComposerMeasurementRequest,
  ): CodexComposerAutosizeSnapshot => {
    const text = request.text;
    const nextKey = `${request.typography.font}\u0000${text}`;
    if (preparedKey !== nextKey || !preparedText) {
      preparedText = pretextModule!.prepare(text, request.typography.font, { whiteSpace: 'pre-wrap' });
      preparedKey = nextKey;
    }
    const layout = pretextModule!.layout(
      preparedText,
      Math.max(1, request.contentWidthPx),
      request.typography.lineHeightPx,
    );
    const contentHeightPx = Math.max(layout.height, request.typography.lineHeightPx);
    const naturalHeightPx = contentHeightPx + request.typography.paddingBlockPx;
    return {
      heightPx: clamp(naturalHeightPx, request.typography.minHeightPx, request.typography.maxHeightPx),
      lineCount: Math.max(1, layout.lineCount),
      overflowY: naturalHeightPx > request.typography.maxHeightPx ? 'auto' : 'hidden',
      source: 'pretext',
    };
  };

  const runMeasure = (): void => {
    scheduledFrame = null;
    const textarea = textareaEl;
    if (!textarea || disposed) return;

    const typography = readTypography(textarea, readStyle);
    const contentWidthPx = readContentWidthPx(textarea, typography, readStyle);
    const request: CodexComposerMeasurementRequest = {
      text: latestText,
      contentWidthPx,
      typography,
    };

    if (!pretextFailed && pretextModule && !typography.unsafeForPretext && request.contentWidthPx > 0) {
      try {
        applySnapshot(measureWithPretext(request));
        return;
      } catch {
        pretextFailed = true;
      }
    }

    applySnapshot(measureWithDomFallback(textarea, typography));
  };

  const scheduleMeasure = (): void => {
    if (disposed) return;
    if (scheduledFrame !== null) return;
    scheduledFrame = FRAME_PENDING;
    const handle = requestFrame(() => {
      runMeasure();
    });
    if (scheduledFrame === FRAME_PENDING) {
      scheduledFrame = handle;
    }
  };

  const handleFontsChanged = (): void => {
    scheduleMeasure();
  };

  const ensurePretextLoaded = (): void => {
    if (pretextLoadStarted || pretextFailed) return;
    pretextLoadStarted = true;
    void loadPretext()
      .then((module) => {
        if (disposed) return;
        pretextModule = module;
        scheduleMeasure();
      })
      .catch(() => {
        if (disposed) return;
        pretextFailed = true;
        scheduleMeasure();
      });
  };

  const disconnectResizeObserver = (): void => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  };

  const setTextarea = (element: HTMLTextAreaElement | null | undefined): void => {
    if (textareaEl === (element ?? null)) return;
    disconnectResizeObserver();
    textareaEl = element ?? null;
    preparedKey = '';
    preparedText = null;

    if (!textareaEl || disposed) return;

    resizeObserver = createResizeObserver(() => {
      scheduleMeasure();
    });
    resizeObserver?.observe(textareaEl);
    ensurePretextLoaded();
    scheduleMeasure();
  };

  const requestMeasure = (text: string): void => {
    latestText = String(text ?? '');
    scheduleMeasure();
  };

  const dispose = (): void => {
    disposed = true;
    disconnectResizeObserver();
    if (scheduledFrame !== null) {
      cancelFrame(scheduledFrame);
      scheduledFrame = null;
    }
    fontFaceSet?.removeEventListener?.('loadingdone', handleFontsChanged);
    fontFaceSet?.removeEventListener?.('loadingerror', handleFontsChanged);
    textareaEl = null;
  };

  if (fontFaceSet) {
    void fontFaceSet.ready.then(() => {
      if (!disposed) scheduleMeasure();
    });
    fontFaceSet.addEventListener?.('loadingdone', handleFontsChanged);
    fontFaceSet.addEventListener?.('loadingerror', handleFontsChanged);
  }

  return {
    setTextarea,
    requestMeasure,
    style,
    snapshot,
    dispose,
  };
}
