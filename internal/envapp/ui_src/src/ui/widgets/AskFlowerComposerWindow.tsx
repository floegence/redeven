import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Button, FloatingWindow } from '@floegence/floe-webapp-core/ui';
import type { AskFlowerComposerAnchor } from '../pages/EnvContext';
import type { AskFlowerContextItem, AskFlowerIntent } from '../pages/askFlowerIntent';
import { resolveSuggestedWorkingDirAbsolute } from '../utils/askFlowerPath';

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
  defaultSize: {
    width: number;
    height: number;
  };
  minSize: {
    width: number;
    height: number;
  };
  maxSize: {
    width: number;
    height: number;
  };
};

function currentViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 1440, height: 900 };
  }
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function resolveWindowSizing(viewport: { width: number; height: number }): WindowSizing {
  const compact = viewport.width < 900;
  const margin = viewport.width < 640 ? WINDOW_VIEWPORT_MARGIN_MOBILE : WINDOW_VIEWPORT_MARGIN_DESKTOP;
  const maxWidth = Math.max(280, viewport.width - margin * 2);
  const maxHeight = Math.max(280, viewport.height - margin * 2);
  const defaultWidth = compact ? Math.min(720, maxWidth) : Math.min(920, maxWidth);
  const defaultHeight = compact ? Math.min(660, maxHeight) : Math.min(730, maxHeight);
  const minWidth = Math.min(compact ? 280 : 560, maxWidth);
  const minHeight = Math.min(compact ? 280 : 420, maxHeight);

  return {
    compact,
    margin,
    defaultSize: {
      width: defaultWidth,
      height: defaultHeight,
    },
    minSize: {
      width: minWidth,
      height: minHeight,
    },
    maxSize: {
      width: maxWidth,
      height: maxHeight,
    },
  };
}

function toWindowPosition(anchor: AskFlowerComposerAnchor | null | undefined, sizing: WindowSizing): { x: number; y: number } | undefined {
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
  if (source === 'file_browser') return 'File Browser';
  if (source === 'file_preview') return 'File Preview';
  return 'Terminal';
}

function contextLine(item: AskFlowerContextItem): string {
  if (item.kind === 'file_path') {
    if (item.isDirectory) return `Directory: ${item.path}`;
    return `File: ${item.path}`;
  }
  if (item.kind === 'file_selection') {
    return `Selected ${Math.max(0, item.selectionChars)} chars from ${item.path}`;
  }

  const workingDir = String(item.workingDir ?? '').trim() || '/';
  if (Math.max(0, item.selectionChars) > 0) {
    return `Selected ${Math.max(0, item.selectionChars)} terminal chars (working directory: ${workingDir})`;
  }
  return `Terminal working directory: ${workingDir}`;
}

function attachmentLine(files: File[]): string | null {
  if (files.length <= 0) return null;
  if (files.length === 1) return `Queued attachment: ${files[0]?.name ?? '1 file'}`;
  return `Queued attachments: ${files.length} files`;
}

function summarizeContextItems(items: AskFlowerContextItem[]): { filePaths: number; fileSelections: number; terminalSelections: number } {
  let filePaths = 0;
  let fileSelections = 0;
  let terminalSelections = 0;
  for (const item of items) {
    if (item.kind === 'file_path') {
      filePaths += 1;
      continue;
    }
    if (item.kind === 'file_selection') {
      fileSelections += 1;
      continue;
    }
    terminalSelections += 1;
  }
  return { filePaths, fileSelections, terminalSelections };
}

function isPointerInsideComposer(event: PointerEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node instanceof Element && node.classList.contains('ask-flower-composer-window')) {
      return true;
    }
  }

  const target = event.target;
  if (target instanceof Element) {
    return !!target.closest('.ask-flower-composer-window');
  }

  return false;
}

export function AskFlowerComposerWindow(props: AskFlowerComposerWindowProps) {
  const [userPrompt, setUserPrompt] = createSignal('');
  const [validationError, setValidationError] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [viewport, setViewport] = createSignal(currentViewportSize());
  let textareaEl: HTMLTextAreaElement | undefined;

  onMount(() => {
    const syncViewport = () => {
      setViewport(currentViewportSize());
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);

    onCleanup(() => {
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    });
  });

  const windowSizing = createMemo(() => resolveWindowSizing(viewport()));
  const compactMode = createMemo(() => windowSizing().compact);
  const position = createMemo(() => toWindowPosition(props.anchor ?? null, windowSizing()));

  const contextLines = createMemo(() => {
    const intent = props.intent;
    if (!intent) return [] as string[];

    const lines: string[] = [`Source: ${sourceLabel(intent.source)}`];
    if (intent.contextItems.length > 0) {
      lines.push(...intent.contextItems.map((item) => contextLine(item)));
    }

    const suggestedWorkingDir = resolveSuggestedWorkingDirAbsolute({
      suggestedWorkingDirAbs: intent.suggestedWorkingDirAbs,
      suggestedWorkingDirVirtual: intent.suggestedWorkingDirVirtual,
      fsRootAbs: intent.fsRootAbs,
    });
    if (suggestedWorkingDir) {
      lines.push(`Suggested working directory: ${suggestedWorkingDir}`);
    }

    const attachments = attachmentLine(intent.pendingAttachments);
    if (attachments) {
      lines.push(attachments);
    }

    return lines;
  });

  const contextSummary = createMemo(() => {
    const intent = props.intent;
    if (!intent) {
      return { filePaths: 0, fileSelections: 0, terminalSelections: 0 };
    }
    return summarizeContextItems(intent.contextItems);
  });

  const suggestedWorkingDir = createMemo(() => {
    const intent = props.intent;
    if (!intent) return '';
    return resolveSuggestedWorkingDirAbsolute({
      suggestedWorkingDirAbs: intent.suggestedWorkingDirAbs,
      suggestedWorkingDirVirtual: intent.suggestedWorkingDirVirtual,
      fsRootAbs: intent.fsRootAbs,
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

  const promptCharCount = createMemo(() => String(userPrompt() ?? '').trim().length);

  const resetDraft = (intent: AskFlowerIntent | null) => {
    setValidationError('');
    setSending(false);
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
    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    });
  });

  const submit = async () => {
    if (sending()) return;
    const trimmedPrompt = String(userPrompt()).trim();
    if (!trimmedPrompt) {
      setValidationError('Please enter your question before sending.');
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
        <FloatingWindow
          open
          onOpenChange={(next) => {
            if (sending()) return;
            if (!next) props.onClose();
          }}
          title="Ask Flower"
          defaultPosition={position()}
          defaultSize={windowSizing().defaultSize}
          minSize={windowSizing().minSize}
          maxSize={windowSizing().maxSize}
          class="ask-flower-composer-window"
          zIndex={130}
          footer={(
            <>
              <Button variant="ghost" onClick={props.onClose} disabled={sending()}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void submit()} disabled={sending()}>
                {sending() ? 'Sending...' : 'Send'}
              </Button>
            </>
          )}
        >
          <div class="h-full min-h-0 flex flex-col gap-3 sm:gap-4">
            <div class="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/12 via-primary/[0.06] to-background px-3 py-3 sm:px-4 sm:py-4 shadow-sm">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <div class="text-sm font-semibold text-foreground">Ask exactly what you need</div>
                  <div class="text-xs text-muted-foreground">
                    Flower will include your selected context automatically.
                  </div>
                </div>
                <div class="inline-flex w-fit items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
                  {sourceLabel(intent.source)}
                </div>
              </div>

              <div class="mt-3 rounded-xl border border-border/70 bg-background/90 p-3 sm:p-4 shadow-inner">
                <label class="text-xs font-medium text-foreground" for={`ask-flower-user-prompt-${intent.id}`}>
                  Your question
                </label>
                <textarea
                  ref={textareaEl}
                  id={`ask-flower-user-prompt-${intent.id}`}
                  class="mt-2 w-full min-h-[150px] sm:min-h-[190px] max-h-[42vh] resize-y rounded-xl border border-border/80 bg-background px-3.5 py-3 text-sm leading-6 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={userPrompt()}
                  placeholder="What do you want Flower to help you with?"
                  disabled={sending()}
                  onInput={(event) => {
                    setUserPrompt(event.currentTarget.value);
                    if (validationError()) {
                      setValidationError('');
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.isComposing) return;
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                />
                <div class="mt-2 flex items-center gap-2 text-[11px]">
                  <Show when={validationError()}>
                    <span class="text-error">{validationError()}</span>
                  </Show>
                  <span class="ml-auto text-muted-foreground">{promptCharCount()} chars</span>
                </div>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-auto pr-0.5">
              <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div class="rounded-xl border border-border/70 bg-card/70 p-3 sm:p-3.5">
                  <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Context overview</div>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <div class="rounded-full border border-border bg-muted/35 px-2.5 py-1 text-[11px] text-muted-foreground">
                      File paths: {contextSummary().filePaths}
                    </div>
                    <div class="rounded-full border border-border bg-muted/35 px-2.5 py-1 text-[11px] text-muted-foreground">
                      File selections: {contextSummary().fileSelections}
                    </div>
                    <div class="rounded-full border border-border bg-muted/35 px-2.5 py-1 text-[11px] text-muted-foreground">
                      Terminal context: {contextSummary().terminalSelections}
                    </div>
                  </div>

                  <div class="mt-3 max-h-[26vh] sm:max-h-[30vh] overflow-auto rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    <Show
                      when={contextLines().length > 0}
                      fallback={<div class="text-xs text-muted-foreground">No context lines available.</div>}
                    >
                      <ul class="space-y-2">
                        <For each={contextLines()}>
                          {(line) => (
                            <li class="rounded-md border border-border/50 bg-background/80 px-2.5 py-2 text-xs text-foreground/90 break-all">
                              {line}
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </div>
                </div>

                <div class="rounded-xl border border-border/70 bg-card/70 p-3 sm:p-3.5 flex flex-col gap-3">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Working directory</div>
                    <div class="mt-1 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 text-xs font-mono text-foreground break-all">
                      {suggestedWorkingDir() || 'Use environment default working directory'}
                    </div>
                  </div>

                  <div>
                    <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachments</div>
                    <div class="mt-1 rounded-lg border border-border/60 bg-muted/20 p-2.5 max-h-[18vh] sm:max-h-[20vh] overflow-auto">
                      <Show
                        when={attachmentNames().length > 0}
                        fallback={<div class="text-xs text-muted-foreground">No attachments queued.</div>}
                      >
                        <ul class="space-y-1">
                          <For each={attachmentNames()}>
                            {(name) => <li class="text-xs text-foreground break-all">{name}</li>}
                          </For>
                        </ul>
                      </Show>
                    </div>
                  </div>

                  <div class="min-h-0 flex-1">
                    <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</div>
                    <div class="mt-1 min-h-0 max-h-[20vh] sm:max-h-[24vh] rounded-lg border border-border/60 bg-muted/20 p-2.5 overflow-auto">
                      <Show
                        when={cleanedNotes().length > 0}
                        fallback={<div class="text-xs text-muted-foreground">No extra notes.</div>}
                      >
                        <ul class="space-y-1">
                          <For each={cleanedNotes()}>
                            {(note) => <li class="text-xs text-muted-foreground break-words">{note}</li>}
                          </For>
                        </ul>
                      </Show>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span>Tip: Press Cmd/Ctrl + Enter to send.</span>
              <span>{sending() ? 'Flower is preparing your request...' : compactMode() ? 'Review and send.' : 'Review the context and send when ready.'}</span>
            </div>
          </div>
        </FloatingWindow>
      )}
    </Show>
  );
}
