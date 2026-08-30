// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GitContentSkeleton, GitInlineLoadingStatus, GitMetaPill, GitPagedTableFooter, GitPanelFrame, GitShortcutOrbButton, GitStatePane, GitTableFrame } from './GitWorkbenchPrimitives';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitWorkbenchPrimitives shared panel frames', () => {
  it('maps shortcut orbs to theme-owned categorical and status colors', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const TestIcon = (props: { class?: string }) => <span data-testid="shortcut-icon" class={props.class} />;

    const dispose = render(() => (
      <>
        <GitShortcutOrbButton label="Ask Flower" tone="flower" icon={TestIcon} />
        <GitShortcutOrbButton label="Open terminal" tone="terminal" icon={TestIcon} />
        <GitShortcutOrbButton label="Browse files" tone="files" icon={TestIcon} />
      </>
    ), host);

    try {
      const buttons = host.querySelectorAll<HTMLButtonElement>('[data-git-shortcut-orb]');
      expect(buttons).toHaveLength(3);
      const shell = buttons[0]?.querySelector('span');
      expect(shell?.className).toContain('text-foreground');
      expect(shell?.className).toContain('hover:bg-muted');
      const icons = host.querySelectorAll<HTMLElement>('[data-testid="shortcut-icon"]');
      expect(icons[0]?.className).toContain('text-[var(--redeven-categorical-4)]');
      expect(icons[1]?.className).toContain('text-[var(--redeven-status-info)]');
      expect(icons[2]?.className).toContain('text-[var(--redeven-status-success)]');
    } finally {
      dispose();
    }
  });

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

  it('renders GitStatePane loading as a content-shaped skeleton', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitStatePane loading loadingVariant="commit-detail" loadingRows={3} message="Loading branch status..." detail="Preparing changed files." />
    ), host);

    try {
      const status = host.querySelector('[role="status"]');
      expect(status).toBeTruthy();
      expect(status?.getAttribute('aria-busy')).toBe('true');
      expect(status?.getAttribute('aria-live')).toBe('polite');
      expect(host.querySelector('[data-git-content-skeleton="commit-detail"]')).toBeTruthy();
      expect(host.querySelector('.git-content-skeleton__detail-title')).toBeTruthy();
      expect(host.querySelectorAll('.git-content-skeleton__table-row')).toHaveLength(3);
      expect(host.querySelector('.git-loading-indicator')).toBeNull();
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
      expect(host.querySelector('[data-git-content-skeleton]')).toBeNull();
      expect(host.textContent).toContain('Failed to load branches.');
      expect(host.firstElementChild?.className).toContain('border-error/20');
    } finally {
      dispose();
    }
  });

  it('renders inline loading status as a text-slot skeleton', () => {
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
      expect(host.querySelector('.git-inline-loading-status__skeleton')).toBeTruthy();
      expect(host.querySelector('.git-loading-indicator--inline')).toBeNull();
      expect(host.querySelector('.floe-grid-cell')).toBeNull();
      expect(host.textContent).toContain('Loading next page');
    } finally {
      dispose();
    }
  });

  it('uses content-shaped skeleton slots for paged table footer loading', () => {
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
      expect(host.querySelector('.git-inline-loading-status__skeleton')).toBeTruthy();
      expect(host.querySelector('.git-paged-footer__button-skeleton')).toBeTruthy();
      expect(host.querySelector('.git-loading-indicator--inline')).toBeNull();
      expect(host.querySelector('.floe-grid-cell')).toBeNull();
      expect(host.textContent).toContain('Loading next page');
      expect(host.textContent).not.toContain('Loading more...');
      expect(host.textContent).toContain('Loaded 2 of 40 files.');
    } finally {
      dispose();
    }
  });

  it('matches the graph-detail and patch loading geometries', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <>
        <GitContentSkeleton label="Loading branch history" variant="commit-graph-detail" rows={6} />
        <GitContentSkeleton label="Loading patch" variant="patch" rows={5} />
      </>
    ), host);

    try {
      const split = host.querySelector('[data-git-content-skeleton="commit-graph-detail"]');
      expect(split?.querySelectorAll('.git-content-skeleton__graph-row')).toHaveLength(6);
      expect(split?.querySelector('.git-content-skeleton__detail-panel')).toBeTruthy();
      expect(split?.querySelector('.git-content-skeleton__table')).toBeTruthy();
      const patch = host.querySelector('[data-git-content-skeleton="patch"]');
      expect(patch?.querySelector('.git-content-skeleton__patch-heading')).toBeTruthy();
      expect(patch?.querySelectorAll('.git-content-skeleton__code-row')).toHaveLength(8);
    } finally {
      dispose();
    }
  });
});
