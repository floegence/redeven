export type FlowerAttachmentDisplayKind = 'image' | 'file';

function normalizedMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().split(';', 1)[0] ?? '';
}

export function flowerAttachmentDisplayKind(mimeType: unknown): FlowerAttachmentDisplayKind {
  return normalizedMimeType(mimeType).startsWith('image/') ? 'image' : 'file';
}

export function isFlowerImageMimeType(mimeType: unknown): boolean {
  return flowerAttachmentDisplayKind(mimeType) === 'image';
}

export function safeFlowerAttachmentURL(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}
