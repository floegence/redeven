import type {
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerModelIOPhase,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { presentFlowerActivityItem } from './flowerActivityPresentation';
import { trimString } from './flowerSurfaceModel';

export type FlowerCompanionProgressKind = 'status' | 'tool' | 'output';

export type FlowerCompanionLiveTail = Readonly<{
  kind: FlowerCompanionProgressKind;
  text: string;
  identity: string;
}>;

type ModelStatusLabel = (phase: FlowerModelIOPhase) => string;
const FLOWER_COMPANION_LIVE_TAIL_MAX_CHARACTERS = 320;

function singleLine(value: string | null | undefined): string {
  return trimString(value).replace(/\s+/g, ' ');
}

function singleLineTail(value: string | null | undefined): string {
  const characters = Array.from(singleLine(value));
  return characters.length > FLOWER_COMPANION_LIVE_TAIL_MAX_CHARACTERS
    ? characters.slice(-FLOWER_COMPANION_LIVE_TAIL_MAX_CHARACTERS).join('')
    : characters.join('');
}

function singleLineHead(value: string | null | undefined): string {
  return Array.from(singleLine(value)).slice(0, FLOWER_COMPANION_LIVE_TAIL_MAX_CHARACTERS).join('');
}

function belongsToActiveRun(message: FlowerChatMessage, activeRunID: string): boolean {
  const messageRunID = trimString(message.run_id);
  return messageRunID !== '' && messageRunID === activeRunID;
}

function latestToolLabel(block: FlowerActivityTimelineBlock): Readonly<{ itemID: string; text: string }> | null {
  for (let index = block.items.length - 1; index >= 0; index -= 1) {
    const item = block.items[index];
    const label = singleLineHead(presentFlowerActivityItem(item, block.file_actions).label);
    if (label) return { itemID: item.item_id, text: label };
  }
  return null;
}

function liveTailIdentity(
  threadID: string,
  runID: string,
  messageID: string,
  blockIdentity: string,
): string {
  return [threadID, runID, messageID, blockIdentity].join('\x1f');
}

function activeRunTail(thread: FlowerThreadSnapshot): FlowerCompanionLiveTail | null {
  const activeRunID = trimString(thread.active_run_id);
  if (!activeRunID) return null;

  for (let messageIndex = thread.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = thread.messages[messageIndex];
    if (message.role !== 'assistant' || !belongsToActiveRun(message, activeRunID)) continue;

    const blocks = message.blocks ?? [];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (block.type === 'thinking') return null;
      if (block.type === 'markdown' || block.type === 'text') {
        const text = singleLineTail(block.content);
        return text ? {
          kind: 'output',
          text,
          identity: liveTailIdentity(thread.thread_id, activeRunID, message.id, `block:${blockIndex}`),
        } : null;
      }
      if (block.type === 'activity-timeline') {
        const tool = latestToolLabel(block);
        return tool ? {
          kind: 'tool',
          text: tool.text,
          identity: liveTailIdentity(thread.thread_id, activeRunID, message.id, `block:${blockIndex}:item:${tool.itemID}`),
        } : null;
      }
    }

    const text = singleLineTail(message.content);
    return text ? {
      kind: 'output',
      text,
      identity: liveTailIdentity(thread.thread_id, activeRunID, message.id, 'content'),
    } : null;
  }
  return null;
}

export function projectFlowerCompanionLiveTail(
  thread: FlowerThreadSnapshot,
  modelStatusLabel: ModelStatusLabel,
): FlowerCompanionLiveTail | null {
  if (thread.status !== 'running') return null;

  const activeRunID = trimString(thread.active_run_id);
  const candidateModelStatus = thread.model_io_status ?? null;
  const modelStatus = candidateModelStatus && trimString(candidateModelStatus.run_id) === activeRunID
    ? candidateModelStatus
    : null;
  if (modelStatus && (
    modelStatus.phase === 'preparing'
    || modelStatus.phase === 'waiting_response'
    || modelStatus.phase === 'retrying'
  )) {
    return {
      kind: 'status',
      text: modelStatusLabel(modelStatus.phase),
      identity: liveTailIdentity(thread.thread_id, activeRunID, 'model-status', modelStatus.phase),
    };
  }

  const tail = activeRunTail(thread);
  if (tail) return tail;

  const fallbackPhase = modelStatus?.phase ?? 'waiting_response';
  return {
    kind: 'status',
    text: modelStatusLabel(fallbackPhase),
    identity: liveTailIdentity(thread.thread_id, activeRunID, 'model-status', fallbackPhase),
  };
}
