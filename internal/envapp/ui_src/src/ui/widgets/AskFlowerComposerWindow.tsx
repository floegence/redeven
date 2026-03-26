import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Activity, FileText, Folder, Paperclip, Send, Terminal } from '@floegence/floe-webapp-core/icons';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { Button } from '@floegence/floe-webapp-core/ui';
import { FlowerIcon } from '../icons/FlowerIcon';
import type { AskFlowerComposerAnchor } from '../pages/EnvContext';
import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { buildAskFlowerComposerCopy, type AskFlowerComposerEntry } from '../utils/askFlowerComposerCopy';
import { resolveSuggestedWorkingDirAbsolute } from '../utils/askFlowerPath';
import {
  describeFilePreview,
  FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR,
  getExtDot,
  isLikelyTextContent,
  mimeFromExtDot,
  type FilePreviewDescriptor,
} from '../utils/filePreview';
import { readFileBytesOnce } from '../utils/fileStreamReader';
import { syncLiveTextValue } from '../utils/liveTextValue';
import { shouldSubmitOnEnterKeydown } from '../utils/shouldSubmitOnEnterKeydown';
import { useFilePreviewContext } from './FilePreviewContext';
import { FilePreviewContent } from './FilePreviewContent';
import { PersistentFloatingWindow } from './PersistentFloatingWindow';
import { PREVIEW_WINDOW_Z_INDEX, PreviewWindow } from './PreviewWindow';
import { RemoteFileBrowser } from './RemoteFileBrowser';

const WINDOW_VIEWPORT_MARGIN_DESKTOP = 12;
const WINDOW_VIEWPORT_MARGIN_MOBILE = 8;
const WINDOW_ANCHOR_OFFSET = 8;
const INLINE_FILE_PREVIEW_MAX_BYTES = 160 * 1024;
const INLINE_TEXT_PREVIEW_MAX_CHARS = 120_000;
const CONTEXT_PREVIEW_DEFAULT_SIZE = { width: 880, height: 640 };
const CONTEXT_PREVIEW_MIN_SIZE = { width: 380, height: 280 };
const ASK_FLOWER_COMPOSER_Z_INDEX = PREVIEW_WINDOW_Z_INDEX + 10;
const ASK_FLOWER_CONTEXT_BROWSER_Z_INDEX = ASK_FLOWER_COMPOSER_Z_INDEX + 1;
const ASK_FLOWER_CONTEXT_PREVIEW_Z_INDEX = ASK_FLOWER_CONTEXT_BROWSER_Z_INDEX + 1;

type AskFlowerComposerWindowProps = {
  open: boolean;
  intent: AskFlowerIntent | null;
  anchor?: AskFlowerComposerAnchor | null;
  onClose: () => void;
  onSend: (userPrompt: string) => Promise<void>;
};

type WindowSizing = {
  compact: boolean;
  margin: number;
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maxSize: { width: number; height: number };
};

type ContextPreviewState = Readonly<{
  title: string;
  subtitle: string;
  item: FileItem;
  descriptor: FilePreviewDescriptor;
  text?: string;
  message?: string;
  objectUrl?: string;
  bytes?: Uint8Array<ArrayBuffer> | null;
  truncated?: boolean;
  loading?: boolean;
  error?: string | null;
  xlsxSheetName?: string;
  xlsxRows?: string[][];
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
}>;

type ContextBrowserState = Readonly<{
  path: string;
  title: string;
  subtitle: string;
}>;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function currentViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function resolveWindowSizing(viewport: { width: number; height: number }): WindowSizing {
  const compact = viewport.width < 640;
  const margin = compact ? WINDOW_VIEWPORT_MARGIN_MOBILE : WINDOW_VIEWPORT_MARGIN_DESKTOP;
  const maxWidth = Math.max(280, viewport.width - margin * 2);
  const maxHeight = Math.max(280, viewport.height - margin * 2);
  const defaultWidth = compact ? Math.min(460, maxWidth) : Math.min(640, maxWidth);
  const defaultHeight = compact ? Math.min(620, maxHeight) : Math.min(720, maxHeight);
  const minWidth = Math.min(compact ? 300 : 420, maxWidth);
  const minHeight = Math.min(compact ? 440 : 520, maxHeight);

  return {
    compact,
    margin,
    defaultSize: { width: defaultWidth, height: defaultHeight },
    minSize: { width: minWidth, height: minHeight },
    maxSize: { width: maxWidth, height: maxHeight },
  };
}

function toWindowPosition(
  anchor: AskFlowerComposerAnchor | null | undefined,
  sizing: WindowSizing,
): { x: number; y: number } | undefined {
  if (!anchor) return undefined;
  if (typeof window === 'undefined') return undefined;

  const availableWidth = Math.max(0, window.innerWidth - sizing.margin * 2);
  const availableHeight = Math.max(0, window.innerHeight - sizing.margin * 2);
  const windowWidth = Math.min(sizing.defaultSize.width, availableWidth || sizing.defaultSize.width);
  const windowHeight = Math.min(sizing.defaultSize.height, availableHeight || sizing.defaultSize.height);
  const maxX = Math.max(sizing.margin, window.innerWidth - windowWidth - sizing.margin);
  const maxY = Math.max(sizing.margin, window.innerHeight - windowHeight - sizing.margin);

  return {
    x: clamp(anchor.x + WINDOW_ANCHOR_OFFSET, sizing.margin, maxX),
    y: clamp(anchor.y + WINDOW_ANCHOR_OFFSET, sizing.margin, maxY),
  };
}

function isPointerInsideComposer(event: PointerEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (node.classList.contains('ask-flower-composer-window')) return true;
    if (node.classList.contains('ask-flower-context-preview-surface')) return true;
  }

  const target = event.target;
  if (!(target instanceof Element)) return false;
  return !!target.closest('.ask-flower-composer-window, .ask-flower-context-preview-surface');
}

function truncatePath(fullPath: string, maxSegments = 3): string {
  const segments = fullPath.split('/').filter(Boolean);
  if (segments.length <= maxSegments) return fullPath;
  return '.../' + segments.slice(-maxSegments).join('/');
}

function basenameFromPath(path: string): string {
  const normalized = String(path ?? '').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized || 'File';
}

function fileItemFromPath(path: string): FileItem {
  return {
    id: path,
    name: basenameFromPath(path),
    path,
    type: 'file',
  };
}

function fileItemForContextPreview(path: string, name?: string): FileItem {
  const normalizedPath = String(path ?? '').trim() || name || 'Context preview';
  return {
    id: normalizedPath,
    name: String(name ?? '').trim() || basenameFromPath(normalizedPath),
    path: normalizedPath,
    type: 'file',
  };
}

function previewNoticeForMode(mode: ReturnType<typeof describeFilePreview>['mode']): string {
  if (mode === 'image') return 'This file uses an image preview. Open the full preview to inspect it.';
  if (mode === 'pdf') return 'This file uses a PDF preview. Open the full preview to inspect it.';
  if (mode === 'docx') return 'This file uses a document preview. Open the full preview to inspect it.';
  if (mode === 'xlsx') return 'This file uses a spreadsheet preview. Open the full preview to inspect it.';
  if (mode === 'unsupported') return 'This file type is not available in the inline preview.';
  return 'This file is best viewed in the full preview.';
}

function trimPreviewBody(content: string): { body: string; truncated: boolean } {
  if (content.length <= INLINE_TEXT_PREVIEW_MAX_CHARS) {
    return { body: content, truncated: false };
  }
  return {
    body: content.slice(0, INLINE_TEXT_PREVIEW_MAX_CHARS),
    truncated: true,
  };
}

function contextPreviewStateForText(params: {
  title: string;
  subtitle: string;
  item: FileItem;
  text: string;
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
}): ContextPreviewState {
  return {
    title: params.title,
    subtitle: params.subtitle,
    item: params.item,
    descriptor: FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR,
    text: params.text,
    helper: params.helper,
    actionLabel: params.actionLabel,
    onAction: params.onAction,
  };
}

function contextPreviewStateForMessage(params: {
  title: string;
  subtitle: string;
  item: FileItem;
  descriptor?: FilePreviewDescriptor;
  message: string;
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
  error?: string | null;
}): ContextPreviewState {
  return {
    title: params.title,
    subtitle: params.subtitle,
    item: params.item,
    descriptor: params.descriptor ?? { mode: 'unsupported' },
    message: params.message,
    helper: params.helper,
    actionLabel: params.actionLabel,
    onAction: params.onAction,
    error: params.error ?? null,
  };
}

function contextPreviewStateLoading(params: {
  title: string;
  subtitle: string;
  item: FileItem;
  helper?: string;
}): ContextPreviewState {
  return {
    title: params.title,
    subtitle: params.subtitle,
    item: params.item,
    descriptor: FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR,
    loading: true,
    helper: params.helper,
  };
}

function revokeContextPreviewResources(preview: ContextPreviewState | null) {
  const objectUrl = String(preview?.objectUrl ?? '').trim();
  if (!objectUrl) return;
  try {
    URL.revokeObjectURL(objectUrl);
  } catch {
    // ignore
  }
}

async function resolveSpreadsheetPreview(bytes: Uint8Array<ArrayBuffer>): Promise<{ sheetName: string; rows: string[][] } | null> {
  const module = await import('exceljs');
  const ExcelJS: any = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer);

  const worksheet = workbook.worksheets?.[0] ?? workbook.getWorksheet?.(1);
  if (!worksheet) {
    return null;
  }

  const cellToText = (value: unknown): string => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const maybeCell = value as any;
      if (typeof maybeCell.text === 'string') return maybeCell.text;
      if (Array.isArray(maybeCell.richText)) {
        return maybeCell.richText.map((part: any) => String(part?.text ?? '')).join('');
      }
      if (maybeCell.result != null) return cellToText(maybeCell.result);
      if (typeof maybeCell.formula === 'string' && maybeCell.result != null) {
        return `${maybeCell.formula} = ${cellToText(maybeCell.result)}`;
      }
      try {
        return JSON.stringify(maybeCell);
      } catch {
        return String(maybeCell);
      }
    }
    return String(value);
  };

  const rows: string[][] = [];
  const maxRows = 200;
  const maxCols = 50;
  const rowCount = typeof worksheet.rowCount === 'number' ? worksheet.rowCount : 0;
  const takeRows = Math.min(rowCount || maxRows, maxRows);

  for (let rowIndex = 1; rowIndex <= takeRows; rowIndex += 1) {
    const row = worksheet.getRow?.(rowIndex);
    if (!row) continue;
    const nextRow: string[] = [];
    for (let colIndex = 1; colIndex <= maxCols; colIndex += 1) {
      const cell = row.getCell?.(colIndex);
      nextRow.push(cellToText(cell?.value));
    }
    rows.push(nextRow);
  }

  return {
    sheetName: String(worksheet.name ?? 'Sheet1'),
    rows,
  };
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  }

  if (typeof FileReader !== 'undefined') {
    return await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result) as Uint8Array<ArrayBuffer>);
          return;
        }
        reject(new Error('Failed to read file.'));
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  return new Uint8Array(await new Response(blob).arrayBuffer()) as Uint8Array<ArrayBuffer>;
}

async function buildFileLikeContextPreview(params: {
  title: string;
  subtitle: string;
  item: FileItem;
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  truncated?: boolean;
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
  blob?: Blob;
}): Promise<ContextPreviewState> {
  const descriptor = describeFilePreview(params.name);
  const helperParts = params.helper ? [params.helper] : [];
  const truncated = !!params.truncated;

  if (descriptor.mode === 'text') {
    const preview = trimPreviewBody(new TextDecoder('utf-8', { fatal: false }).decode(params.bytes));
    if (truncated) {
      helperParts.push('Showing partial content (truncated).');
    }
    if (preview.truncated) {
      helperParts.push('Showing the first part of the content.');
    }
    return contextPreviewStateForText({
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      text: preview.body,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    });
  }

  if (descriptor.mode === 'image' || descriptor.mode === 'pdf') {
    if (truncated) {
      return contextPreviewStateForMessage({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        message: descriptor.mode === 'image' ? 'This image is too large to preview.' : 'This PDF is too large to preview.',
        helper: helperParts.join(' ') || undefined,
        actionLabel: params.actionLabel,
        onAction: params.onAction,
      });
    }

    const mime = mimeFromExtDot(getExtDot(params.name)) ?? 'application/octet-stream';
    const objectUrl = URL.createObjectURL(params.blob ?? new Blob([params.bytes], { type: mime }));
    return {
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      descriptor,
      objectUrl,
      bytes: params.bytes,
      truncated,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    };
  }

  if (descriptor.mode === 'docx') {
    if (truncated) {
      return contextPreviewStateForMessage({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        message: 'This document is too large to preview.',
        helper: helperParts.join(' ') || undefined,
        actionLabel: params.actionLabel,
        onAction: params.onAction,
      });
    }

    return {
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      descriptor,
      bytes: params.bytes,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    };
  }

  if (descriptor.mode === 'xlsx') {
    if (truncated) {
      return contextPreviewStateForMessage({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        message: 'This spreadsheet is too large to preview.',
        helper: helperParts.join(' ') || undefined,
        actionLabel: params.actionLabel,
        onAction: params.onAction,
      });
    }

    const spreadsheetPreview = await resolveSpreadsheetPreview(params.bytes);
    if (!spreadsheetPreview) {
      return contextPreviewStateForMessage({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        message: 'No worksheet found in this file.',
        helper: helperParts.join(' ') || undefined,
        actionLabel: params.actionLabel,
        onAction: params.onAction,
      });
    }

    return {
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      descriptor,
      bytes: params.bytes,
      xlsxSheetName: spreadsheetPreview.sheetName,
      xlsxRows: spreadsheetPreview.rows,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    };
  }

  if (isLikelyTextContent(params.bytes)) {
    const preview = trimPreviewBody(new TextDecoder('utf-8', { fatal: false }).decode(params.bytes));
    if (truncated) {
      helperParts.push('Showing partial content (truncated).');
    }
    if (preview.truncated) {
      helperParts.push('Showing the first part of the content.');
    }
    return contextPreviewStateForText({
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      text: preview.body,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    });
  }

  return contextPreviewStateForMessage({
    title: params.title,
    subtitle: params.subtitle,
    item: params.item,
    message: 'Preview is not available for this file type.',
    helper: helperParts.join(' ') || undefined,
    actionLabel: params.actionLabel,
    onAction: params.onAction,
  });
}

function entryIcon(entry: AskFlowerComposerEntry) {
  if (entry.kind === 'directory') return <Folder class="size-3.5 shrink-0" />;
  if (entry.kind === 'attachment') return <Paperclip class="size-3.5 shrink-0" />;
  if (entry.kind === 'process_snapshot') return <Activity class="size-3.5 shrink-0" />;
  if (entry.kind === 'snapshot') return <FileText class="size-3.5 shrink-0" />;
  if (entry.kind === 'terminal_selection') return <Terminal class="size-3.5 shrink-0" />;
  if (entry.kind === 'selection') return <FileText class="size-3.5 shrink-0" />;
  return <FileText class="size-3.5 shrink-0" />;
}

function entryButtonClass(entry: AskFlowerComposerEntry): string {
  if (entry.kind === 'process_snapshot') {
    return 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 hover:border-cyan-500/35 hover:bg-cyan-500/16 dark:text-cyan-200';
  }
  if (entry.kind === 'selection' || entry.kind === 'terminal_selection') {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500/35 hover:bg-emerald-500/16 dark:text-emerald-200';
  }
  if (entry.kind === 'snapshot') {
    return 'border-violet-500/20 bg-violet-500/10 text-violet-700 hover:border-violet-500/35 hover:bg-violet-500/16 dark:text-violet-200';
  }
  if (entry.kind === 'attachment') {
    return 'border-sky-500/20 bg-sky-500/10 text-sky-700 hover:border-sky-500/35 hover:bg-sky-500/16 dark:text-sky-200';
  }
  if (entry.kind === 'directory') {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-700 hover:border-amber-500/35 hover:bg-amber-500/16 dark:text-amber-200';
  }
  return 'border-primary/20 bg-primary/10 text-primary hover:border-primary/35 hover:bg-primary/16';
}

const FlowerComposerAvatar: Component = () => (
  <div data-testid="ask-flower-avatar" class="relative flex size-10 shrink-0 items-center justify-center sm:size-11">
    <div class="absolute inset-0 rounded-full bg-primary/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" />
    <div class="relative flex size-10 items-center justify-center rounded-full border border-primary/18 bg-gradient-to-br from-primary/15 to-amber-500/10 shadow-[0_14px_30px_-20px_rgba(37,99,235,0.42)] sm:size-11">
      <FlowerIcon class="w-8 h-8 text-primary" />
    </div>
  </div>
);

export function AskFlowerComposerWindow(props: AskFlowerComposerWindowProps) {
  const protocol = useProtocol();
  const filePreview = useFilePreviewContext();
  const [userPrompt, setUserPrompt] = createSignal('');
  const [validationError, setValidationError] = createSignal('');
  const [isComposing, setIsComposing] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [viewport, setViewport] = createSignal(currentViewportSize());
  const [contextPreview, setContextPreview] = createSignal<ContextPreviewState | null>(null);
  const [contextBrowser, setContextBrowser] = createSignal<ContextBrowserState | null>(null);
  let textareaEl: HTMLTextAreaElement | undefined;
  let previewRequestSeq = 0;

  onMount(() => {
    const syncViewport = () => setViewport(currentViewportSize());
    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    onCleanup(() => {
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    });
  });

  onCleanup(() => {
    closeContextPreview();
    closeContextBrowser();
  });

  const windowSizing = createMemo(() => resolveWindowSizing(viewport()));
  const position = createMemo(() => toWindowPosition(props.anchor ?? null, windowSizing()));
  const composerCopy = createMemo(() => (props.intent ? buildAskFlowerComposerCopy(props.intent) : null));
  const canSubmit = createMemo(() => !sending() && userPrompt().trim().length > 0);

  const suggestedWorkingDir = createMemo(() => {
    const intent = props.intent;
    if (!intent) return '';
    return resolveSuggestedWorkingDirAbsolute({ suggestedWorkingDirAbs: intent.suggestedWorkingDirAbs });
  });

  const cleanedNotes = createMemo(() => {
    const intent = props.intent;
    if (!intent) return [] as string[];
    return intent.notes
      .map((note) => String(note ?? '').trim())
      .filter((note) => !!note);
  });

  const updateContextPreview = (next: ContextPreviewState | null) => {
    setContextPreview((current) => {
      if (current?.objectUrl && current.objectUrl !== next?.objectUrl) {
        revokeContextPreviewResources(current);
      }
      return next;
    });
  };

  const closeContextPreview = () => {
    previewRequestSeq += 1;
    updateContextPreview(null);
  };

  const closeContextBrowser = () => {
    setContextBrowser(null);
  };

  const resetDraft = (intent: AskFlowerIntent | null) => {
    setValidationError('');
    setIsComposing(false);
    setSending(false);
    closeContextPreview();
    closeContextBrowser();
    setUserPrompt(String(intent?.userPrompt ?? '').trim());
    requestAnimationFrame(() => {
      textareaEl?.focus();
      const el = textareaEl;
      if (!el) return;
      const pos = el.value.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        // ignore
      }
    });
  };

  createEffect(() => {
    if (!props.open) {
      closeContextPreview();
      closeContextBrowser();
      return;
    }
    resetDraft(props.intent);
  });

  createEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (sending()) return;
      if (contextPreview()) return;
      if (contextBrowser()) return;
      if (isPointerInsideComposer(event)) return;
      props.onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() => window.removeEventListener('pointerdown', onPointerDown, true));
  });

  const syncPromptFromTextarea = () => syncLiveTextValue(textareaEl, setUserPrompt, userPrompt());

  const submit = async () => {
    if (sending()) return;
    const trimmedPrompt = syncPromptFromTextarea().trim();
    if (!trimmedPrompt) {
      setValidationError('Please enter a message for Flower.');
      requestAnimationFrame(() => textareaEl?.focus());
      return;
    }

    setSending(true);
    try {
      await props.onSend(trimmedPrompt);
    } finally {
      setSending(false);
    }
  };

  const openFullFilePreview = async (path: string) => {
    closeContextPreview();
    await filePreview.openPreview(fileItemFromPath(path));
  };

  const openAttachmentPreview = async (params: {
    title: string;
    subtitle: string;
    item: FileItem;
    file: File;
    helper?: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => {
    const seq = ++previewRequestSeq;
    updateContextPreview(contextPreviewStateLoading({
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      helper: 'Loading preview...',
    }));

    try {
      const bytes = await readBlobBytes(params.file);
      if (seq !== previewRequestSeq) return;
      const nextPreview = await buildFileLikeContextPreview({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        name: params.file.name || params.item.name,
        bytes,
        helper: params.helper,
        actionLabel: params.actionLabel,
        onAction: params.onAction,
        blob: params.file,
      });
      if (seq !== previewRequestSeq) {
        revokeContextPreviewResources(nextPreview);
        return;
      }
      updateContextPreview(nextPreview);
    } catch (error) {
      if (seq !== previewRequestSeq) return;
      const message = error instanceof Error ? error.message : String(error);
      updateContextPreview(contextPreviewStateForMessage({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        message: 'Failed to read the attachment preview.',
        helper: message || undefined,
        error: message || 'Failed to read the attachment preview.',
      }));
    }
  };

  const openContextEntry = async (entry: AskFlowerComposerEntry): Promise<void> => {
    if (entry.kind === 'selection') {
      const preview = trimPreviewBody(entry.content);
      updateContextPreview(contextPreviewStateForText({
        title: 'Selected content',
        subtitle: entry.detail,
        item: fileItemForContextPreview(entry.sourcePath || entry.detail, 'Selected content'),
        text: preview.body,
        helper: preview.truncated ? 'Showing the first part of the selected content.' : undefined,
      }));
      return;
    }

    if (entry.kind === 'process_snapshot') {
      const preview = trimPreviewBody(entry.content);
      updateContextPreview(contextPreviewStateForText({
        title: 'Process snapshot',
        subtitle: entry.detail,
        item: fileItemForContextPreview(`process://${entry.pid}`, entry.label),
        text: preview.body,
        helper: preview.truncated ? 'Showing the first part of the process snapshot.' : undefined,
      }));
      return;
    }

    if (entry.kind === 'terminal_selection') {
      const preview = trimPreviewBody(entry.content);
      updateContextPreview(contextPreviewStateForText({
        title: 'Selected terminal output',
        subtitle: entry.detail,
        item: fileItemForContextPreview(entry.workingDir || entry.detail, 'Selected terminal output'),
        text: preview.body,
        helper: preview.truncated ? 'Showing the first part of the selected terminal output.' : undefined,
      }));
      return;
    }

    if (entry.kind === 'snapshot') {
      const preview = trimPreviewBody(entry.content);
      updateContextPreview(contextPreviewStateForText({
        title: entry.label,
        subtitle: entry.detail,
        item: fileItemForContextPreview(`snapshot://${entry.label}`, entry.label),
        text: preview.body,
        helper: preview.truncated ? 'Showing the first part of this context snapshot.' : undefined,
      }));
      return;
    }

    if (entry.kind === 'attachment') {
      await openAttachmentPreview({
        title: entry.label,
        subtitle: entry.detail,
        item: fileItemForContextPreview(entry.detail === 'Queued attachment' ? entry.file.name : entry.detail, entry.file.name),
        file: entry.file,
        helper: 'Queued with your Ask Flower message.',
      });
      return;
    }

    if (entry.kind === 'directory') {
      setContextBrowser({
        path: entry.path,
        title: entry.label,
        subtitle: entry.path,
      });
      return;
    }

    if (entry.attachmentFile) {
      await openAttachmentPreview({
        title: entry.label,
        subtitle: entry.path,
        item: fileItemForContextPreview(entry.path, entry.label),
        file: entry.attachmentFile,
        helper: 'Showing the attached snapshot that Flower will receive.',
        actionLabel: 'Open live file preview',
        onAction: () => {
          void openFullFilePreview(entry.path);
        },
      });
      return;
    }

    const seq = ++previewRequestSeq;
    updateContextPreview(contextPreviewStateLoading({
      title: entry.label,
      subtitle: entry.path,
      item: fileItemForContextPreview(entry.path, entry.label),
      helper: 'Loading preview...',
    }));

    const client = protocol.client();
    if (!client) {
      updateContextPreview(contextPreviewStateForMessage({
        title: entry.label,
        subtitle: entry.path,
        item: fileItemForContextPreview(entry.path, entry.label),
        message: 'Failed to load file preview.',
        helper: 'Connection is not ready.',
        error: 'Connection is not ready.',
      }));
      return;
    }

    try {
      const { bytes, meta } = await readFileBytesOnce({
        client,
        path: entry.path,
        maxBytes: INLINE_FILE_PREVIEW_MAX_BYTES,
      });
      if (seq !== previewRequestSeq) return;

      const descriptor = describeFilePreview(entry.path);
      const canRenderText = descriptor.mode === 'text' || (descriptor.mode === 'binary' && isLikelyTextContent(bytes));
      if (!canRenderText) {
        updateContextPreview(contextPreviewStateForMessage({
          title: entry.label,
          subtitle: entry.path,
          item: fileItemForContextPreview(entry.path, entry.label),
          message: previewNoticeForMode(descriptor.mode),
          actionLabel: 'Open full preview',
          onAction: () => {
            void openFullFilePreview(entry.path);
          },
        }));
        return;
      }

      const helperParts: string[] = [];
      if (meta.truncated) {
        helperParts.push(`Showing the first ${Math.round(INLINE_FILE_PREVIEW_MAX_BYTES / 1024)} KB.`);
      }
      const nextPreview = await buildFileLikeContextPreview({
        title: entry.label,
        subtitle: entry.path,
        item: fileItemForContextPreview(entry.path, entry.label),
        name: entry.path,
        bytes,
        truncated: meta.truncated,
        helper: helperParts.join(' ') || undefined,
        actionLabel: 'Open full preview',
        onAction: () => {
          void openFullFilePreview(entry.path);
        },
      });
      if (seq !== previewRequestSeq) {
        revokeContextPreviewResources(nextPreview);
        return;
      }
      updateContextPreview(nextPreview);
    } catch (error) {
      if (seq !== previewRequestSeq) return;
      const message = error instanceof Error ? error.message : String(error);
      updateContextPreview(contextPreviewStateForMessage({
        title: entry.label,
        subtitle: entry.path,
        item: fileItemForContextPreview(entry.path, entry.label),
        message: 'Failed to load file preview.',
        helper: message || undefined,
        error: message || 'Failed to load file preview.',
        actionLabel: 'Retry',
        onAction: () => {
          void openContextEntry(entry);
        },
      }));
    }
  };

  return (
    <Show when={props.open ? props.intent : null} keyed>
      {(intent) => (
        <>
          <PersistentFloatingWindow
            open
            onOpenChange={(next) => {
              if (sending()) return;
              if (!next) props.onClose();
            }}
            title="Ask Flower"
            persistenceKey="ask-flower-composer"
            defaultPosition={position()}
            defaultSize={windowSizing().defaultSize}
            minSize={windowSizing().minSize}
            maxSize={windowSizing().maxSize}
            class="ask-flower-composer-window border-border/65 shadow-[0_28px_72px_-42px_rgba(15,23,42,0.38)]"
            contentClass="!p-0"
            footerClass="!gap-1.5 !px-2 !py-1.5 sm:!px-2.5 sm:!py-1.5"
            zIndex={ASK_FLOWER_COMPOSER_Z_INDEX}
            footer={(
              <div class="flex w-full min-w-0 items-center gap-1.5 overflow-hidden">
                <div class="flex min-w-0 flex-1 items-center text-[10px] text-muted-foreground sm:text-[11px]">
                  <span class="inline-flex min-w-0 flex-1 items-center gap-1 rounded-full border border-border/60 bg-muted/28 px-2 py-0.5">
                    <Folder class="size-3 shrink-0" />
                    <span class="shrink-0 font-medium text-foreground/80">Working dir</span>
                    <span class="min-w-0 truncate font-mono text-[10px] sm:text-[11px]" title={suggestedWorkingDir() || 'Working directory unavailable'}>
                      {suggestedWorkingDir() ? truncatePath(suggestedWorkingDir()) : 'Unavailable'}
                    </span>
                  </span>
                </div>
                <span class="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{sending() ? 'Sending...' : 'Ready'}</span>
                <Button variant="ghost" size="sm" class="h-7 shrink-0 rounded-md px-2.5 text-[11px] font-medium cursor-pointer sm:h-8" onClick={props.onClose} disabled={sending()}>
                  Close
                </Button>
              </div>
            )}
          >
            <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
              <div data-testid="ask-flower-scroll-region" class="ask-flower-scroll-region flex-1 min-h-0 overflow-y-auto px-2 py-2 sm:px-2.5 sm:py-2.5">
                <div class="mx-auto flex w-full max-w-[40rem] flex-col gap-2">
                  <div class="chat-message-item items-start gap-2">
                    <FlowerComposerAvatar />

                    <div class="chat-message-content-wrapper max-w-[min(100%,37rem)] gap-1">
                      <div class="ask-flower-composer-message-surface min-w-0 rounded-[1.05rem] rounded-tl-md px-2.5 py-2 shadow-[0_14px_28px_-28px_rgba(15,23,42,0.34)] backdrop-blur sm:px-3 sm:py-2.5">
                        <div class="text-sm leading-5 text-foreground/95">{composerCopy()?.question}</div>

                        <Show when={(composerCopy()?.contextEntries.length ?? 0) > 0}>
                          <div class="mt-2 border-t border-border/50 pt-2">
                            <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">Linked context</div>
                            <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
                              <For each={composerCopy()?.contextEntries ?? []}>
                                {(entry) => (
                                  <button
                                    type="button"
                                    class={`flex min-w-0 items-start gap-2 rounded-[0.95rem] border px-2 py-1.5 text-left text-[11px] font-medium transition-colors cursor-pointer ${entryButtonClass(entry)}`}
                                    title={entry.title}
                                    onClick={() => {
                                      void openContextEntry(entry);
                                    }}
                                  >
                                    <span class="mt-0.5 shrink-0">{entryIcon(entry)}</span>
                                    <span class="min-w-0 flex-1">
                                      <span class="block truncate leading-4">{entry.label}</span>
                                      <span class="mt-0.5 block truncate font-mono text-[11px] leading-4 opacity-75">{entry.detail}</span>
                                    </span>
                                  </button>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>

                        <Show when={cleanedNotes().length > 0}>
                          <div class="mt-1.5 space-y-1">
                            <For each={cleanedNotes()}>
                              {(note) => (
                                <div class="rounded-[0.95rem] border border-sky-500/15 bg-sky-500/8 px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground">
                                  {note}
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div data-testid="ask-flower-composer-dock" class="ask-flower-composer-dock shrink-0 border-t border-border/65 bg-background/96 shadow-[0_-14px_30px_-30px_rgba(15,23,42,0.32)] backdrop-blur">
                <div class="mx-auto w-full max-w-[40rem]">
                  <div class="ask-flower-flat-input flower-chat-input ask-flower-composer-input">
                    <div class="chat-input-body flower-chat-input-body ask-flower-composer-input-body">
                      <div class="flower-chat-input-primary-row ask-flower-composer-editor-row">
                        <div class="ask-flower-composer-editor min-w-0 flex-1">
                          <div class="ask-flower-composer-heading mb-0.5 flex items-center justify-between gap-2">
                            <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary/70">You</div>
                            <span class="text-[11px] text-muted-foreground">{sending() ? 'Sending...' : 'Reply to Flower'}</span>
                          </div>

                          <div data-testid="ask-flower-composer-editor-shell" class="ask-flower-composer-editor-shell">
                            <textarea
                              ref={textareaEl}
                              id={`ask-flower-prompt-${intent.id}`}
                              class="chat-input-textarea flower-chat-input-textarea ask-flower-composer-textarea focus:!outline-none focus-visible:!outline-none focus-visible:!shadow-none"
                              value={userPrompt()}
                              placeholder={composerCopy()?.placeholder}
                              disabled={sending()}
                              onInput={(event) => {
                                setUserPrompt(event.currentTarget.value);
                                if (validationError()) setValidationError('');
                              }}
                              onCompositionStart={() => setIsComposing(true)}
                              onCompositionUpdate={() => {
                                syncPromptFromTextarea();
                                if (validationError()) setValidationError('');
                              }}
                              onCompositionEnd={() => {
                                setIsComposing(false);
                                syncPromptFromTextarea();
                                if (validationError()) setValidationError('');
                              }}
                              onKeyDown={(event) => {
                                if (shouldSubmitOnEnterKeydown({ event, isComposing: isComposing() })) {
                                  event.preventDefault();
                                  void submit();
                                }
                              }}
                            />

                            <Show when={validationError()}>
                              <div class="ask-flower-composer-validation text-error">
                                {validationError()}
                              </div>
                            </Show>

                            <button
                              data-testid="ask-flower-inline-send"
                              type="button"
                              class={`chat-input-send-btn flower-chat-input-send-btn ask-flower-composer-send-btn cursor-pointer ${canSubmit() ? 'chat-input-send-btn-active' : ''}`}
                              onClick={() => void submit()}
                              disabled={!canSubmit()}
                              title="Send message"
                              aria-label="Send message"
                            >
                              <Send class="size-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </PersistentFloatingWindow>

          <PreviewWindow
            open={!!contextBrowser()}
            onOpenChange={(open) => {
              if (!open) closeContextBrowser();
            }}
            title={contextBrowser()?.title || 'Linked context'}
            description={contextBrowser()?.subtitle || undefined}
            persistenceKey="ask-flower-context-browser"
            defaultSize={{ width: 760, height: 580 }}
            minSize={{ width: 420, height: 320 }}
            zIndex={ASK_FLOWER_CONTEXT_BROWSER_Z_INDEX}
            floatingClass="ask-flower-context-preview-surface"
            mobileClass="ask-flower-context-preview-surface"
          >
            <div class="h-full min-h-0 overflow-hidden bg-background">
              <Show when={contextBrowser()} keyed>
                {(browser) => (
                  <RemoteFileBrowser
                    stateScope="ask-flower-context-browser"
                    initialPathOverride={browser.path}
                  />
                )}
              </Show>
            </div>
          </PreviewWindow>

          <PreviewWindow
            open={!!contextPreview()}
            onOpenChange={(open) => {
              if (!open) closeContextPreview();
            }}
            title={contextPreview()?.title || 'Context preview'}
            description={contextPreview()?.subtitle || undefined}
            persistenceKey="ask-flower-context-preview"
            defaultSize={CONTEXT_PREVIEW_DEFAULT_SIZE}
            minSize={CONTEXT_PREVIEW_MIN_SIZE}
            zIndex={ASK_FLOWER_CONTEXT_PREVIEW_Z_INDEX}
            floatingClass="ask-flower-context-preview-surface"
            mobileClass="ask-flower-context-preview-surface"
            footer={(
              <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button size="sm" variant="outline" class="cursor-pointer" onClick={closeContextPreview}>
                  Close
                </Button>
                <Show when={contextPreview()?.actionLabel && contextPreview()?.onAction}>
                  <Button
                    size="sm"
                    variant="default"
                    class="cursor-pointer"
                    onClick={() => {
                      contextPreview()?.onAction?.();
                    }}
                  >
                    {contextPreview()?.actionLabel}
                  </Button>
                </Show>
              </div>
            )}
          >
            <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
                <Show when={contextPreview()?.helper}>
                  <div class={`shrink-0 border-b px-3 py-2 text-xs ${contextPreview()?.error ? 'border-error/20 bg-error/5 text-error' : 'border-border/70 bg-muted/25 text-muted-foreground'}`}>
                    {contextPreview()?.helper}
                  </div>
                </Show>
              <div class="min-h-0 flex-1 overflow-hidden">
                <Show when={contextPreview()}>
                  {(preview) => (
                    <FilePreviewContent
                      item={preview().item}
                      descriptor={preview().descriptor}
                      text={preview().text}
                      message={preview().message}
                      objectUrl={preview().objectUrl}
                      bytes={preview().bytes}
                      truncated={preview().truncated}
                      loading={preview().loading}
                      error={preview().error}
                      xlsxSheetName={preview().xlsxSheetName}
                      xlsxRows={preview().xlsxRows}
                    />
                  )}
                </Show>
              </div>
            </div>
          </PreviewWindow>
        </>
      )}
    </Show>
  );
}
