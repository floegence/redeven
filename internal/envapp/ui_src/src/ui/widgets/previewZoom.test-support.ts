/** Exercise the published zoom menu from renderer unit tests. */
export async function selectPreviewZoomMode(host: HTMLElement, label: string) {
  const trigger = host.querySelector<HTMLElement>('[data-floe-dropdown-trigger]')!;
  trigger.click();
  const menu = document.getElementById(trigger.getAttribute('aria-controls')!)!;
  const text = menu.textContent;
  const item = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === label);
  if (!item) throw new Error(`Missing preview zoom mode: ${label}`);
  item.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  return text;
}
