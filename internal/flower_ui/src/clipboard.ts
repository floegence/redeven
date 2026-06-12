const CLIPBOARD_UNAVAILABLE_MESSAGE = 'Clipboard is not available in this context.';
const CLIPBOARD_WRITE_FAILED_MESSAGE = 'Clipboard copy failed.';

function normalizeClipboardWriteError(error: unknown): Error {
  if (error instanceof Error && error.message.trim()) return error;
  return new Error(CLIPBOARD_WRITE_FAILED_MESSAGE);
}

function writeTextWithLegacyClipboard(text: string, documentRef: Document): void {
  const activeElement = documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  documentRef.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    if (!documentRef.execCommand('copy')) {
      throw new Error(CLIPBOARD_WRITE_FAILED_MESSAGE);
    }
  } finally {
    textarea.remove();
    activeElement?.focus();
  }
}

export async function writeTextToClipboard(text: string): Promise<void> {
  const normalizedText = String(text ?? '');
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(normalizedText);
      return;
    } catch (error) {
      if (typeof document !== 'undefined') {
        try {
          writeTextWithLegacyClipboard(normalizedText, document);
          return;
        } catch {
          throw normalizeClipboardWriteError(error);
        }
      }
      throw normalizeClipboardWriteError(error);
    }
  }
  if (typeof document !== 'undefined') {
    writeTextWithLegacyClipboard(normalizedText, document);
    return;
  }
  throw new Error(CLIPBOARD_UNAVAILABLE_MESSAGE);
}
