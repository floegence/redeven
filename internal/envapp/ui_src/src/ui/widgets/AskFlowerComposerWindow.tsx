import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { FileText, Folder, Paperclip, Send, Terminal } from '@floegence/floe-webapp-core/icons';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { FlowerIcon } from '../icons/FlowerIcon';
import type { AskFlowerComposerAnchor } from '../pages/EnvContext';
import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { buildDetachedFileBrowserSurface, openDetachedSurfaceWindow } from '../services/detachedSurface';
import { buildAskFlowerComposerCopy, type AskFlowerComposerEntry } from '../utils/askFlowerComposerCopy';
import { resolveSuggestedWorkingDirAbsolute } from '../utils/askFlowerPath';
import { describeFilePreview, isLikelyTextContent } from '../utils/filePreview';
import { readFileBytesOnce } from '../utils/fileStreamReader';
import { syncLiveTextValue } from '../utils/liveTextValue';
import { useFilePreviewContext } from './FilePreviewContext';
import { PersistentFloatingWindow } from './PersistentFloatingWindow';

const WINDOW_VIEWPORT_MARGIN_DESKTOP = 12;
const WINDOW_VIEWPORT_MARGIN_MOBILE = 8;
const WINDOW_ANCHOR_OFFSET = 8;
const INLINE_FILE_PREVIEW_MAX_BYTES = 160 * 1024;
const INLINE_TEXT_PREVIEW_MAX_CHARS = 120_000;

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
  tone: 'loading' | 'text' | 'notice' | 'error';
  title: string;
  subtitle: string;
  body?: string;
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
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
    if (node.classList.contains('ask-flower-context-preview-dialog')) return true;
  }

  const target = event.target;
  if (!(target instanceof Element)) return false;
  return !!target.closest('.ask-flower-composer-window, .ask-flower-context-preview-dialog');
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

function entryIcon(entry: AskFlowerComposerEntry) {
  if (entry.kind === 'directory') return <Folder class="size-3.5 shrink-0" />;
  if (entry.kind === 'attachment') return <Paperclip class="size-3.5 shrink-0" />;
  if (entry.kind === 'terminal_selection') return <Terminal class="size-3.5 shrink-0" />;
  if (entry.kind === 'selection') return <FileText class="size-3.5 shrink-0" />;
  return <FileText class="size-3.5 shrink-0" />;
}

function entryButtonClass(entry: AskFlowerComposerEntry): string {
  if (entry.kind === 'selection' || entry.kind === 'terminal_selection') {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500/35 hover:bg-emerald-500/16 dark:text-emerald-200';
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
  const [isFocused, setIsFocused] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [viewport, setViewport] = createSignal(currentViewportSize());
  const [contextPreview, setContextPreview] = createSignal<ContextPreviewState | null>(null);
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

  const windowSizing = createMemo(() => resolveWindowSizing(viewport()));
  const position = createMemo(() => toWindowPosition(props.anchor ?? null, windowSizing()));
  const composerCopy = createMemo(() => (props.intent ? buildAskFlowerComposerCopy(props.intent) : null));
  const canSubmit = createMemo(() => !sending() && userPrompt().trim().length > 0);
  const contextEntryMap = createMemo(() => {
    const map = new Map<string, AskFlowerComposerEntry>();
    for (const item of composerCopy()?.contextEntries ?? []) {
      map.set(item.id, item);
    }
    return map;
  });

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

  const closeContextPreview = () => {
    previewRequestSeq += 1;
    setContextPreview(null);
  };

  const resetDraft = (intent: AskFlowerIntent | null) => {
    setValidationError('');
    setIsComposing(false);
    setIsFocused(false);
    setSending(false);
    closeContextPreview();
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
      return;
    }
    resetDraft(props.intent);
  });

  createEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (sending()) return;
      if (contextPreview()) return;
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

  const openContextEntry = async (entry: AskFlowerComposerEntry): Promise<void> => {
    if (entry.kind === 'selection') {
      const preview = trimPreviewBody(entry.content);
      setContextPreview({
        tone: 'text',
        title: 'Selected content',
        subtitle: entry.detail,
        body: preview.body,
        helper: preview.truncated ? 'Showing the first part of the selected content.' : undefined,
      });
      return;
    }

    if (entry.kind === 'terminal_selection') {
      const preview = trimPreviewBody(entry.content);
      setContextPreview({
        tone: 'text',
        title: 'Selected terminal output',
        subtitle: entry.detail,
        body: preview.body,
        helper: preview.truncated ? 'Showing the first part of the selected terminal output.' : undefined,
      });
      return;
    }

    if (entry.kind === 'attachment') {
      const seq = ++previewRequestSeq;
      setContextPreview({
        tone: 'loading',
        title: entry.label,
        subtitle: entry.detail,
        helper: 'Loading attachment preview...',
      });
      try {
        const preview = trimPreviewBody(await entry.file.text());
        if (seq !== previewRequestSeq) return;
        setContextPreview({
          tone: 'text',
          title: entry.label,
          subtitle: entry.detail,
          body: preview.body,
          helper: preview.truncated ? 'Showing the first part of the attachment.' : 'Queued with your Ask Flower message.',
        });
      } catch (error) {
        if (seq !== previewRequestSeq) return;
        const message = error instanceof Error ? error.message : String(error);
        setContextPreview({
          tone: 'error',
          title: entry.label,
          subtitle: entry.detail,
          helper: message || 'Failed to read the attachment preview.',
        });
      }
      return;
    }

    if (entry.kind === 'directory') {
      const surface = buildDetachedFileBrowserSurface({ path: entry.path });
      if (!surface) return;
      openDetachedSurfaceWindow(surface);
      return;
    }

    const seq = ++previewRequestSeq;
    setContextPreview({
      tone: 'loading',
      title: entry.label,
      subtitle: entry.path,
      helper: 'Loading file preview...',
    });

    const client = protocol.client();
    if (!client) {
      setContextPreview({
        tone: 'error',
        title: entry.label,
        subtitle: entry.path,
        helper: 'Connection is not ready.',
      });
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
        setContextPreview({
          tone: 'notice',
          title: entry.label,
          subtitle: entry.path,
          helper: previewNoticeForMode(descriptor.mode),
          actionLabel: 'Open full preview',
          onAction: () => {
            void openFullFilePreview(entry.path);
          },
        });
        return;
      }

      const preview = trimPreviewBody(new TextDecoder().decode(bytes));
      const helperParts: string[] = [];
      if (meta.truncated) {
        helperParts.push(`Showing the first ${Math.round(INLINE_FILE_PREVIEW_MAX_BYTES / 1024)} KB.`);
      }
      if (preview.truncated) {
        helperParts.push('Showing the first part of the file.');
      }

      setContextPreview({
        tone: 'text',
        title: entry.label,
        subtitle: entry.path,
        body: preview.body,
        helper: helperParts.join(' ') || undefined,
        actionLabel: 'Open full preview',
        onAction: () => {
          void openFullFilePreview(entry.path);
        },
      });
    } catch (error) {
      if (seq !== previewRequestSeq) return;
      const message = error instanceof Error ? error.message : String(error);
      setContextPreview({
        tone: 'error',
        title: entry.label,
        subtitle: entry.path,
        helper: message || 'Failed to load file preview.',
        actionLabel: 'Retry',
        onAction: () => {
          void openContextEntry(entry);
        },
      });
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
            class="ask-flower-composer-window"
            zIndex={130}
            footer={(
              <div class="flex w-full min-w-0 items-center gap-2">
                <div class="flex min-w-0 flex-1 items-center text-[11px] text-muted-foreground">
                  <span class="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-border/65 bg-muted/35 px-2.5 py-1">
                    <Folder class="size-3 shrink-0" />
                    <span class="shrink-0 font-medium text-foreground/80">Working dir</span>
                    <span class="min-w-0 truncate font-mono" title={suggestedWorkingDir() || 'Working directory unavailable'}>
                      {suggestedWorkingDir() ? truncatePath(suggestedWorkingDir()) : 'Unavailable'}
                    </span>
                  </span>
                </div>
                <span class="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{sending() ? 'Sending...' : 'Ready'}</span>
                <Button variant="ghost" size="sm" onClick={props.onClose} disabled={sending()}>
                  Close
                </Button>
              </div>
            )}
          >
            <div class="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,255,255,0.9))] dark:bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_42%),linear-gradient(180deg,rgba(19,24,38,0.98),rgba(12,16,28,0.98))]">
              <div data-testid="ask-flower-scroll-region" class="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 sm:px-3 sm:py-3">
                <div class="mx-auto flex w-full max-w-[42rem] flex-col gap-2.5">
                  <div class="chat-message-item items-start gap-2 sm:gap-2.5">
                    <FlowerComposerAvatar />

                    <div class="chat-message-content-wrapper max-w-[min(100%,39rem)] gap-1.5">
                      <div class="min-w-0 rounded-2xl rounded-tl-lg border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_16px_34px_-32px_rgba(15,23,42,0.4)] backdrop-blur sm:px-3.5 sm:py-3">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <div class="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">Flower</div>
                          <span class="inline-flex items-center rounded-full border border-primary/15 bg-primary/8 px-2 py-0.5 text-[11px] font-semibold text-primary/80">
                            {composerCopy()?.sourceLabel}
                          </span>
                          <Show when={(composerCopy()?.contextEntries.length ?? 0) > 0}>
                            <span class="inline-flex items-center rounded-full border border-border/65 bg-muted/35 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {composerCopy()?.contextEntries.length} linked
                            </span>
                          </Show>
                        </div>

                        <div class="mt-1.5 text-sm leading-5 text-foreground/95">
                          <For each={composerCopy()?.headline ?? []}>
                            {(part) =>
                              part.kind === 'text'
                                ? part.value
                                : (
                                  <button
                                    type="button"
                                    class={`mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 align-baseline text-[11px] font-medium transition-colors ${entryButtonClass(contextEntryMap().get(part.entryId)!)}`}
                                    title={contextEntryMap().get(part.entryId)?.title}
                                    onClick={() => {
                                      const entry = contextEntryMap().get(part.entryId);
                                      if (!entry) return;
                                      void openContextEntry(entry);
                                    }}
                                  >
                                    {entryIcon(contextEntryMap().get(part.entryId)!)}
                                    <span class="truncate">{contextEntryMap().get(part.entryId)?.label}</span>
                                  </button>
                                )
                            }
                          </For>
                        </div>

                        <div class="mt-2 rounded-xl border border-border/60 bg-muted/[0.22] px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                          <span class="font-medium text-foreground/90">{composerCopy()?.question}</span>
                          <Show when={(composerCopy()?.contextEntries.length ?? 0) > 0}>
                            <span class="ml-1">Open any linked context below to preview exactly what Flower will use.</span>
                          </Show>
                        </div>

                        <Show when={(composerCopy()?.contextEntries.length ?? 0) > 0}>
                          <div class="mt-2.5 border-t border-border/55 pt-2.5">
                            <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">Linked context</div>
                            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              <For each={composerCopy()?.contextEntries ?? []}>
                                {(entry) => (
                                  <button
                                    type="button"
                                    class={`flex min-w-0 items-start gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] font-medium transition-colors ${entryButtonClass(entry)}`}
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
                          <div class="mt-2 space-y-1.5">
                            <For each={cleanedNotes()}>
                              {(note) => (
                                <div class="rounded-xl border border-sky-500/15 bg-sky-500/8 px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground">
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

              <div data-testid="ask-flower-composer-dock" class="shrink-0 border-t border-border/70 bg-background/96 px-2 py-2 shadow-[0_-16px_32px_-30px_rgba(15,23,42,0.36)] backdrop-blur sm:px-2.5 sm:py-2.5">
                <div class="mx-auto w-full max-w-[42rem]">
                  <div class={`chat-input-container flower-chat-input !m-0 overflow-hidden rounded-[1.1rem] border border-border/55 bg-background/92 shadow-[0_12px_26px_-24px_rgba(15,23,42,0.22)] transition-[border-color,box-shadow,background-color] duration-150 ${isFocused() ? 'border-primary/30 bg-background shadow-[0_0_0_1px_rgba(59,130,246,0.10),0_14px_30px_-24px_rgba(37,99,235,0.18)]' : ''}`}>
                    <div class="chat-input-body flower-chat-input-body">
                      <div class="flower-chat-input-primary-row !gap-2 !px-2.5 !pt-2.5 !pb-0 sm:!gap-2.5 sm:!px-3 sm:!pt-3">
                        <div class="min-w-0 flex-1">
                          <div class="mb-1 flex items-center justify-between gap-2">
                            <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary/70">You</div>
                            <span class="text-[11px] text-muted-foreground">{sending() ? 'Sending...' : 'Reply to Flower'}</span>
                          </div>

                          <textarea
                            ref={textareaEl}
                            id={`ask-flower-prompt-${intent.id}`}
                            class="chat-input-textarea flower-chat-input-textarea !min-h-[72px] !max-h-[24vh] !px-0 !py-0 !text-sm !leading-5 focus-visible:!shadow-none sm:!min-h-[84px]"
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
                              if (event.isComposing || isComposing()) return;
                              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                event.preventDefault();
                                void submit();
                              }
                            }}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                          />
                        </div>

                        <div class="flower-chat-input-send-slot pb-0.5">
                          <button
                            type="button"
                            class={`chat-input-send-btn flower-chat-input-send-btn chat-input-send-btn-expanded ${canSubmit() ? 'chat-input-send-btn-active' : ''}`}
                            onClick={() => void submit()}
                            disabled={!canSubmit()}
                            title="Send message"
                          >
                            <span class="chat-input-send-btn-label">Send</span>
                            <Send class="size-3.5" />
                          </button>
                        </div>
                      </div>

                      <div class="chat-input-toolbar flex-wrap gap-1.5 !px-2.5 !py-1.5 sm:!px-3 sm:!py-2">
                        <div class="chat-input-toolbar-left min-w-0">
                          <div class="min-h-4 text-[11px] leading-4 text-muted-foreground">
                            <Show when={validationError()} fallback={<span>Flower receives the linked context automatically.</span>}>
                              <span class="text-error">{validationError()}</span>
                            </Show>
                          </div>
                        </div>
                        <div class="chat-input-toolbar-right ml-auto shrink-0 flex-wrap justify-end gap-1.5">
                          <Show when={(composerCopy()?.contextEntries.length ?? 0) > 0}>
                            <span class="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {composerCopy()?.contextEntries.length} linked
                            </span>
                          </Show>
                          <span class="chat-input-hint hidden sm:inline-flex">
                            <kbd>Ctrl/⌘</kbd>
                            <span>+</span>
                            <kbd>Enter</kbd>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </PersistentFloatingWindow>

          <Dialog
            open={!!contextPreview()}
            onOpenChange={(open) => {
              if (!open) closeContextPreview();
            }}
            title={contextPreview()?.title || 'Context preview'}
            description={contextPreview()?.subtitle || undefined}
            class="ask-flower-context-preview-dialog flex max-w-none flex-col overflow-hidden rounded-md p-0 sm:w-[min(52rem,92vw)]"
            footer={(
              <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button size="sm" variant="outline" onClick={closeContextPreview}>
                  Close
                </Button>
                <Show when={contextPreview()?.actionLabel && contextPreview()?.onAction}>
                  <Button
                    size="sm"
                    variant="default"
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
            <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2 pb-4">
              <Show when={contextPreview()?.body} fallback={(
                <div class="rounded-2xl border border-dashed border-border/70 bg-muted/15 px-4 py-6 text-sm leading-6 text-muted-foreground">
                  {contextPreview()?.tone === 'loading' ? 'Loading preview...' : contextPreview()?.helper || 'Nothing to preview.'}
                </div>
              )}>
                <Show when={contextPreview()?.helper}>
                  <div class={`mb-3 rounded-xl border px-3 py-2 text-sm ${contextPreview()?.tone === 'error' ? 'border-error/25 bg-error/6 text-error' : 'border-border/60 bg-muted/25 text-muted-foreground'}`}>
                    {contextPreview()?.helper}
                  </div>
                </Show>
                <pre class="min-h-[14rem] max-h-[min(60vh,38rem)] overflow-auto rounded-2xl border border-border/70 bg-slate-950 px-4 py-4 text-[12px] leading-6 text-slate-50 shadow-inner whitespace-pre-wrap break-words">{contextPreview()?.body}</pre>
              </Show>
            </div>
          </Dialog>
        </>
      )}
    </Show>
  );
}
