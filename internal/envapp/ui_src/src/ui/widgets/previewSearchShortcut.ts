/** Route preview-window/header shortcuts to the current document's own Find action. */
export function handlePreviewSearchShortcut(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;
  const trigger = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-redeven-preview-find]')]
    .find(button => !button.disabled && !button.closest('[inert]') && button.checkVisibility());
  if (!trigger) return;
  event.preventDefault();
  event.stopPropagation();
  trigger.click();
}
