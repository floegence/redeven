import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { ChevronDown, ChevronUp, Folder, FileText, Paperclip, Terminal, Send } from '@floegence/floe-webapp-core/icons';
import type { AskFlowerComposerAnchor } from '../pages/EnvContext';
import type { AskFlowerContextItem, AskFlowerIntent } from '../pages/askFlowerIntent';
import { resolveSuggestedWorkingDirAbsolute } from '../utils/askFlowerPath';
import { syncLiveTextValue } from '../utils/liveTextValue';
import { PersistentFloatingWindow } from './PersistentFloatingWindow';

const WINDOW_VIEWPORT_MARGIN_DESKTOP = 12;
const WINDOW_VIEWPORT_MARGIN_MOBILE = 8;
const WINDOW_ANCHOR_OFFSET = 8;

type AskFlowerComposerWindowProps = {
  open: boolean;
  intent: AskFlowerIntent | null;
  anchor?: AskFlowerComposerAnchor | null;
  onClose: () => void;
  onSend: (userPrompt: string) => Promise<void>;
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

type WindowSizing = {
  compact: boolean;
  margin: number;
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maxSize: { width: number; height: number };
};

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
  const defaultWidth = compact ? Math.min(420, maxWidth) : Math.min(560, maxWidth);
  const defaultHeight = compact ? Math.min(400, maxHeight) : Math.min(480, maxHeight);
  const minWidth = Math.min(compact ? 280 : 380, maxWidth);
  const minHeight = Math.min(compact ? 260 : 340, maxHeight);

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

function sourceLabel(source: AskFlowerIntent['source']): string {
  if (source === 'file_browser') return 'Files';
  if (source === 'file_preview') return 'Preview';
  return 'Terminal';
}

// Build a compact chip label for a single context item.
function contextChipLabel(item: AskFlowerContextItem): string {
  if (item.kind === 'file_path') {
    const segments = item.path.split('/');
    const name = segments[segments.length - 1] || item.path;
    return item.isDirectory ? name : name;
  }
  if (item.kind === 'file_selection') {
    const segments = item.path.split('/');
    const name = segments[segments.length - 1] || item.path;
    return `${name} (${item.selectionChars} chars)`;
  }
  if (item.selectionChars > 0) {
    return `${item.selectionChars} chars selected`;
  }
  return item.workingDir || 'Working directory unavailable';
}

function contextChipIcon(item: AskFlowerContextItem): 'folder' | 'file' | 'terminal' {
  if (item.kind === 'file_path') return item.isDirectory ? 'folder' : 'file';
  if (item.kind === 'file_selection') return 'file';
  return 'terminal';
}

function isPointerInsideComposer(event: PointerEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node instanceof Element && node.classList.contains('ask-flower-composer-window')) {
      return true;
    }
  }
  const target = event.target;
  if (target instanceof Element) return !!target.closest('.ask-flower-composer-window');
  return false;
}

// Truncate a path to the last N segments for display.
function truncatePath(fullPath: string, maxSegments: number = 2): string {
  const segments = fullPath.split('/').filter(Boolean);
  if (segments.length <= maxSegments) return fullPath;
  return '.../' + segments.slice(-maxSegments).join('/');
}

export function AskFlowerComposerWindow(props: AskFlowerComposerWindowProps) {
  const [userPrompt, setUserPrompt] = createSignal('');
  const [validationError, setValidationError] = createSignal('');
  const [isComposing, setIsComposing] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [viewport, setViewport] = createSignal(currentViewportSize());
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  let textareaEl: HTMLTextAreaElement | undefined;

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

  const suggestedWorkingDir = createMemo(() => {
    const intent = props.intent;
    if (!intent) return '';
    return resolveSuggestedWorkingDirAbsolute({
      suggestedWorkingDirAbs: intent.suggestedWorkingDirAbs,
    });
  });

  const attachmentNames = createMemo(() => {
    const intent = props.intent;
    if (!intent) return [] as string[];
    return intent.pendingAttachments
      .map((file) => String(file?.name ?? '').trim())
      .filter((name) => !!name);
  });

  const cleanedNotes = createMemo(() => {
    const intent = props.intent;
    if (!intent) return [] as string[];
    return intent.notes
      .map((note) => String(note ?? '').trim())
      .filter((note) => !!note);
  });

  // Total count of context items + attachments for the toggle label.
  const contextCount = createMemo(() => {
    const intent = props.intent;
    if (!intent) return 0;
    return intent.contextItems.length + intent.pendingAttachments.length;
  });

  const resetDraft = (intent: AskFlowerIntent | null) => {
    setValidationError('');
    setIsComposing(false);
    setSending(false);
    setDetailsOpen(false);
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
    if (!props.open) return;
    resetDraft(props.intent);
  });

  createEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (sending()) return;
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
      setValidationError('Please enter a question.');
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

  return (
    <Show when={props.open && props.intent} keyed>
      {(intent) => (
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
            <div class="flex w-full items-center justify-between">
              <span class="text-[11px] text-muted-foreground select-none">
                {sending() ? 'Sending...' : '\u2318/Ctrl + \u23CE'}
              </span>
              <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={props.onClose} disabled={sending()}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={() => void submit()} disabled={sending()}>
                  <Send class="size-3.5" />
                  <span class="ml-1.5">Send</span>
                </Button>
              </div>
            </div>
          )}
        >
          <div class="h-full min-h-0 flex flex-col">
            {/* ── Textarea area ── */}
            <div class="flex-1 min-h-0 flex flex-col px-0.5">
              <textarea
                ref={textareaEl}
                id={`ask-flower-prompt-${intent.id}`}
                class="flex-1 min-h-[80px] w-full resize-none rounded-lg border-none bg-transparent px-2 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                value={userPrompt()}
                placeholder="Ask Flower anything..."
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
              />
              <Show when={validationError()}>
                <div class="px-2 pb-1 text-[11px] text-error">{validationError()}</div>
              </Show>
            </div>

            {/* ── Context chips & details ── */}
            <div class="shrink-0 border-t border-border/50 pt-2.5 pb-0.5 px-1">
              {/* Inline context chips */}
              <div class="flex flex-wrap items-center gap-1.5 px-1">
                <span class="text-[11px] font-medium text-muted-foreground/70 select-none mr-0.5">Context</span>

                <For each={intent.contextItems}>
                  {(item) => {
                    const icon = contextChipIcon(item);
                    return (
                      <span class="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground max-w-[180px]">
                        {icon === 'folder' && <Folder class="size-3 shrink-0 text-muted-foreground/60" />}
                        {icon === 'file' && <FileText class="size-3 shrink-0 text-muted-foreground/60" />}
                        {icon === 'terminal' && <Terminal class="size-3 shrink-0 text-muted-foreground/60" />}
                        <span class="truncate">{contextChipLabel(item)}</span>
                      </span>
                    );
                  }}
                </For>

                <Show when={attachmentNames().length > 0}>
                  <span class="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    <Paperclip class="size-3 shrink-0 text-muted-foreground/60" />
                    <span>{attachmentNames().length === 1 ? attachmentNames()[0] : `${attachmentNames().length} files`}</span>
                  </span>
                </Show>

                <Show when={suggestedWorkingDir()}>
                  <span class="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground max-w-[200px]">
                    <Folder class="size-3 shrink-0 text-muted-foreground/60" />
                    <span class="truncate">{truncatePath(suggestedWorkingDir())}</span>
                  </span>
                </Show>

                {/* Source badge */}
                <span class="inline-flex items-center rounded-md bg-primary/8 px-1.5 py-0.5 text-[11px] font-medium text-primary/70">
                  {sourceLabel(intent.source)}
                </span>

                {/* Toggle for details */}
                <Show when={contextCount() > 0 || cleanedNotes().length > 0}>
                  <button
                    type="button"
                    class="ml-auto inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/30 transition-colors"
                    onClick={() => setDetailsOpen((prev) => !prev)}
                  >
                    {detailsOpen() ? <ChevronUp class="size-3" /> : <ChevronDown class="size-3" />}
                  </button>
                </Show>
              </div>

              {/* Expandable detail panel */}
              <Show when={detailsOpen()}>
                <div class="mt-2 mx-1 max-h-[28vh] overflow-auto rounded-lg bg-muted/15 px-2.5 py-2 space-y-2">
                  <For each={intent.contextItems}>
                    {(item) => (
                      <div class="text-[11px] text-muted-foreground break-all leading-relaxed">
                        <Show when={item.kind === 'file_path' && item.kind === 'file_path'}>
                          <span class="text-foreground/70">
                            {(item as Extract<AskFlowerContextItem, { kind: 'file_path' }>).isDirectory ? 'Dir' : 'File'}:
                          </span>{' '}
                          {(item as Extract<AskFlowerContextItem, { kind: 'file_path' }>).path}
                        </Show>
                        <Show when={item.kind === 'file_selection'}>
                          <span class="text-foreground/70">Selection:</span>{' '}
                          {(item as Extract<AskFlowerContextItem, { kind: 'file_selection' }>).selectionChars} chars from{' '}
                          {(item as Extract<AskFlowerContextItem, { kind: 'file_selection' }>).path}
                        </Show>
                        <Show when={item.kind === 'terminal_selection'}>
                          <span class="text-foreground/70">Terminal:</span>{' '}
                          {(item as Extract<AskFlowerContextItem, { kind: 'terminal_selection' }>).selectionChars > 0
                            ? `${(item as Extract<AskFlowerContextItem, { kind: 'terminal_selection' }>).selectionChars} chars`
                            : (item as Extract<AskFlowerContextItem, { kind: 'terminal_selection' }>).workingDir || 'Working directory unavailable'}
                        </Show>
                      </div>
                    )}
                  </For>

                  <Show when={suggestedWorkingDir()}>
                    <div class="text-[11px] text-muted-foreground break-all">
                      <span class="text-foreground/70">Working dir:</span>{' '}
                      <span class="font-mono">{suggestedWorkingDir()}</span>
                    </div>
                  </Show>

                  <Show when={attachmentNames().length > 0}>
                    <div class="text-[11px] text-muted-foreground">
                      <span class="text-foreground/70">Attachments:</span>{' '}
                      {attachmentNames().join(', ')}
                    </div>
                  </Show>

                  <For each={cleanedNotes()}>
                    {(note) => (
                      <div class="text-[11px] text-muted-foreground/80 italic break-words">{note}</div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </PersistentFloatingWindow>
      )}
    </Show>
  );
}
