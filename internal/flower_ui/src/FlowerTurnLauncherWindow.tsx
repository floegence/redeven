import type { Component } from 'solid-js';
import { For, Show, createContext, createEffect, createMemo, createSignal, onCleanup, onMount, untrack, useContext } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Activity, AlertTriangle, ArrowUp, FileText, Folder, Paperclip, Terminal } from '@floegence/floe-webapp-core/icons';
import { Button, FloatingWindow } from '@floegence/floe-webapp-core/ui';

import type {
  FlowerTurnLauncherIntent,
} from './contracts/flowerSurfaceContracts';
import { FlowerIcon } from './icons/FlowerIcon';
import {
  DEFAULT_FLOWER_TURN_LAUNCHER_WINDOW_COPY,
  buildFlowerTurnLauncherCopy,
  truncateFlowerTurnLauncherPath,
  type FlowerTurnLauncherContextAction,
  type FlowerTurnLauncherContextChip,
  type FlowerTurnLauncherWindowCopyInput,
  type FlowerTurnLauncherWindowChromeCopy,
} from './flowerTurnLauncherCopy';

const WINDOW_VIEWPORT_MARGIN_DESKTOP = 12;
const WINDOW_VIEWPORT_MARGIN_MOBILE = 8;
const WINDOW_ANCHOR_OFFSET = 8;
const WINDOW_DEFAULT_WIDTH_DESKTOP = 560;
const WINDOW_DEFAULT_HEIGHT_DESKTOP = 592;
const WINDOW_DEFAULT_WIDTH_COMPACT = 420;
const WINDOW_DEFAULT_HEIGHT_COMPACT = 512;
const WINDOW_MIN_WIDTH_DESKTOP = 400;
const WINDOW_MIN_HEIGHT_DESKTOP = 452;
const WINDOW_MIN_WIDTH_COMPACT = 300;
const WINDOW_MIN_HEIGHT_COMPACT = 372;

export type FlowerTurnLauncherAnchor = Readonly<{
  x: number;
  y: number;
}>;

export type FlowerTurnLauncherSubmitInput = Readonly<{
  prompt: string;
  intent: FlowerTurnLauncherIntent;
}>;

export type FlowerTurnLauncherPanelProps = Readonly<{
  open: boolean;
  intent: FlowerTurnLauncherIntent | null;
  copy?: FlowerTurnLauncherWindowCopyInput;
  contentClass?: string;
  footerClass?: string;
  localScrollProps?: Record<string, unknown>;
  autoFocus?: boolean;
  draft?: string;
  onDraftChange?: (draft: string) => void;
  onClose: () => void;
  onSubmit: (input: FlowerTurnLauncherSubmitInput) => Promise<void>;
  onContextAction?: (action: FlowerTurnLauncherContextAction, entry: FlowerTurnLauncherContextChip) => void | Promise<void>;
}>;

export type FlowerTurnLauncherWindowProps = FlowerTurnLauncherPanelProps & Readonly<{
  anchor?: FlowerTurnLauncherAnchor | null;
  zIndex?: number;
  windowClass?: string;
}>;

type ViewportSize = Readonly<{
  width: number;
  height: number;
}>;

type WindowSizing = Readonly<{
  compact: boolean;
  margin: number;
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maxSize: { width: number; height: number };
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function currentViewportSize(): ViewportSize {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function resolveWindowSizing(viewport: ViewportSize): WindowSizing {
  const compactViewport = viewport.width < 640;
  const margin = compactViewport ? WINDOW_VIEWPORT_MARGIN_MOBILE : WINDOW_VIEWPORT_MARGIN_DESKTOP;
  const maxWidth = Math.max(280, viewport.width - margin * 2);
  const maxHeight = Math.max(280, viewport.height - margin * 2);
  const defaultWidth = compactViewport
    ? Math.min(WINDOW_DEFAULT_WIDTH_COMPACT, maxWidth)
    : Math.min(WINDOW_DEFAULT_WIDTH_DESKTOP, maxWidth);
  const defaultHeight = compactViewport
    ? Math.min(WINDOW_DEFAULT_HEIGHT_COMPACT, maxHeight)
    : Math.min(WINDOW_DEFAULT_HEIGHT_DESKTOP, maxHeight);
  const minWidth = Math.min(compactViewport ? WINDOW_MIN_WIDTH_COMPACT : WINDOW_MIN_WIDTH_DESKTOP, maxWidth);
  const minHeight = Math.min(compactViewport ? WINDOW_MIN_HEIGHT_COMPACT : WINDOW_MIN_HEIGHT_DESKTOP, maxHeight);

  return {
    compact: compactViewport,
    margin,
    defaultSize: { width: defaultWidth, height: defaultHeight },
    minSize: { width: minWidth, height: minHeight },
    maxSize: { width: maxWidth, height: maxHeight },
  };
}

function toWindowPosition(
  anchor: FlowerTurnLauncherAnchor | null | undefined,
  sizing: WindowSizing,
): { x: number; y: number } | undefined {
  if (!anchor || typeof window === 'undefined') return undefined;

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

function isPointerInsideLauncher(event: PointerEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (node.classList.contains('flower-turn-launcher-window')) return true;
    if (node.classList.contains('flower-turn-launcher-related-surface')) return true;
  }

  const target = event.target;
  if (!(target instanceof Element)) return false;
  return !!target.closest('.flower-turn-launcher-window, .flower-turn-launcher-related-surface');
}

function shouldSubmitOnEnterKeydown(event: KeyboardEvent, composing: boolean): boolean {
  if (event.isComposing || composing) return false;
  return event.key === 'Enter' && !event.shiftKey;
}

function copyValue(
  copy: FlowerTurnLauncherWindowCopyInput | undefined,
  key: keyof FlowerTurnLauncherWindowChromeCopy,
): string {
  return compact(copy?.[key]) || DEFAULT_FLOWER_TURN_LAUNCHER_WINDOW_COPY[key];
}

function entryIcon(entry: FlowerTurnLauncherContextChip) {
  if (entry.tone === 'environment') return <Activity class="size-3.5 shrink-0" />;
  if (entry.tone === 'directory') return <Folder class="size-3.5 shrink-0" />;
  if (entry.tone === 'attachment') return <Paperclip class="size-3.5 shrink-0" />;
  if (entry.tone === 'process') return <Activity class="size-3.5 shrink-0" />;
  if (entry.tone === 'terminal') return <Terminal class="size-3.5 shrink-0" />;
  return <FileText class="size-3.5 shrink-0" />;
}

function actionIcon(action: FlowerTurnLauncherContextAction) {
  if (action.type === 'open_attachment_snapshot_preview') return <Paperclip class="size-3.5" />;
  if (action.type === 'open_directory_browser') return <Folder class="size-3.5" />;
  if (action.type === 'open_process_snapshot_preview') return <Activity class="size-3.5" />;
  return <FileText class="size-3.5" />;
}

function entryButtonClass(entry: FlowerTurnLauncherContextChip): string {
  if (entry.tone === 'environment') {
    return 'border-[color-mix(in_srgb,var(--redeven-categorical-7)_24%,var(--border))] bg-[color-mix(in_srgb,var(--redeven-categorical-7)_10%,transparent)] text-[var(--redeven-categorical-7)] hover:border-[var(--redeven-categorical-7)] hover:bg-[color-mix(in_srgb,var(--redeven-categorical-7)_16%,transparent)]';
  }
  if (entry.tone === 'process') {
    return 'border-[color-mix(in_srgb,var(--redeven-categorical-8)_24%,var(--border))] bg-[color-mix(in_srgb,var(--redeven-categorical-8)_10%,transparent)] text-[var(--redeven-categorical-8)] hover:border-[var(--redeven-categorical-8)] hover:bg-[color-mix(in_srgb,var(--redeven-categorical-8)_16%,transparent)]';
  }
  if (entry.tone === 'selection' || entry.tone === 'terminal') {
    return 'border-[var(--redeven-status-success-border)] bg-[var(--redeven-status-success-soft)] text-[var(--redeven-status-success-foreground)] hover:border-[var(--redeven-status-success)] hover:bg-[color-mix(in_srgb,var(--redeven-status-success)_16%,transparent)]';
  }
  if (entry.tone === 'snapshot') {
    return 'border-[color-mix(in_srgb,var(--redeven-categorical-6)_24%,var(--border))] bg-[color-mix(in_srgb,var(--redeven-categorical-6)_10%,transparent)] text-[var(--redeven-categorical-6)] hover:border-[var(--redeven-categorical-6)] hover:bg-[color-mix(in_srgb,var(--redeven-categorical-6)_16%,transparent)]';
  }
  if (entry.tone === 'attachment') {
    return 'border-[var(--redeven-status-info-border)] bg-[var(--redeven-status-info-soft)] text-[var(--redeven-status-info-foreground)] hover:border-[var(--redeven-status-info)] hover:bg-[color-mix(in_srgb,var(--redeven-status-info)_16%,transparent)]';
  }
  if (entry.tone === 'directory') {
    return 'border-[var(--redeven-status-warning-border)] bg-[var(--redeven-status-warning-soft)] text-[var(--redeven-status-warning-foreground)] hover:border-[var(--redeven-status-warning)] hover:bg-[color-mix(in_srgb,var(--redeven-status-warning)_16%,transparent)]';
  }
  return 'border-primary/20 bg-primary/10 text-primary hover:border-primary/35 hover:bg-primary/16';
}

function secondaryActionLabel(action: FlowerTurnLauncherContextAction): string {
  if (action.type === 'open_attachment_snapshot_preview') return action.label;
  if (action.type === 'open_live_file_preview') return action.label;
  if (action.type === 'open_directory_browser') return action.label;
  return action.title;
}

const FlowerLauncherAvatar: Component = () => (
  <div data-testid="flower-turn-launcher-avatar" class="flower-turn-launcher-avatar relative flex size-8 shrink-0 items-center justify-center">
    <div class="absolute inset-0 rounded-full bg-primary/8 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--background)_55%,transparent)]" />
    <div class="relative flex size-8 items-center justify-center rounded-full border border-primary/18 bg-gradient-to-br from-primary/15 to-[var(--redeven-status-warning-soft)] shadow-[0_10px_20px_-16px_color-mix(in_srgb,var(--primary)_42%,transparent)]">
      <FlowerIcon class="h-5 w-5 text-primary" />
    </div>
  </div>
);

function createFlowerTurnLauncherPanelController(
  props: FlowerTurnLauncherPanelProps,
  footerPlacement: 'panel' | 'window' = 'panel',
) {
  const [internalUserPrompt, setInternalUserPrompt] = createSignal('');
  const [validationError, setValidationError] = createSignal('');
  const [launchError, setLaunchError] = createSignal('');
  const [isComposing, setIsComposing] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  let textareaEl: HTMLTextAreaElement | undefined;

  const projected = createMemo(() => (props.intent ? buildFlowerTurnLauncherCopy(props.intent, props.copy) : null));
  const userPrompt = () => props.draft ?? internalUserPrompt();
  const setUserPrompt = (value: string) => {
    setInternalUserPrompt(value);
    props.onDraftChange?.(value);
  };
  const canSubmit = createMemo(() => !sending() && compact(userPrompt()).length > 0);
  const suggestedWorkingDir = createMemo(() => compact(props.intent?.suggested_working_dir));

  const resetLauncherState = (intent: FlowerTurnLauncherIntent | null) => {
    setValidationError('');
    setLaunchError('');
    setIsComposing(false);
    setSending(false);
    setInternalUserPrompt(untrack(() => props.draft) ?? compact(intent?.initial_prompt));
    if (props.autoFocus === false) return;
    requestAnimationFrame(() => {
      textareaEl?.focus();
      const el = textareaEl;
      if (!el) return;
      const pos = el.value.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        // Selection can fail on detached test nodes.
      }
    });
  };

  createEffect(() => {
    if (!props.open) return;
    resetLauncherState(props.intent);
  });

  const submit = async () => {
    if (sending()) return;
    const intent = props.intent;
    const prompt = compact(textareaEl?.value ?? userPrompt());
    if (!intent) return;
    if (!prompt) {
      setValidationError(copyValue(props.copy, 'empty_message'));
      requestAnimationFrame(() => textareaEl?.focus());
      return;
    }

    setSending(true);
    setValidationError('');
    setLaunchError('');
    try {
      await props.onSubmit({ prompt, intent });
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error));
      requestAnimationFrame(() => textareaEl?.focus());
    } finally {
      setSending(false);
    }
  };

  const runContextAction = (action: FlowerTurnLauncherContextAction | null, entry: FlowerTurnLauncherContextChip) => {
    if (!action || sending()) return;
    void props.onContextAction?.(action, entry);
  };

  return {
    footerPlacement,
    userPrompt,
    setUserPrompt,
    validationError,
    setValidationError,
    launchError,
    setLaunchError,
    isComposing,
    setIsComposing,
    sending,
    projected,
    canSubmit,
    suggestedWorkingDir,
    setTextareaEl: (element: HTMLTextAreaElement) => {
      textareaEl = element;
    },
    textareaValue: () => textareaEl?.value ?? userPrompt(),
    submit,
    runContextAction,
  };
}

type FlowerTurnLauncherPanelController = ReturnType<typeof createFlowerTurnLauncherPanelController>;
const FlowerTurnLauncherPanelControllerContext = createContext<FlowerTurnLauncherPanelController>();

type FlowerTurnLauncherFooterProps = Readonly<{
  copy?: FlowerTurnLauncherWindowCopyInput;
  footerClass?: string;
  controller: FlowerTurnLauncherPanelController;
  onClose: () => void;
}>;

function FlowerTurnLauncherFooter(props: FlowerTurnLauncherFooterProps) {
  return (
    <div class={cn('flower-turn-launcher-footer flex w-full min-w-0 items-center gap-1.5 overflow-hidden', props.footerClass)}>
      <div class="flex min-w-0 flex-1 items-center text-[10px] text-muted-foreground sm:text-[11px]">
        <span class="inline-flex min-w-0 flex-1 items-center gap-1 rounded-full border border-border/60 bg-muted/28 px-2 py-0.5">
          <Folder class="size-3 shrink-0" />
          <span class="shrink-0 font-medium text-foreground/80">{copyValue(props.copy, 'working_dir_label')}</span>
          <span
            class="min-w-0 truncate font-mono text-[10px] sm:text-[11px]"
            title={props.controller.suggestedWorkingDir() || copyValue(props.copy, 'working_directory_unavailable')}
          >
            {props.controller.suggestedWorkingDir()
              ? truncateFlowerTurnLauncherPath(props.controller.suggestedWorkingDir())
              : copyValue(props.copy, 'working_directory_unavailable')}
          </span>
        </span>
      </div>
      <span class="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
        {props.controller.sending() ? copyValue(props.copy, 'sending') : copyValue(props.copy, 'ready')}
      </span>
      <Button
        variant="ghost"
        size="sm"
        class={`h-7 shrink-0 rounded-md px-2.5 text-[11px] font-medium sm:h-8 ${props.controller.sending() ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        onClick={props.onClose}
        disabled={props.controller.sending()}
      >
        {copyValue(props.copy, 'close')}
      </Button>
    </div>
  );
}

export function FlowerTurnLauncherPanel(props: FlowerTurnLauncherPanelProps) {
  const controller = useContext(FlowerTurnLauncherPanelControllerContext)
    ?? createFlowerTurnLauncherPanelController(props);
  const {
    userPrompt,
    setUserPrompt,
    validationError,
    setValidationError,
    launchError,
    setLaunchError,
    isComposing,
    setIsComposing,
    sending,
    projected,
    canSubmit,
    setTextareaEl,
    textareaValue,
    submit,
    runContextAction,
  } = controller;

  return (
    <Show when={props.open ? props.intent : null} keyed>
      {(intent) => (
        <div class={cn('flower-turn-launcher-surface flex h-full min-h-0 flex-col overflow-hidden bg-background', props.contentClass)}>
            <div
              {...(props.localScrollProps ?? {})}
              data-testid="flower-turn-launcher-scroll-region"
              class="flower-turn-launcher-scroll-region flex-1 min-h-0 overflow-y-auto px-2 py-2 sm:px-2.5 sm:py-2.5"
            >
              <div class="mx-auto flex w-full max-w-[40rem] flex-col gap-2">
                <div class="flower-turn-launcher-message-row chat-message-item items-start">
                  <FlowerLauncherAvatar />
                  <div class="chat-message-content-wrapper max-w-[min(100%,37rem)] gap-1">
                    <div class="flower-turn-launcher-message-surface min-w-0 rounded-[1.05rem] rounded-tl-md px-2.5 py-2 shadow-[0_14px_28px_-28px_color-mix(in_srgb,var(--foreground)_34%,transparent)] backdrop-blur sm:px-3 sm:py-2.5">
                      <div class="text-sm leading-5 text-foreground/95">{projected()?.question}</div>

                      <Show when={(projected()?.context_entries.length ?? 0) > 0}>
                        <div class="mt-2 border-t border-border/50 pt-2">
                          <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
                            {copyValue(props.copy, 'linked_context_label')}
                          </div>
                          <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
                            <For each={projected()?.context_entries ?? []}>
                              {(entry) => (
                                <div class="flex min-w-0 items-stretch">
                                  <button
                                    type="button"
                                    class={`flex min-w-0 flex-1 items-start gap-2 border px-2 py-1.5 text-left text-[11px] font-medium transition-colors ${
                                      entry.secondary_actions.length > 0 ? 'rounded-l-[0.95rem] rounded-r-none' : 'rounded-[0.95rem]'
                                    } ${
                                      entry.primary_action
                                        ? (sending() ? 'cursor-not-allowed' : 'cursor-pointer')
                                        : 'cursor-default'
                                    } ${entryButtonClass(entry)}`}
                                    title={entry.title}
                                    disabled={!entry.primary_action || sending()}
                                    onClick={() => runContextAction(entry.primary_action, entry)}
                                  >
                                    <span class="mt-0.5 shrink-0">{entryIcon(entry)}</span>
                                    <span class="min-w-0 flex-1">
                                      <span class="block truncate leading-4">{entry.label}</span>
                                      <span class="mt-0.5 block truncate font-mono text-[11px] leading-4 opacity-75">{entry.detail}</span>
                                    </span>
                                  </button>
                                  <For each={entry.secondary_actions}>
                                    {(action, index) => {
                                      const label = secondaryActionLabel(action);
                                      return (
                                        <button
                                          type="button"
                                          class={`-ml-px flex w-9 shrink-0 items-center justify-center border px-0 py-1.5 transition-colors ${
                                            index() === entry.secondary_actions.length - 1 ? 'rounded-l-none rounded-r-[0.95rem]' : 'rounded-none'
                                          } ${sending() ? 'cursor-not-allowed' : 'cursor-pointer'} ${entryButtonClass(entry)}`}
                                          aria-label={label}
                                          title={label}
                                          disabled={sending()}
                                          onClick={() => runContextAction(action, entry)}
                                        >
                                          {actionIcon(action)}
                                        </button>
                                      );
                                    }}
                                  </For>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>

                      <Show when={(intent.notes?.length ?? 0) > 0}>
                        <div class="mt-1.5 space-y-1">
                          <For each={(intent.notes ?? []).map(compact).filter(Boolean)}>
                            {(note) => (
                              <div class="rounded-[0.95rem] border border-[var(--redeven-status-info-border)] bg-[var(--redeven-status-info-soft)] px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground">
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

            <div data-testid="flower-turn-launcher-dock" class="flower-turn-launcher-dock shrink-0 border-t border-border/65 bg-background/96 shadow-[0_-14px_30px_-30px_color-mix(in_srgb,var(--foreground)_32%,transparent)] backdrop-blur">
              <div class="mx-auto w-full max-w-[40rem]">
                <div class="flower-turn-launcher-input flower-chat-input">
                  <div class="chat-input-body flower-chat-input-body flower-turn-launcher-input-body">
                    <div class="flower-chat-input-primary-row flower-turn-launcher-editor-row">
                      <div class="flower-turn-launcher-editor min-w-0 flex-1">
                        <div class="flower-turn-launcher-heading mb-0.5 flex items-center justify-between gap-2">
                          <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary/70">{copyValue(props.copy, 'you_label')}</div>
                          <span
                            class="text-[11px] text-muted-foreground"
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                          >
                            {sending() ? copyValue(props.copy, 'sending') : copyValue(props.copy, 'reply_to_flower_label')}
                          </span>
                        </div>

                        <div data-testid="flower-turn-launcher-editor-shell" class="flower-turn-launcher-editor-shell">
                          <textarea
                            ref={setTextareaEl}
                            id={`flower-turn-launcher-prompt-${intent.id}`}
                            class="chat-input-textarea flower-chat-input-textarea flower-turn-launcher-textarea focus:!outline-none focus-visible:!outline-none focus-visible:!shadow-none"
                            value={userPrompt()}
                            placeholder={projected()?.placeholder}
                            disabled={sending()}
                            onInput={(event) => {
                              setUserPrompt(event.currentTarget.value);
                              if (validationError()) setValidationError('');
                              if (launchError()) setLaunchError('');
                            }}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionUpdate={() => {
                              setUserPrompt(textareaValue());
                            }}
                            onCompositionEnd={() => {
                              setIsComposing(false);
                              setUserPrompt(textareaValue());
                            }}
                            onKeyDown={(event) => {
                              if (shouldSubmitOnEnterKeydown(event, isComposing())) {
                                event.preventDefault();
                                void submit();
                              }
                            }}
                          />

                          <Show when={validationError()}>
                            <div class="flower-turn-launcher-validation text-error">
                              {validationError()}
                            </div>
                          </Show>

                          <Button
                            data-testid="flower-turn-launcher-inline-send"
                            variant="primary"
                            size="icon"
                            icon={ArrowUp}
                            class="flower-composer-submit flower-turn-launcher-send-btn rounded-full"
                            onClick={() => void submit()}
                            disabled={!canSubmit()}
                            loading={sending()}
                            aria-busy={sending() ? 'true' : 'false'}
                            title={copyValue(props.copy, sending() ? 'sending' : 'send_turn')}
                            aria-label={copyValue(props.copy, sending() ? 'sending' : 'send_turn')}
                          />
                        </div>

                        <Show when={launchError()}>
                          <div role="alert" class="flower-turn-launcher-error">
                            <AlertTriangle class="size-3.5 shrink-0" />
                            <span class="min-w-0">{copyValue(props.copy, 'launch_failed_title')} {launchError()}</span>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Show when={controller.footerPlacement === 'panel'}>
              <div class="shrink-0 border-t border-border p-3">
                <FlowerTurnLauncherFooter
                  copy={props.copy}
                  footerClass={props.footerClass}
                  controller={controller}
                  onClose={props.onClose}
                />
              </div>
            </Show>
        </div>
      )}
    </Show>
  );
}

export function FlowerTurnLauncherWindow(props: FlowerTurnLauncherWindowProps) {
  const [viewport, setViewport] = createSignal(currentViewportSize());
  const controller = createFlowerTurnLauncherPanelController(props, 'window');

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

  createEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (controller.sending()) return;
      if (isPointerInsideLauncher(event)) return;
      props.onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() => window.removeEventListener('pointerdown', onPointerDown, true));
  });

  return (
    <Show when={props.open ? props.intent : null}>
      <FloatingWindow
        open
        onOpenChange={(next) => {
          if (controller.sending()) return;
          if (!next) props.onClose();
        }}
        title={copyValue(props.copy, 'window_title')}
        defaultPosition={position()}
        defaultSize={windowSizing().defaultSize}
        minSize={windowSizing().minSize}
        maxSize={windowSizing().maxSize}
        zIndex={props.zIndex}
        class={cn('flower-turn-launcher-window border-border/65 shadow-[0_28px_72px_-42px_color-mix(in_srgb,var(--foreground)_38%,transparent)]', props.windowClass)}
      >
        <FlowerTurnLauncherPanelControllerContext.Provider value={controller}>
          <FlowerTurnLauncherPanel
            open={props.open}
            intent={props.intent}
            copy={props.copy}
            contentClass={props.contentClass}
            localScrollProps={props.localScrollProps}
            autoFocus={props.autoFocus}
            draft={props.draft}
            onDraftChange={props.onDraftChange}
            onClose={props.onClose}
            onSubmit={props.onSubmit}
            onContextAction={props.onContextAction}
          />
        </FlowerTurnLauncherPanelControllerContext.Provider>
      </FloatingWindow>
    </Show>
  );
}
