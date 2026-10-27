import type { FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';

export type FlowerTurnDisclosurePolicy = 'none' | 'manual' | 'automatic';

export type FlowerTurnProcess = Readonly<{
  turnID: string;
  turn?: FlowerRuntimeTurn;
  processKeys: readonly string[];
  parentEventCount: number;
  interleavedInputs: boolean;
  countsComplete: boolean;
  inputResponseCount: number;
  toolCallCount: number;
  failedCallCount: number;
  summaryKey?: string;
  terminalKey?: string;
  disclosure: FlowerTurnDisclosurePolicy;
}>;

export type FlowerTurnProcessProjection = Readonly<{
  groups: ReadonlyMap<string, FlowerTurnProcess>;
  rows: ReadonlyMap<string, FlowerTurnProcess>;
}>;

export function projectFlowerTurnProcess(entries: readonly FlowerTimelineEntry[], turns: readonly FlowerRuntimeTurn[] = [], pendingTurnIDs: readonly string[] = [], previous?: FlowerTurnProcessProjection,
  coverage: Readonly<{ hasBefore: boolean; hasAfter: boolean; readingBreaks?: ReadonlySet<string>; missingEvents?: readonly Readonly<{ after: number; before: number }>[] }> = { hasBefore: false, hasAfter: false }): FlowerTurnProcessProjection {
  const facts = new Map(turns.map((turn) => [turn.turn_id, turn]));
  const groups = new Map<string, string[]>();
  const rowTurns = new Map<string, string>();
  const eventCounts = new Map<string, number>();
  const terminalKeys = new Map<string, string>();
  const summaryKeys = new Map<string, string>();
  const inputResponses = new Map<string, string[]>();
  const turnBounds = new Map<string, { first: number; last: number }>();
  for (const [index, entry] of entries.entries()) {
    const id = entry.type === 'message' ? entry.message.turn_id : entry.type === 'parent_event' ? entry.event.parent_turn_id : entry.type === 'context_compaction' ? entry.decoration.compaction.turn_id : undefined;
    if (!id) continue;
    const bounds = turnBounds.get(id);
    if (bounds) bounds.last = index;
    else turnBounds.set(id, { first: index, last: index });
    rowTurns.set(entry.key, id);
    // Header placement follows turn order, independently of which rows fold.
    const request = entry.type === 'message' && entry.message.role === 'user'
      && !entry.blocks.some(block => block.type === 'input_response');
    if (!request && !summaryKeys.has(id)) summaryKeys.set(id, entry.key);
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
    // A turn can continue in a new run after the user answers an interaction.
    // The response still belongs to the same canonical turn even when its
    // message retains the earlier run identity.
    if (entry.blocks.some((block) => block.type === 'input_response')) {
      const responses = inputResponses.get(id) ?? [];
      responses.push(entry.key);
      inputResponses.set(id, responses);
    }
    terminalKeys.set(id, entry.key);
    const turn = facts.get(id);
    const final = turn?.final_item_ids.includes(entry.message.id);
    const goalProcess = entry.message.role === 'system' && Boolean(entry.message.goal)
      && Boolean(turn && entry.message.run_id);
    const dialogue = entry.message.role !== 'assistant' || entry.blocks.some((block) => block.type === 'input_response');
    // Only the canonical owner can classify prose as superseded. Unknown and
    // trailing partial output stay visible regardless of terminal outcome.
    const intermediate = turn?.intermediate_item_ids?.includes(entry.message.id) && !entry.message.live;
    const explicitProcess = entry.blocks.length > 0 && entry.blocks.every((block) => block.type === 'activity'
      || block.type === 'content' && block.block_type === 'thinking');
    if (!final && (goalProcess || !dialogue && (intermediate || explicitProcess))) groups.get(id)!.push(entry.key);
  }
  const positions = new Map(entries.map((entry, index) => [entry.key, index]));
  const projected = new Map([...groups].map(([turnID, processKeys]) => {
    const turn = facts.get(turnID);
    const pending = pendingTurnIDs.includes(turnID);
    const disclosable = Boolean(turn?.outcome && turn.ended_at && turn.kind !== 'context_compaction' && processKeys.length && !pending);
    const processPositions = processKeys.map((key) => positions.get(key) ?? -1).filter((position) => position >= 0);
    const firstProcess = Math.min(...processPositions);
    const lastProcess = Math.max(...processPositions);
    const inputResponseCount = (inputResponses.get(turnID) ?? []).filter((key) => {
      const position = positions.get(key);
      return position !== undefined && position > firstProcess && position < lastProcess;
    }).length;
    const interleavedInputs = disclosable && inputResponseCount > 0;
    const { first, last } = turnBounds.get(turnID)!;
    const beginning = entries[first];
    const startsWithRequest = beginning?.type === 'message' && beginning.message.role === 'user'
      && !beginning.blocks.some(block => block.type === 'input_response');
    const ordinal = (entry: FlowerTimelineEntry | undefined) => entry?.type === 'message' ? entry.message.canonical_ordinal
      : entry?.type === 'parent_event' ? entry.event.canonical_ordinal
        : entry?.type === 'context_compaction' ? entry.decoration.compaction.canonical_ordinal : undefined;
    const lower = first > 0 ? ordinal(entries[first - 1]) : -Infinity;
    const upper = last + 1 < entries.length ? ordinal(entries[last + 1]) : Infinity;
    const countsComplete = (startsWithRequest || (first > 0 ? !coverage.readingBreaks?.has(entries[first].key) : !coverage.hasBefore))
      && (last < entries.length - 1 ? !coverage.readingBreaks?.has(entries[last + 1].key) : !coverage.hasAfter)
      && !entries.slice(first + 1, last + 1).some(entry => coverage.readingBreaks?.has(entry.key))
      && !coverage.missingEvents?.some(gap => lower === undefined || upper === undefined || lower < gap.before && upper > gap.after);
    let toolCallCount = 0;
    let failedCallCount = 0;
    for (const key of processKeys) {
      const entry = entries[positions.get(key) ?? -1];
      if (entry?.type !== 'message') continue;
      for (const block of entry.blocks) {
        if (block.type !== 'activity' || block.block.turn_id !== turnID) continue;
        for (const item of block.block.items) {
          if (item.kind !== 'tool' && item.kind !== 'hosted_tool') continue;
          toolCallCount += 1;
          if (item.status === 'error') failedCallCount += 1;
        }
      }
    }
    // A single thinking row already has its own stable disclosure and timing.
    // Wrapping it in another summary adds height without adding navigation.
    const onlyProcess = processKeys.length === 1 ? entries[positions.get(processKeys[0]) ?? -1] : undefined;
    const thinkingOnly = onlyProcess?.type === 'message' && onlyProcess.blocks.length === 1
      && onlyProcess.blocks[0].type === 'content' && onlyProcess.blocks[0].block_type === 'thinking';
    const disclosure: FlowerTurnDisclosurePolicy = !disclosable || thinkingOnly ? 'none' : interleavedInputs ? 'manual' : 'automatic';
    const next = { turnID, turn, processKeys, parentEventCount: eventCounts.get(turnID) ?? 0, interleavedInputs, countsComplete, inputResponseCount,
      toolCallCount, failedCallCount, summaryKey: summaryKeys.get(turnID), terminalKey: terminalKeys.get(turnID), disclosure };
    const prior = previous?.groups.get(turnID);
    return [turnID, prior && prior.turn === turn && prior.disclosure === disclosure
      && prior.parentEventCount === next.parentEventCount && prior.terminalKey === next.terminalKey && prior.summaryKey === next.summaryKey
      && prior.interleavedInputs === interleavedInputs && prior.countsComplete === countsComplete && prior.inputResponseCount === inputResponseCount
      && prior.toolCallCount === toolCallCount && prior.failedCallCount === failedCallCount
      && prior.processKeys.length === processKeys.length && prior.processKeys.every((key, index) => key === processKeys[index]) ? prior : next];
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
