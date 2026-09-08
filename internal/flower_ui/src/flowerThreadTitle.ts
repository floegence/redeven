import type { FlowerThreadSnapshot, FlowerTitleStatus } from './contracts/flowerSurfaceContracts';

const FLOWER_CANONICAL_TITLE_MAX_RUNES = 200;

type FlowerThreadTitleSource = Readonly<{
  title: string;
  title_status: FlowerTitleStatus;
}>;

export function canonicalFlowerThreadTitle(source: FlowerThreadTitleSource | null | undefined): string {
  if (!source || source.title_status === 'unset') return '';
  return source.title.trim();
}

export function canonicalFlowerThreadSnapshotTitle(thread: FlowerThreadSnapshot | null | undefined): string {
  return canonicalFlowerThreadTitle(thread);
}

export function flowerThreadDisplayTitle(
  thread: FlowerThreadTitleSource & Readonly<{ thread_id: string }>,
  untitled: string,
): string {
  return canonicalFlowerThreadTitle(thread) || (untitled ? `${untitled} · ${thread.thread_id.slice(-8)}` : '');
}

export function flowerForkTitle(title: string, suffix: string): string {
  const ending = ` · ${suffix.trim()}`;
  const available = Math.max(0, FLOWER_CANONICAL_TITLE_MAX_RUNES - Array.from(ending).length);
  const source = Array.from(title.trim().replace(/\s+/gu, ' ')).slice(0, available).join('').trimEnd();
  return `${source}${ending}`.trim();
}
