import type { FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';

export type FlowerTurnDisclosurePolicy = 'none' | 'manual' | 'automatic';

export type FlowerTurnProcess = Readonly<{
  turnID: string;
  turn?: FlowerRuntimeTurn;
  processKeys: readonly string[];
  parentEventCount: number;
  summaryKey?: string;
  terminalKey?: string;
  disclosure: FlowerTurnDisclosurePolicy;
}>;

export type FlowerTurnProcessProjection = Readonly<{
  groups: ReadonlyMap<string, FlowerTurnProcess>;
  rows: ReadonlyMap<string, FlowerTurnProcess>;
}>;

export function projectFlowerTurnProcess(entries: readonly FlowerTimelineEntry[], turns: readonly FlowerRuntimeTurn[] = [], pendingTurnIDs: readonly string[] = []): FlowerTurnProcessProjection {
  const facts = new Map(turns.map((turn) => [turn.turn_id, turn]));
  const latestTurnID = turns.filter((turn) => turn.kind !== 'context_compaction').at(-1)?.turn_id;
  const groups = new Map<string, string[]>();
  const rowTurns = new Map<string, string>();
  const eventCounts = new Map<string, number>();
  const terminalKeys = new Map<string, string>();
  for (const entry of entries) {
    const id = entry.type === 'message' ? entry.message.turn_id : entry.type === 'parent_event' ? entry.event.parent_turn_id : entry.type === 'context_compaction' ? entry.decoration.compaction.turn_id : undefined;
    if (!id) continue;
    rowTurns.set(entry.key, id);
    if (!groups.has(id)) groups.set(id, []);
    if (entry.type === 'parent_event') {
      const event = entry.event;
      const unresolved = !event.resolved && (event.interaction_id || event.kind === 'input_required' || event.kind === 'approval_required');
      if (!unresolved && event.reason_code !== 'effect_outcome_unknown') {
        groups.get(id)!.push(entry.key);
        eventCounts.set(id, (eventCounts.get(id) ?? 0) + 1);
      }
      continue;
    }
    if (entry.type === 'context_compaction') {
      groups.get(id)!.push(entry.key);
      continue;
    }
    if (entry.type !== 'message') continue;
    terminalKeys.set(id, entry.key);
    const turn = facts.get(id);
    const final = turn?.final_item_ids.includes(entry.message.id);
    const goalProcess = entry.message.role === 'system' && Boolean(entry.message.goal)
      && Boolean(turn && turn.run_id === entry.message.run_id);
    const dialogue = entry.message.role !== 'assistant' || entry.blocks.some((block) => block.type === 'input_response');
    // Only the canonical owner can classify prose as superseded. Unknown and
    // trailing partial output stay visible regardless of terminal outcome.
    const intermediate = turn?.run_id === entry.message.run_id
      && turn?.intermediate_item_ids?.includes(entry.message.id) && !entry.message.live;
    const explicitProcess = entry.blocks.length > 0 && entry.blocks.every((block) => block.type === 'activity'
      || block.type === 'content' && block.block_type === 'thinking');
    if (!final && (goalProcess || !dialogue && (intermediate || explicitProcess))) groups.get(id)!.push(entry.key);
  }
  const projected = new Map([...groups].map(([turnID, processKeys]) => {
    const turn = facts.get(turnID);
    const pending = pendingTurnIDs.includes(turnID);
    const disclosable = Boolean(turn?.outcome && turn.ended_at && turn.kind !== 'context_compaction' && processKeys.length && !pending);
    const disclosure: FlowerTurnDisclosurePolicy = !disclosable ? 'none'
      : turnID === latestTurnID && turn?.outcome !== 'completed' ? 'manual' : 'automatic';
    return [turnID, { turnID, turn, processKeys, parentEventCount: eventCounts.get(turnID) ?? 0, summaryKey: processKeys[0], terminalKey: terminalKeys.get(turnID), disclosure }];
  }));
  return { groups: projected, rows: new Map([...rowTurns].map(([key, turnID]) => [key, projected.get(turnID)!])) };
}

export type FlowerDurationPart = Readonly<{ unit: 'hour' | 'minute' | 'second'; count: number }>;
export function flowerDurationParts(milliseconds: number): readonly FlowerDurationPart[] {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return ([
    { unit: 'hour', count: Math.floor(seconds / 3600) },
    { unit: 'minute', count: Math.floor(seconds / 60) % 60 },
    { unit: 'second', count: seconds % 60 },
  ] as const).filter((part) => part.count > 0).slice(0, 2);
}
