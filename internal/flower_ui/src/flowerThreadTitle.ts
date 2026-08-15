import type { FlowerChatMessage, FlowerThreadSnapshot, FlowerTitleStatus } from './contracts/flowerSurfaceContracts';

const FLOWER_CANONICAL_TITLE_MAX_RUNES = 200;

type FlowerThreadTitleSource = Readonly<{
  title: string;
  title_status: FlowerTitleStatus;
  messages?: readonly FlowerChatMessage[];
}>;

function collapseWhitespace(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

function truncateTitle(value: string): string {
  return Array.from(value).slice(0, FLOWER_CANONICAL_TITLE_MAX_RUNES).join('');
}

function firstUserMessageTitle(messages: readonly FlowerChatMessage[] | undefined): string {
  for (const message of messages ?? []) {
    if (message.role !== 'user') continue;
    const text = collapseWhitespace(message.content)
      || collapseWhitespace((message.blocks ?? [])
        .map((block) => block.type === 'text' || block.type === 'markdown' ? block.content : '')
        .filter(Boolean)
        .join(' '));
    if (text) return truncateTitle(text);
    const attachmentBlock = (message.blocks ?? [])
      .map((block) => block.type === 'file' ? collapseWhitespace(block.name) : '')
      .find(Boolean);
    if (attachmentBlock) return truncateTitle(attachmentBlock);
    const references = message.references ?? [];
    const attachmentReference = references
      .filter((item) => item.reference_id.startsWith('attachment:'))
      .map((item) => collapseWhitespace(item.label))
      .find(Boolean);
    if (attachmentReference) return truncateTitle(attachmentReference);
    const reference = references.map((item) => collapseWhitespace(item.label)).find(Boolean);
    if (reference) return truncateTitle(reference);
  }
  return '';
}

export function canonicalFlowerThreadTitle(source: FlowerThreadTitleSource | null | undefined): string {
  if (!source) return '';
  const title = String(source.title ?? '').trim();
  if (title && source.title_status !== 'unset') return title;
  return firstUserMessageTitle(source.messages);
}

export function canonicalFlowerThreadSnapshotTitle(thread: FlowerThreadSnapshot | null | undefined): string {
  return canonicalFlowerThreadTitle(thread);
}
