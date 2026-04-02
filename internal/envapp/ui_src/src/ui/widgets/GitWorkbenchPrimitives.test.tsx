// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GitCountPill, GitMetaPill, GitPanelFrame, GitTableFrame } from './GitWorkbenchPrimitives';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitWorkbenchPrimitives shared panel frames', () => {
  it('renders GitPanelFrame with the shared strong bordered surface geometry', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitPanelFrame as="section" class="custom-frame">
        <div>Panel content</div>
      </GitPanelFrame>
    ), host);

    try {
      const panel = host.querySelector('section');
      expect(panel).toBeTruthy();
      expect(panel?.className).toContain('rounded-md');
      expect(panel?.className).toContain('border');
      expect(panel?.className).toContain('shadow-sm');
      expect(panel?.className).toContain('ring-1');
      expect(panel?.className).toContain('redeven-surface-panel--strong');
      expect(panel?.className).toContain('custom-frame');
      expect(panel?.textContent).toContain('Panel content');
    } finally {
      dispose();
    }
  });

  it('renders GitTableFrame with the shared bordered table surface shell', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitTableFrame class="flex min-h-0 flex-1 flex-col">
        <div>Table content</div>
      </GitTableFrame>
    ), host);

    try {
      const panel = host.firstElementChild as HTMLDivElement | null;
      expect(panel).toBeTruthy();
      expect(panel?.className).toContain('overflow-hidden');
      expect(panel?.className).toContain('rounded-md');
      expect(panel?.className).toContain('border');
      expect(panel?.className).toContain('redeven-surface-panel--strong');
      expect(panel?.className).toContain('flex');
      expect(panel?.textContent).toContain('Table content');
    } finally {
      dispose();
    }
  });

  it('renders GitMetaPill with semantic tone metadata and selected emphasis hooks', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitMetaPill tone="warning" emphasis="selected" class="custom-pill">
        Pending
      </GitMetaPill>
    ), host);

    try {
      const pill = host.querySelector('[data-git-tone="warning"]') as HTMLElement | null;
      expect(pill).toBeTruthy();
      expect(pill?.getAttribute('data-git-pill-kind')).toBe('meta');
      expect(pill?.className).toContain('git-meta-pill');
      expect(pill?.className).toContain('git-browser-selection-chip');
      expect(pill?.className).toContain('custom-pill');
      expect(pill?.textContent).toContain('Pending');
    } finally {
      dispose();
    }
  });

  it('renders GitCountPill with count metadata and compact count geometry', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitCountPill tone="info" class="count-pill">
        12
      </GitCountPill>
    ), host);

    try {
      const pill = host.querySelector('[data-git-tone="info"]') as HTMLElement | null;
      expect(pill).toBeTruthy();
      expect(pill?.getAttribute('data-git-pill-kind')).toBe('count');
      expect(pill?.className).toContain('git-meta-pill');
      expect(pill?.className).toContain('min-w-[1.5rem]');
      expect(pill?.className).toContain('tabular-nums');
      expect(pill?.className).toContain('count-pill');
      expect(pill?.textContent).toContain('12');
    } finally {
      dispose();
    }
  });
});
