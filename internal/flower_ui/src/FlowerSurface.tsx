import type { Component } from 'solid-js';
import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Send, Settings } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { FlowerEmptyState } from './chat/FlowerEmptyState';
import type { FlowerSurfaceCopy } from './copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from './copy';
import type {
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { projectFlowerThreadListItem, trimString } from './flowerSurfaceModel';
import { FlowerIcon } from './icons/FlowerIcon';
import { FlowerSoftAuraIcon } from './icons/FlowerSoftAuraIcon';
import { FlowerSettingsSurface } from './settings/FlowerSettingsSurface';
import { FlowerThreadList } from './threads/FlowerThreadList';

type FlowerSurfacePanel = 'chat' | 'settings';

export {
  projectFlowerThreadListItem,
} from './flowerSurfaceModel';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type FlowerSurfaceProps = Readonly<{
  adapter: FlowerSurfaceAdapter;
  copy?: FlowerSurfaceCopy;
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

  const selectedThread = createMemo(() => threads().find((thread) => thread.thread_id === selectedThreadID()) ?? null);
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

  const refreshThreads = async () => {
    setThreadsRefreshing(true);
    try {
      const next = await props.adapter.listThreads();
      setThreads(next);
      setSelectedThreadID((current) => (current && !next.some((thread) => thread.thread_id === current) ? '' : current));
    } finally {
      setThreadsRefreshing(false);
    }
  };

  const loadSurface = async () => {
    try {
      const next = await props.adapter.loadSettings();
      setSnapshot(next);
      setLoadError('');
      await refreshThreads();
    } catch (error) {
      setLoadError(getErrorMessage(error));
    }
  };

  onMount(() => {
    void loadSurface();
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
    const prompt = trimString(chatDraft());
    setChatSubmitError('');
    if (!snapshot()) {
      setChatSubmitError(copy().chat.loadingSettings);
      return;
    }
    if (!readyForChat()) {
      setChatSubmitError(copy().chat.configureProviderBeforeChat);
      return;
    }
    if (!prompt) {
      setChatSubmitError(copy().chat.enterMessageBeforeSending);
      return;
    }
    setChatRunning(true);
    try {
      const thread = await props.adapter.sendMessage({
        thread_id: selectedThreadID() || undefined,
        prompt,
      });
      setThreads((current) => [thread, ...current.filter((item) => item.thread_id !== thread.thread_id)]);
      setSelectedThreadID(thread.thread_id);
      setChatDraft('');
      returnToChat();
    } catch (error) {
      setChatSubmitError(getErrorMessage(error));
    } finally {
      setChatRunning(false);
    }
  };

  const startCompose = () => {
    setSelectedThreadID('');
    setChatDraft('');
    setChatSubmitError('');
    returnToChat();
  };

  const selectThread = (threadID: string) => {
    setSelectedThreadID(threadID);
    setChatSubmitError('');
    returnToChat();
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
          <Tag variant={readyForChat() ? 'success' : 'warning'} class="flower-host-status-tag">{readyForChat() ? copy().chat.ready : copy().chat.setupNeeded}</Tag>
          <Show when={currentModelID()}>
            <Tag variant="neutral" class="flower-host-model-tag max-w-[15rem] truncate">{currentModelID()}</Tag>
          </Show>
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
          <Show when={!readyForChat()}>
            <div role="status" class="mb-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              {copy().chat.needsProviderNotice}
              <button type="button" class="ml-2 cursor-pointer font-medium underline underline-offset-2" onClick={openSettings}>
                {copy().chat.openSettings}
              </button>
            </div>
          </Show>
          <Show
            when={selectedThread()?.messages.length}
            fallback={<FlowerEmptyState copy={copy().emptyState} disabled={!readyForChat()} onSuggestionClick={(prompt) => setChatDraft(prompt)} />}
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
                class="w-full text-sm leading-6 text-foreground placeholder:text-muted-foreground"
                placeholder={copy().chat.placeholder}
                value={chatDraft()}
                onInput={(event) => {
                  setChatDraft(event.currentTarget.value);
                  setChatSubmitError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submitChat();
                  }
                }}
              />
              <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 flex-wrap gap-1.5">
                  <Tag variant="neutral">{copy().chat.fromHost(props.adapter.host.display_name)}</Tag>
                </div>
                <Button
                  variant="primary"
                  icon={Send}
                  disabled={chatRunning() || !readyForChat() || !trimString(chatDraft())}
                  loading={chatRunning()}
                  onClick={() => void submitChat()}
                >
                  {copy().chat.send}
                </Button>
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
    <main id="redeven-flower-surface" class={cn('flower-component-shell flower-host-surface', props.class)}>
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
