// ChatProvider — forked from @floegence/floe-webapp-core/chat for local customization.

import {
  createContext,
  createMemo,
  createEffect,
  on,
  createSignal,
  useContext,
  batch,
  type ParentComponent,
  type Accessor,
} from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import type {
  FollowBottomRequest,
  FollowBottomRequestReason,
} from './scroll/createFollowBottomController';
import type {
  Message,
  ColdMessage,
  Attachment,
  ChatConfig,
  ChatCallbacks,
  VirtualListConfig,
  StreamEvent,
  ActivityGroup,
  ActivityItem,
  ActivityTimelineBlock,
} from './types';
import { DEFAULT_VIRTUAL_LIST_CONFIG } from './types';
import { createClientId } from '../utils/clientId';
import { applyStreamEventBatchToMessages, buildUserBlocks } from './messageState';

// ---- Defer helper (avoids blocking the UI thread) ----

function deferNonBlocking(fn: () => void): void {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(fn);
  } else {
    Promise.resolve().then(fn);
  }
}

function activityStatusRank(status: string | undefined): number {
  switch (String(status ?? '').trim()) {
    case 'error':
      return 5;
    case 'waiting':
    case 'waiting_approval':
      return 4;
    case 'running':
      return 3;
    case 'pending':
      return 2;
    case 'success':
      return 1;
    default:
      return 0;
  }
}

function activitySeverityRank(severity: string | undefined): number {
  switch (String(severity ?? '').trim()) {
    case 'error':
      return 4;
    case 'blocking':
      return 3;
    case 'warning':
      return 2;
    case 'normal':
      return 1;
    default:
      return 0;
  }
}

function rollupActivityStatus(items: ActivityItem[]): string {
  let status = 'success';
  for (const item of items) {
    if (activityStatusRank(item.status) > activityStatusRank(status)) {
      status = item.status;
    }
  }
  return status;
}

function rollupActivitySeverity(items: ActivityItem[]): string {
  let severity = 'quiet';
  for (const item of items) {
    const next = String(item.severity ?? '').trim() || (item.status === 'error' ? 'error' : 'quiet');
    if (activitySeverityRank(next) > activitySeverityRank(severity)) {
      severity = next;
    }
  }
  return severity;
}

function updateActivityApprovalGroup(group: ActivityGroup, toolId: string, approved: boolean): ActivityGroup {
  let changed = false;
  const items = group.items.map((item) => {
    if (
      String(item.toolId ?? '').trim() !== toolId ||
      item.requiresApproval !== true ||
      item.approvalState !== 'required'
    ) {
      return item;
    }
    changed = true;
    return approved
      ? { ...item, approvalState: 'approved' as const, status: 'running' as const, severity: 'normal' as const }
      : { ...item, approvalState: 'rejected' as const, status: 'error' as const, severity: 'error' as const };
  });
  if (!changed) return group;
  return {
    ...group,
    items,
    status: rollupActivityStatus(items),
    severity: rollupActivitySeverity(items),
    defaultOpen: items.some((item) => item.status === 'waiting' || item.status === 'error' || item.requiresApproval === true),
  };
}

function updateActivityApprovalSummary(block: ActivityTimelineBlock, groups: ActivityGroup[]): ActivityTimelineBlock['summary'] {
  const items = groups.flatMap((group) => group.items);
  return {
    ...block.summary,
    status: rollupActivityStatus(items),
    totalItems: block.summary.totalItems || items.length,
    visibleItems: block.summary.visibleItems || items.length,
  };
}

// ---- Context value type ----

export interface ChatContextValue {
  messages: Accessor<Message[]>;
  coldMessages: Map<string, ColdMessage>;
  isLoadingHistory: Accessor<boolean>;
  hasMoreHistory: Accessor<boolean>;
  streamingMessageId: Accessor<string | null>;
  isPreparing: Accessor<boolean>;
  isWorking: Accessor<boolean>;
  config: Accessor<ChatConfig>;
  virtualListConfig: Accessor<VirtualListConfig>;

  sendMessage: (content: string, attachments?: Attachment[]) => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  retryMessage: (messageId: string) => void;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updater: (message: Message) => Message) => void;
  deleteMessage: (messageId: string) => void;
  clearMessages: () => void;
  setMessages: (messages: Message[]) => void;
  handleStreamEvent: (event: StreamEvent) => void;
  uploadAttachment: (file: File) => Promise<string>;
  approveToolCall: (messageId: string, toolId: string, approved: boolean) => void;
  scrollToBottomRequest: Accessor<FollowBottomRequest | null>;
  requestScrollToBottom: (options?: ScrollToBottomRequestOptions) => void;

  heightCache: Map<string, number>;
  setMessageHeight: (id: string, height: number) => void;
  getMessageHeight: (id: string) => number;

  toggleChecklistItem: (messageId: string, blockIndex: number, itemId: string) => void;
}

// `smooth` is reserved for explicit user bottom intents; restore/bootstrap paths stay `auto`.
export type ScrollToBottomBehavior = 'auto' | 'smooth';

export interface ScrollToBottomRequestOptions {
  behavior?: ScrollToBottomBehavior;
  source?: 'system' | 'user';
  reason?: FollowBottomRequestReason;
}

// ---- Context ----

const ChatContext = createContext<ChatContextValue>();

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within a ChatProvider');
  return ctx;
}

// ---- Provider ----

export interface ChatProviderProps {
  initialMessages?: Message[];
  config?: ChatConfig;
  callbacks?: ChatCallbacks;
}

export const ChatProvider: ParentComponent<ChatProviderProps> = (props) => {
  // Resolved config with defaults
  const config = createMemo<ChatConfig>(() => ({
    placeholder: 'Type a message...',
    allowAttachments: true,
    maxAttachments: 10,
    maxAttachmentSize: 10_485_760, // 10 MB
    ...props.config,
  }));

  const virtualListConfig = createMemo<VirtualListConfig>(() => ({
    ...DEFAULT_VIRTUAL_LIST_CONFIG,
    ...props.config?.virtualList,
  }));

  // Message store (Solid.js fine-grained reactive store)
  const [messages, setMessages] = createStore<Message[]>(props.initialMessages || []);
  const coldMessages: Map<string, ColdMessage> = new Map();

  // Reconcile when initialMessages changes externally
  createEffect(
    on(
      () => props.initialMessages,
      (next) => {
        if (next && next.length > 0) setMessages(reconcile(next));
      },
      { defer: true },
    ),
  );

  // Loading / streaming state
  const [isLoadingHistory, setIsLoadingHistory] = createSignal(false);
  const [hasMoreHistory, setHasMoreHistory] = createSignal(true);
  const [streamingMessageId, setStreamingMessageId] = createSignal<string | null>(null);
  const [preparingCount, setPreparingCount] = createSignal(0);
  const [scrollToBottomRequest, setScrollToBottomRequest] = createSignal<FollowBottomRequest | null>(null);
  let scrollToBottomRequestSeq = 0;

  const requestScrollToBottom = (options?: ScrollToBottomRequestOptions): void => {
    scrollToBottomRequestSeq += 1;
    setScrollToBottomRequest({
      seq: scrollToBottomRequestSeq,
      reason: options?.reason ?? (options?.source === 'user' ? 'manual' : 'bootstrap'),
      behavior: options?.behavior ?? 'auto',
      source: options?.source ?? 'system',
    });
  };

  // Preparing tracking (tracks outstanding send operations)
  let prepIdCounter = 0;
  const activePrepIds = new Set<number>();
  const prepIdQueue: number[] = [];

  const removePrepId = (id: number): void => {
    if (!activePrepIds.delete(id)) return;
    const idx = prepIdQueue.indexOf(id);
    if (idx >= 0) prepIdQueue.splice(idx, 1);
    setPreparingCount(activePrepIds.size);
  };

  const addPrepId = (): number => {
    const id = ++prepIdCounter;
    activePrepIds.add(id);
    prepIdQueue.push(id);
    setPreparingCount(activePrepIds.size);
    return id;
  };

  const consumeOnePrepId = (): void => {
    while (prepIdQueue.length > 0) {
      const id = prepIdQueue.shift();
      if (id === undefined) return;
      if (activePrepIds.has(id)) {
        activePrepIds.delete(id);
        setPreparingCount(activePrepIds.size);
        return;
      }
    }
  };

  const isPreparing = createMemo(() => preparingCount() > 0);
  const isWorking = createMemo(() => isPreparing() || streamingMessageId() !== null);

  // Self-heal stale streaming pointers when message snapshots are replaced or dropped.
  createEffect(() => {
    const id = streamingMessageId();
    if (!id) return;
    const hasStreamingMessage = messages.some((msg) => msg.id === id && msg.status === 'streaming');
    if (!hasStreamingMessage) {
      setStreamingMessageId(null);
    }
  });

  // Height cache for virtual list
  const heightCache: Map<string, number> = new Map();

  // ---- Message CRUD ----

  const addMessage = (msg: Message): void => {
    setMessages(produce((msgs) => { msgs.push(msg); }));
  };

  const updateMessage = (id: string, updater: (msg: Message) => Message): void => {
    setMessages(produce((msgs) => {
      const idx = msgs.findIndex((m) => m.id === id);
      if (idx !== -1) msgs[idx] = updater(msgs[idx]);
    }));
  };

  const deleteMessage = (id: string): void => {
    setMessages(produce((msgs) => {
      const idx = msgs.findIndex((m) => m.id === id);
      if (idx !== -1) msgs.splice(idx, 1);
    }));
    heightCache.delete(id);
  };

  const clearMessages = (): void => {
    setMessages(reconcile([]));
    heightCache.clear();
  };

  const replaceMessages = (next: Message[]): void => {
    setMessages(reconcile(next));
  };

  // ---- Stream event handling (batched via microtask) ----

  let pendingEvents: StreamEvent[] = [];
  let scheduled = false;

  const flushStreamEvents = (): void => {
    const events = pendingEvents;
    pendingEvents = [];
    scheduled = false;
    if (events.length === 0) {
      return;
    }

    const result = applyStreamEventBatchToMessages(messages, events, {
      currentStreamingMessageId: streamingMessageId(),
      now: Date.now(),
    });
    batch(() => {
      for (let index = 0; index < result.consumePrepCount; index += 1) {
        consumeOnePrepId();
      }
      if (result.messages !== messages) {
        setMessages(reconcile(result.messages));
      }
      if (streamingMessageId() !== result.streamingMessageId) {
        setStreamingMessageId(result.streamingMessageId);
      }
    });
  };

  // ---- Context value ----

  const ctx: ChatContextValue = {
    messages: () => messages,
    coldMessages,
    isLoadingHistory,
    hasMoreHistory,
    streamingMessageId,
    isPreparing,
    isWorking,
    config,
    virtualListConfig,

    sendMessage: async (content, attachments = []) => {
      const userMsg: Message = {
        id: createClientId('message'),
        role: 'user',
        blocks: buildUserBlocks(content, attachments),
        status: 'sending',
        timestamp: Date.now(),
      };

      batch(() => {
        addMessage(userMsg);
        updateMessage(userMsg.id, (m) => ({ ...m, status: 'complete' }));
      });

      try {
        props.callbacks?.onWillSend?.(content, attachments, userMsg.id);
      } catch (err) {
        console.error('onWillSend error:', err);
      }

      const onSend = props.callbacks?.onSendMessage;
      if (!onSend) return;

      const prepId = addPrepId();
      const text = content;
      const atts = [...attachments];
      const userMessageId = userMsg.id;

      try {
        await onSend(text, atts, userMessageId, addMessage);
      } catch (err) {
        deleteMessage(userMessageId);
        throw err;
      } finally {
        removePrepId(prepId);
      }
    },

    loadMoreHistory: async () => {
      if (isLoadingHistory() || !hasMoreHistory()) return;
      const onLoadMore = props.callbacks?.onLoadMore;
      if (!onLoadMore) return;

      setIsLoadingHistory(true);
      deferNonBlocking(() => {
        Promise.resolve(onLoadMore())
          .then((older) => {
            if (older.length === 0) {
              setHasMoreHistory(false);
              return;
            }
            setMessages(produce((msgs) => { msgs.unshift(...older); }));
          })
          .catch((err) => {
            console.error('Failed to load history:', err);
          })
          .finally(() => {
            setIsLoadingHistory(false);
          });
      });
    },

    retryMessage: (messageId) => {
      const onRetry = props.callbacks?.onRetry;
      if (!onRetry) return;
      deferNonBlocking(() => {
        try {
          onRetry(messageId);
        } catch (err) {
          console.error('Failed to retry message:', err);
        }
      });
    },

    addMessage,
    updateMessage,
    deleteMessage,
    clearMessages,
    setMessages: replaceMessages,

    handleStreamEvent: (event) => {
      pendingEvents.push(event);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flushStreamEvents);
      }
    },

    uploadAttachment: async (file) => {
      const onUpload = props.callbacks?.onUploadAttachment;
      return onUpload ? await onUpload(file) : URL.createObjectURL(file);
    },

    approveToolCall: (messageId, toolId, approved) => {
      updateMessage(messageId, (msg) => ({
        ...msg,
        blocks: msg.blocks.map((block) => {
          if (block.type === 'activity-timeline') {
            let changed = false;
            const groups = block.groups.map((group) => {
              const next = updateActivityApprovalGroup(group, toolId, approved);
              if (next !== group) changed = true;
              return next;
            });
            return changed ? { ...block, groups, summary: updateActivityApprovalSummary(block, groups) } : block;
          }
          return block;
        }),
      }));

      const onApproval = props.callbacks?.onToolApproval;
      if (!onApproval) return;
      deferNonBlocking(() => {
        Promise.resolve(onApproval(messageId, toolId, approved)).catch((err) => {
          console.error('Failed to approve tool call:', err);
        });
      });
    },

    scrollToBottomRequest,
    requestScrollToBottom,

    heightCache,
    setMessageHeight: (id, height) => { heightCache.set(id, height); },
    getMessageHeight: (id) => heightCache.get(id) || virtualListConfig().defaultItemHeight,

    toggleChecklistItem: (messageId, blockIndex, itemId) => {
      let newChecked: boolean | null = null;
      updateMessage(messageId, (msg) => {
        const blocks = [...msg.blocks];
        const block = blocks[blockIndex];
        if (block && block.type === 'checklist') {
          const items = block.items.map((item) => {
            if (item.id === itemId) {
              newChecked = !item.checked;
              return { ...item, checked: newChecked };
            }
            return item;
          });
          blocks[blockIndex] = { ...block, items };
        }
        return { ...msg, blocks };
      });

      const onChange = props.callbacks?.onChecklistChange;
      if (!onChange || newChecked === null) return;
      deferNonBlocking(() => {
        try {
          onChange(messageId, blockIndex, itemId, newChecked!);
        } catch (err) {
          console.error('Failed to handle checklist change:', err);
        }
      });
    },
  };

  return <ChatContext.Provider value={ctx}>{props.children}</ChatContext.Provider>;
};
