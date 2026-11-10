import { For, Show, createEffect, createMemo, createSignal, mergeProps, onCleanup, untrack } from 'solid-js';
import { cn, deferAfterPaint } from '@floegence/floe-webapp-core';
import { Activity, AlertTriangle, ArrowUp, Camera, FileText } from '@floegence/floe-webapp-core/icons';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { Button, Dialog, PromptCard, type FloatingWindowViewportInsets, type SelectOption } from '@floegence/floe-webapp-core/ui';

import type {
  FlowerTurnLauncherIntent, FlowerModelDirectory, FlowerSurfaceAdapter,
} from './contracts/flowerSurfaceContracts';
import { createFlowerClientRequestID } from './flowerRequestIdentity';
import { FlowerIcon } from './icons/FlowerIcon';
import { DEFAULT_FLOWER_SURFACE_COPY, type FlowerSurfaceCopy } from './copy';
import { flowerComposerModelOption, type ComposerModelOption } from './composerModelOption';
import { FlowerModelOptionContent } from './composer/FlowerModelOptionContent';
import { FlowerContextIcon } from './icons/FlowerContextIcon';
import { flowerTurnAdmissionFailureKind } from './flowerTurnAdmission';
import { FlowerComposerContextReference, FlowerComposerContextReferences } from './composer/FlowerComposerContextReferences';
import { removeFlowerTurnLauncherReference } from './composer/removeFlowerTurnLauncherReference';
import {
  DEFAULT_FLOWER_TURN_LAUNCHER_WINDOW_COPY,
  buildFlowerTurnLauncherCopy,
  truncateFlowerTurnLauncherPath,
  type FlowerTurnLauncherContextAction,
  type FlowerTurnLauncherContextChip,
  type FlowerTurnLauncherWindowCopyInput,
  type FlowerTurnLauncherWindowChromeCopy,
} from './flowerTurnLauncherCopy';

export type FlowerTurnLauncherAnchor = Readonly<{
  x: number;
  y: number;
}>;

export type FlowerTurnLauncherSubmitInput = Readonly<{
  client_request_id: string;
  prompt: string;
  model_id?: string;
  intent: FlowerTurnLauncherIntent;
}>;

export type FlowerTurnLauncherPanelProps = Readonly<{
  open: boolean;
  intent: FlowerTurnLauncherIntent | null;
  copy?: FlowerTurnLauncherWindowCopyInput;
  modelCopy?: FlowerSurfaceCopy;
  contentClass?: string;
  footerClass?: string;
  localScrollProps?: Record<string, unknown>;
  autoFocus?: boolean;
  modelSource?: Pick<FlowerSurfaceAdapter, 'loadSettings' | 'loadModelDirectory' | 'subscribeModelDirectory'>;
  draft?: string;
  onDraftChange?: (draft: string) => void;
  onLockedChange?: (locked: boolean) => void;
  screenshot?: Readonly<{ label: string; failed: string; capture: (signal: AbortSignal) => Promise<File> }>;
  onClose: () => void;
  onSubmit: (input: FlowerTurnLauncherSubmitInput) => Promise<void>;
  onContextAction?: (action: FlowerTurnLauncherContextAction, entry: FlowerTurnLauncherContextChip) => void | Promise<void>;
}>;

export type FlowerTurnLauncherWindowProps = FlowerTurnLauncherPanelProps & Readonly<{
  anchor?: FlowerTurnLauncherAnchor | null;
  viewportInsets?: FloatingWindowViewportInsets;
  zIndex?: number;
  windowClass?: string;
  onActivate?: () => void;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function shouldSubmitOnEnterKeydown(event: KeyboardEvent, composing: boolean): boolean {
  if (event.isComposing || composing) return false;
  return event.key === 'Enter' && !event.shiftKey;
}

function copyValue(
  copy: FlowerTurnLauncherWindowCopyInput | undefined,
  key: Exclude<keyof FlowerTurnLauncherWindowChromeCopy, 'remove_reference'>,
): string {
  return compact(copy?.[key]) || DEFAULT_FLOWER_TURN_LAUNCHER_WINDOW_COPY[key];
}

function entryIcon(entry: FlowerTurnLauncherContextChip) {
  const file = entry.primary_action?.type === 'open_attachment_snapshot_preview' ? entry.primary_action.file : undefined;
  if (file?.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    onCleanup(() => URL.revokeObjectURL(url));
    return <img src={url} alt="" class="h-5 w-5 rounded-sm object-cover" />;
  }
  return <FlowerContextIcon tone={entry.tone} name={entry.tone === 'selection' ? entry.detail : entry.label} />;
}

function actionIcon(action: FlowerTurnLauncherContextAction) {
  if (action.type === 'open_attachment_snapshot_preview') return <FileItemIcon size={16} item={{ name: action.file.name, type: 'file' }} class="size-4" />;
  if (action.type === 'open_directory_browser') return <FileItemIcon size={16} item={{ name: action.path, type: 'folder' }} class="size-4" />;
  if (action.type === 'open_live_file_preview') return <FileItemIcon size={16} item={{ name: action.path, type: 'file' }} class="size-4" />;
  if (action.type === 'open_process_snapshot_preview') return <Activity class="size-3.5" />;
  return <FileText class="size-3.5" />;
}

function secondaryActionLabel(action: FlowerTurnLauncherContextAction): string {
  if (action.type === 'open_attachment_snapshot_preview') return action.label;
  if (action.type === 'open_live_file_preview') return action.label;
  if (action.type === 'open_directory_browser') return action.label;
  return action.title;
}

export function createFlowerTurnLauncherPanelController(
  props: FlowerTurnLauncherPanelProps,
  footerPlacement: 'panel' | 'window' = 'panel',
) {
  const [internalUserPrompt, setInternalUserPrompt] = createSignal('');
  const [validationError, setValidationError] = createSignal('');
  const [launchError, setLaunchError] = createSignal('');
  const [launchErrorKind, setLaunchErrorKind] = createSignal<'failure' | 'unknown'>('failure');
  const [isComposing, setIsComposing] = createSignal(false);
  const [selectedModelID, setSelectedModelID] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [capturing, setCapturing] = createSignal(false);
  const [captureError, setCaptureError] = createSignal('');
  let captureController: AbortController | undefined;
  const cancelCapture = () => { captureController?.abort(); captureController = undefined; setCapturing(false); };
  createEffect(() => { const open = props.open; void props.intent; cancelCapture(); if (open) setCaptureError(''); });
  onCleanup(cancelCapture);
  const [clientRequestID, setClientRequestID] = createSignal('');
  const [pendingRequest, setPendingRequest] = createSignal<FlowerTurnLauncherSubmitInput | null>(null);
  const [editableIntent, setEditableIntent] = createSignal<FlowerTurnLauncherIntent | null>(null);
  let textareaEl: HTMLTextAreaElement | undefined;
  let focusedFrame: number | undefined;
  let presentedIntent: FlowerTurnLauncherIntent | null = null;

  const projected = createMemo(() => {
    const intent = editableIntent();
    return intent ? buildFlowerTurnLauncherCopy(intent, props.copy) : null;
  });
  const userPrompt = () => props.draft ?? internalUserPrompt();
  const admissionUnknown = () => launchErrorKind() === 'unknown' && Boolean(launchError());
  createEffect(() => props.onLockedChange?.(props.open && (sending() || admissionUnknown())));
  onCleanup(() => props.onLockedChange?.(false));
  const visiblePrompt = () => admissionUnknown() ? pendingRequest()?.prompt ?? '' : userPrompt();
  const setUserPrompt = (value: string) => {
    setInternalUserPrompt(value);
    props.onDraftChange?.(value);
  };
  const canSubmit = createMemo(() => !capturing() && !sending() && (compact(visiblePrompt()).length > 0 || (editableIntent()?.pending_attachments?.length ?? 0) > 0));
  const suggestedWorkingDir = createMemo(() => compact(props.intent?.suggested_working_dir));

  const resetLauncherState = (intent: FlowerTurnLauncherIntent | null) => {
    setEditableIntent(intent);
    setValidationError('');
    setLaunchError('');
    setLaunchErrorKind('failure');
    setIsComposing(false);
    setSending(false);
    setClientRequestID(intent ? createFlowerClientRequestID() : '');
    setPendingRequest(null);
    setSelectedModelID('');
    setInternalUserPrompt(untrack(() => props.draft) ?? compact(intent?.initial_prompt));
    if (props.autoFocus === false || footerPlacement === 'window') return;
    focusedFrame = requestAnimationFrame(() => {
      focusedFrame = undefined;
      if (!props.open) return;
      textareaEl?.focus({ preventScroll: true });
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
    if (!props.open) {
      if (focusedFrame !== undefined) cancelAnimationFrame(focusedFrame);
      return;
    }
    const intent = props.intent;
    // Reversing an unfinished exit keeps the same editor, draft and request.
    if (footerPlacement === 'window' && intent && intent === presentedIntent && textareaEl?.isConnected) return;
    if (intent && presentedIntent && intent.id === presentedIntent.id) {
      if (untrack(sending) || untrack(admissionUnknown)) return;
      const current = untrack(editableIntent);
      const previousAutomatic = new Set(presentedIntent.pending_attachments ?? []);
      const manualAttachments = current?.pending_attachments?.filter(file => !previousAutomatic.has(file)) ?? [];
      setEditableIntent({ ...intent, pending_attachments: [...intent.pending_attachments ?? [], ...manualAttachments] });
      setValidationError('');
      setLaunchError('');
      setPendingRequest(null);
      setClientRequestID(createFlowerClientRequestID());
      presentedIntent = intent;
      // A fresh contextual action also raises an already-open card. Preserve the
      // draft and insertion point while returning typing ownership from its source.
      queueMicrotask(() => {
        if (props.open && props.autoFocus !== false && textareaEl?.isConnected) textareaEl.focus({ preventScroll: true });
      });
      return;
    }
    presentedIntent = intent;
    resetLauncherState(intent);
  });
  onCleanup(() => { if (focusedFrame !== undefined) cancelAnimationFrame(focusedFrame); });

  const submit = async () => {
    if (sending() || capturing()) return;
    const intent = editableIntent();
    const requestID = clientRequestID();
    const retryingUnknownAdmission = admissionUnknown();
    const prompt = compact(retryingUnknownAdmission
      ? pendingRequest()?.prompt ?? ''
      : textareaEl?.value ?? userPrompt());
    if (!intent || !requestID) return;
    if (!prompt && !(intent.pending_attachments?.length)) {
      setValidationError(copyValue(props.copy, 'empty_message'));
      requestAnimationFrame(() => textareaEl?.focus());
      return;
    }

    setSending(true);
    setValidationError('');
    setLaunchError('');
    setLaunchErrorKind('failure');
    const request = retryingUnknownAdmission ? pendingRequest()! : { client_request_id: requestID, prompt, intent, ...(selectedModelID() ? { model_id: selectedModelID() } : {}) };
    setPendingRequest(request);
    try {
      await props.onSubmit(request);
    } catch (error) {
      const admissionKind = flowerTurnAdmissionFailureKind(error);
      setLaunchErrorKind(admissionKind === 'unknown' ? 'unknown' : 'failure');
      setLaunchError(error instanceof Error ? error.message : String(error));
      if (admissionKind !== 'unknown') {
        setPendingRequest(null);
        requestAnimationFrame(() => textareaEl?.focus());
      }
    } finally {
      setSending(false);
    }
  };

  const runContextAction = (action: FlowerTurnLauncherContextAction | null, entry: FlowerTurnLauncherContextChip) => {
    if (!action || sending()) return;
    void props.onContextAction?.(action, entry);
  };

  const removeReference = (entry: FlowerTurnLauncherContextChip) => {
    const intent = editableIntent();
    if (!intent || sending() || admissionUnknown()) return;
    setEditableIntent(removeFlowerTurnLauncherReference(intent, entry));
  };

  const addFiles = (files: readonly File[]) => {
    const intent = editableIntent();
    if (!intent || sending() || admissionUnknown()) return;
    setEditableIntent({ ...intent, pending_attachments: [...intent.pending_attachments ?? [], ...files] });
    setValidationError('');
  };

  const captureScreenshot = async () => {
    if (!props.screenshot || capturing() || sending() || admissionUnknown()) return;
    textareaEl?.focus({ preventScroll: true });
    const operation = new AbortController(); captureController = operation;
    setCapturing(true); setCaptureError('');
    try {
      const file = await props.screenshot.capture(operation.signal);
      if (!operation.signal.aborted && props.open) addFiles([file]);
    } catch (error) {
      if (!operation.signal.aborted && !(error instanceof DOMException && error.name === 'NotAllowedError')) setCaptureError(props.screenshot.failed);
    } finally {
      if (captureController === operation) { captureController = undefined; setCapturing(false); }
    }
  };

  return {
    capturing, captureError, captureScreenshot,
    selectedModelID, setSelectedModelID, addFiles,
    footerPlacement,
    visiblePrompt,
    admissionUnknown,
    setUserPrompt,
    validationError,
    setValidationError,
    launchError,
    setLaunchError,
    launchErrorKind,
    setLaunchErrorKind,
    isComposing,
    setIsComposing,
    sending,
    projected,
    canSubmit,
    suggestedWorkingDir,
    setTextareaEl: (element: HTMLTextAreaElement) => {
      textareaEl = element;
    },
    textareaValue: () => textareaEl?.value ?? visiblePrompt(),
    submit,
    runContextAction,
    removeReference,
  };
}

type FlowerTurnLauncherPanelController = ReturnType<typeof createFlowerTurnLauncherPanelController>;

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
          <FileItemIcon size={14} item={{ name: props.controller.suggestedWorkingDir(), type: 'folder' }} class="size-3.5 shrink-0" />
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

function FlowerTurnLauncherReferences(props: {
  controller: FlowerTurnLauncherPanelController;
  copy?: FlowerTurnLauncherWindowCopyInput;
  localScrollProps?: Record<string, unknown>;
}) {
  return (
    <Show when={(props.controller.projected()?.context_entries.length ?? 0) > 0}>
      <FlowerComposerContextReferences label={copyValue(props.copy, 'linked_context_label')}
        localScrollProps={props.localScrollProps}>
        <For each={props.controller.projected()?.context_entries ?? []}>{entry => (
          <FlowerComposerContextReference label={entry.tone === 'selection' ? entry.detail : entry.label}
            title={`${entry.title}${entry.detail ? `\n${entry.detail}` : ''}`}
            icon={entryIcon(entry)} disabled={props.controller.sending()}
            removalDisabled={props.controller.admissionUnknown()}
            removeLabel={(props.copy?.remove_reference ?? DEFAULT_FLOWER_TURN_LAUNCHER_WINDOW_COPY.remove_reference)(entry.tone === 'selection' ? entry.detail : entry.label)}
            onRemove={() => props.controller.removeReference(entry)}
            onPreview={entry.primary_action ? () => props.controller.runContextAction(entry.primary_action, entry) : undefined}
            actions={<For each={entry.secondary_actions}>{action => (
              <button type="button" class="flower-composer-context-action"
                aria-label={secondaryActionLabel(action)} title={secondaryActionLabel(action)}
                disabled={props.controller.sending()} onClick={() => props.controller.runContextAction(action, entry)}>{actionIcon(action)}</button>
            )}</For>} />
        )}</For>
      </FlowerComposerContextReferences>
    </Show>
  );
}

export function FlowerTurnLauncherPanel(props: FlowerTurnLauncherPanelProps) {
  const controller = createFlowerTurnLauncherPanelController(props);
  const {
    visiblePrompt,
    admissionUnknown,
    setUserPrompt,
    validationError,
    setValidationError,
    launchError,
    setLaunchError,
    launchErrorKind,
    setLaunchErrorKind,
    isComposing,
    setIsComposing,
    sending,
    canSubmit,
    setTextareaEl,
    textareaValue,
    submit,
  } = controller;

  return (
    <Show when={props.open ? props.intent : null} keyed>
      {(intent) => (
        <div class={cn('flower-turn-launcher-surface flex h-full min-h-0 flex-col overflow-hidden bg-background', props.contentClass)}>
            <Show when={(intent.notes?.length ?? 0) > 0}>
              <div {...props.localScrollProps} class="min-h-0 overflow-y-auto px-2.5 py-2">
                <For each={intent.notes}>{note => <div class="flower-ask-card-note">{note}</div>}</For>
              </div>
            </Show>

            <div data-testid="flower-turn-launcher-dock" class="flower-turn-launcher-dock shrink-0 border-t border-border/65 bg-background/96 shadow-[0_-14px_30px_-30px_color-mix(in_srgb,var(--foreground)_32%,transparent)] backdrop-blur">
              <div class="mx-auto w-full max-w-[40rem]">
                <div class="flower-turn-launcher-input flower-chat-input">
                  <div class="chat-input-body flower-chat-input-body flower-turn-launcher-input-body">
                    <div class="flower-chat-input-primary-row flower-turn-launcher-editor-row">
                      <div class="flower-turn-launcher-editor min-w-0 flex-1">
                        <div data-floe-input-surface={controller.footerPlacement === 'panel' ? true : undefined} data-testid="flower-turn-launcher-editor-shell" class="flower-turn-launcher-editor-shell">
                          <FlowerTurnLauncherReferences controller={controller} copy={props.copy} localScrollProps={props.localScrollProps} />
                          <textarea
                            ref={setTextareaEl}
                            id={`flower-turn-launcher-prompt-${intent.id}`}
                            class="chat-input-textarea flower-chat-input-textarea flower-turn-launcher-textarea"
                            aria-label={copyValue(props.copy, 'you_label')}
                            rows={3}
                            value={visiblePrompt()}
                            disabled={sending() || admissionUnknown()}
                            onInput={(event) => {
                              setUserPrompt(event.currentTarget.value);
                              if (validationError()) setValidationError('');
                              if (launchError()) {
                                setLaunchError('');
                                setLaunchErrorKind('failure');
                              }
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
                          <div
                            role={launchErrorKind() === 'unknown' ? 'status' : 'alert'}
                            class={launchErrorKind() === 'unknown'
                              ? 'flower-turn-launcher-unknown'
                              : 'flower-turn-launcher-error'}
                          >
                            <AlertTriangle class="size-3.5 shrink-0" />
                            <span class="min-w-0">
                              {copyValue(
                                props.copy,
                                launchErrorKind() === 'unknown' ? 'launch_unknown_title' : 'launch_failed_title',
                              )} {launchError()}
                            </span>
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

type FlowerModelSelectOption = SelectOption & Readonly<{ model: ComposerModelOption }>;

/** Product content and admission state over the published contextual input. */
export function FlowerTurnLauncherWindow(props: FlowerTurnLauncherWindowProps) {
  const [localPreview, setLocalPreview] = createSignal<{ title: string; text?: string; url?: string }>();
  let previewURL: string | undefined;
  const clearPreview = () => { if (previewURL) URL.revokeObjectURL(previewURL); previewURL = undefined; setLocalPreview(undefined); };
  onCleanup(clearPreview);
  createEffect(() => { if (!props.open) clearPreview(); });
  const controller = createFlowerTurnLauncherPanelController(mergeProps(props, {
    onContextAction: (action: FlowerTurnLauncherContextAction, entry: FlowerTurnLauncherContextChip) => {
      if (props.onContextAction) return props.onContextAction(action, entry);
      clearPreview();
      if (action.type === 'open_attachment_snapshot_preview' && action.file.type.startsWith('image/')) {
        previewURL = URL.createObjectURL(action.file); setLocalPreview({ title: action.file.name, url: previewURL });
      } else if (action.type === 'open_text_context_preview' || action.type === 'open_process_snapshot_preview') {
        setLocalPreview({ title: action.title, text: action.body });
      }
    },
  }), 'window');
  const [directory, setDirectory] = createSignal<FlowerModelDirectory>();
  const [modelLoading, setModelLoading] = createSignal(false);
  const [modelError, setModelError] = createSignal('');
  const [modelReload, setModelReload] = createSignal(0);
  createEffect(() => {
    if (!props.open || !props.modelSource) return;
    const source = props.modelSource;
    const intent = props.intent;
    const refresh = modelReload() > 0;
    let active = true;
    setModelLoading(true); setModelError('');
    const unsubscribe = source.subscribeModelDirectory?.(value => { if (active) setDirectory(value); });
    onCleanup(() => { active = false; unsubscribe?.(); });
    deferAfterPaint(() => {
      if (!active) return;
      void Promise.all([source.loadSettings(), source.loadModelDirectory?.(refresh)]).then(([settings, models]) => {
        if (!active) return;
        const value = models ?? settings.model_directory;
        if (value) setDirectory(value);
        if (intent === props.intent && !controller.selectedModelID() && !controller.sending() && !controller.admissionUnknown()) controller.setSelectedModelID(
          settings.conversation_preferences?.model_id || value?.current_model_id || settings.model_profile?.current_model_id || '');
      }).catch(() => { if (active) setModelError(copyValue(props.copy, 'models_failed')); })
        .finally(() => { if (active) setModelLoading(false); });
    });
  });
  const modelCopy = () => props.modelCopy ?? DEFAULT_FLOWER_SURFACE_COPY;
  const modelOptions = createMemo<FlowerModelSelectOption[]>(() => {
    const groups = new Map<string, ReturnType<typeof flowerComposerModelOption>[]>();
    for (const model of directory()?.models ?? []) {
      const option = flowerComposerModelOption(model, modelCopy());
      const key = `${option.source}/${model.provider_id || option.group}`;
      groups.set(key, [...groups.get(key) ?? [], option]);
    }
    return [...groups].flatMap(([group, options]) => options.map(option => ({
      value: option.id, label: option.name || option.label, group, groupLabel: option.group,
      disabled: option.disabled, description: option.unavailableReason,
      keywords: [option.label, option.id, option.group], model: option,
    })));
  });
  const presentedIntent = createMemo<FlowerTurnLauncherIntent | null>(previous =>
    props.open && props.intent ? props.intent : previous ?? null);
  return (<>
    <PromptCard
      open={props.open && Boolean(props.intent)}
      bodyProps={props.localScrollProps}
      portalScope="viewport"
      anchor={props.anchor}
      viewportInsets={props.viewportInsets}
      title={copyValue(props.copy, 'window_title')}
      icon={<FlowerIcon />}
      closeLabel={copyValue(props.copy, 'close')}
      busy={controller.sending()}
      zIndex={props.zIndex}
      class={cn('flower-ask-card flower-turn-launcher-window', props.windowClass)}
      onActivate={props.onActivate}
      onClose={props.onClose}
      autoFocus={props.autoFocus}
      editorRef={controller.setTextareaEl}
      question={(presentedIntent()?.notes?.length ?? 0) > 0 ? <For each={presentedIntent()?.notes}>{note => <div class="flower-ask-card-note">{note}</div>}</For> : undefined}
      value={controller.visiblePrompt()}
      onValueChange={value => {
        controller.setUserPrompt(value);
        controller.setValidationError('');
        controller.setLaunchError('');
        controller.setLaunchErrorKind('failure');
      }}
      inputLabel={copyValue(props.copy, 'you_label')}
      inputDisabled={controller.admissionUnknown()}
      submitDisabled={!controller.canSubmit()}
      submitLabel={copyValue(props.copy, controller.sending() ? 'sending' : 'send_turn')}
      onSubmit={() => { void controller.submit(); }}
      attachment={{ label: copyValue(props.copy, 'add_attachments'), onFiles: controller.addFiles }}
      tools={<Show when={props.screenshot}><Button variant="ghost" size="icon" icon={Camera}
        aria-label={props.screenshot!.label} title={props.screenshot!.label} loading={controller.capturing()}
        disabled={controller.sending() || controller.admissionUnknown()}
        onClick={() => { void controller.captureScreenshot(); }} /></Show>}
      selection={props.modelSource ? {
        label: copyValue(props.copy, 'select_model'), placeholder: copyValue(props.copy, 'select_model'),
        value: controller.selectedModelID(), options: modelOptions(),
        renderOption: option => <FlowerModelOptionContent option={(option as FlowerModelSelectOption).model}
          selected={controller.selectedModelID() === option.value} pendingLabel={modelCopy().chat.modelsChecking}
          unavailableLabel={modelCopy().settings.dialog.catalog.unavailableModel} />,
        search: { label: modelCopy().settings.dialog.catalog.search, placeholder: modelCopy().settings.dialog.catalog.search },
        popupClass: 'flower-model-dropdown',
        onChange: controller.setSelectedModelID, loading: modelLoading(), error: modelError(),
        onRetry: () => setModelReload(value => value + 1),
      } : undefined}
      references={<FlowerTurnLauncherReferences controller={controller} copy={props.copy} localScrollProps={props.localScrollProps} />}
      feedback={(controller.captureError() || controller.validationError() || controller.launchError()) && <>
        <Show when={controller.captureError()}><div class="flower-ask-card-validation" role="alert">{controller.captureError()}</div></Show>
        <Show when={controller.validationError()}><div class="flower-ask-card-validation" role="alert">{controller.validationError()}</div></Show>
        <Show when={controller.launchError()}>
          <div role={controller.launchErrorKind() === 'unknown' ? 'status' : 'alert'}
            class={controller.launchErrorKind() === 'unknown' ? 'flower-turn-launcher-unknown' : 'flower-turn-launcher-error'}>
            <AlertTriangle class="size-3.5 shrink-0" />
            <span class="min-w-0">{copyValue(props.copy, controller.launchErrorKind() === 'unknown' ? 'launch_unknown_title' : 'launch_failed_title')} {controller.launchError()}</span>
          </div>
        </Show>
      </>}
      containsTarget={target => target instanceof Element && Boolean(
        target.closest('.flower-turn-launcher-related-surface')
          || target.closest('[role="menu"]')
          || target.closest('[data-floe-geometry-surface="floating-window"]')?.querySelector(':scope > .flower-turn-launcher-related-surface'))}
    />
    <Dialog open={Boolean(localPreview())} onOpenChange={open => { if (!open) clearPreview(); }}
      title={localPreview()?.title} closeLabel={copyValue(props.copy, 'close')} class="flower-turn-launcher-related-surface" globalZIndex={(props.zIndex ?? 100) + 2}>
      <Show when={localPreview()?.url} fallback={<pre class="max-h-[65vh] overflow-auto whitespace-pre-wrap text-xs">{localPreview()?.text}</pre>}>
        <img src={localPreview()?.url} alt={localPreview()?.title ?? ''} class="max-h-[65vh] w-full object-contain" />
      </Show>
    </Dialog>
  </>);
}
