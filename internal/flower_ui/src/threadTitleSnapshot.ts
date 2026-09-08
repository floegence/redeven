import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

export type ThreadTitleSnapshot = Pick<FlowerThreadSnapshot, 'title' | 'title_status' | 'title_generation'>;

export function threadTitleSnapshot(snapshot: ThreadTitleSnapshot): ThreadTitleSnapshot {
  const { title, title_status, title_generation } = snapshot;
  if (!Number.isSafeInteger(title_generation) || title_generation < 0
    || (title_status === 'unset'
      ? title_generation !== 0 || title !== ''
      : !['pending', 'ready', 'failed'].includes(title_status) || title_generation === 0 || title.trim() === '')) {
    throw new Error('Flower contract error: invalid canonical title snapshot.');
  }
  return { title, title_status, title_generation };
}

export function mergeThreadTitle(
  current: ThreadTitleSnapshot | undefined,
  candidate: ThreadTitleSnapshot,
): ThreadTitleSnapshot {
  const next = threadTitleSnapshot(candidate);
  if (!current || next.title_generation > current.title_generation) return next;
  if (next.title_generation < current.title_generation) return threadTitleSnapshot(current);
  if (next.title_status === current.title_status && next.title === current.title) return threadTitleSnapshot(current);
  if (current.title_status === 'pending' && (next.title_status === 'ready' || next.title_status === 'failed')) return next;
  if (next.title_status === 'pending' && (current.title_status === 'ready' || current.title_status === 'failed')) return threadTitleSnapshot(current);
  throw new Error('Flower contract error: conflicting title snapshots in the same generation.');
}
