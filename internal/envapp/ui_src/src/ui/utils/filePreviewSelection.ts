export function readSelectionTextFromPreview(contentElement?: HTMLDivElement): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount <= 0) return '';

  const text = String(selection.toString() ?? '').trim();
  if (!text) return '';
  if (!contentElement) return text;

  const range = selection.getRangeAt(0);
  const containerNode = range.commonAncestorContainer;
  const containerElement =
    containerNode.nodeType === Node.ELEMENT_NODE
      ? (containerNode as Element)
      : containerNode.parentElement;
  if (!containerElement || !contentElement.contains(containerElement)) {
    return '';
  }

  return text;
}
