import type { FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerTurnDisclosurePolicy } from './flowerTurnPresentation';
import { flowerActivityIdentity } from './flowerActivityIdentity';
import { flowerToolCallPreviewIdentity } from './toolCallPreview';

type SequenceNode = Readonly<{
  key: string;
  entryKey: string;
  scope: string;
  turnID?: string;
  kind: 'tool' | 'thinking' | 'subagent_event';
  active: boolean;
  failed: boolean;
}>;

const sequenceBoundaryToolNames = new Set(['ask_user']);
const sequenceableParentEventKinds = new Set(['report', 'completed', 'failed', 'cancelled', 'interrupted', 'timed_out']);

function isSequenceTool(toolName: string | undefined): boolean {
  return !sequenceBoundaryToolNames.has(toolName ?? '');
}

export type FlowerToolSequence = Readonly<{
  key: string;
  nodeKeys: readonly string[];
  entryKeys: readonly string[];
  toolCount: number;
  failedCount: number;
  failedSubagentEventCount: number;
  thinkingCount: number;
  subagentEventCount: number;
  runningCount: number;
  disclosure: FlowerTurnDisclosurePolicy;
}>;
export type FlowerToolSequenceMember = Readonly<{ group: FlowerToolSequence; first: boolean; last: boolean }>;
export type FlowerToolSequenceProjection = Readonly<{
  groups: ReadonlyMap<string, FlowerToolSequence>;
  members: ReadonlyMap<string, FlowerToolSequenceMember>;
  continuingEntries: ReadonlySet<string>;
}>;

function uniqueTurnsByID(turns: readonly FlowerRuntimeTurn[]): ReadonlyMap<string, FlowerRuntimeTurn> {
  const byID = new Map<string, FlowerRuntimeTurn>();
  const ambiguous = new Set<string>();
  for (const turn of turns) {
    if (!turn.turn_id || !turn.run_id || ambiguous.has(turn.turn_id)) continue;
    if (byID.has(turn.turn_id)) {
      byID.delete(turn.turn_id);
      ambiguous.add(turn.turn_id);
      continue;
    }
    byID.set(turn.turn_id, turn);
  }
  return byID;
}

// Presentation only: source entries and canonical execution facts are never changed.
export function projectFlowerToolSequences(
  entries: readonly FlowerTimelineEntry[],
  threadID?: string,
  turns: readonly FlowerRuntimeTurn[] = [],
  previous?: FlowerToolSequenceProjection,
  breakBefore: ReadonlySet<string> = new Set(),
): FlowerToolSequenceProjection {
  const tokens: (SequenceNode | null)[] = [];
  const turnsByID = uniqueTurnsByID(turns);
  const entryPositions = new Map(entries.map((entry, index) => [entry.key, index]));
  const inputResponsePositions = new Map<string, number[]>();
  const sequenceScope = (ownerThreadID: string | undefined, turnID: string | undefined, runID: string | undefined) =>
    ownerThreadID && turnID && runID ? JSON.stringify([ownerThreadID, turnID, runID]) : '';
  const parentEventNode = (entry: Extract<FlowerTimelineEntry, { type: 'parent_event' }>): SequenceNode | null => {
    const { event } = entry;
    if (!threadID || event.parent_thread_id !== threadID || !event.parent_turn_id
      || !sequenceableParentEventKinds.has(event.kind) || event.reason_code === 'effect_outcome_unknown') return null;
    const turn = turnsByID.get(event.parent_turn_id);
    const scope = sequenceScope(event.parent_thread_id, turn?.turn_id, turn?.run_id);
    return scope ? { key: entry.key, entryKey: entry.key, scope, turnID: turn?.turn_id, kind: 'subagent_event', active: false,
      failed: event.kind === 'failed' || event.kind === 'timed_out' } : null;
  };

  for (const entry of entries) {
    if (breakBefore.has(entry.key)) tokens.push(null);
    if (entry.type === 'parent_event') {
      tokens.push(parentEventNode(entry));
      continue;
    }
    if (entry.type === 'message' && entry.blocks.some((block) => block.type === 'input_response')) {
      const turnID = entry.message.turn_id;
      if (turnID) {
        const positions = inputResponsePositions.get(turnID) ?? [];
        positions.push(entryPositions.get(entry.key)!);
        inputResponsePositions.set(turnID, positions);
      }
    }
    if (entry.type !== 'message' || entry.message.role !== 'assistant' || entry.message.goal) {
      tokens.push(null);
      continue;
    }
    const scope = sequenceScope(entry.message.thread_id, entry.message.turn_id, entry.message.run_id);
    const sameScope = (ownerThreadID: string | undefined, turnID: string | undefined, runID: string | undefined) =>
      Boolean(scope) && scope === sequenceScope(ownerThreadID, turnID, runID);
    for (const block of entry.blocks) {
      if (block.type === 'content') {
        if (block.block_type === 'thinking') {
          tokens.push({ key: block.key, entryKey: entry.key, scope, turnID: entry.message.turn_id, kind: 'thinking', active: entry.message.live === true, failed: false });
        } else if (block.content.trim()) {
          tokens.push(null);
        }
      } else if (block.type === 'tool_preview') {
        const call = block.block.call;
        tokens.push(sameScope(call.thread_id, call.turn_id, call.run_id) && isSequenceTool(call.name)
          ? { key: flowerToolCallPreviewIdentity(call), entryKey: entry.key, scope, turnID: entry.message.turn_id, kind: 'tool', active: true, failed: false } : null);
      } else if (block.type === 'activity') {
        for (const item of block.block.items) {
          const failed = item.status === 'error';
          const attentionReasons = item.attention_reasons ?? [];
          const subagentWait = item.tool_name === 'subagents' && item.renderer === 'subagent_operation'
            && (item.field_summary?.action ?? item.payload?.action) === 'wait' && (item.status === 'running' || item.status === 'waiting');
          const runningAttention = item.status === 'running' && attentionReasons.length > 0
            && attentionReasons.every(reason => reason === 'running');
          const waitingAttention = subagentWait && item.status === 'waiting'
            && attentionReasons.every(reason => reason === 'waiting' || reason === 'running');
          const attentionAllowed = failed || runningAttention || waitingAttention || !item.needs_attention && attentionReasons.length === 0;
          const statusAllowed = ['success', 'pending', 'running'].includes(item.status) || failed || subagentWait;
          const foldable = sameScope(block.block.thread_id, block.block.turn_id, block.block.run_id)
            && (item.kind === 'tool' || item.kind === 'hosted_tool')
            && isSequenceTool(item.tool_name)
            && statusAllowed
            && attentionAllowed
            && !item.requires_approval && !item.approval_state
            && (!(item.field_summary?.has_error || item.payload?.error) || failed)
            && (!['warning', 'error', 'blocking'].includes(item.severity) || failed || waitingAttention)
            && !item.field_summary?.uncertain_effect
            && !item.chips?.some(chip => chip.kind === 'effect_outcome' && chip.value === 'uncertain');
          tokens.push(foldable ? {
            key: flowerActivityIdentity({ threadID: block.block.thread_id, runID: block.block.run_id, turnID: block.block.turn_id,
              itemID: item.kind === 'tool' && item.tool_id ? item.tool_id : item.item_id }),
            entryKey: entry.key, scope, turnID: entry.message.turn_id, kind: 'tool',
            active: item.status === 'pending' || item.status === 'running' || subagentWait,
            failed,
          } : null);
        }
      } else {
        tokens.push(null);
      }
    }
  }

  const runs: SequenceNode[][] = [];
  let pending: SequenceNode[] = [];
  const flush = () => {
    if (pending.some(node => node.kind !== 'thinking')) runs.push(pending);
    pending = [];
  };
  for (const node of tokens) {
    if (!node || pending.length && pending[0].scope !== node.scope) flush();
    if (node) pending.push(node);
  }
  flush();

  const groups = new Map<string, FlowerToolSequence>();
  const members = new Map<string, FlowerToolSequenceMember>();
  const continuingEntries = new Set<string>();
  const processPositions = new Map<string, number[]>();
  for (const nodes of runs) for (const node of nodes) {
    const position = entryPositions.get(node.entryKey);
    if (position === undefined) continue;
    if (!node.turnID) continue;
    const positions = processPositions.get(node.turnID) ?? [];
    positions.push(position);
    processPositions.set(node.turnID, positions);
  }
  const separatedTurns = new Set<string>();
  for (const [turnID, checkpoints] of inputResponsePositions) {
    const positions = processPositions.get(turnID) ?? [];
    if (checkpoints.some((checkpoint) => positions.some((position) => position < checkpoint)
      && positions.some((position) => position > checkpoint))) separatedTurns.add(turnID);
  }
  const settledTurns = new Set([...turnsByID.values()].filter((turn) => turn.outcome && turn.ended_at)
    .map((turn) => turn.turn_id));
  runs.forEach((nodes, index) => {
    if (nodes.length < 2) return;
    const tools = nodes.filter(node => node.kind === 'tool');
    const thinking = nodes.filter(node => node.kind === 'thinking');
    const subagentEvents = nodes.filter(node => node.kind === 'subagent_event');
    const firstEntry = Math.min(...nodes.map(node => entryPositions.get(node.entryKey) ?? 0));
    const lastEntry = Math.max(...nodes.map(node => entryPositions.get(node.entryKey) ?? firstEntry));
    const entryKeys = entries.slice(firstEntry, lastEntry + 1).map(entry => entry.key);
    const separated = Boolean(nodes[0].turnID && settledTurns.has(nodes[0].turnID) && separatedTurns.has(nodes[0].turnID));
    let group: FlowerToolSequence = {
      key: nodes[0].key,
      nodeKeys: nodes.map(node => node.key),
      entryKeys,
      toolCount: tools.length,
      failedCount: tools.filter(node => node.failed).length,
      failedSubagentEventCount: subagentEvents.filter(node => node.failed).length,
      thinkingCount: thinking.length,
      subagentEventCount: subagentEvents.length,
      runningCount: tools.filter(node => node.active).length,
      disclosure: nodes.some(node => node.active) || !separated && index === runs.length - 1 ? 'manual' : 'automatic',
    };
    const prior = previous?.groups.get(group.key);
    if (prior && (Object.keys(group) as (keyof FlowerToolSequence)[]).every(key => {
      const value = group[key], old = prior[key];
      return Array.isArray(value) && Array.isArray(old)
        ? value.length === old.length && value.every((item, index) => item === old[index])
        : value === old;
    })) group = prior;
    groups.set(group.key, group);
    entryKeys.slice(0, -1).forEach(key => continuingEntries.add(key));
    nodes.forEach((node, nodeIndex) => {
      const priorMember = previous?.members.get(node.key);
      members.set(node.key, priorMember?.group === group ? priorMember
        : { group, first: nodeIndex === 0, last: nodeIndex === nodes.length - 1 });
    });
  });
  const previousKeys = previous ? [...previous.groups.keys()] : [];
  if (previous && groups.size === previous.groups.size && members.size === previous.members.size
    && [...groups].every(([key, group], index) => previousKeys[index] === key && previous.groups.get(key) === group)
    && continuingEntries.size === previous.continuingEntries.size
    && [...continuingEntries].every(key => previous.continuingEntries.has(key))) return previous;
  return { groups, members, continuingEntries };
}
