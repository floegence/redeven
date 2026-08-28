import type {
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

export type FlowerLiveProgressKind = 'waiting' | 'thinking' | 'tool' | 'output';

export type FlowerLiveProgress = Readonly<{
  kind: FlowerLiveProgressKind;
  runID: string;
  identity: string;
  initialWait: boolean;
  text?: string;
  tool?: Readonly<{
    timeline: FlowerActivityTimelineBlock;
    itemIndex: number;
  }>;
}>;

const ACTIVE_TOOL_STATUSES = new Set(['pending', 'running', 'waiting']);

function messageRunID(message: FlowerChatMessage): string {
  return trimString(message.turn_id) || trimString(message.run_id);
}

function progressIdentity(threadID: string, runID: string, itemID: string, kind: FlowerLiveProgressKind): string {
  return [threadID, runID, itemID, kind].join('\x1f');
}

function waitingProgress(thread: FlowerThreadSnapshot, runID: string, itemID: string, initialWait: boolean): FlowerLiveProgress {
  return {
    kind: 'waiting',
    runID,
    identity: progressIdentity(thread.thread_id, runID, itemID || 'initial', 'waiting'),
    initialWait,
  };
}

function latestActiveActivityItem(timeline: FlowerActivityTimelineBlock): Readonly<{ itemIndex: number }> | null {
  for (let itemIndex = timeline.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    if (ACTIVE_TOOL_STATUSES.has(timeline.items[itemIndex].status)) return { itemIndex };
  }
  return null;
}

function hasAssistantEvidence(message: FlowerChatMessage): boolean {
  if (trimString(message.content)) return true;
  return (message.blocks ?? []).some((block) => {
    if (block.type === 'activity-timeline') return block.items.length > 0;
    if (block.type === 'thinking' || block.type === 'markdown' || block.type === 'text') {
      return Boolean(trimString(block.content));
    }
    return true;
  });
}

/**
 * Projects truthful, presentation-only progress from the canonical active turn.
 * It never infers provider phases from thread activity and never persists state.
 */
export function projectFlowerLiveProgress(
  thread: FlowerThreadSnapshot | null | undefined,
): FlowerLiveProgress | null {
  if (!thread || thread.status !== 'running') return null;
  const runID = trimString(thread.active_run_id);
  if (!runID) return null;

  const messages = thread.messages.filter((message) => messageRunID(message) === runID);
  let latestAssistantEvidenceID = '';
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== 'assistant') continue;
    if (!latestAssistantEvidenceID && hasAssistantEvidence(message)) latestAssistantEvidenceID = message.id;
    const blocks = message.blocks ?? [];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (block.type === 'activity-timeline') {
        const latest = latestActiveActivityItem(block);
        if (!latest) continue;
        const item = block.items[latest.itemIndex];
        return {
          kind: 'tool',
          runID,
          identity: progressIdentity(thread.thread_id, runID, item.item_id, 'tool'),
          initialWait: false,
          tool: { timeline: block, itemIndex: latest.itemIndex },
        };
      }
      if (block.type === 'thinking') {
        const text = String(block.content ?? '');
        if (message.live === true && trimString(text)) {
          return {
            kind: 'thinking',
            runID,
            identity: progressIdentity(thread.thread_id, runID, message.id, 'thinking'),
            initialWait: false,
          };
        }
        continue;
      }
      if (block.type === 'markdown' || block.type === 'text') {
        const text = String(block.content ?? '');
        if (message.live === true && trimString(text)) {
          return {
            kind: 'output',
            runID,
            identity: progressIdentity(thread.thread_id, runID, `${message.id}:block:${blockIndex}`, 'output'),
            initialWait: false,
            text,
          };
        }
      }
    }

    const text = String(message.content ?? '');
    if (message.live === true && trimString(text)) {
      return {
        kind: 'output',
        runID,
        identity: progressIdentity(thread.thread_id, runID, message.id, 'output'),
        initialWait: false,
        text,
      };
    }
  }

  return waitingProgress(thread, runID, latestAssistantEvidenceID || 'initial', !latestAssistantEvidenceID);
}
