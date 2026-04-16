// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  NOTES_OVERLAY_SHELL_SLOT_SELECTORS,
  resolveNotesOverlayViewportHosts,
} from './notesOverlayShellViewport';

describe('notesOverlayShellViewport', () => {
  it('resolves sidebar and main shell slots in stable order', () => {
    const shell = document.createElement('div');
    shell.setAttribute('data-floe-shell', '');

    const sidebar = document.createElement('aside');
    sidebar.setAttribute('data-floe-shell-slot', 'sidebar');
    const contentArea = document.createElement('div');
    contentArea.setAttribute('data-floe-shell-slot', 'content-area');
    const main = document.createElement('main');
    main.setAttribute('data-floe-shell-slot', 'main');
    const anchor = document.createElement('div');

    main.appendChild(anchor);
    contentArea.appendChild(main);
    shell.append(sidebar, contentArea);
    document.body.appendChild(shell);

    expect(resolveNotesOverlayViewportHosts(anchor)).toEqual([sidebar, main]);
  });

  it('falls back to the anchor element when shell slots are unavailable', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);

    expect(resolveNotesOverlayViewportHosts(anchor)).toEqual([anchor]);
  });

  it('keeps the stable public selectors pinned to shared shell slot names', () => {
    expect(NOTES_OVERLAY_SHELL_SLOT_SELECTORS.shell).toBe('[data-floe-shell]');
    expect(NOTES_OVERLAY_SHELL_SLOT_SELECTORS.sidebar).toBe('[data-floe-shell-slot="sidebar"]');
    expect(NOTES_OVERLAY_SHELL_SLOT_SELECTORS.main).toBe('[data-floe-shell-slot="main"]');
  });
});
