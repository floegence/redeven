import { isSplitWorkspaceLayout, mapSplitWorkspace, splitWorkspaceItems, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';

/** Product occupancy metadata; Floe remains the owner of all split geometry. */
export type TerminalViewLayout =
  | Readonly<{ type: 'pane'; id: string; empty?: true }>
  | Readonly<{ type: 'split'; id: string; axis: 'x' | 'y'; ratio: number; first: TerminalViewLayout; second: TerminalViewLayout }>;

export function emptyViewSlots(layout: SplitWorkspaceLayout | null): Set<string> {
  const slots = new Set<string>();
  const visit = (node: TerminalViewLayout | null) => {
    if (!node) return;
    if (node.type === 'pane') { if (node.empty) slots.add(node.id); }
    else { visit(node.first); visit(node.second); }
  };
  visit(layout);
  return slots;
}
export const viewSessionIds = (layout: SplitWorkspaceLayout | null) => {
  const empty = emptyViewSlots(layout);
  return splitWorkspaceItems(layout).filter(id => !empty.has(id));
};
export function vacateViewSessions(layout: TerminalViewLayout, ids: ReadonlySet<string>): TerminalViewLayout {
  let next = layout;
  for (const id of viewSessionIds(layout)) if (ids.has(id)) {
    next = mapSplitWorkspace(next, id, () => ({ type: 'pane', id: 'vacant-' + crypto.randomUUID(), empty: true } as TerminalViewLayout));
  }
  return next;
}
export function isTerminalViewLayout(value: unknown): value is TerminalViewLayout {
  if (!isSplitWorkspaceLayout(value)) return false;
  const validate = (node: TerminalViewLayout): boolean => node.type === 'pane'
    ? node.empty === undefined || node.empty === true
    : !('empty' in node) && validate(node.first) && validate(node.second);
  return validate(value);
}
