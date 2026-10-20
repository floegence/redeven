import type {
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { presentFlowerActivityItem } from './flowerActivityPresentation';
import { flowerRunProgress } from './flowerLiveProgress';
import type { FlowerLiveProgress, FlowerLiveProgressKind } from './flowerLiveProgress';
import { trimString } from './flowerSurfaceModel';

export type FlowerCompanionProgressKind = 'status' | 'tool' | 'output' | 'error';

export type FlowerCompanionLiveTail = Readonly<{
  kind: FlowerCompanionProgressKind;
  text: string;
  identity: string;
}>;

type LiveProgressLabel = (kind: FlowerLiveProgressKind, retry?: FlowerLiveProgress['retry']) => string;
const FLOWER_COMPANION_LIVE_TAIL_MAX_CHARACTERS = 320;
const ACTIVE_TOOL_STATUSES = new Set(['pending', 'running', 'waiting']);

function singleLine(value: string | null | undefined): string {
  return trimString(value).replace(/\s+/g, ' ');
}

function singleLineTail(value: string | null | undefined): string {
  if (!value) return '';
  const characters: string[] = [];
  let whitespace = false;
  for (let index = value.length; index > 0 && characters.length < FLOWER_COMPANION_LIVE_TAIL_MAX_CHARACTERS;) {
    let start = index - 1;
    const unit = value.charCodeAt(start);
    if (unit >= 0xdc00 && unit <= 0xdfff && start > 0) {
      const previous = value.charCodeAt(start - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) start -= 1;
    }
    const character = value.slice(start, index);
    index = start;
    if (/\s/u.test(character)) {
      whitespace = characters.length > 0;
      continue;
    }
    if (whitespace) {
      characters.push(' ');
      whitespace = false;
      if (characters.length === FLOWER_COMPANION_LIVE_TAIL_MAX_CHARACTERS) break;
    }
    characters.push(character);
  }
  return characters.reverse().join('');
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
  if (progress.kind === 'retrying') return { kind: 'status', text: liveProgressLabel(progress.kind, progress.retry), identity: progress.identity };
  const messages = thread.messages;
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (trimString(message.turn_id) !== progress.turnID) continue;
    if (message.role !== 'assistant') continue;
    for (let blockIndex = (message.blocks?.length ?? 0) - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.blocks?.[blockIndex];
      if (block?.type !== 'activity-timeline') continue;
      const itemIndex = activeTool(block);
      if (itemIndex < 0) continue;
      const item = block.items[itemIndex];
      const text = singleLineHead(presentFlowerActivityItem(item).label);
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
    text: liveProgressLabel(progress.kind, progress.retry),
    identity: progress.identity,
  };
}
