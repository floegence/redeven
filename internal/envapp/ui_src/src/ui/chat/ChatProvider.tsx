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
  Message,
  MessageBlock,
  ColdMessage,
  Attachment,
  ChatConfig,
  ChatCallbacks,
  VirtualListConfig,
  StreamEvent,
} from './types';
import { DEFAULT_VIRTUAL_LIST_CONFIG } from './types';

// ---- Defer helper (avoids blocking the UI thread) ----

function deferNonBlocking(fn: () => void): void {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(fn);
  } else {
    Promise.resolve().then(fn);
  }
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
  toggleToolCollapse: (messageId: string, toolId: string) => void;
  approveToolCall: (messageId: string, toolId: string, approved: boolean) => void;
  scrollToBottomRequest: Accessor<ScrollToBottomRequest | null>;
  requestScrollToBottom: (options?: ScrollToBottomRequestOptions) => void;

  heightCache: Map<string, number>;
  setMessageHeight: (id: string, height: number) => void;
  getMessageHeight: (id: string) => number;

  toggleChecklistItem: (messageId: string, blockIndex: number, itemId: string) => void;
}

export type ScrollToBottomBehavior = 'auto' | 'smooth';

export interface ScrollToBottomRequest {
  seq: number;
  behavior: ScrollToBottomBehavior;
  source: 'system' | 'user';
}

export interface ScrollToBottomRequestOptions {
  behavior?: ScrollToBottomBehavior;
  source?: 'system' | 'user';
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
  const [scrollToBottomRequest, setScrollToBottomRequest] = createSignal<ScrollToBottomRequest | null>(null);
  let scrollToBottomRequestSeq = 0;

  const requestScrollToBottom = (options?: ScrollToBottomRequestOptions): void => {
    scrollToBottomRequestSeq += 1;
    setScrollToBottomRequest({
      seq: scrollToBottomRequestSeq,
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

  // ---- Stream event handling (batched via rAF) ----

  let pendingEvents: StreamEvent[] = [];
  let rafHandle: number | null = null;

  const flushStreamEvents = (): void => {
    const events = pendingEvents;
    pendingEvents = [];
    rafHandle = null;
    batch(() => {
      events.forEach(applySingleStreamEvent);
    });
  };

  const applySingleStreamEvent = (event: StreamEvent): void => {
    const ensureStreamingAssistantMessage = (msgs: Message[], messageId: string, timestamp: number): number => {
      let idx = msgs.findIndex((m) => m.id === messageId);
      if (idx === -1) {
        msgs.push({
          id: messageId,
          role: 'assistant',
          blocks: [],
          status: 'streaming',
          timestamp,
        });
        return msgs.length - 1;
      }

      const prev = msgs[idx];
      msgs[idx] = {
        ...prev,
        role: 'assistant',
        status: 'streaming',
        error: undefined,
      };
      return idx;
    };

    switch (event.type) {
      case 'message-start': {
        consumeOnePrepId();
        const id = event.messageId;
        const ts = Date.now();
        setMessages(produce((msgs) => {
          ensureStreamingAssistantMessage(msgs, id, ts);
        }));
        setStreamingMessageId(id);
        break;
      }
      case 'block-start': {
        const id = event.messageId;
        const ts = Date.now();
        setMessages(produce((msgs) => {
          const idx = ensureStreamingAssistantMessage(msgs, id, ts);
          const msg = msgs[idx];
          const blocks = [...msg.blocks];
          const target = Math.max(0, event.blockIndex);
          while (blocks.length <= target) {
            blocks.push(createEmptyBlock(event.blockType));
          }
          const existing = blocks[target];
          if (existing && existing.type !== event.blockType) {
            blocks[target] = createEmptyBlock(event.blockType);
          }
          msgs[idx] = { ...msg, blocks };
        }));
        setStreamingMessageId(id);
        break;
      }
      case 'block-delta': {
        const id = event.messageId;
        const ts = Date.now();
        setMessages(produce((msgs) => {
          const idx = ensureStreamingAssistantMessage(msgs, id, ts);
          const msg = msgs[idx];
          const blocks = [...msg.blocks];
          const target = Math.max(0, event.blockIndex);
          while (blocks.length <= target) {
            blocks.push(createEmptyBlock('text'));
          }
          const block = blocks[target];
          if (block && 'content' in block && typeof block.content === 'string') {
            blocks[target] = { ...(block as any), content: block.content + event.delta };
          } else {
            blocks[target] = { type: 'text', content: event.delta };
          }
          msgs[idx] = { ...msg, blocks };
        }));
        setStreamingMessageId(id);
        break;
      }
      case 'block-set': {
        const id = event.messageId;
        const ts = Date.now();
        setMessages(produce((msgs) => {
          const idx = ensureStreamingAssistantMessage(msgs, id, ts);
          const msg = msgs[idx];
          const blocks = [...msg.blocks];
          const target = Math.max(0, event.blockIndex);
          while (blocks.length < target) {
            blocks.push(createEmptyBlock(event.block.type));
          }
          if (target === blocks.length) {
            blocks.push(event.block);
          } else {
            blocks[target] = event.block;
          }
          msgs[idx] = { ...msg, blocks };
        }));
        setStreamingMessageId(id);
        break;
      }
      case 'block-end':
        // No-op for now; individual blocks handle their own finalization.
        break;
      case 'message-end': {
        updateMessage(event.messageId, (msg) => ({ ...msg, status: 'complete' }));
        setStreamingMessageId(null);
        break;
      }
      case 'error': {
        updateMessage(event.messageId, (msg) => ({
          ...msg,
          status: 'error',
          error: event.error,
        }));
        setStreamingMessageId(null);
        break;
      }
    }
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
        id: crypto.randomUUID(),
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

      deferNonBlocking(() => {
        Promise.resolve()
          .then(() => onSend(text, atts, userMessageId, addMessage))
          .catch((err) => {
            console.error('Failed to send message:', err);
          })
          .finally(() => {
            removePrepId(prepId);
          });
      });
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
      if (!rafHandle) {
        rafHandle = requestAnimationFrame(flushStreamEvents);
      }
    },

    uploadAttachment: async (file) => {
      const onUpload = props.callbacks?.onUploadAttachment;
      return onUpload ? await onUpload(file) : URL.createObjectURL(file);
    },

    toggleToolCollapse: (messageId, toolId) => {
      updateMessage(messageId, (msg) => ({
        ...msg,
        blocks: msg.blocks.map((block) => {
          if (block.type === 'tool-call' && block.toolId === toolId) {
            return { ...block, collapsed: block.collapsed === undefined ? false : !block.collapsed };
          }
          return block;
        }),
      }));
    },

    approveToolCall: (messageId, toolId, approved) => {
      updateMessage(messageId, (msg) => ({
        ...msg,
        blocks: msg.blocks.map((block) => {
          if (
            block.type !== 'tool-call' ||
            block.toolId !== toolId ||
            block.requiresApproval !== true ||
            block.approvalState !== 'required'
          ) {
            return block;
          }
          return approved
            ? { ...block, approvalState: 'approved' as const, status: 'running' as const }
            : { ...block, approvalState: 'rejected' as const, status: 'error' as const, error: block.error || 'Rejected by user' };
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

// ---- Helpers ----

function createEmptyBlock(blockType: MessageBlock['type']): MessageBlock {
  switch (blockType) {
    case 'text':
      return { type: 'text', content: '' };
    case 'markdown':
      return { type: 'markdown', content: '' };
    case 'code':
      return { type: 'code', language: '', content: '' };
    case 'code-diff':
      return { type: 'code-diff', language: '', oldCode: '', newCode: '' };
    case 'image':
      return { type: 'image', src: '' };
    case 'svg':
      return { type: 'svg', content: '' };
    case 'mermaid':
      return { type: 'mermaid', content: '' };
    case 'checklist':
      return { type: 'checklist', items: [] };
    case 'shell':
      return { type: 'shell', command: '', status: 'running' };
    case 'file':
      return { type: 'file', name: '', size: 0, mimeType: '' };
    case 'thinking':
      return { type: 'thinking' };
    case 'tool-call':
      return { type: 'tool-call', toolName: '', toolId: '', args: {}, status: 'pending' };
    case 'todos':
      return { type: 'todos', version: 0, updatedAtUnixMs: 0, todos: [] };
    case 'sources':
      return { type: 'sources', sources: [] };
    default:
      return { type: 'text', content: '' };
  }
}

function buildUserBlocks(content: string, attachments: Attachment[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  for (const att of attachments) {
    if (att.type === 'image') {
      blocks.push({ type: 'image', src: att.url || att.preview || '', alt: att.file.name });
    } else {
      blocks.push({ type: 'file', name: att.file.name, size: att.file.size, mimeType: att.file.type, url: att.url });
    }
  }
  if (content.trim()) {
    blocks.push({ type: 'text', content: content.trim() });
  }
  return blocks;
}
