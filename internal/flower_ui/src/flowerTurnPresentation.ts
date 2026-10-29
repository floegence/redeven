import { untrack } from 'solid-js';
import { readPresentationValue } from './presentationIdentity';
import type { FlowerRuntimeTurn, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';

export type FlowerTurnDisclosurePolicy = 'none' | 'manual' | 'automatic';

export type FlowerTurnProcess = Readonly<{
  turnID: string;
  turn?: FlowerRuntimeTurn;
  processKeys: readonly string[];
  processMembers: ReadonlySet<string>;
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
  // Turns and activity blocks are replaced atomically by RuntimeThreadRecord.
  // Track structural membership at the caller, without
  // subscribing the projector to every immutable historical property.
  turns = readPresentationValue(turns);
  const facts = new Map(turns.map((turn) => [turn.turn_id, turn]));
  const finalItems = new Map(turns.map(turn => [turn.turn_id, new Set(turn.final_item_ids)]));
  const intermediateItems = new Map(turns.map(turn => [turn.turn_id, new Set(turn.intermediate_item_ids)]));
  const groups = new Map<string, string[]>();
  const rowTurns = new Map<string, string>();
  const eventCounts = new Map<string, number>();
  const terminalKeys = new Map<string, string>();
  const summaryKeys = new Map<string, string>();
  const inputResponses = new Map<string, string[]>();
  const turnBounds = new Map<string, { first: number; last: number }>();
  for (const [index, entry] of entries.entries()) {
    const message = entry.type === 'message' ? readPresentationValue(entry.message) : undefined;
    const live = message?.live;
    const id = entry.type === 'message' ? message!.turn_id : entry.type === 'parent_event' ? entry.event.parent_turn_id : entry.type === 'context_compaction' ? entry.decoration.compaction.turn_id : undefined;
    if (!id) continue;
    const bounds = turnBounds.get(id);
    if (bounds) bounds.last = index;
    else turnBounds.set(id, { first: index, last: index });
    rowTurns.set(entry.key, id);
    // Header placement follows turn order, independently of which rows fold.
    const request = entry.type === 'message' && message!.role === 'user'
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
    const inputResponse = entry.blocks.some((block) => block.type === 'input_response');
    if (inputResponse) {
      const responses = inputResponses.get(id) ?? [];
      responses.push(entry.key);
      inputResponses.set(id, responses);
    }
    terminalKeys.set(id, entry.key);
    const turn = facts.get(id);
    const final = finalItems.get(id)?.has(message!.id);
    const goalProcess = message!.role === 'system' && Boolean(message!.goal)
      && Boolean(turn && message!.run_id);
    const dialogue = message!.role !== 'assistant';
    // Only the canonical owner can classify prose as superseded. Unknown and
    // trailing partial output stay visible regardless of terminal outcome.
    const intermediate = intermediateItems.get(id)?.has(message!.id) && !live;
    const explicitProcess = entry.blocks.length > 0 && entry.blocks.every((block) => block.type === 'activity'
      || block.type === 'content' && block.block_type === 'thinking');
    // Settled question/answer receipts are in-turn work, even though their
    // canonical message uses the user role. The initiating request stays visible.
    if (!final && (inputResponse || goalProcess || !dialogue && (intermediate || explicitProcess))) groups.get(id)!.push(entry.key);
  }
  const positions = new Map(entries.map((entry, index) => [entry.key, index]));
  const projected = new Map([...groups].map(([turnID, processKeys]) => {
    const turn = facts.get(turnID);
    const pending = pendingTurnIDs.includes(turnID);
    const disclosable = Boolean(turn?.outcome && turn.ended_at && turn.kind !== 'context_compaction' && processKeys.length && !pending);
    const responses = new Set(inputResponses.get(turnID) ?? []);
    const processPositions = processKeys.filter(key => !responses.has(key)).map((key) => positions.get(key) ?? -1).filter((position) => position >= 0);
    const firstProcess = Math.min(...processPositions);
    const lastProcess = Math.max(...processPositions);
    const inputResponseCount = [...responses].filter((key) => {
      const position = positions.get(key);
      return position !== undefined && position > firstProcess && position < lastProcess;
    }).length;
    const interleavedInputs = disclosable && inputResponseCount > 0;
    const { first, last } = turnBounds.get(turnID)!;
    const beginning = entries[first];
    const startsWithRequest = beginning?.type === 'message' && readPresentationValue(beginning.message).role === 'user'
      && !beginning.blocks.some(block => block.type === 'input_response');
    const ordinal = (entry: FlowerTimelineEntry | undefined) => entry?.type === 'message' ? readPresentationValue(entry.message).canonical_ordinal
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
        if (block.type !== 'activity') continue;
        const activity = readPresentationValue(block.block);
        if (activity.turn_id !== turnID) continue;
        for (const item of activity.items) {
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
    const next = { turnID, turn, processKeys, processMembers: new Set(processKeys), parentEventCount: eventCounts.get(turnID) ?? 0, interleavedInputs, countsComplete, inputResponseCount,
      toolCallCount, failedCallCount, summaryKey: summaryKeys.get(turnID), terminalKey: terminalKeys.get(turnID), disclosure };
    const prior = previous?.groups.get(turnID);
    return [turnID, prior && prior.turn === turn && prior.disclosure === disclosure
      && prior.parentEventCount === next.parentEventCount && prior.terminalKey === next.terminalKey && prior.summaryKey === next.summaryKey
      && prior.interleavedInputs === interleavedInputs && prior.countsComplete === countsComplete && prior.inputResponseCount === inputResponseCount
      && prior.toolCallCount === toolCallCount && prior.failedCallCount === failedCallCount
      && prior.processKeys.length === processKeys.length && prior.processKeys.every((key, index) => key === processKeys[index]) ? prior : next];
  }));
  const rows = new Map([...rowTurns].map(([key, turnID]) => [key, projected.get(turnID)!]));
  if (previous && projected.size === previous.groups.size && rows.size === previous.rows.size
    && [...projected].every(([key, group]) => previous.groups.get(key) === group)
    && [...rows].every(([key, group]) => previous.rows.get(key) === group)) return previous;
  return { groups: projected, rows };
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

export type FlowerHistorySection = { key: string; threadID: string | undefined; entries: FlowerTimelineEntry[] };

export function projectFlowerHistorySections(entries: readonly FlowerTimelineEntry[], thread: FlowerThreadSnapshot | null | undefined,
  previous: readonly FlowerHistorySection[] = []): FlowerHistorySection[] {
  const threadID = thread?.thread_id;
  const prior = new Map(previous.filter(section => section.threadID === threadID).map(section => [section.key, section]));
  const id = (entry: FlowerTimelineEntry) => entry.type === 'message' ? readPresentationValue(entry.message).turn_id : entry.type === 'parent_event'
    ? entry.event.parent_turn_id : entry.type === 'context_compaction' ? entry.decoration.compaction.turn_id : undefined;
  const priorByEntry = new Map<string, string>();
  for (const section of prior.values()) for (const entry of section.entries) priorByEntry.set(entry.key, section.key);
  const used = new Set<string>();
  const last = new Map<string, number>();
  entries.forEach((entry, index) => { const turn = id(entry); if (turn) last.set(turn, index); });
  const result: { key: string; threadID: string | undefined; entries: FlowerTimelineEntry[] }[] = [];
  for (let first = 0; first < entries.length;) {
    let end = first;
    // Keep every mounted partition through prepend, sealing and navigation.
    // Only the growing active turn introduces new layout boundaries; historical
    // pages retain their established reading owners.
    const current = thread;
    const active = current?.current_execution?.turn_id === id(entries[first])
      && current && ['running', 'waiting_user', 'waiting_approval'].includes(current.status);
    // Discover the reachable turn boundary only until this section closes.
    // Scanning the whole remaining turn before every 24-row partition would
    // revisit the same suffix quadratically as an active turn accumulates.
    for (let i = first; i <= end; i++) {
      end = Math.max(end, last.get(id(entries[i]) ?? '') ?? i);
      if (i === end) continue;
      const candidate = entries[i];
      const owner = priorByEntry.get(candidate.key);
      const nextOwner = priorByEntry.get(entries[i + 1].key);
      if (owner && nextOwner && owner !== nextOwner) { end = i; break; }
      if (!active || i - first < 23 || owner && owner === nextOwner) continue;
      const lastBlock = candidate.type === 'message' ? candidate.blocks.at(-1) : undefined;
      if (lastBlock?.type === 'content' && lastBlock.block_type !== 'thinking'
        && untrack(() => Boolean(lastBlock.content.trim()))) { end = i; break; }
    }
    const entry = entries[first];
    // Keep the first mounted section through admission and history prepend;
    // subsequent chunks retain their own first-row identity as the turn grows.
    const members = entries.slice(first, end + 1);
    const priorKey = members.map(value => priorByEntry.get(value.key)).find(key => key && !used.has(key));
    const key = priorKey ?? JSON.stringify([threadID, entry.key]);
    used.add(key);
    const retained = prior.get(key);
    result.push(retained && retained.entries.length === members.length && members.every((value, index) => value === retained.entries[index])
      ? retained : { key, threadID, entries: members });
    first = end + 1;
  }
  return result;
}
