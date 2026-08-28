import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { presentFlowerActivityItem } from './flowerActivityPresentation';
import { projectFlowerLiveProgress } from './flowerLiveProgress';
import type { FlowerLiveProgressKind as ProjectedProgressKind } from './flowerLiveProgress';
import { trimString } from './flowerSurfaceModel';

export type FlowerCompanionProgressKind = 'status' | 'tool' | 'output' | 'error';

export type FlowerCompanionLiveTail = Readonly<{
  kind: FlowerCompanionProgressKind;
  text: string;
  identity: string;
}>;

type LiveProgressLabel = (kind: ProjectedProgressKind) => string;
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

export function projectFlowerCompanionLiveTail(
  thread: FlowerThreadSnapshot,
  liveProgressLabel: LiveProgressLabel,
): FlowerCompanionLiveTail | null {
  const progress = projectFlowerLiveProgress(thread);
  if (!progress) return null;
  if (progress.kind === 'output') {
    const text = singleLineTail(progress.text);
    return text ? { kind: 'output', text, identity: progress.identity } : null;
  }
  if (progress.kind === 'tool' && progress.tool) {
    const { timeline, itemIndex } = progress.tool;
    const item = timeline.items[itemIndex];
    const text = singleLineHead(presentFlowerActivityItem(item, timeline.file_actions).label);
    if (text) return { kind: 'tool', text, identity: progress.identity };
  }
  if (progress.kind === 'waiting' || progress.kind === 'thinking' || progress.kind === 'tool') {
    return {
      kind: 'status',
      text: liveProgressLabel(progress.kind),
      identity: progress.identity,
    };
  }
  return null;
}
