import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerTurnDisclosurePolicy } from './flowerTurnPresentation';
import { flowerActivityIdentity } from './flowerActivityIdentity';
import { flowerToolCallPreviewIdentity } from './toolCallPreview';

type SequenceNode = Readonly<{ key: string; entryKey: string; scope: string; thinking: boolean; active: boolean; failed: boolean }>;
export type FlowerToolSequence = Readonly<{
  key: string;
  nodeKeys: readonly string[];
  entryKeys: readonly string[];
  toolCount: number;
  failedCount: number;
  thinkingCount: number;
  runningCount: number;
  disclosure: FlowerTurnDisclosurePolicy;
}>;
export type FlowerToolSequenceMember = Readonly<{ group: FlowerToolSequence; first: boolean; last: boolean }>;
export type FlowerToolSequenceProjection = Readonly<{
  groups: ReadonlyMap<string, FlowerToolSequence>;
  members: ReadonlyMap<string, FlowerToolSequenceMember>;
  continuingEntries: ReadonlySet<string>;
}>;

// Presentation only: source entries and canonical execution facts are never changed.
export function projectFlowerToolSequences(entries: readonly FlowerTimelineEntry[]): FlowerToolSequenceProjection {
  const tokens: (SequenceNode | null)[] = [];
  const tails = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== 'message' || entry.message.role !== 'assistant' || entry.message.goal) {
      tokens.push(null);
      continue;
    }
    const scope = JSON.stringify([entry.message.thread_id, entry.message.turn_id, entry.message.run_id]);
    const sameScope = (threadID: string | undefined, turnID: string | undefined, runID: string | undefined) =>
      Boolean(threadID && turnID && runID) && scope === JSON.stringify([threadID, turnID, runID]);
    for (const block of entry.blocks) {
      if (block.type === 'content' && block.block_type === 'thinking') {
        tokens.push({ key: block.key, entryKey: entry.key, scope, thinking: true, active: entry.message.live === true, failed: false });
      } else if (block.type === 'tool_preview') {
        const call = block.block.call;
        tokens.push(sameScope(call.thread_id, call.turn_id, call.run_id) && !['ask_user', 'subagents', 'subagent_events', 'goal'].includes(call.name)
          ? { key: flowerToolCallPreviewIdentity(call), entryKey: entry.key, scope, thinking: false, active: true, failed: false } : null);
      } else if (block.type === 'activity') {
        for (const item of block.block.items) {
          const failed = item.status === 'error';
          const foldable = sameScope(block.block.thread_id, block.block.turn_id, block.block.run_id)
            && (item.kind === 'tool' || item.kind === 'hosted_tool')
            && (['success', 'pending', 'running'].includes(item.status) || failed)
            && (!item.needs_attention || failed)
            && !item.requires_approval && !item.approval_state
            && (!item.attention_reasons?.length || failed && item.attention_reasons.every(reason => reason === 'error'))
            && (!item.payload?.error || failed)
            && (!['warning', 'error', 'blocking'].includes(item.severity) || failed)
            && !['subagent', 'subagent_operation'].includes(item.renderer ?? '')
            && !['subagents', 'subagent_events', 'goal'].includes(item.tool_name ?? '')
            && !item.chips?.some(chip => chip.kind === 'effect_outcome' && chip.value === 'uncertain');
          tokens.push(foldable ? {
            key: flowerActivityIdentity({ threadID: block.block.thread_id, runID: block.block.run_id, turnID: block.block.turn_id,
              itemID: item.kind === 'tool' && item.tool_id ? item.tool_id : item.item_id }),
            entryKey: entry.key, scope, thinking: false, active: item.status === 'pending' || item.status === 'running', failed,
          } : null);
        }
      } else tokens.push(null);
    }
    const tail = tokens.at(-1);
    if (tail?.entryKey === entry.key) tails.set(entry.key, tail.key);
  }
  const runs: SequenceNode[][] = [];
  let pending: SequenceNode[] = [];
  const flush = () => {
    // A leading or trailing thought stays an independent thinking disclosure.
    let end = pending.length - 1;
    while (end >= 0 && pending[end].thinking) end -= 1;
    const bounded = pending.slice(0, end + 1);
    if (bounded.length) runs.push(bounded);
    pending = [];
  };
  for (const node of tokens) {
    if (!node || pending.length && pending[0].scope !== node.scope) flush();
    if (!node) continue;
    if (!node.thinking || pending.length) pending.push(node);
  }
  flush();
  const groups = new Map<string, FlowerToolSequence>();
  const members = new Map<string, FlowerToolSequenceMember>();
  runs.forEach((nodes, index) => {
    const tools = nodes.filter(node => !node.thinking);
    if (tools.length < 2) return;
    const group: FlowerToolSequence = {
      key: nodes[0].key, nodeKeys: nodes.map(node => node.key), entryKeys: [...new Set(nodes.map(node => node.entryKey))],
      toolCount: tools.length, failedCount: tools.filter(node => node.failed).length, thinkingCount: nodes.length - tools.length,
      runningCount: tools.filter(node => node.active).length,
      disclosure: index === runs.length - 1 || nodes.some(node => node.active) ? 'manual' : 'automatic',
    };
    groups.set(group.key, group);
    nodes.forEach((node, i) => members.set(node.key, { group, first: i === 0, last: i === nodes.length - 1 }));
  });
  return { groups, members, continuingEntries: new Set([...tails].filter(([, key]) => {
    const member = members.get(key);
    return member && !member.last;
  }).map(([key]) => key)) };
}
