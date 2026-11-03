import { createMemo, mapArray, type Accessor } from 'solid-js';
import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import { readPresentationValue } from './presentationIdentity';

type ComputerActivity = { item: FlowerActivityItem; runID?: string; turnID?: string };

// Replaced activity blocks own their resource references. Classify each entry
// once; unrelated streaming rows must not rescan every old tool for a viewer.
export function createFlowerComputerActivities(entries: Accessor<readonly FlowerTimelineEntry[]>) {
  const records = mapArray(entries, entry => {
    const candidates: ComputerActivity[] = [];
    if (entry.type !== 'message' && entry.type !== 'queued_turn') return candidates;
    for (const block of entry.blocks) {
      if (block.type !== 'activity') continue;
      const activity = readPresentationValue(block.block);
      for (let index = 0; index < activity.items.length; index++) {
        if (!activity.items[index].target_refs?.some(ref =>
          ref.kind === 'computer_frame' || ref.kind === 'computer_control' || ref.kind === 'computer_target')) continue;
        candidates.push({ item: block.block.items[index], runID: activity.run_id, turnID: activity.turn_id });
      }
    }
    return candidates;
  });
  return createMemo<readonly ComputerActivity[]>((previous = []) => {
    const next = records().flat();
    return previous.length === next.length && next.every((value, index) => value === previous[index]) ? previous : next;
  });
}
