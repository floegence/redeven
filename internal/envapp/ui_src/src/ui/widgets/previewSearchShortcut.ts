const searchOwners = new WeakMap<HTMLElement, () => boolean>();

/** Bind the visible action surface, without a hidden or duplicate Find button. */
export function bindPreviewSearchShortcut(owner: HTMLElement, show: () => boolean): () => void {
  owner.setAttribute('data-redeven-preview-search-owner', '');
  searchOwners.set(owner, show);
  return () => { searchOwners.delete(owner); owner.removeAttribute('data-redeven-preview-search-owner'); };
}

/** Route preview-window/header shortcuts to the current document's own Find action. */
export function handlePreviewSearchShortcut(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;
  for (const owner of event.currentTarget.querySelectorAll<HTMLElement>('[data-redeven-preview-search-owner]')) {
    if (owner.closest('[inert]') || !owner.checkVisibility() || !searchOwners.get(owner)?.()) continue;
    event.preventDefault(); event.stopPropagation(); return;
  }
  const trigger = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-redeven-preview-find]')]
    .find(button => !button.disabled && !button.closest('[inert]') && button.checkVisibility());
  if (!trigger) return;
  event.preventDefault();
  event.stopPropagation();
  trigger.click();
}
