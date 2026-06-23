import type { FlowerThreadListItem } from '../contracts/flowerSurfaceContracts';

export function isSubagentProjectionItem(item: Pick<FlowerThreadListItem, 'owner_kind'>): boolean {
  return String(item.owner_kind ?? '').trim().toLowerCase() === 'subagent_projection';
}

export function canForkThreadItem(item: FlowerThreadListItem): boolean {
  if (isSubagentProjectionItem(item)) return false;
  switch (item.status) {
    case 'running':
    case 'waiting_approval':
    case 'waiting_user':
    case 'read_only':
      return false;
    default:
      return true;
  }
}

export function canRenameThreadItem(item: FlowerThreadListItem): boolean {
  return !isSubagentProjectionItem(item);
}

export function canPinThreadItem(item: FlowerThreadListItem): boolean {
  return !isSubagentProjectionItem(item);
}
