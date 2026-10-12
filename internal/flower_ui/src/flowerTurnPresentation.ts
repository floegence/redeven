import type { FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';

export type FlowerTurnDisclosurePolicy = 'none' | 'manual' | 'automatic';

export type FlowerTurnProcess = Readonly<{
  turnID: string;
  turn?: FlowerRuntimeTurn;
  processKeys: readonly string[];
  summaryKey?: string;
  terminalKey?: string;
  disclosure: FlowerTurnDisclosurePolicy;
}>;

export function projectFlowerTurnProcess(entries: readonly FlowerTimelineEntry[], turns: readonly FlowerRuntimeTurn[] = [], pendingTurnIDs: readonly string[] = []): ReadonlyMap<string, FlowerTurnProcess> {
  const facts = new Map(turns.map((turn) => [turn.turn_id, turn]));
  const messages = new Map(entries.flatMap((entry) => entry.type === 'message' ? [[entry.message.id, entry] as const] : []));
  const completeBoundaries = new Set(turns.filter((turn) => turn.outcome === 'completed'
    && turn.final_boundary_complete && turn.final_item_ids.length > 0 && turn.final_item_ids.every((id) => {
      const item = messages.get(id)?.message;
      return item?.role === 'assistant' && item.turn_id === turn.turn_id && item.run_id === turn.run_id;
    })).map((turn) => turn.turn_id));
  const groups = new Map<string, string[]>();
  const terminalKeys = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message.turn_id) continue;
    const id = entry.message.turn_id;
    terminalKeys.set(id, entry.key);
    if (!groups.has(id)) groups.set(id, []);
    const final = facts.get(id)?.final_item_ids.includes(entry.message.id);
    const dialogue = entry.message.role !== 'assistant' || entry.blocks.some((block) => block.type === 'input_response');
    // Without an exact final boundary, assistant prose may contain a conclusion.
    // Only exclusively typed process blocks are safe to hide by manual choice.
    const explicitProcess = entry.blocks.length > 0 && entry.blocks.every((block) => block.type === 'activity'
      || block.type === 'content' && block.block_type === 'thinking');
    if (!final && !dialogue && (completeBoundaries.has(id) || explicitProcess)) groups.get(id)!.push(entry.key);
  }
  return new Map([...groups].map(([turnID, processKeys]) => {
    const turn = facts.get(turnID);
    const pending = pendingTurnIDs.includes(turnID);
    const disclosable = Boolean(turn?.outcome && turn.ended_at && !turn.kind && processKeys.length && !pending);
    const disclosure: FlowerTurnDisclosurePolicy = !disclosable ? 'none' : completeBoundaries.has(turnID) ? 'automatic' : 'manual';
    return [turnID, { turnID, turn, processKeys, summaryKey: processKeys[0], terminalKey: terminalKeys.get(turnID), disclosure }];
  }));
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
