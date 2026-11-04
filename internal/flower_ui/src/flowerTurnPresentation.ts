import { isPresentedToolFailure } from './computerActivityOutcome';
import { untrack } from 'solid-js';
import { readPresentationValue } from './presentationIdentity';
import type { FlowerActivityTimelineBlock, FlowerRuntimeTurn, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
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

// Activity blocks are immutable runtime facts. Keep their scalar summary with
// that source identity; live status replacements get a new block and recount.
const activityCounts = new WeakMap<FlowerActivityTimelineBlock, { tools: number; failed: number }>();
function countActivity(activity: FlowerActivityTimelineBlock) {
  let counts = activityCounts.get(activity);
  if (!counts) {
    counts = { tools: 0, failed: 0 };
    for (const item of activity.items) {
      if (item.kind !== 'tool' && item.kind !== 'hosted_tool') continue;
      counts.tools++;
      if (isPresentedToolFailure(item)) counts.failed++;
    }
    activityCounts.set(activity, counts);
  }
  return counts;
}

type ProcessRowFacts = Readonly<{ turnID?: string; message?: Extract<FlowerTimelineEntry, { type: 'message' }>['message'];
  process: boolean; inputResponse: boolean; parentEventCount: number; tools: number; failed: number; thinkingOnly: boolean }>;
const processRowFacts = new WeakMap<FlowerTimelineEntry, ProcessRowFacts>();
function classifyProcessRow(entry: FlowerTimelineEntry): ProcessRowFacts {
  const retained = processRowFacts.get(entry);
  if (retained) return retained;
  const message = entry.type === 'message' ? readPresentationValue(entry.message) : undefined;
  const turnID = entry.type === 'message' ? message!.turn_id : entry.type === 'parent_event' ? entry.event.parent_turn_id
    : entry.type === 'context_compaction' ? entry.decoration.compaction.turn_id : undefined;
  let process = false, inputResponse = false, parentEventCount = 0, tools = 0, failed = 0, thinkingOnly = false;
  if (entry.type === 'parent_event') {
    const event = entry.event;
    const unresolved = !event.resolved && (event.interaction_id || event.kind === 'input_required' || event.kind === 'approval_required');
    process = !unresolved && event.reason_code !== 'effect_outcome_unknown';
    parentEventCount = process ? 1 : 0;
  } else if (entry.type === 'context_compaction') process = true;
  else if (entry.type === 'message') {
    const blocks = entry.blocks;
    inputResponse = blocks.some(block => block.type === 'input_response');
    process = blocks.length > 0 && blocks.every(block => block.type === 'activity' || block.type === 'content' && block.block_type === 'thinking');
    thinkingOnly = blocks.length === 1 && blocks[0].type === 'content' && blocks[0].block_type === 'thinking';
    for (const block of blocks) {
      if (block.type !== 'activity') continue;
      const activity = readPresentationValue(block.block);
      if (activity.turn_id !== turnID) continue;
      const counts = countActivity(activity);
      tools += counts.tools; failed += counts.failed;
    }
  }
  const value = { turnID, message, process, inputResponse, parentEventCount, tools, failed, thinkingOnly };
  processRowFacts.set(entry, value);
  return value;
}

export function projectFlowerTurnProcess(entries: readonly FlowerTimelineEntry[], turns: readonly FlowerRuntimeTurn[] = [], pendingTurnIDs: readonly string[] = [], previous?: FlowerTurnProcessProjection,
  coverage: Readonly<{ hasBefore: boolean; hasAfter: boolean; readingBreaks?: ReadonlySet<string>; missingEvents?: readonly Readonly<{ after: number; before: number }>[] }> = { hasBefore: false, hasAfter: false }): FlowerTurnProcessProjection {
  // Turns and activity blocks are replaced atomically by RuntimeThreadRecord.
  // Track structural membership at the caller, without
  // subscribing the projector to every immutable historical property.
  turns = readPresentationValue(turns);
  const facts = new Map<string, { turn: FlowerRuntimeTurn; final: Set<string>; intermediate: Set<string> }>();
  for (const turn of turns) facts.set(turn.turn_id, { turn, final: new Set(turn.final_item_ids), intermediate: new Set(turn.intermediate_item_ids) });
  type WorkingTurn = {
    first: number; last: number; firstBreak: number; lastBreak: number;
    processKeys: string[]; responses: number[]; firstProcess: number; lastProcess: number;
    toolCallCount: number; failedCallCount: number; parentEventCount: number;
    summaryKey: string; terminalKey?: string; onlyProcess?: FlowerTimelineEntry;
  };
  const groups = new Map<string, WorkingTurn>();
  const rowTurns = new Map<string, string>();
  let breaks = 0;
  // Classify and count each row in one traversal. A growing turn must not
  // rebuild parallel position, membership and count indexes on every frame.
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (coverage.readingBreaks?.has(entry.key)) breaks++;
    const row = classifyProcessRow(entry);
    const { message, turnID: id, inputResponse } = row;
    if (!id) continue;
    let group = groups.get(id);
    if (!group) {
      group = { first: index, last: index, firstBreak: breaks, lastBreak: breaks, processKeys: [], responses: [],
        firstProcess: Infinity, lastProcess: -Infinity, toolCallCount: 0, failedCallCount: 0, parentEventCount: 0, summaryKey: entry.key };
      groups.set(id, group);
    }
    group.last = index;
    group.lastBreak = breaks;
    rowTurns.set(entry.key, id);
    let process = row.process;
    group.parentEventCount += row.parentEventCount;
    if (entry.type === 'message') {
      // Interaction responses remain in their canonical turn across runs.
      if (inputResponse) group.responses.push(index);
      group.terminalKey = entry.key;
      const fact = facts.get(id);
      const final = fact?.final.has(message!.id);
      const goalProcess = message!.role === 'system' && Boolean(message!.goal) && Boolean(fact && message!.run_id);
      const intermediate = fact?.intermediate.has(message!.id) && !message!.live;
      // Unknown and trailing partial output stay visible. Only canonical turn
      // facts classify prose as superseded; settled responses are process work.
      process = !final && (inputResponse || goalProcess || message!.role === 'assistant' && Boolean(intermediate || row.process));
      if (process) { group.toolCallCount += row.tools; group.failedCallCount += row.failed; }
    }
    if (process) {
      group.processKeys.push(entry.key);
      group.onlyProcess = entry;
      if (!inputResponse) {
        if (group.firstProcess === Infinity) group.firstProcess = index;
        group.lastProcess = index;
      }
    }
  }
  const projected = new Map<string, FlowerTurnProcess>();
  const pending = new Set(pendingTurnIDs);
  const ordinal = (entry: FlowerTimelineEntry | undefined) => entry?.type === 'message' ? readPresentationValue(entry.message).canonical_ordinal
    : entry?.type === 'parent_event' ? entry.event.canonical_ordinal
      : entry?.type === 'context_compaction' ? entry.decoration.compaction.canonical_ordinal : undefined;
  for (const [turnID, group] of groups) {
    const { processKeys, first, last, toolCallCount, failedCallCount, parentEventCount, summaryKey, terminalKey } = group;
    const turn = facts.get(turnID)?.turn;
    const disclosable = Boolean(turn?.outcome && turn.ended_at && turn.kind !== 'context_compaction' && processKeys.length && !pending.has(turnID));
    let inputResponseCount = 0;
    for (const position of group.responses) if (position > group.firstProcess && position < group.lastProcess) inputResponseCount++;
    const interleavedInputs = disclosable && inputResponseCount > 0;
    const beginning = entries[first];
    const startsWithRequest = beginning.type === 'message' && readPresentationValue(beginning.message).role === 'user'
      && !classifyProcessRow(beginning).inputResponse;
    const lower = first > 0 ? ordinal(entries[first - 1]) : -Infinity;
    const upper = last + 1 < entries.length ? ordinal(entries[last + 1]) : Infinity;
    const countsComplete = (startsWithRequest || (first > 0 ? !coverage.readingBreaks?.has(entries[first].key) : !coverage.hasBefore))
      && (last < entries.length - 1 ? !coverage.readingBreaks?.has(entries[last + 1].key) : !coverage.hasAfter)
      && group.firstBreak === group.lastBreak
      && !coverage.missingEvents?.some(gap => lower === undefined || upper === undefined || lower < gap.before && upper > gap.after);
    // A lone thinking row already owns its disclosure and timing.
    const onlyProcess = processKeys.length === 1 ? group.onlyProcess : undefined;
    const thinkingOnly = onlyProcess && classifyProcessRow(onlyProcess).thinkingOnly;
    const disclosure: FlowerTurnDisclosurePolicy = !disclosable || thinkingOnly ? 'none' : interleavedInputs ? 'manual' : 'automatic';
    const prior = previous?.groups.get(turnID);
    const retained = prior && prior.turn === turn && prior.disclosure === disclosure
      && prior.parentEventCount === parentEventCount && prior.terminalKey === terminalKey && prior.summaryKey === summaryKey
      && prior.interleavedInputs === interleavedInputs && prior.countsComplete === countsComplete && prior.inputResponseCount === inputResponseCount
      && prior.toolCallCount === toolCallCount && prior.failedCallCount === failedCallCount
      && prior.processKeys.length === processKeys.length && prior.processKeys.every((key, index) => key === processKeys[index]);
    projected.set(turnID, retained ? prior : { turnID, turn, processKeys, processMembers: new Set(processKeys), parentEventCount,
      interleavedInputs, countsComplete, inputResponseCount, toolCallCount, failedCallCount, summaryKey, terminalKey, disclosure });
  }
  const rows = new Map<string, FlowerTurnProcess>();
  let unchanged = Boolean(previous && projected.size === previous.groups.size && rowTurns.size === previous.rows.size);
  for (const [key, turnID] of rowTurns) {
    const group = projected.get(turnID)!;
    rows.set(key, group);
    if (previous?.rows.get(key) !== group) unchanged = false;
  }
  return unchanged ? previous! : { groups: projected, rows };
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
  const activeTurnID = thread?.current_execution?.turn_id;
  const activeStatus = thread && ['running', 'waiting_user', 'waiting_approval'].includes(thread.status);
  const prior = new Map(previous.filter(section => section.threadID === threadID).map(section => [section.key, section]));
  const id = (entry: FlowerTimelineEntry) => classifyProcessRow(entry).turnID;
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
    const active = activeStatus && activeTurnID === id(entries[first]);
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
    let priorKey: string | undefined;
    for (let index = first; index <= end; index++) {
      const candidate = priorByEntry.get(entries[index].key);
      if (candidate && !used.has(candidate)) { priorKey = candidate; break; }
    }
    const key = priorKey ?? JSON.stringify([threadID, entry.key]);
    used.add(key);
    const retained = prior.get(key);
    result.push(retained && retained.entries.length === end - first + 1 && retained.entries.every((value, index) => value === entries[first + index])
      ? retained : { key, threadID, entries: entries.slice(first, end + 1) });
    first = end + 1;
  }
  return result;
}
