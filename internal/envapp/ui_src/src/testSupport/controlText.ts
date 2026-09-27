/** Text exposed by a control, excluding decorative sizing and icon content. */
export function controlText(element: Element | null | undefined): string {
  const copy = element?.cloneNode(true) as Element | undefined;
  copy?.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
  return copy?.textContent?.trim() ?? '';
}
