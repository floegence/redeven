import type { Message, MessageBlock } from '../chat/types';
import {
  mergeSubagentEventsByTimestamp,
  normalizeSubagentStatus,
  type SubagentView,
} from './aiDataNormalizers';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!sameStructuredValue(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!(key in right) || !sameStructuredValue(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function normalizeSubagentHistory(
  raw: unknown,
): Array<{ role: 'user' | 'assistant' | 'system'; text: string }> {
  if (!Array.isArray(raw)) return [];
  const history: Array<{ role: 'user' | 'assistant' | 'system'; text: string }> = [];
  for (const item of raw) {
    const record = asRecord(item);
    const roleRaw = String(record.role ?? '').trim().toLowerCase();
    const role = roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === 'system'
      ? roleRaw
      : '';
    const text = String(record.text ?? '').trim();
    if (!role || !text) continue;
    history.push({
      role,
      text,
    });
  }
  return history;
}

function mergeIntoSubagentMap(
  current: Record<string, SubagentView>,
  incoming: SubagentView | null,
  fallbackUpdatedAt = 0,
): void {
  if (!incoming || !incoming.subagentId) return;
  const normalized: SubagentView = incoming.updatedAtUnixMs > 0
    ? incoming
    : {
      ...incoming,
      updatedAtUnixMs: Math.max(0, Number(fallbackUpdatedAt || 0)),
    };
  const merged = mergeSubagentEventsByTimestamp(current[normalized.subagentId] ?? null, normalized);
  if (merged) {
    current[normalized.subagentId] = merged;
  }
}

function deriveSubagentViewFromBlock(block: Extract<MessageBlock, { type: 'subagent' }>, fallbackUpdatedAt: number): SubagentView {
  return {
    subagentId: String(block.subagentId ?? '').trim(),
    taskId: String(block.taskId ?? '').trim(),
    specId: String(block.specId ?? '').trim() || undefined,
    title: String(block.title ?? '').trim() || undefined,
    objective: String(block.objective ?? '').trim() || undefined,
    contextMode: String(block.contextMode ?? '').trim() || undefined,
    promptHash: String(block.promptHash ?? '').trim() || undefined,
    delegationPromptMarkdown: String(block.delegationPromptMarkdown ?? '').trim() || undefined,
    deliverables: Array.isArray(block.deliverables) ? block.deliverables : [],
    definitionOfDone: Array.isArray(block.definitionOfDone) ? block.definitionOfDone : [],
    outputSchema: block.outputSchema && typeof block.outputSchema === 'object' && !Array.isArray(block.outputSchema)
      ? block.outputSchema
      : {},
    agentType: String(block.agentType ?? '').trim(),
    triggerReason: String(block.triggerReason ?? '').trim(),
    status: normalizeSubagentStatus(block.status),
    summary: String(block.summary ?? '').trim(),
    evidenceRefs: Array.isArray(block.evidenceRefs) ? block.evidenceRefs : [],
    keyFiles: Array.isArray(block.keyFiles) ? block.keyFiles : [],
    openRisks: Array.isArray(block.openRisks) ? block.openRisks : [],
    nextActions: Array.isArray(block.nextActions) ? block.nextActions : [],
    history: normalizeSubagentHistory(block.history),
    stats: block.stats ?? {
      steps: 0,
      toolCalls: 0,
      tokens: 0,
      elapsedMs: 0,
      outcome: '',
    },
    updatedAtUnixMs: Math.max(0, Number(block.updatedAtUnixMs ?? 0) || fallbackUpdatedAt || 0),
    error: String(block.error ?? '').trim() || undefined,
  };
}

function walkSubagentBlocks(
  blocks: MessageBlock[],
  messageTimestamp: number,
  nextMap: Record<string, SubagentView>,
): void {
  for (const block of blocks) {
    if (!block) continue;

    if (block.type === 'subagent') {
      mergeIntoSubagentMap(nextMap, deriveSubagentViewFromBlock(block, messageTimestamp), messageTimestamp);
    }
  }
}

export function sameSubagentViewContent(
  left: SubagentView | null | undefined,
  right: SubagentView | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.subagentId === right.subagentId &&
    left.taskId === right.taskId &&
    left.specId === right.specId &&
    left.title === right.title &&
    left.objective === right.objective &&
    left.contextMode === right.contextMode &&
    left.promptHash === right.promptHash &&
    left.delegationPromptMarkdown === right.delegationPromptMarkdown &&
    left.agentType === right.agentType &&
    left.triggerReason === right.triggerReason &&
    left.status === right.status &&
    left.summary === right.summary &&
    left.updatedAtUnixMs === right.updatedAtUnixMs &&
    left.error === right.error &&
    sameStructuredValue(left.deliverables ?? [], right.deliverables ?? []) &&
    sameStructuredValue(left.definitionOfDone ?? [], right.definitionOfDone ?? []) &&
    sameStructuredValue(left.outputSchema ?? {}, right.outputSchema ?? {}) &&
    sameStructuredValue(left.evidenceRefs ?? [], right.evidenceRefs ?? []) &&
    sameStructuredValue(left.keyFiles ?? [], right.keyFiles ?? []) &&
    sameStructuredValue(left.openRisks ?? [], right.openRisks ?? []) &&
    sameStructuredValue(left.nextActions ?? [], right.nextActions ?? []) &&
    sameStructuredValue(left.history ?? [], right.history ?? []) &&
    sameStructuredValue(left.stats ?? {}, right.stats ?? {})
  );
}

export function sameSubagentViewMap(
  left: Record<string, SubagentView>,
  right: Record<string, SubagentView>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!sameSubagentViewContent(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

export function deriveSubagentViewsFromMessages(messages: Message[]): Record<string, SubagentView> {
  const nextMap: Record<string, SubagentView> = {};
  for (const message of messages) {
    const messageTimestamp = Math.max(0, Number(message?.timestamp ?? 0) || 0);
    const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
    walkSubagentBlocks(blocks, messageTimestamp, nextMap);
  }
  return nextMap;
}
