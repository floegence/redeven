import type { Attachment, Message, MessageBlock, StreamEvent } from './types';

export interface AppliedStreamEventResult {
  messages: Message[];
  streamingMessageId: string | null;
  consumeOnePrepId: boolean;
}

export function upsertMessageById(existing: Message[], next: Message): Message[] {
  const id = String(next?.id ?? '').trim();
  if (!id) return existing;
  const index = existing.findIndex((message) => String(message?.id ?? '').trim() === id);
  if (index === -1) {
    return [...existing, next];
  }
  if (existing[index] === next) {
    return existing;
  }
  const updated = existing.slice();
  updated[index] = next;
  return updated;
}

export function createEmptyBlock(blockType: MessageBlock['type']): MessageBlock {
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
    case 'request_user_input_response':
      return { type: 'request_user_input_response', prompt_id: '' };
    case 'subagent':
      return {
        type: 'subagent',
        subagentId: '',
        taskId: '',
        agentType: '',
        triggerReason: '',
        status: 'unknown',
        summary: '',
        evidenceRefs: [],
        keyFiles: [],
        openRisks: [],
        nextActions: [],
        history: [],
        stats: {
          steps: 0,
          toolCalls: 0,
          tokens: 0,
          elapsedMs: 0,
          outcome: '',
        },
        updatedAtUnixMs: 0,
      };
    default:
      return { type: 'text', content: '' };
  }
}

function createHiddenPlaceholderBlock(): MessageBlock {
  // Preserve sparse stream block indices without rendering fake visible content.
  return { type: 'thinking' };
}

function ensureBlockSlots(
  blocks: MessageBlock[],
  target: number,
  createTargetBlock: () => MessageBlock,
): void {
  ensureGapSlots(blocks, target);
  if (blocks.length === target) {
    blocks.push(createTargetBlock());
  }
}

function ensureGapSlots(blocks: MessageBlock[], target: number): void {
  while (blocks.length < target) {
    blocks.push(createHiddenPlaceholderBlock());
  }
}

export function readBlockContent(block: MessageBlock | undefined): string {
  if (!block) {
    return '';
  }
  switch (block.type) {
    case 'text':
    case 'markdown':
    case 'code':
    case 'svg':
    case 'mermaid':
    case 'thinking':
      return typeof block.content === 'string' ? block.content : '';
    default:
      return '';
  }
}

export function appendDeltaToBlock(block: MessageBlock | undefined, delta: string): MessageBlock {
  const nextContent = `${readBlockContent(block)}${delta}`;
  switch (block?.type) {
    case 'text':
      return { ...block, content: nextContent };
    case 'markdown':
      return { ...block, content: nextContent };
    case 'code':
      return { ...block, content: nextContent };
    case 'svg':
      return { ...block, content: nextContent };
    case 'mermaid':
      return { ...block, content: nextContent };
    case 'thinking':
      return { ...block, content: nextContent };
    default:
      return { type: 'text', content: delta };
  }
}

export function buildUserBlocks(content: string, attachments: Attachment[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  for (const attachment of attachments) {
    if (attachment.type === 'image') {
      blocks.push({
        type: 'image',
        src: attachment.url || attachment.preview || '',
        alt: attachment.file.name,
      });
      continue;
    }
    blocks.push({
      type: 'file',
      name: attachment.file.name,
      size: attachment.file.size,
      mimeType: attachment.file.type,
      url: attachment.url,
    });
  }
  if (content.trim()) {
    blocks.push({ type: 'text', content: content.trim() });
  }
  return blocks;
}

export function applyStreamEventToMessages(
  existing: Message[],
  event: StreamEvent,
  opts?: {
    currentStreamingMessageId?: string | null;
    now?: number;
  },
): AppliedStreamEventResult {
  const currentStreamingMessageId = opts?.currentStreamingMessageId ?? null;
  const now = opts?.now ?? Date.now();
  const nextMessages = existing.slice();

  const ensureStreamingAssistantMessage = (messageId: string, timestamp: number): number => {
    let index = nextMessages.findIndex((message) => message.id === messageId);
    if (index === -1) {
      nextMessages.push({
        id: messageId,
        role: 'assistant',
        blocks: [],
        status: 'streaming',
        timestamp,
      });
      return nextMessages.length - 1;
    }

    const previous = nextMessages[index];
    nextMessages[index] = {
      ...previous,
      role: 'assistant',
      status: 'streaming',
      error: undefined,
    };
    return index;
  };

  switch (event.type) {
    case 'message-start': {
      ensureStreamingAssistantMessage(event.messageId, now);
      return {
        messages: nextMessages,
        streamingMessageId: event.messageId,
        consumeOnePrepId: true,
      };
    }
    case 'block-start': {
      const index = ensureStreamingAssistantMessage(event.messageId, now);
      const message = nextMessages[index];
      const blocks = [...message.blocks];
      const target = Math.max(0, event.blockIndex);
      ensureBlockSlots(blocks, target, () => createEmptyBlock(event.blockType));
      const existingBlock = blocks[target];
      if (existingBlock && existingBlock.type !== event.blockType) {
        blocks[target] = createEmptyBlock(event.blockType);
      }
      nextMessages[index] = { ...message, blocks };
      return {
        messages: nextMessages,
        streamingMessageId: event.messageId,
        consumeOnePrepId: false,
      };
    }
    case 'block-delta': {
      const index = ensureStreamingAssistantMessage(event.messageId, now);
      const message = nextMessages[index];
      const blocks = [...message.blocks];
      const target = Math.max(0, event.blockIndex);
      ensureBlockSlots(blocks, target, () => createEmptyBlock('text'));
      blocks[target] = appendDeltaToBlock(blocks[target], event.delta);
      nextMessages[index] = { ...message, blocks };
      return {
        messages: nextMessages,
        streamingMessageId: event.messageId,
        consumeOnePrepId: false,
      };
    }
    case 'block-set': {
      const index = ensureStreamingAssistantMessage(event.messageId, now);
      const message = nextMessages[index];
      const blocks = [...message.blocks];
      const target = Math.max(0, event.blockIndex);
      ensureGapSlots(blocks, target);
      if (target === blocks.length) {
        blocks.push(event.block);
      } else {
        blocks[target] = event.block;
      }
      nextMessages[index] = { ...message, blocks };
      return {
        messages: nextMessages,
        streamingMessageId: event.messageId,
        consumeOnePrepId: false,
      };
    }
    case 'block-end':
      return {
        messages: existing,
        streamingMessageId: currentStreamingMessageId,
        consumeOnePrepId: false,
      };
    case 'message-end': {
      const index = nextMessages.findIndex((message) => message.id === event.messageId);
      if (index === -1) {
        return {
          messages: existing,
          streamingMessageId: null,
          consumeOnePrepId: false,
        };
      }
      nextMessages[index] = {
        ...nextMessages[index],
        status: 'complete',
      };
      return {
        messages: nextMessages,
        streamingMessageId: null,
        consumeOnePrepId: false,
      };
    }
    case 'error': {
      const index = nextMessages.findIndex((message) => message.id === event.messageId);
      if (index === -1) {
        return {
          messages: existing,
          streamingMessageId: null,
          consumeOnePrepId: false,
        };
      }
      nextMessages[index] = {
        ...nextMessages[index],
        status: 'error',
        error: event.error,
      };
      return {
        messages: nextMessages,
        streamingMessageId: null,
        consumeOnePrepId: false,
      };
    }
    default:
      return {
        messages: existing,
        streamingMessageId: currentStreamingMessageId,
        consumeOnePrepId: false,
      };
  }
}
