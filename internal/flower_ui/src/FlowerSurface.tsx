import type { Component } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronDown, GripVertical, Send, Settings } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { FlowerEmptyState } from './chat/FlowerEmptyState';
import type { FlowerSurfaceCopy } from './copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from './copy';
import type {
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerSendMessageFailure,
  FlowerRouterDecision,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { projectFlowerThreadListItem, trimString } from './flowerSurfaceModel';
import { FlowerIcon } from './icons/FlowerIcon';
import { FlowerSoftAuraIcon } from './icons/FlowerSoftAuraIcon';
import { FlowerSettingsSurface } from './settings/FlowerSettingsSurface';
import { FlowerThreadList } from './threads/FlowerThreadList';

type FlowerSurfacePanel = 'chat' | 'settings';

const THREAD_RAIL_WIDTH_STORAGE_KEY = 'redeven.flower.threadRailWidth';
const THREAD_RAIL_WIDTH_DEFAULT = 272;
const THREAD_RAIL_WIDTH_MIN = 220;
const THREAD_RAIL_WIDTH_MAX = 380;

export {
  projectFlowerThreadListItem,
} from './flowerSurfaceModel';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampThreadRailWidth(width: number): number {
  return Math.min(THREAD_RAIL_WIDTH_MAX, Math.max(THREAD_RAIL_WIDTH_MIN, Math.round(width)));
}

function loadThreadRailWidth(): number {
  if (typeof window === 'undefined') return THREAD_RAIL_WIDTH_DEFAULT;
  const stored = Number(window.localStorage.getItem(THREAD_RAIL_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) ? clampThreadRailWidth(stored) : THREAD_RAIL_WIDTH_DEFAULT;
}

export type FlowerSurfaceProps = Readonly<{
  adapter: FlowerSurfaceAdapter;
  copy?: FlowerSurfaceCopy;
  focusThreadID?: string;
  class?: string;
}>;

export const FlowerSurface: Component<FlowerSurfaceProps> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY;
  const [loadError, setLoadError] = createSignal('');
  const [saveError, setSaveError] = createSignal('');
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [snapshot, setSnapshot] = createSignal<FlowerSettingsSnapshot | null>(null);
  const [threads, setThreads] = createSignal<readonly FlowerThreadSnapshot[]>([]);
  const [selectedThreadID, setSelectedThreadID] = createSignal('');
  const [chatDraft, setChatDraft] = createSignal('');
  const [chatSubmitError, setChatSubmitError] = createSignal('');
  const [chatRunning, setChatRunning] = createSignal(false);
  const [settingsSaving, setSettingsSaving] = createSignal(false);
  const [threadsRefreshing, setThreadsRefreshing] = createSignal(false);
  const [historyFilter, setHistoryFilter] = createSignal('');
  const [sidePanel, setSidePanel] = createSignal<FlowerSurfacePanel>('chat');
  const [isComposing, setIsComposing] = createSignal(false);
  const [handlerDecision, setHandlerDecision] = createSignal<FlowerRouterDecision | null>(null);
  const [handlerLoading, setHandlerLoading] = createSignal(false);
  const [handlerError, setHandlerError] = createSignal('');
  const [threadLoadError, setThreadLoadError] = createSignal('');
  const [threadRailWidth, setThreadRailWidth] = createSignal(THREAD_RAIL_WIDTH_DEFAULT);
  const [threadRailResizing, setThreadRailResizing] = createSignal(false);
  let threadLoadSequence = 0;
  let lastFocusedThreadID = '';
  let composerRef: HTMLTextAreaElement | undefined;

  const selectedThread = createMemo(() => threads().find((thread) => thread.thread_id === selectedThreadID()) ?? null);
  const selectedThreadRunning = createMemo(() => selectedThread()?.status === 'running');
  const threadItems = createMemo(() => threads().map(projectFlowerThreadListItem));
  const currentModelID = createMemo(() => trimString(snapshot()?.config.current_model_id));
  const activeProvider = createMemo(() => {
    const current = currentModelID();
    const providerID = current.split('/')[0] ?? '';
    return snapshot()?.config.providers.find((provider) => provider.id === providerID) ?? null;
  });
  const activeProviderSecrets = createMemo(() => {
    const provider = activeProvider();
    if (!provider) return null;
    return snapshot()?.provider_secrets.find((secret) => secret.provider_id === provider.id) ?? null;
  });
  const readyForChat = createMemo(() => {
    const provider = activeProvider();
    const secrets = activeProviderSecrets();
    if (!snapshot()?.config.enabled || !currentModelID() || !provider || !secrets?.provider_api_key_configured) return false;
    return provider.web_search?.mode !== 'brave' || Boolean(secrets.web_search_api_key_configured);
  });
  const selectedHandler = createMemo(() => handlerDecision()?.selected_handler ?? null);
  const handlerOptions = createMemo(() => {
    const decision = handlerDecision();
    const selected = decision?.selected_handler;
    const items = [...(decision?.available_handlers ?? [])];
    if (selected && !items.some((item) => item.handler_id === selected.handler_id)) {
      items.unshift(selected);
    }
    return items;
  });
  const canSwitchHandler = createMemo(() => {
    const decision = handlerDecision();
    return !selectedThreadID() && !!decision?.handler_selection.can_switch && handlerOptions().length > 1;
  });
  const readyHandlerDecision = createMemo(() => {
    const decision = handlerDecision();
    return !!decision?.selected_handler && !decision.blocker && decision.route !== 'blocked';
  });
  const needsSetup = createMemo(() => !!snapshot() && !readyForChat());

  const resolveHandlerDecision = async (requestedHandlerID?: string, previousDecision?: FlowerRouterDecision | null) => {
    setHandlerLoading(true);
    setHandlerError('');
    try {
      const baseDecision = previousDecision ?? handlerDecision();
      const next = await props.adapter.resolveHandler({
        thread_kind: 'chat',
        client_surface: baseDecision?.decision_scope.client_surface || 'flower_surface',
        ...(baseDecision?.decision_scope.context_envelope_id ? { context_envelope_id: baseDecision.decision_scope.context_envelope_id } : {}),
        ...(baseDecision?.decision_scope.primary_target_id ? { primary_target_id: baseDecision.decision_scope.primary_target_id } : {}),
        ...(trimString(requestedHandlerID) ? { requested_handler_id: trimString(requestedHandlerID) } : {}),
      });
      setHandlerDecision(next);
      if (next.blocker?.message && readyForChat()) {
        setHandlerError(next.blocker.message);
      }
      return next;
    } catch (error) {
      const message = getErrorMessage(error);
      setHandlerError(message);
      setHandlerDecision(null);
      throw new Error(message);
    } finally {
      setHandlerLoading(false);
    }
  };

  const upsertThread = (thread: FlowerThreadSnapshot) => {
    setThreads((current) => [thread, ...current.filter((item) => item.thread_id !== thread.thread_id)]);
  };

  const mergeThreadListRefresh = (
    current: readonly FlowerThreadSnapshot[],
    next: readonly FlowerThreadSnapshot[],
  ): readonly FlowerThreadSnapshot[] => {
    const byID = new Map(current.map((thread) => [thread.thread_id, thread] as const));
    return next.map((thread) => {
      const existing = byID.get(thread.thread_id);
      if (!existing) return thread;
      return {
        ...thread,
        messages: thread.messages.length > 0 ? thread.messages : existing.messages,
      };
    });
  };

  const loadAndSelectThread = async (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid) return;
    const sequence = ++threadLoadSequence;
    setSelectedThreadID(tid);
    setChatSubmitError('');
    setThreadLoadError('');
    returnToChat();
    if (!props.adapter.loadThread) return;
    try {
      const thread = await props.adapter.loadThread(tid);
      if (sequence !== threadLoadSequence) return;
      upsertThread(thread);
      setSelectedThreadID(thread.thread_id);
    } catch (error) {
      if (sequence !== threadLoadSequence) return;
      setThreadLoadError(getErrorMessage(error));
    }
  };

  const refreshSelectedThread = async (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid || !props.adapter.loadThread) return;
    try {
      const thread = await props.adapter.loadThread(tid);
      if (selectedThreadID() !== thread.thread_id) return;
      upsertThread(thread);
      setThreadLoadError('');
    } catch (error) {
      setThreadLoadError(getErrorMessage(error));
    }
  };

  const refreshThreads = async () => {
    setThreadsRefreshing(true);
    try {
      const next = await props.adapter.listThreads();
      setThreads((current) => mergeThreadListRefresh(current, next));
      const focusedThreadID = trimString(props.focusThreadID);
      setSelectedThreadID((current) => {
        if (focusedThreadID && next.some((thread) => thread.thread_id === focusedThreadID)) {
          return focusedThreadID;
        }
        return current && !next.some((thread) => thread.thread_id === current) ? '' : current;
      });
    } finally {
      setThreadsRefreshing(false);
    }
  };

  const loadSurface = async () => {
    try {
      const next = await props.adapter.loadSettings();
      setSnapshot(next);
      setLoadError('');
      await resolveHandlerDecision().catch(() => undefined);
      await refreshThreads();
    } catch (error) {
      setLoadError(getErrorMessage(error));
    }
  };

  onMount(() => {
    setThreadRailWidth(loadThreadRailWidth());
    void loadSurface();
  });

  createEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(THREAD_RAIL_WIDTH_STORAGE_KEY, String(threadRailWidth()));
  });

  createEffect(() => {
    const focusedThreadID = trimString(props.focusThreadID);
    if (!focusedThreadID || focusedThreadID === lastFocusedThreadID) {
      return;
    }
    lastFocusedThreadID = focusedThreadID;
    if (threads().some((thread) => thread.thread_id === focusedThreadID)) {
      void loadAndSelectThread(focusedThreadID);
      return;
    }
    void refreshThreads().then(() => {
      if (threads().some((thread) => thread.thread_id === focusedThreadID)) {
        void loadAndSelectThread(focusedThreadID);
      }
    });
  });

  createEffect(() => {
    const threadID = selectedThreadID();
    if (!threadID || !selectedThreadRunning()) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshSelectedThread(threadID);
    }, 1200);
    void refreshSelectedThread(threadID);
    onCleanup(() => window.clearInterval(timer));
  });

  const saveSettings = async (draft: FlowerSettingsDraft) => {
    setSaveError('');
    setSettingsSaving(true);
    try {
      const next = await props.adapter.saveSettings(draft);
      setSnapshot(next);
      setSavedAt(Date.now());
      return next;
    } catch (error) {
      const message = getErrorMessage(error);
      setSaveError(message);
      throw new Error(message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const returnToChat = () => {
    setChatSubmitError('');
    setSidePanel('chat');
  };

  const openSettings = () => {
    setSidePanel('settings');
  };

  const submitChat = async () => {
    const prompt = trimString(composerRef?.value ?? chatDraft());
    setChatSubmitError('');
    if (!snapshot()) {
      setChatSubmitError(copy().chat.loadingSettings);
      return;
    }
    if (!readyForChat()) {
      openSettings();
      return;
    }
    if (!prompt) {
      setChatSubmitError(copy().chat.enterMessageBeforeSending);
      return;
    }
    const decision = handlerDecision() ?? await resolveHandlerDecision();
    if (!decision.selected_handler || decision.blocker || decision.route === 'blocked') {
      setChatSubmitError(decision.blocker?.message || handlerError() || copy().chat.handlerUnavailable);
      return;
    }
    setChatRunning(true);
    try {
      const thread = await props.adapter.sendMessage({
        thread_id: selectedThreadID() || undefined,
        prompt,
        decision: selectedThreadID() ? null : decision,
      });
      upsertThread(thread);
      setSelectedThreadID(thread.thread_id);
      setChatDraft('');
      if (composerRef) {
        composerRef.value = '';
      }
      returnToChat();
      await refreshSelectedThread(thread.thread_id);
    } catch (error) {
      const failure = error as FlowerSendMessageFailure;
      if (failure.fresh_decision) {
        setHandlerDecision(failure.fresh_decision);
        setHandlerError(failure.fresh_decision.blocker?.message ?? '');
      }
      setChatSubmitError(getErrorMessage(error));
    } finally {
      setChatRunning(false);
    }
  };

  const startCompose = () => {
    threadLoadSequence += 1;
    setSelectedThreadID('');
    setChatDraft('');
    setChatSubmitError('');
    setThreadLoadError('');
    void resolveHandlerDecision();
    returnToChat();
  };

  const switchHandler = (handlerID: string) => {
    const previous = handlerDecision();
    void resolveHandlerDecision(handlerID, previous).catch(() => undefined);
  };

  const startThreadRailResize = (event: PointerEvent) => {
    event.preventDefault();
    setThreadRailResizing(true);
    const startX = event.clientX;
    const startWidth = threadRailWidth();
    const onPointerMove = (moveEvent: PointerEvent) => {
      setThreadRailWidth(clampThreadRailWidth(startWidth + moveEvent.clientX - startX));
    };
    const onPointerUp = () => {
      setThreadRailResizing(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onPointerUp);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onPointerUp);
  };

  const nudgeThreadRailWidth = (delta: number) => {
    setThreadRailWidth((width) => clampThreadRailWidth(width + delta));
  };

  const selectThread = (threadID: string) => {
    void loadAndSelectThread(threadID);
  };

  const shouldSubmitOnEnterKeydown = (event: KeyboardEvent): boolean => {
    if (event.isComposing || isComposing()) {
      return false;
    }
    return event.key === 'Enter' && !event.shiftKey;
  };

  const messageBubble = (message: FlowerThreadSnapshot['messages'][number]) => (
    <div class={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
      <div class={cn(
        'max-w-[78%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-6 shadow-sm',
        message.role === 'user'
          ? 'bg-primary text-primary-foreground'
          : 'border border-border/60 bg-card/70 text-foreground',
      )}>
        {message.content}
      </div>
    </div>
  );

  const setupGuide = () => (
    <div class="flower-host-setup-guide" role="status">
      <FlowerSoftAuraIcon class="redeven-flower-soft-aura-lg h-14 w-14 redeven-flower-icon-breathe" iconClass="redeven-flower-icon-spin" />
      <div class="flower-host-setup-copy">
        <h2>{copy().chat.setupNeeded}</h2>
        <p>{copy().chat.needsProviderNotice}</p>
      </div>
      <button type="button" class="flower-host-setup-primary" onClick={openSettings}>
        <Settings class="h-4 w-4" />
        <span>{copy().chat.openSettings}</span>
      </button>
    </div>
  );

  const chatPanel = () => (
    <div class="flower-host-chat-shell flower-chat-shell">
      <div class="flower-host-chat-header flower-chat-header border-b border-border/80 backdrop-blur-md">
        <div class="flex min-w-0 items-center gap-3">
          <FlowerIcon class="h-5 w-5 text-primary" />
          <div class="min-w-0 flex items-center gap-2">
            <div class="flower-host-chat-header-title truncate">{selectedThread()?.title || copy().chat.titleFallback}</div>
          </div>
        </div>
        <div class="flower-host-chat-header-actions">
          <button
            type="button"
            class="flower-host-header-icon-button"
            aria-label={copy().chat.settingsLabel}
            title={copy().chat.settingsLabel}
            onClick={openSettings}
          >
            <Settings class="h-4 w-4" />
          </button>
        </div>
      </div>
      <div class="flower-host-chat-main flower-chat-main">
        <div class="flower-host-chat-transcript flower-chat-transcript">
          <Show when={loadError()}>
            <div role="alert" class="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {loadError()}
            </div>
          </Show>
          <Show when={threadLoadError()}>
            <div role="alert" class="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {threadLoadError()}
            </div>
          </Show>
          <Show
            when={selectedThread()?.messages.length}
            fallback={needsSetup()
              ? setupGuide()
              : <FlowerEmptyState copy={copy().emptyState} disabled={!readyForChat()} onSuggestionClick={(prompt) => setChatDraft(prompt)} />}
          >
            <div class="mx-auto flex max-w-3xl flex-col gap-3">
              <For each={selectedThread()?.messages ?? []}>{messageBubble}</For>
            </div>
          </Show>
        </div>
        <div class="flower-host-chat-bottom-dock flower-chat-bottom-dock">
          <div class="flower-host-chat-bottom-dock-track flower-chat-bottom-dock-track">
            <div class="flower-host-composer flower-chat-input-floating chat-input-container p-3">
              <textarea
                ref={composerRef}
                class="w-full text-sm leading-6 text-foreground placeholder:text-muted-foreground"
                placeholder={copy().chat.placeholder}
                value={chatDraft()}
                onInput={(event) => {
                  setChatDraft(event.currentTarget.value);
                  setChatSubmitError('');
                }}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(event) => {
                  setIsComposing(false);
                  setChatDraft(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (shouldSubmitOnEnterKeydown(event)) {
                    event.preventDefault();
                    void submitChat();
                  }
                }}
              />
              <div class="flower-host-composer-footer">
                <Show
                  when={!needsSetup()}
                  fallback={(
                    <>
                      <div class="flower-host-setup-inline">
                        <span>{copy().chat.configureProviderBeforeChat}</span>
                      </div>
                      <Button variant="primary" icon={Settings} onClick={openSettings}>
                        {copy().chat.openSettings}
                      </Button>
                    </>
                  )}
                >
                  <div class="flower-host-handler-stack" aria-live="polite">
                    <Show when={canSwitchHandler()}>
                      <label class="flower-host-handler-picker">
                        <span class="flower-host-handler-selection-label">{copy().chat.handlerSelectionLabel}</span>
                        <span class="flower-host-handler-picker-value">
                          {handlerLoading()
                            ? copy().chat.handlerResolving
                            : selectedHandler()?.display_name || copy().chat.handlerUnavailable}
                        </span>
                        <ChevronDown class="flower-host-handler-picker-icon" />
                        <select
                          aria-label={copy().chat.handlerSelectionLabel}
                          value={selectedHandler()?.handler_id ?? ''}
                          disabled={handlerLoading()}
                          onChange={(event) => switchHandler(event.currentTarget.value)}
                        >
                          <For each={handlerOptions()}>
                            {(handler) => <option value={handler.handler_id}>{handler.display_name}</option>}
                          </For>
                        </select>
                      </label>
                    </Show>
                    <Show when={!canSwitchHandler() && !readyHandlerDecision()}>
                      <div class="flower-host-handler-selection">
                        <span class="flower-host-handler-selection-label">{copy().chat.handlerSelectionLabel}</span>
                        <Tag variant="warning" class="flower-host-handler-chip">
                          {handlerLoading() ? copy().chat.handlerResolving : copy().chat.handlerUnavailable}
                        </Tag>
                      </div>
                    </Show>
                    <Show when={handlerError()}>
                      <div class="flower-host-handler-error-row">
                        <span class="flower-host-handler-error">{handlerError()}</span>
                        <button
                          type="button"
                          class="flower-host-handler-retry"
                          onClick={() => void resolveHandlerDecision().catch(() => undefined)}
                        >
                          {copy().chat.handlerRetry}
                        </button>
                      </div>
                    </Show>
                  </div>
                  <Button
                    variant="primary"
                    icon={Send}
                    disabled={chatRunning() || !readyForChat() || !readyHandlerDecision() || !trimString(chatDraft())}
                    loading={chatRunning()}
                    onClick={() => void submitChat()}
                  >
                    {copy().chat.send}
                  </Button>
                </Show>
              </div>
            </div>
            <Show when={chatSubmitError()}>
              <div role="alert" class="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{chatSubmitError()}</div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <main
      id="redeven-flower-surface"
      class={cn('flower-component-shell flower-host-surface', threadRailResizing() && 'flower-component-shell-resizing', props.class)}
      style={{ '--flower-thread-rail-width': `${threadRailWidth()}px` }}
    >
      <aside class="flower-component-thread-rail" aria-label={copy().chat.conversationsAria}>
        <div class="flower-host-sidebar-actions">
          <button
            type="button"
            class="flower-host-new-chat-button"
            aria-label={copy().chat.newChat}
            title={copy().chat.newChat}
            onClick={startCompose}
          >
            <FlowerSoftAuraIcon class="h-8 w-8 shrink-0" iconClass="redeven-flower-soft-aura-nav-svg" glowClass="redeven-flower-soft-aura-nav-glow" />
            <span class="flower-host-new-chat-label">{copy().chat.newChat}</span>
          </button>
        </div>
        <FlowerThreadList
          items={threadItems()}
          activeThreadID={selectedThreadID()}
          query={historyFilter()}
          refreshing={threadsRefreshing()}
          copy={copy().threadList}
          onQueryChange={setHistoryFilter}
          onRefresh={() => void refreshThreads()}
          onSelect={selectThread}
        />
      </aside>
      <button
        type="button"
        class="flower-component-rail-resizer"
        role="separator"
        aria-label={copy().chat.resizeConversationsLabel}
        aria-orientation="vertical"
        aria-valuemin={THREAD_RAIL_WIDTH_MIN}
        aria-valuemax={THREAD_RAIL_WIDTH_MAX}
        aria-valuenow={threadRailWidth()}
        title={copy().chat.resizeConversationsLabel}
        onPointerDown={startThreadRailResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nudgeThreadRailWidth(-16);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            nudgeThreadRailWidth(16);
          }
        }}
      >
        <GripVertical class="h-3.5 w-3.5" />
      </button>
      <section class="flower-component-main">
        <Show when={sidePanel() === 'chat'}>{chatPanel()}</Show>
        <div class={cn('h-full min-h-0', sidePanel() !== 'settings' && 'hidden')} aria-hidden={sidePanel() !== 'settings'}>
          <FlowerSettingsSurface
            snapshot={snapshot()}
            copy={copy().settings}
            onSaveDraft={saveSettings}
            saveError={saveError()}
            savedAt={savedAt()}
            saving={settingsSaving()}
            onBackToChat={returnToChat}
          />
        </div>
      </section>
    </main>
  );
};
