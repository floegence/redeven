import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

export type CopiedFileBrowserNamesResult = {
  count: number;
  firstName: string;
};

function normalizeClipboardError(error: unknown): Error {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'NotAllowedError') {
    return new Error('Clipboard permission denied.');
  }
  if (error instanceof Error) {
    return new Error(error.message || 'Failed to copy names to clipboard.');
  }

  const message = String(error ?? '').trim();
  return new Error(message || 'Failed to copy names to clipboard.');
}

export async function copyFileBrowserItemNames(items: FileItem[]): Promise<CopiedFileBrowserNamesResult> {
  const names = items
    .map((item) => String(item.name ?? '').trim())
    .filter((name) => name.length > 0);

  if (names.length <= 0) {
    throw new Error('No file or folder name available to copy.');
  }
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Clipboard is not available.');
  }

  try {
    await navigator.clipboard.writeText(names.join('\n'));
  } catch (error) {
    throw normalizeClipboardError(error);
  }

  return {
    count: names.length,
    firstName: names[0]!,
  };
}

export function describeCopiedFileBrowserItemNames(result: CopiedFileBrowserNamesResult): string {
  if (result.count === 1) {
    return `"${result.firstName}" copied to clipboard.`;
  }
  return `${result.count} names copied to clipboard.`;
}
