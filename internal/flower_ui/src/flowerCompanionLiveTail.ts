import type {
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { presentFlowerActivityItem } from './flowerActivityPresentation';
import { flowerRunProgress } from './flowerLiveProgress';
import type { FlowerLiveProgressKind } from './flowerLiveProgress';
import { trimString } from './flowerSurfaceModel';

export type FlowerCompanionProgressKind = 'status' | 'tool' | 'output' | 'error';

export type FlowerCompanionLiveTail = Readonly<{
  kind: FlowerCompanionProgressKind;
  text: string;
  identity: string;
}>;

type LiveProgressLabel = (kind: FlowerLiveProgressKind) => string;
const FLOWER_COMPANION_LIVE_TAIL_MAX_CHARACTERS = 320;
const ACTIVE_TOOL_STATUSES = new Set(['pending', 'running', 'waiting']);

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

function activeTool(timeline: FlowerActivityTimelineBlock): number {
  for (let index = timeline.items.length - 1; index >= 0; index -= 1) {
    if (ACTIVE_TOOL_STATUSES.has(timeline.items[index].status)) return index;
  }
  return -1;
}

function liveOutput(message: FlowerChatMessage): Readonly<{ text: string; key: string }> | null {
  if (message.live !== true) return null;
  for (let index = (message.blocks?.length ?? 0) - 1; index >= 0; index -= 1) {
    const block = message.blocks?.[index];
    if (block?.type === 'markdown' || block?.type === 'text') {
      const text = singleLineTail(block.content);
      if (text) return { text, key: `block:${index}` };
    }
  }
  const text = singleLineTail(message.content);
  return text ? { text, key: 'content' } : null;
}

export function projectFlowerCompanionLiveTail(
  thread: FlowerThreadSnapshot,
  liveProgressLabel: LiveProgressLabel,
): FlowerCompanionLiveTail | null {
  const progress = flowerRunProgress(thread);
  if (!progress) return null;
  const messages = thread.messages.filter((message) => trimString(message.turn_id) === progress.turnID);
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== 'assistant') continue;
    for (let blockIndex = (message.blocks?.length ?? 0) - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.blocks?.[blockIndex];
      if (block?.type !== 'activity-timeline') continue;
      const itemIndex = activeTool(block);
      if (itemIndex < 0) continue;
      const item = block.items[itemIndex];
      const text = singleLineHead(presentFlowerActivityItem(item, block.file_actions).label);
      if (text) return { kind: 'tool', text, identity: [progress.identity, 'tool', item.item_id].join('\x1f') };
    }
    const output = liveOutput(message);
    if (output) return {
      kind: 'output',
      text: output.text,
      identity: [progress.identity, 'output', message.id, output.key].join('\x1f'),
    };
  }
  return {
    kind: 'status',
    text: liveProgressLabel(progress.kind),
    identity: progress.identity,
  };
}
