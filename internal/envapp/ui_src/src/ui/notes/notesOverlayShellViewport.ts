export const NOTES_OVERLAY_SHELL_SLOT_SELECTORS = {
  shell: '[data-floe-shell]',
  sidebar: '[data-floe-shell-slot="sidebar"]',
  main: '[data-floe-shell-slot="main"]',
} as const;

function uniqueHTMLCandidates(candidates: readonly (Element | null | undefined)[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }

  return out;
}

export function resolveNotesOverlayViewportHosts(anchor: Element | null | undefined): readonly HTMLElement[] {
  if (!(anchor instanceof HTMLElement)) return [];

  const shellRoot = anchor.closest(NOTES_OVERLAY_SHELL_SLOT_SELECTORS.shell);
  if (!(shellRoot instanceof HTMLElement)) {
    return [anchor];
  }

  const hosts = uniqueHTMLCandidates([
    shellRoot.querySelector(NOTES_OVERLAY_SHELL_SLOT_SELECTORS.sidebar),
    shellRoot.querySelector(NOTES_OVERLAY_SHELL_SLOT_SELECTORS.main),
  ]);
  if (hosts.length > 0) return hosts;

  return [anchor];
}
