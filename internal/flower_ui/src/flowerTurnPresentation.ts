import type { FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';

export type FlowerTurnProcess = Readonly<{
  turnID: string;
  turn?: FlowerRuntimeTurn;
  processKeys: readonly string[];
  summaryKey?: string;
  terminalKey?: string;
  eligible: boolean;
}>;

export function projectFlowerTurnProcess(entries: readonly FlowerTimelineEntry[], turns: readonly FlowerRuntimeTurn[] = [], pendingTurnIDs: readonly string[] = []): ReadonlyMap<string, FlowerTurnProcess> {
  const facts = new Map(turns.map((turn) => [turn.turn_id, turn]));
  const messages = new Map(entries.flatMap((entry) => entry.type === 'message' ? [[entry.message.id, entry] as const] : []));
  const groups = new Map<string, string[]>();
  const terminalKeys = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message.turn_id) continue;
    const id = entry.message.turn_id;
    terminalKeys.set(id, entry.key);
    if (!groups.has(id)) groups.set(id, []);
    const final = facts.get(id)?.final_item_ids.includes(entry.message.id);
    const dialogue = entry.message.role !== 'assistant' || entry.blocks.some((block) => block.type === 'input_response');
    if (!final && !dialogue) groups.get(id)!.push(entry.key);
  }
  return new Map([...groups].map(([turnID, processKeys]) => {
    const turn = facts.get(turnID);
    const finalsPresent = turn?.final_item_ids.length && turn.final_item_ids.every((id) => {
      const item = messages.get(id)?.message;
      return item?.role === 'assistant' && item.turn_id === turnID && item.run_id === turn.run_id;
    });
    const pending = pendingTurnIDs.includes(turnID);
    const eligible = Boolean(turn?.outcome === 'completed' && turn.ended_at && !turn.kind
      && turn.final_boundary_complete && finalsPresent && processKeys.length && !pending);
    return [turnID, { turnID, turn, processKeys, summaryKey: processKeys[0], terminalKey: terminalKeys.get(turnID), eligible }];
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
