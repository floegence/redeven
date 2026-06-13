import type { Component } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, ArrowUp, Check, ChevronDown, Clock, GripVertical, Plus, Settings, Terminal, Zap } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { writeTextToClipboard } from './clipboard';
import { FlowerEmptyState } from './chat/FlowerEmptyState';
import type { FlowerSurfaceCopy } from './copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from './copy';
import type {
  FlowerInputAnswer,
  FlowerInputRequest,
  FlowerInputRequestChoice,
  FlowerInputRequestQuestion,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerSendMessageFailure,
  FlowerRouterDecision,
  FlowerThreadListItem,
  FlowerThreadSnapshot,
  FlowerChatMessage,
  FlowerToolActivity,
} from './contracts/flowerSurfaceContracts';
import { projectFlowerThreadListItem, trimString } from './flowerSurfaceModel';
import { FlowerIcon } from './icons/FlowerIcon';
import { FlowerSoftAuraIcon } from './icons/FlowerSoftAuraIcon';
import { FlowerSettingsSurface } from './settings/FlowerSettingsSurface';
import { FlowerThreadList, type FlowerThreadMenuAction } from './threads/FlowerThreadList';

type FlowerSurfacePanel = 'chat' | 'settings';
type FlowerInputDraft = Readonly<{
  choice_id?: string;
  text?: string;
}>;

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
  const [inputDrafts, setInputDrafts] = createSignal<Record<string, FlowerInputDraft>>({});
  const [activeInputQuestionID, setActiveInputQuestionID] = createSignal('');
  const [inputSubmitError, setInputSubmitError] = createSignal('');
  const [inputSubmitting, setInputSubmitting] = createSignal(false);
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
  const [threadActionError, setThreadActionError] = createSignal('');
  const [threadActionSuccess, setThreadActionSuccess] = createSignal('');
  const [threadActionBusy, setThreadActionBusy] = createSignal<{ threadID: string; action: FlowerThreadMenuAction } | null>(null);
  const [renameThreadID, setRenameThreadID] = createSignal('');
  const [renameDraft, setRenameDraft] = createSignal('');
  const [renameError, setRenameError] = createSignal('');
  const [renameSaving, setRenameSaving] = createSignal(false);
  const [loadingThreadID, setLoadingThreadID] = createSignal('');
  const [threadRailWidth, setThreadRailWidth] = createSignal(THREAD_RAIL_WIDTH_DEFAULT);
  const [threadRailResizing, setThreadRailResizing] = createSignal(false);
  let threadLoadSequence = 0;
  let lastFocusedThreadID = '';
  let lastInputPromptSignature = '';
  let composerRef: HTMLTextAreaElement | HTMLInputElement | undefined;
  let transcriptRef: HTMLDivElement | undefined;
  let renameDialogRef: HTMLDivElement | undefined;
  let renameInputRef: HTMLInputElement | undefined;
  let renameRestoreRef: HTMLElement | undefined;
  let transcriptNearBottom = true;

  const selectedThread = createMemo(() => threads().find((thread) => thread.thread_id === selectedThreadID()) ?? null);
  const selectedThreadRunning = createMemo(() => selectedThread()?.status === 'running');
  const visibleInputRequest = (thread: FlowerThreadSnapshot | null | undefined): FlowerInputRequest | null => (
    thread?.status === 'waiting_user' ? thread.input_request ?? null : null
  );
  const selectedInputRequest = createMemo(() => visibleInputRequest(selectedThread()));
  const selectedThreadHasContent = createMemo(() => {
    const thread = selectedThread();
    if (!thread) return false;
    return thread.messages.length > 0
      || (thread.tool_activity?.length ?? 0) > 0
      || !!visibleInputRequest(thread)
      || trimString(thread.error?.message) !== '';
  });
  const selectedThreadLoading = createMemo(() => trimString(loadingThreadID()) !== '' && loadingThreadID() === selectedThreadID());

  const stableSelectedMessages = createMemo(
    (prev: readonly FlowerChatMessage[] | undefined) => {
      const msgs = selectedThread()?.messages ?? [];
      if (!prev || prev.length !== msgs.length) return msgs;
      for (let i = 0; i < msgs.length; i++) {
        if (prev[i]?.id !== msgs[i]?.id || prev[i]?.status !== msgs[i]?.status || prev[i]?.content !== msgs[i]?.content) {
          return msgs;
        }
      }
      return prev;
    },
  );
  const selectedThreadRunErrorMessage = createMemo(() => trimString(selectedThread()?.error?.message));
  const threadItemCache = new Map<string, { item: ReturnType<typeof projectFlowerThreadListItem>; sig: string }>();
  const threadItems = createMemo(() =>
    threads().map((t) => {
      const sig = `${t.status}|${t.title}|${Number(t.pinned_at_ms ?? 0)}|${t.created_at_ms}|${t.source_label ?? ''}|${t.model_id ?? ''}|${t.target_labels?.join(',') ?? ''}|${t.working_dir ?? ''}`;
      const cached = threadItemCache.get(t.thread_id);
      if (cached && cached.sig === sig) {
        return cached.item;
      }
      const item = projectFlowerThreadListItem(t);
      threadItemCache.set(t.thread_id, { item, sig });
      return item;
    }),
  );
  // Stable sidebar list items: only updates when sidebar-visible fields change.
  // Uses createEffect(on(...)) bound to a signal rather than createMemo(on(...))
  // because createMemo does not reliably propagate the inner on() recomputation
  // in Solid 1.9.x (see FlowerThreadList.test.ts for the regression test).
  const [sidebarListItems, setSidebarListItems] = createSignal<ReturnType<typeof threadItems>>([]);
  createEffect(
    on(
      () => {
        const items = threadItems();
        return items.map((t) => `${t.thread_id}:${t.status}:${t.title}:${String(t.pinned)}:${t.pinned_at_ms ?? 0}`).join('|');
      },
      () => {
        setSidebarListItems(threadItems());
      },
    ),
  );
  // Prime the signal on first render.
  createEffect(() => {
    const items = threadItems();
    if (items.length > 0) setSidebarListItems(items);
  });

  const renameOriginalTitle = createMemo(() => threads().find((thread) => thread.thread_id === renameThreadID())?.title ?? '');
  const renameUnchanged = createMemo(() => trimString(renameDraft()) === trimString(renameOriginalTitle()));
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
    setThreads((current) => {
      const existingIndex = current.findIndex((item) => item.thread_id === thread.thread_id);
      if (existingIndex < 0) {
        return [thread, ...current];
      }
      if (current[existingIndex] === thread) {
        return current;
      }
      const next = [...current];
      next[existingIndex] = thread;
      return next;
    });
  };

  const writeClipboardText = async (value: string, label: string) => {
    const text = trimString(value);
    if (!text) return;
    await writeTextToClipboard(text);
    setThreadActionSuccess(copy().threadList.copied(label));
  };

  const openRenameDialog = (threadID: string, title: string, restore?: HTMLElement) => {
    setRenameThreadID(trimString(threadID));
    setRenameDraft(title);
    setRenameError('');
    setThreadActionError('');
    renameRestoreRef = restore;
    queueMicrotask(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  };

  const closeRenameDialog = () => {
    if (renameSaving()) return;
    setRenameThreadID('');
    setRenameDraft('');
    setRenameError('');
    renameRestoreRef?.focus();
    renameRestoreRef = undefined;
  };

  const submitRename = async () => {
    const threadID = renameThreadID();
    if (!threadID || !props.adapter.renameThread || renameUnchanged()) return;
    setRenameSaving(true);
    setThreadActionError('');
    setRenameError('');
    try {
      const thread = await props.adapter.renameThread(threadID, renameDraft());
      upsertThread(thread);
      setRenameThreadID('');
      setRenameDraft('');
      renameRestoreRef?.focus();
      renameRestoreRef = undefined;
    } catch (error) {
      setRenameError(getErrorMessage(error));
    } finally {
      setRenameSaving(false);
    }
  };

  const focusRenameDialogEdge = (edge: 'first' | 'last') => {
    const items = Array.from(renameDialogRef?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? []);
    if (items.length === 0) return;
    items[edge === 'first' ? 0 : items.length - 1]?.focus();
  };

  const restoreThreadMenuFocus = (restore?: HTMLElement) => {
    if (!restore) return;
    queueMicrotask(() => {
      if (document.contains(restore)) {
        restore.focus();
      }
    });
  };

  const handleThreadMenuAction = async (action: FlowerThreadMenuAction, item: FlowerThreadListItem, restore?: HTMLElement) => {
    if (threadActionBusy()) {
      restoreThreadMenuFocus(restore);
      return;
    }
    setThreadActionError('');
    setThreadActionSuccess('');
    const shouldRestoreFocus = action !== 'rename';
    try {
      switch (action) {
        case 'copy_thread_id':
          await writeClipboardText(item.thread_id, copy().threadList.threadIDLabel);
          return;
        case 'copy_workdir':
          await writeClipboardText(item.working_dir, copy().threadList.workingDirectoryLabel);
          return;
        case 'rename':
          if (!props.adapter.renameThread) return;
          openRenameDialog(item.thread_id, item.title, restore);
          return;
        case 'pin':
          if (!props.adapter.setThreadPinned) return;
          setThreadActionBusy({ threadID: item.thread_id, action });
          upsertThread(await props.adapter.setThreadPinned(item.thread_id, !item.pinned));
          return;
        case 'fork':
          if (!props.adapter.forkThread) return;
          setThreadActionBusy({ threadID: item.thread_id, action });
          {
            const forked = await props.adapter.forkThread(item.thread_id);
            upsertThread(forked);
            await loadAndSelectThread(forked.thread_id);
          }
          return;
        default:
          return;
      }
    } catch (error) {
      setThreadActionError(getErrorMessage(error));
    } finally {
      setThreadActionBusy(null);
      if (shouldRestoreFocus) {
        restoreThreadMenuFocus(restore);
      }
    }
  };

  const threadHasLoadedDetail = (thread: FlowerThreadSnapshot): boolean => (
    thread.messages.length > 0 || thread.tool_activity !== undefined || visibleInputRequest(thread) !== null || thread.error !== undefined
  );

  const mergeThreadListSummary = (
    summary: FlowerThreadSnapshot,
    existing: FlowerThreadSnapshot,
  ): FlowerThreadSnapshot => ({
    ...summary,
    messages: existing.messages,
    ...(existing.tool_activity !== undefined ? { tool_activity: existing.tool_activity } : {}),
    ...(summary.status === 'waiting_user' && existing.input_request !== undefined ? { input_request: existing.input_request } : {}),
    ...(existing.error !== undefined ? { error: existing.error } : {}),
  });

  const mergeThreadListRefresh = (
    current: readonly FlowerThreadSnapshot[],
    next: readonly FlowerThreadSnapshot[],
  ): readonly FlowerThreadSnapshot[] => {
    const byID = new Map(current.map((thread) => [thread.thread_id, thread] as const));
    return next.map((thread) => {
      const existing = byID.get(thread.thread_id);
      if (!existing) return thread;
      const listSummaryOnly = thread.messages.length === 0
        && thread.tool_activity === undefined
        && thread.input_request === undefined
        && thread.error === undefined;
      if (listSummaryOnly && threadHasLoadedDetail(existing)) {
        return mergeThreadListSummary(thread, existing);
      }
      return thread;
    });
  };

  const loadAndSelectThread = async (threadID: string) => {
    const tid = trimString(threadID);
    if (!tid) return;
    const sequence = ++threadLoadSequence;
    transcriptNearBottom = true;
    setSelectedThreadID(tid);
    setChatSubmitError('');
    setInputSubmitError('');
    setThreadLoadError('');
    returnToChat();
    if (!props.adapter.loadThread) return;
    setLoadingThreadID(tid);
    try {
      const thread = await props.adapter.loadThread(tid);
      if (sequence !== threadLoadSequence) return;
      upsertThread(thread);
      setSelectedThreadID(thread.thread_id);
      setLoadingThreadID('');
    } catch (error) {
      if (sequence !== threadLoadSequence) return;
      setLoadingThreadID('');
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

  const refreshThreads = async (): Promise<boolean> => {
    setThreadsRefreshing(true);
    try {
      const next = await props.adapter.listThreads();
      setLoadError('');
      const selectedID = selectedThreadID();
      const previousSelected = threads().find((thread) => thread.thread_id === selectedID) ?? null;
      const selectedSummary = next.find((thread) => thread.thread_id === selectedID) ?? null;
      setThreads((current) => mergeThreadListRefresh(current, next));
      const focusedThreadID = trimString(props.focusThreadID);
      setSelectedThreadID((current) => {
        if (focusedThreadID && next.some((thread) => thread.thread_id === focusedThreadID)) {
          return focusedThreadID;
        }
        return current && !next.some((thread) => thread.thread_id === current) ? '' : current;
      });
      if (
        selectedID
        && props.adapter.loadThread
        && previousSelected
        && selectedSummary
        && (previousSelected.updated_at_ms !== selectedSummary.updated_at_ms || previousSelected.status !== selectedSummary.status)
      ) {
        void refreshSelectedThread(selectedID);
      }
      return true;
    } catch (error) {
      setLoadError(getErrorMessage(error));
      return false;
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

  createEffect(() => {
    const promptID = selectedInputRequest()?.prompt_id ?? '';
    const signature = promptID ? `${selectedThreadID()}:${promptID}` : '';
    if (signature === lastInputPromptSignature) {
      return;
    }
    lastInputPromptSignature = signature;
    setInputDrafts({});
    const textQuestion = selectedInputRequest()?.questions.find((question) => question.response_mode === 'write' || question.response_mode === 'select_or_write') ?? null;
    setActiveInputQuestionID(textQuestion?.id ?? '');
    setInputSubmitError('');
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
    if (selectedInputRequest()) {
      await submitInputRequest();
      return;
    }
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
      setLoadError('');
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
    transcriptNearBottom = true;
    setSelectedThreadID('');
    setChatDraft('');
    setChatSubmitError('');
    setInputDrafts({});
    setInputSubmitError('');
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
    transcriptNearBottom = true;
    void loadAndSelectThread(threadID);
  };

  const transcriptIsNearBottom = (): boolean => {
    const node = transcriptRef;
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= 96;
  };

  const updateTranscriptNearBottom = () => {
    transcriptNearBottom = transcriptIsNearBottom();
  };

  const scrollTranscriptToBottom = () => {
    const node = transcriptRef;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    transcriptNearBottom = true;
  };

  const transcriptRenderSignature = createMemo(() => {
    const thread = selectedThread();
    if (!thread) return `${selectedThreadID()}:empty`;
    return [
      thread.thread_id,
      thread.status,
      thread.updated_at_ms,
      thread.messages.map((message) => [
        message.id,
        message.status,
        message.content,
        message.blocks?.map((block) => `${block.type}:${block.content ?? ''}`).join('|') ?? '',
      ].join('\x1e')).join('\x1d'),
      thread.tool_activity?.map((item) => [
        item.tool_id,
        item.status,
        item.summary,
        item.error_message ?? '',
        item.approval_state ?? '',
      ].join('\x1e')).join('\x1d') ?? '',
      thread.input_request
        ? [
            thread.input_request.prompt_id,
            thread.input_request.questions.map((question) => [
              question.id,
              question.header,
              question.question,
              question.response_mode,
              question.choices?.map((choice) => `${choice.choice_id}:${choice.label}:${choice.kind}`).join('|') ?? '',
            ].join('\x1e')).join('\x1d'),
          ].join('\x1e')
        : '',
      thread.error?.message ?? '',
    ].join('\x1f');
  });

  createEffect(() => {
    transcriptRenderSignature();
    if (transcriptNearBottom) {
      queueMicrotask(scrollTranscriptToBottom);
    }
  });

  const shouldSubmitOnEnterKeydown = (event: KeyboardEvent): boolean => {
    if (event.isComposing || isComposing()) {
      return false;
    }
    return event.key === 'Enter' && !event.shiftKey;
  };

  const errorNotice = (title: string, message: string) => (
    <div role="alert" class="flower-host-error-card">
      <div class="flower-host-error-icon"><AlertTriangle class="h-4 w-4" /></div>
      <div class="flower-host-error-copy">
        <div class="flower-host-error-title">{title}</div>
        <div class="flower-host-error-message">{message}</div>
      </div>
    </div>
  );

  const chatCopyValue = (
    key: 'inputRequestTitle'
      | 'inputRequestDescription'
      | 'inputRequestSubmit'
      | 'inputRequestRetry'
      | 'inputRequestAnswerRequired'
      | 'inputRequestSubmitting'
      | 'inputRequestComposerPlaceholder'
      | 'inputRequestChoicePlaceholder',
    fallback: string,
  ): string => trimString(copy().chat[key]) || trimString(DEFAULT_FLOWER_SURFACE_COPY.chat[key]) || fallback;

  const streamingCursor = () => <span class="flower-host-streaming-cursor" aria-hidden="true" />;

  const questionMode = (question: FlowerInputRequestQuestion): NonNullable<FlowerInputRequestQuestion['response_mode']> => {
    return question.response_mode;
  };

  const questionAllowsText = (question: FlowerInputRequestQuestion): boolean => {
    const mode = questionMode(question);
    return mode === 'write' || mode === 'select_or_write';
  };

  const questionDraft = (questionID: string): FlowerInputDraft => inputDrafts()[questionID] ?? {};

  const setQuestionDraft = (questionID: string, next: FlowerInputDraft) => {
    setInputDrafts((current) => ({
      ...current,
      [questionID]: {
        ...(trimString(next.choice_id) ? { choice_id: trimString(next.choice_id) } : {}),
        ...(next.text !== undefined ? { text: next.text } : {}),
      },
    }));
    setInputSubmitError('');
  };

  const selectInputChoice = (question: FlowerInputRequestQuestion, choice: FlowerInputRequestChoice) => {
    setQuestionDraft(question.id, {
      choice_id: choice.choice_id,
    });
  };

  const updateInputText = (question: FlowerInputRequestQuestion, text: string) => {
    if (!questionAllowsText(question)) return;
    setQuestionDraft(question.id, {
      text,
    });
  };

  const updateComposerText = (value: string) => {
    const waitingQuestion = activeInputQuestion();
    if (selectedInputRequest() && waitingQuestion) {
      updateInputText(waitingQuestion, value);
      setInputSubmitError('');
      return;
    }
    setChatDraft(value);
    setChatSubmitError('');
  };

  const inputTextQuestions = createMemo(() => selectedInputRequest()?.questions.filter(questionAllowsText) ?? []);

  const activeInputQuestion = createMemo(() => {
    const questions = inputTextQuestions();
    const activeID = trimString(activeInputQuestionID());
    return questions.find((question) => question.id === activeID) ?? questions[0] ?? null;
  });
  const activeInputQuestionIsSecret = createMemo(() => !!selectedInputRequest() && !!activeInputQuestion()?.is_secret);

  const composerTextValue = createMemo(() => {
    if (!selectedInputRequest()) return chatDraft();
    const question = activeInputQuestion();
    return question ? questionDraft(question.id).text ?? '' : '';
  });

  const composerPlaceholder = createMemo(() => {
    if (!selectedInputRequest()) return copy().chat.placeholder;
    const question = activeInputQuestion();
    if (!question) {
      return chatCopyValue('inputRequestChoicePlaceholder', 'Choose an option to continue.');
    }
    return trimString(question.write_placeholder)
      || trimString(question.question)
      || chatCopyValue('inputRequestComposerPlaceholder', 'Reply to continue this conversation.');
  });

  const composerTextareaDisabled = createMemo(() => {
    if (!selectedInputRequest()) return false;
    return inputSubmitting() || !activeInputQuestion();
  });

  const questionAnswer = (question: FlowerInputRequestQuestion): FlowerInputAnswer | null => {
    const draft = questionDraft(question.id);
    const choiceID = trimString(draft.choice_id);
    const text = trimString(draft.text);
    const mode = questionMode(question);

    if (mode === 'write') return text ? { text } : null;
    if (mode === 'select') return choiceID ? { choice_id: choiceID } : null;
    if (mode === 'select_or_write' && text) {
      return { text };
    }
    if (mode === 'select_or_write' && choiceID) {
      return { choice_id: choiceID };
    }
    return null;
  };

  const inputRequestAnswers = (): Record<string, FlowerInputAnswer> | null => {
    const request = selectedInputRequest();
    if (!request) return null;
    const answers: Record<string, FlowerInputAnswer> = {};
    for (const question of request.questions) {
      const answer = questionAnswer(question);
      if (!answer) {
        return null;
      }
      answers[question.id] = answer;
    }
    return answers;
  };

  const inputRequestReadyToSubmit = createMemo(() => !!selectedInputRequest() && inputRequestAnswers() !== null);
  const composerErrorMessage = createMemo(() => inputSubmitError() || chatSubmitError());

  const submitInputRequest = async () => {
    const thread = selectedThread();
    const request = selectedInputRequest();
    if (!thread || !request) return;
    const answers = inputRequestAnswers();
    if (!answers) {
      setInputSubmitError(chatCopyValue('inputRequestAnswerRequired', 'Answer every question before continuing.'));
      return;
    }
    setInputSubmitting(true);
    setInputSubmitError('');
    try {
      const next = await props.adapter.submitInput({
        thread_id: thread.thread_id,
        prompt_id: request.prompt_id,
        answers,
      });
      upsertThread(next);
      setSelectedThreadID(next.thread_id);
      setInputDrafts({});
      setActiveInputQuestionID('');
      setInputSubmitError('');
      await refreshSelectedThread(next.thread_id);
    } catch (error) {
      setInputSubmitError(getErrorMessage(error));
    } finally {
      setInputSubmitting(false);
    }
  };

  const inputRequestPrompt = (request: FlowerInputRequest | null | undefined) => (
    <Show when={request}>
      {(inputRequest) => (
        <section class="flower-host-input-request-panel" data-flower-input-request-prompt aria-label={chatCopyValue('inputRequestTitle', 'Waiting for your reply')}>
          <div class="flower-host-input-request-heading">
            <div class="flower-host-input-request-icon"><Clock class="h-4 w-4" /></div>
            <div class="flower-host-input-request-copy">
              <div class="flower-host-input-request-title">{chatCopyValue('inputRequestTitle', 'Waiting for your reply')}</div>
              <div class="flower-host-input-request-description">
                {inputRequest().public_summary || chatCopyValue('inputRequestDescription', 'Reply in the composer to continue this conversation.')}
              </div>
            </div>
          </div>
          <div class="flower-host-input-request-questions">
            <For each={inputRequest().questions}>
              {(question) => {
                const selectedChoiceID = () => trimString(questionDraft(question.id).choice_id);
                return (
                  <div
                    class={cn(
                      'flower-host-input-request-question',
                      activeInputQuestion()?.id === question.id && 'flower-host-input-request-question-active',
                    )}
                  >
                    <div class="flower-host-input-request-question-copy">
                      <div class="flower-host-input-request-question-header">{question.header}</div>
                      <div class="flower-host-input-request-question-text">{question.question}</div>
                    </div>
                    <Show when={(question.choices?.length ?? 0) > 0}>
                      <div class="flower-host-input-request-choice-grid">
                        <For each={question.choices ?? []}>
                          {(choice) => (
                            <button
                              type="button"
                              class={cn(
                                'flower-host-input-request-choice',
                                selectedChoiceID() === choice.choice_id && 'flower-host-input-request-choice-selected',
                              )}
                              aria-pressed={selectedChoiceID() === choice.choice_id}
                              disabled={inputSubmitting()}
                              onClick={() => selectInputChoice(question, choice)}
                            >
                              <span class="flower-host-input-request-choice-label">{choice.label}</span>
                              <Show when={choice.description}>
                                {(description) => <span class="flower-host-input-request-choice-description">{description()}</span>}
                              </Show>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
          <Show when={inputTextQuestions().length > 1}>
            <div class="flower-host-input-request-text-targets" role="tablist" aria-label={chatCopyValue('inputRequestComposerPlaceholder', 'Reply to continue this conversation.')}>
              <For each={inputTextQuestions()}>
                {(question) => (
                  <button
                    type="button"
                    class={cn(
                      'flower-host-input-request-text-target',
                      activeInputQuestion()?.id === question.id && 'flower-host-input-request-text-target-active',
                    )}
                    aria-selected={activeInputQuestion()?.id === question.id}
                    disabled={inputSubmitting()}
                    onClick={() => setActiveInputQuestionID(question.id)}
                  >
                    {question.write_label || question.header}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </section>
      )}
    </Show>
  );

  const messageText = (message: FlowerChatMessage): string => {
    const blocks = message.blocks?.filter((block) => block.type === 'markdown' || block.type === 'text') ?? [];
    const text = blocks.map((block) => trimString(block.content)).filter(Boolean).join('\n\n');
    return trimString(message.content) || trimString(text);
  };

  const messageBubble = (message: FlowerChatMessage) => {
    const streaming = message.status === 'streaming';
    const failed = message.status === 'error';
    const text = messageText(message);
    if (failed && !text && !streaming && selectedThreadRunErrorMessage()) {
      return null;
    }
    const visibleText = text || (failed ? copy().chat.messageErrorFallback : '');
    return (
      <div
        class={cn('flower-host-message-row', message.role === 'user' ? 'flower-host-message-row-user' : 'flower-host-message-row-assistant')}
        data-flower-message-id={message.id}
        data-flower-message-role={message.role}
        data-flower-message-status={message.status}
      >
        <div class={cn(
          'flower-host-message-bubble',
          message.role === 'user'
            ? 'flower-host-message-bubble-user'
            : 'flower-host-message-bubble-assistant',
          streaming && 'flower-host-message-bubble-streaming',
          failed && 'flower-host-message-bubble-error',
        )}>
          <Show when={failed}>
            <div class="flower-host-message-error-kicker">
              <AlertTriangle class="h-3.5 w-3.5" />
              <span>{copy().chat.messageErrorTitle}</span>
            </div>
          </Show>
          <Show when={visibleText} fallback={<Show when={streaming}><span class="flower-host-message-placeholder"> </span>{streamingCursor()}</Show>}>
            <span>{visibleText}</span>
            <Show when={streaming}>{streamingCursor()}</Show>
          </Show>
        </div>
      </div>
    );
  };

  const toolStatusIcon = (item: FlowerToolActivity) => {
    switch (item.status) {
      case 'success':
        return <Check class="h-3.5 w-3.5" />;
      case 'error':
      case 'canceled':
        return <AlertTriangle class="h-3.5 w-3.5" />;
      case 'waiting':
      case 'pending':
        return <Clock class="h-3.5 w-3.5" />;
      case 'running':
        return <Terminal class="h-3.5 w-3.5" />;
    }
  };

  const toolApprovalText = (item: FlowerToolActivity): string => {
    const state = trimString(item.approval_state);
    if (state) return copy().chat.toolApprovalState(state);
    return item.requires_approval ? copy().chat.toolApprovalRequired : '';
  };

  const toolActivityAriaLabel = (item: FlowerToolActivity): string => {
    const parts = [
      item.summary,
      item.tool_name,
      copy().chat.toolStatuses[item.status],
      toolApprovalText(item),
      trimString(item.error_message),
    ].filter(Boolean);
    return parts.join('. ');
  };

  const toolActivity = (items: readonly FlowerToolActivity[] | undefined) => (
    <Show when={(items?.length ?? 0) > 0}>
      <section class="flower-host-tool-activity" aria-label={copy().chat.toolActivityLabel}>
        <div class="flower-host-tool-activity-heading">
          <Zap class="h-3.5 w-3.5" />
          <span>{copy().chat.toolActivityLabel}</span>
        </div>
        <div class="flower-host-tool-activity-list" role="list">
          <For each={items ?? []}>
            {(item) => (
              <div
                class={cn('flower-host-tool-activity-item', `flower-host-tool-activity-item-${item.status}`)}
                role="listitem"
                aria-label={toolActivityAriaLabel(item)}
              >
                <span class="flower-host-tool-activity-icon">{toolStatusIcon(item)}</span>
                <span class="flower-host-tool-activity-main">
                  <span class="flower-host-tool-activity-summary">{item.summary}</span>
                  <Show when={item.error_message}>
                    <span class="flower-host-tool-activity-error">{item.error_message}</span>
                  </Show>
                </span>
                <span class={cn('flower-host-tool-activity-status', `flower-host-tool-activity-status-${item.status}`)}>
                  {copy().chat.toolStatuses[item.status]}
                </span>
                <Show when={toolApprovalText(item)}>
                  {(approval) => <span class="flower-host-tool-activity-approval">{approval()}</span>}
                </Show>
                <span class="flower-host-tool-activity-name">{item.tool_name}</span>
              </div>
            )}
          </For>
        </div>
      </section>
    </Show>
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

  const threadLoadingState = () => (
    <div class="flower-host-thread-loading" role="status" aria-live="polite">
      <FlowerSoftAuraIcon class="redeven-flower-soft-aura-lg h-10 w-10 redeven-flower-icon-breathe" iconClass="redeven-flower-icon-spin" />
      <div class="flower-host-thread-loading-copy">
        <div class="flower-host-thread-loading-title">{copy().chat.threadLoading}</div>
        <div class="flower-host-thread-loading-line" />
        <div class="flower-host-thread-loading-line flower-host-thread-loading-line-short" />
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
        <div ref={transcriptRef} class="flower-host-chat-transcript flower-chat-transcript" onScroll={updateTranscriptNearBottom}>
          <div class="flower-host-transcript-stack">
            <Show when={loadError()}>
              {(message) => errorNotice(copy().chat.loadErrorTitle, message())}
            </Show>
            <Show when={threadLoadError()}>
              {(message) => errorNotice(copy().chat.threadLoadErrorTitle, message())}
            </Show>
            <Show
              when={selectedThreadHasContent()}
              fallback={selectedThreadLoading()
                ? threadLoadingState()
                : needsSetup()
                  ? setupGuide()
                  : <FlowerEmptyState copy={copy().emptyState} disabled={!readyForChat()} onSuggestionClick={(prompt) => setChatDraft(prompt)} />}
            >
              <For each={stableSelectedMessages()}>{messageBubble}</For>
              {toolActivity(selectedThread()?.tool_activity)}
              <Show when={selectedThread()?.error}>
                {(error) => errorNotice(copy().chat.runErrorTitle, error().message)}
              </Show>
            </Show>
          </div>
        </div>
        <div class="flower-host-chat-bottom-dock flower-chat-bottom-dock">
          <div class="flower-host-chat-bottom-dock-track flower-chat-bottom-dock-track">
            <div class="flower-host-composer flower-chat-input-floating chat-input-container p-3">
              {inputRequestPrompt(selectedInputRequest())}
              <Show
                when={activeInputQuestionIsSecret()}
                fallback={(
                  <textarea
                    ref={(el) => {
                      composerRef = el;
                    }}
                    class="w-full text-sm leading-6 text-foreground placeholder:text-muted-foreground"
                    placeholder={composerPlaceholder()}
                    value={composerTextValue()}
                    disabled={composerTextareaDisabled()}
                    onInput={(event) => updateComposerText(event.currentTarget.value)}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={(event) => {
                      setIsComposing(false);
                      updateComposerText(event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                      if (shouldSubmitOnEnterKeydown(event)) {
                        event.preventDefault();
                        void submitChat();
                      }
                    }}
                  />
                )}
              >
                <input
                  ref={(el) => {
                    composerRef = el;
                  }}
                  type="password"
                  class="w-full text-sm leading-6 text-foreground placeholder:text-muted-foreground"
                  placeholder={composerPlaceholder()}
                  value={composerTextValue()}
                  disabled={composerTextareaDisabled()}
                  onInput={(event) => updateComposerText(event.currentTarget.value)}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={(event) => {
                    setIsComposing(false);
                    updateComposerText(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (shouldSubmitOnEnterKeydown(event)) {
                      event.preventDefault();
                      void submitChat();
                    }
                  }}
                />
              </Show>
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
                  <Show when={!selectedInputRequest()} fallback={<div class="flower-host-handler-stack" aria-live="polite" />}>
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
                        <div role="alert" class="flower-host-handler-error-card">
                          <div class="flower-host-handler-error-icon"><AlertTriangle class="h-3.5 w-3.5" /></div>
                          <div class="flower-host-handler-error-copy">
                            <div class="flower-host-handler-error-title">{copy().chat.handlerUnavailable}</div>
                            <div class="flower-host-handler-error-message">{handlerError()}</div>
                          </div>
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
                  </Show>
                  <Show
                    when={selectedInputRequest()}
                    fallback={(
                      <Button
                        variant="primary"
                        icon={ArrowUp}
                        size="icon"
                        class="flower-host-composer-submit rounded-full"
                        aria-label={copy().chat.send}
                        title={copy().chat.send}
                        disabled={chatRunning() || !readyForChat() || !readyHandlerDecision() || !trimString(chatDraft())}
                        loading={chatRunning()}
                        onClick={() => void submitChat()}
                      />
                    )}
                  >
                    <Button
                      variant="primary"
                      icon={ArrowUp}
                      class="flower-host-composer-submit"
                      disabled={inputSubmitting() || !inputRequestReadyToSubmit()}
                      loading={inputSubmitting()}
                      onClick={() => void submitChat()}
                    >
                      {inputSubmitting()
                        ? chatCopyValue('inputRequestSubmitting', 'Submitting...')
                        : inputSubmitError()
                          ? chatCopyValue('inputRequestRetry', 'Retry')
                          : chatCopyValue('inputRequestSubmit', 'Continue')}
                    </Button>
                  </Show>
                </Show>
              </div>
            </div>
            <Show when={composerErrorMessage()}>
              {(message) => <div class="flower-host-composer-error">{errorNotice(copy().chat.composerErrorTitle, message())}</div>}
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
      data-flower-selected-thread-id={selectedThreadID()}
      data-flower-selected-thread-status={selectedThread()?.status ?? 'idle'}
      data-flower-selected-thread-loading={selectedThreadLoading() ? 'true' : 'false'}
      data-flower-side-panel={sidePanel()}
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
            <Plus class="h-4 w-4 shrink-0" />
            <span class="flower-host-new-chat-label">{copy().chat.newChat}</span>
          </button>
        </div>
        <FlowerThreadList
          items={sidebarListItems()}
          activeThreadID={selectedThreadID()}
          query={historyFilter()}
          refreshing={threadsRefreshing()}
          copy={copy().threadList}
          onQueryChange={setHistoryFilter}
          onRefresh={() => void refreshThreads()}
          onSelect={selectThread}
          canFork={!!props.adapter.forkThread}
          canRename={!!props.adapter.renameThread}
          canPin={!!props.adapter.setThreadPinned}
          busyThreadID={threadActionBusy()?.threadID}
          busyAction={threadActionBusy()?.action}
          actionsBusy={threadActionBusy() !== null}
          onMenuAction={(action, item, restore) => void handleThreadMenuAction(action, item, restore)}
        />
        <Show when={threadActionError()}>
          {(message) => <div class="flower-host-thread-action-error" role="alert">{message()}</div>}
        </Show>
        <Show when={threadActionSuccess()}>
          {(message) => <div class="flower-host-thread-action-success" role="status" aria-live="polite">{message()}</div>}
        </Show>
      </aside>
      <Show when={renameThreadID()}>
        <div class="flower-host-rename-backdrop" role="presentation" onMouseDown={closeRenameDialog}>
          <div
            ref={renameDialogRef}
            class="flower-host-rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="flower-thread-rename-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeRenameDialog();
                return;
              }
              if (event.key !== 'Tab') return;
              const items = Array.from(renameDialogRef?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? []);
              if (items.length === 0) {
                event.preventDefault();
                return;
              }
              const first = items[0];
              const last = items[items.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                focusRenameDialogEdge('last');
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                focusRenameDialogEdge('first');
              }
            }}
          >
            <h2 id="flower-thread-rename-title">{copy().threadList.renameTitle}</h2>
            <label>
              <span>{copy().threadList.renameNameLabel}</span>
              <input
                ref={renameInputRef}
                class="flower-host-rename-input"
                value={renameDraft()}
                disabled={renameSaving()}
                aria-invalid={renameError() ? 'true' : undefined}
                aria-describedby={renameError() ? 'flower-thread-rename-error' : undefined}
                onInput={(event) => {
                  setRenameDraft(event.currentTarget.value);
                  setRenameError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitRename();
                  }
                }}
              />
            </label>
            <Show when={renameError()}>
              {(message) => <p id="flower-thread-rename-error" class="flower-host-rename-error" role="alert">{message()}</p>}
            </Show>
            <div class="flower-host-rename-actions">
              <button type="button" class="flower-host-rename-secondary" disabled={renameSaving()} onClick={closeRenameDialog}>{copy().threadList.cancel}</button>
              <button
                type="button"
                class="flower-host-rename-primary"
                disabled={renameSaving() || renameUnchanged()}
                onClick={() => void submitRename()}
              >
                {renameSaving() ? copy().threadList.saving : copy().threadList.save}
              </button>
            </div>
          </div>
        </div>
      </Show>
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
