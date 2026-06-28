import type { FlowerThreadListItem } from '../contracts/flowerSurfaceContracts';

export function canForkThreadItem(item: FlowerThreadListItem): boolean {
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
  void item;
  return true;
}

export function canPinThreadItem(item: FlowerThreadListItem): boolean {
  void item;
  return true;
}
