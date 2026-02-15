import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Button, FloatingWindow } from '@floegence/floe-webapp-core/ui';
import type { AskFlowerComposerAnchor } from '../pages/EnvContext';
import type { AskFlowerContextItem, AskFlowerIntent } from '../pages/askFlowerIntent';

const WINDOW_DEFAULT_SIZE = { width: 620, height: 420 };
const WINDOW_MIN_SIZE = { width: 420, height: 320 };
const WINDOW_MAX_SIZE = { width: 920, height: 720 };
const WINDOW_VIEWPORT_MARGIN = 12;
const WINDOW_ANCHOR_OFFSET = 8;

type AskFlowerComposerWindowProps = {
  open: boolean;
  intent: AskFlowerIntent | null;
  anchor?: AskFlowerComposerAnchor | null;
  onClose: () => void;
  onSubmit: (userPrompt: string) => void;
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function toWindowPosition(anchor: AskFlowerComposerAnchor | null | undefined): { x: number; y: number } | undefined {
  if (!anchor) return undefined;
  if (typeof window === 'undefined') return undefined;

  const availableWidth = Math.max(0, window.innerWidth - WINDOW_VIEWPORT_MARGIN * 2);
  const availableHeight = Math.max(0, window.innerHeight - WINDOW_VIEWPORT_MARGIN * 2);
  const windowWidth = Math.min(WINDOW_DEFAULT_SIZE.width, availableWidth || WINDOW_DEFAULT_SIZE.width);
  const windowHeight = Math.min(WINDOW_DEFAULT_SIZE.height, availableHeight || WINDOW_DEFAULT_SIZE.height);
  const maxX = Math.max(WINDOW_VIEWPORT_MARGIN, window.innerWidth - windowWidth - WINDOW_VIEWPORT_MARGIN);
  const maxY = Math.max(WINDOW_VIEWPORT_MARGIN, window.innerHeight - windowHeight - WINDOW_VIEWPORT_MARGIN);

  return {
    x: clamp(anchor.x + WINDOW_ANCHOR_OFFSET, WINDOW_VIEWPORT_MARGIN, maxX),
    y: clamp(anchor.y + WINDOW_ANCHOR_OFFSET, WINDOW_VIEWPORT_MARGIN, maxY),
  };
}

function sourceLabel(source: AskFlowerIntent['source']): string {
  if (source === 'file_browser') return 'file browser';
  if (source === 'file_preview') return 'file preview';
  return 'terminal';
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

export function AskFlowerComposerWindow(props: AskFlowerComposerWindowProps) {
  const [userPrompt, setUserPrompt] = createSignal('');
  const [validationError, setValidationError] = createSignal('');
  let textareaEl: HTMLTextAreaElement | undefined;

  const position = createMemo(() => toWindowPosition(props.anchor ?? null));

  const contextLines = createMemo(() => {
    const intent = props.intent;
    if (!intent) return [] as string[];

    const lines: string[] = [`Source: ${sourceLabel(intent.source)}`];
    if (intent.contextItems.length > 0) {
      lines.push(...intent.contextItems.map((item) => contextLine(item)));
    }

    const suggestedWorkingDir = String(intent.suggestedWorkingDir ?? '').trim();
    if (suggestedWorkingDir) {
      lines.push(`Suggested working directory: ${suggestedWorkingDir}`);
    }

    const attachments = attachmentLine(intent.pendingAttachments);
    if (attachments) {
      lines.push(attachments);
    }

    return lines;
  });

  const resetDraft = (intent: AskFlowerIntent | null) => {
    setValidationError('');
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
      const target = event.target as Node | null;
      if (!target) {
        props.onClose();
        return;
      }
      const windowEl = document.querySelector<HTMLElement>('.ask-flower-composer-window');
      if (windowEl?.contains(target)) return;
      props.onClose();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    });
  });

  const submit = () => {
    const trimmedPrompt = String(userPrompt()).trim();
    if (!trimmedPrompt) {
      setValidationError('Please enter your question before continuing.');
      requestAnimationFrame(() => textareaEl?.focus());
      return;
    }
    props.onSubmit(trimmedPrompt);
  };

  return (
    <Show when={props.open && props.intent} keyed>
      {(intent) => (
        <FloatingWindow
          open
          onOpenChange={(next) => {
            if (!next) props.onClose();
          }}
          title="Ask Flower"
          defaultPosition={position()}
          defaultSize={WINDOW_DEFAULT_SIZE}
          minSize={WINDOW_MIN_SIZE}
          maxSize={WINDOW_MAX_SIZE}
          class="ask-flower-composer-window"
          zIndex={130}
          footer={(
            <>
              <Button variant="ghost" onClick={props.onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={submit}>
                Continue to Flower
              </Button>
            </>
          )}
        >
          <div class="h-full min-h-0 flex flex-col gap-3">
            <div class="space-y-1">
              <div class="text-xs font-medium text-foreground">Context</div>
              <div class="max-h-32 overflow-auto rounded-md border border-border bg-muted/20 px-3 py-2">
                <ul class="space-y-1">
                  <For each={contextLines()}>
                    {(line) => <li class="text-xs text-muted-foreground break-all">{line}</li>}
                  </For>
                </ul>
              </div>
            </div>

            <div class="min-h-0 flex-1 flex flex-col gap-1">
              <label class="text-xs font-medium text-foreground" for={`ask-flower-user-prompt-${intent.id}`}>
                Your question
              </label>
              <textarea
                ref={textareaEl}
                id={`ask-flower-user-prompt-${intent.id}`}
                class="w-full min-h-[160px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={userPrompt()}
                placeholder="Describe what you want Flower to do..."
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
                    submit();
                  }
                }}
              />
              <Show when={validationError()}>
                <div class="text-[11px] text-error">{validationError()}</div>
              </Show>
            </div>

            <div class="text-[11px] text-muted-foreground">Tip: Press Cmd/Ctrl + Enter to continue.</div>
          </div>
        </FloatingWindow>
      )}
    </Show>
  );
}
