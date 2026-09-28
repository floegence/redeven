/** Read announced text without the hidden copies used to reserve label width. */
export function textWithoutHiddenCopies(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"], [hidden]')) hidden.remove();
  return copy.textContent ?? '';
}
