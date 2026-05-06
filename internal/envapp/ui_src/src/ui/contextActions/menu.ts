import type { ContextActionID } from './protocol';

const CONTEXT_ACTION_MENU_RANK: Record<ContextActionID, number> = {
  'assistant.ask.flower': 10,
  'assistant.ask.codex': 20,
  'handoff.terminal.open': 40,
  'handoff.files.browse': 50,
};

export function contextActionMenuRank(actionId: ContextActionID | string): number {
  if (actionId === 'ask-flower') return CONTEXT_ACTION_MENU_RANK['assistant.ask.flower'];
  if (actionId === 'ask-codex') return CONTEXT_ACTION_MENU_RANK['assistant.ask.codex'];
  if (actionId === 'open-in-terminal') return CONTEXT_ACTION_MENU_RANK['handoff.terminal.open'];
  if (actionId === 'browse-files') return CONTEXT_ACTION_MENU_RANK['handoff.files.browse'];
  return CONTEXT_ACTION_MENU_RANK[actionId as ContextActionID] ?? 1000;
}

export function compareContextActionMenuItems(
  left: { contextActionId?: ContextActionID | string; id?: string },
  right: { contextActionId?: ContextActionID | string; id?: string },
): number {
  const rankDelta = contextActionMenuRank(left.contextActionId ?? left.id ?? '')
    - contextActionMenuRank(right.contextActionId ?? right.id ?? '');
  if (rankDelta !== 0) return rankDelta;
  return String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

export function sortContextActionMenuItems<T extends { contextActionId?: ContextActionID | string; id?: string }>(items: readonly T[]): T[] {
  return [...items].sort(compareContextActionMenuItems);
}
