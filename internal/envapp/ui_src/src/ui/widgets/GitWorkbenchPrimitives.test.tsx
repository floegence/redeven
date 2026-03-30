// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GitPanelFrame, GitTableFrame } from './GitWorkbenchPrimitives';

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
});
