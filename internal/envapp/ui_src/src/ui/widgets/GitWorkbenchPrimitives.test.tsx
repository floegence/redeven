// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GitInlineLoadingStatus, GitMetaPill, GitPagedTableFooter, GitPanelFrame, GitStatePane, GitTableFrame } from './GitWorkbenchPrimitives';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitWorkbenchPrimitives shared panel frames', () => {
  it('renders GitPanelFrame with quiet git-specific panel geometry', () => {
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
      expect(panel?.className).toContain('border-transparent');
      expect(panel?.className).toContain('bg-muted/[0.08]');
      expect(panel?.className).not.toContain('shadow-sm');
      expect(panel?.className).not.toContain('ring-1');
      expect(panel?.className).not.toContain('redeven-surface-panel--strong');
      expect(panel?.className).toContain('custom-frame');
      expect(panel?.textContent).toContain('Panel content');
    } finally {
      dispose();
    }
  });

  it('renders GitTableFrame with a light table surface shell', () => {
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
      expect(panel?.className).toContain('redeven-divider');
      expect(panel?.className).toContain('redeven-surface-panel');
      expect(panel?.className).not.toContain('redeven-surface-panel--strong');
      expect(panel?.className).toContain('flex');
      expect(panel?.textContent).toContain('Table content');
    } finally {
      dispose();
    }
  });

  it('renders GitMetaPill with caller classes while deferring theme styling to the shared Tag contract', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitMetaPill tone="info" class="custom-pill">
        Git tag
      </GitMetaPill>
    ), host);

    try {
      const pill = host.firstElementChild as HTMLSpanElement | null;
      expect(pill).toBeTruthy();
      expect(pill?.className).toContain('custom-pill');
      expect(pill?.textContent).toContain('Git tag');
    } finally {
      dispose();
    }
  });

  it('renders GitStatePane loading with the git sweep indicator instead of the square grid loader', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitStatePane loading message="Loading branch status..." detail="Preparing changed files." />
    ), host);

    try {
      const status = host.querySelector('[role="status"]');
      expect(status).toBeTruthy();
      expect(status?.getAttribute('aria-busy')).toBe('true');
      expect(status?.getAttribute('aria-live')).toBe('polite');
      expect(host.querySelector('.git-state-pane__loading-eyebrow')?.textContent).toContain('Loading');
      expect(host.querySelector('.git-loading-indicator')).toBeTruthy();
      expect(host.querySelector('.git-loading-indicator__bar')).toBeTruthy();
      expect(host.querySelector('.floe-grid-cell')).toBeNull();
      expect(host.textContent).toContain('Loading branch status...');
      expect(host.textContent).toContain('Preparing changed files.');
    } finally {
      dispose();
    }
  });

  it('leaves non-loading GitStatePane states free of live loading semantics', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitStatePane tone="error" message="Failed to load branches." surface />
    ), host);

    try {
      expect(host.querySelector('[role="status"]')).toBeNull();
      expect(host.querySelector('.git-loading-indicator')).toBeNull();
      expect(host.textContent).toContain('Failed to load branches.');
      expect(host.firstElementChild?.className).toContain('border-error/20');
    } finally {
      dispose();
    }
  });

  it('renders inline loading status with the same sweep language', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitInlineLoadingStatus>Loading next page</GitInlineLoadingStatus>
    ), host);

    try {
      const status = host.querySelector('.git-inline-loading-status');
      expect(status).toBeTruthy();
      expect(status?.getAttribute('role')).toBe('status');
      expect(status?.getAttribute('aria-busy')).toBe('true');
      expect(host.querySelector('.git-loading-indicator--inline')).toBeTruthy();
      expect(host.querySelector('.floe-grid-cell')).toBeNull();
      expect(host.textContent).toContain('Loading next page');
    } finally {
      dispose();
    }
  });

  it('uses the inline sweep status for paged table footer loading', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitPagedTableFooter
        summary={<span>Loaded 2 of 40 files.</span>}
        hasMore
        loading
        loadingStatus="Loading next page"
      />
    ), host);

    try {
      expect(host.querySelector('.git-inline-loading-status')).toBeTruthy();
      expect(host.querySelector('.git-loading-indicator--inline')).toBeTruthy();
      expect(host.querySelector('.floe-grid-cell')).toBeNull();
      expect(host.textContent).toContain('Loading next page');
      expect(host.textContent).toContain('Loading more...');
      expect(host.textContent).toContain('Loaded 2 of 40 files.');
    } finally {
      dispose();
    }
  });
});
