import '../../index.css';
import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redevenV1Contract } from '../protocol/redeven_v1';
import type { GitSeededWorkspaceChange } from '../utils/gitWorkbench';
import { GitChangesPanel } from './GitChangesPanel';
import { GitHistoryBrowser } from './GitHistoryBrowser';

const rpcTransport = vi.hoisted(() => ({}));
vi.mock('@floegence/floe-webapp-protocol', async () => ({
  ...await vi.importActual<typeof import('@floegence/floe-webapp-protocol')>('@floegence/floe-webapp-protocol'),
  useProtocol: () => ({ rpcTransport: () => rpcTransport, session: () => ({ connected: true }) }),
}));
vi.mock('../protocol/redeven_v1', async () => ({
  ...await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1'),
  useRedevenRpc: () => ({ git: { getCommitDetail: async () => ({
    repoRootPath: '/workspace/repo', commit: { hash: 'abc123', shortHash: 'abc123', parents: [], subject: 'Review compact file navigation' }, files,
  }) } }),
}));

const files: GitSeededWorkspaceChange[] = Array.from({ length: 24 }, (_, index) => ({
  section: 'unstaged', changeType: 'modified', path: `src/feature-${index}.ts`, displayPath: `src/feature-${index}.ts`,
  additions: 70, deletions: 1,
  patchText: `@@ -1,1 +1,70 @@\n-old${index}\n` + Array.from({ length: 70 }, (_, line) => `+const file${index}Line${line} = ${line};`).join('\n'),
}));
let dispose: (() => void) | undefined;
const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
afterEach(async () => {
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  dispose?.(); document.body.replaceChildren();
});

function mount(width: number, items = files) {
  const host = document.createElement('div');
  Object.assign(host.style, { width: `${width}px`, height: '640px' });
  document.body.append(host);
  const [currentItems, setItems] = createSignal(items);
  dispose = render(() => (
    <LayoutProvider><NotificationProvider><ProtocolProvider contract={redevenV1Contract}>
      <GitChangesPanel selectedSection="changes" workspace={{
        repoRootPath: '/workspace/repo', summary: { unstagedCount: currentItems().length, stagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
        staged: [], unstaged: currentItems(), untracked: [], conflicted: [],
      }} />
    </ProtocolProvider></NotificationProvider></LayoutProvider>
  ), host);
  return { host, setItems };
}

describe('Git inline diff browsing', () => {
  it('keeps commit files dense, preserves exact path access, and switches without moving the rail', async () => {
    await page.viewport(1280, 800);
    const host = document.createElement('div');
    Object.assign(host.style, { width: '1100px', height: '640px' });
    document.body.append(host);
    dispose = render(() => <LayoutProvider><NotificationProvider>
      <GitHistoryBrowser currentPath="/workspace/repo" repoInfo={{ available: true, repoRootPath: '/workspace/repo' }} selectedCommitHash="abc123" />
    </NotificationProvider></LayoutProvider>, host);
    await expect.poll(() => host.querySelectorAll('[role="option"]').length).toBe(24);
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const before = rows[1].getBoundingClientRect();
    expect(before.height).toBe(30);
    expect(rows[0].querySelector('[title="src/feature-0.ts"]')).not.toBeNull();
    expect(rows[0].textContent).toContain('Modified');
    rows[0].focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(() => host.querySelector('[data-git-diff-panel]')?.textContent).toContain('file1Line0');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    expect(rows[1].getBoundingClientRect().top).toBe(before.top);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps both viewports contained, navigates files with the keyboard, and reconciles a removed selection', async () => {
    await page.viewport(1280, 800);
    const { host, setItems } = mount(1100);
    await expect.poll(() => host.querySelector('[data-git-diff-panel]')?.textContent).toContain('file0Line0');
    const rail = host.querySelector<HTMLElement>('.git-diff-split__files')!;
    const detail = host.querySelector<HTMLElement>('.git-diff-split__detail')!;
    const rows = Array.from(rail.querySelectorAll<HTMLElement>('tr[aria-selected]'));
    expect(Math.max(...rows.map((row) => row.getBoundingClientRect().height))).toBeLessThanOrEqual(32);
    expect(rows.filter((row) => row.getBoundingClientRect().bottom <= rail.getBoundingClientRect().bottom).length).toBeGreaterThanOrEqual(15);
    expect(rail.getBoundingClientRect().right).toBeLessThanOrEqual(detail.getBoundingClientRect().left + 1);
    expect(host.scrollWidth).toBe(host.clientWidth);
    const first = rail.querySelector<HTMLButtonElement>('td:first-child button')!;
    first.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(() => detail.textContent).toContain('file1Line0');
    expect(detail.textContent).not.toContain('file0Line0');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const scrollers = Array.from(detail.querySelectorAll<HTMLElement>('*')).filter((el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight);
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0].getBoundingClientRect().bottom).toBeLessThanOrEqual(detail.getBoundingClientRect().bottom + 1);
    scrollers[0].scrollTop = 150;
    expect(scrollers[0].scrollTop).toBeGreaterThan(0);
    setItems(files.filter((file) => file.path !== 'src/feature-1.ts'));
    await expect.poll(() => detail.textContent).toContain('file0Line0');
    expect(rail.querySelector('[aria-selected="true"]')?.textContent).toContain('feature-0.ts');
    expect(scrollers[0].scrollTop).toBe(0);
  });

  it('stacks the file rail above the diff at narrow container widths without horizontal page overflow', async () => {
    await page.viewport(1100, 800);
    const { host } = mount(420);
    await expect.poll(() => host.querySelector('[data-git-diff-panel]')?.textContent).toContain('file0Line0');
    const rail = host.querySelector<HTMLElement>('.git-diff-split__files')!;
    const detail = host.querySelector<HTMLElement>('.git-diff-split__detail')!;
    expect(rail.getBoundingClientRect().bottom).toBeLessThanOrEqual(detail.getBoundingClientRect().top + 1);
    expect(detail.clientHeight).toBeGreaterThan(250);
    expect(host.scrollWidth).toBe(host.clientWidth);
    expect(detail.scrollWidth).toBe(detail.clientWidth);
  });

  it('respects reduced motion while retaining immediate keyboard navigation', async () => {
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    const { host } = mount(1100);
    await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')).not.toBeNull();
    const row = host.querySelector<HTMLElement>('tr[aria-selected]')!;
    expect(getComputedStyle(row).transitionDuration).toBe('0s');
    expect(getComputedStyle(host.querySelector('.git-patch-viewer__viewport')!).animationName).toBe('none');
    row.querySelector('button')!.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(() => host.querySelector('[data-git-diff-panel]')?.textContent).toContain('file1Line0');
  });

  it('keeps a visible horizontal scrollbar inside the constrained patch viewport for long diff lines', async () => {
    await page.viewport(1280, 800);
    const longLine = `+const generatedLine = "${'x'.repeat(1800)}";`;
    const longFile = {
      ...files[0],
      patchText: `@@ -1,1 +1,71 @@\n${longLine}\n${files[0].patchText}`,
    };
    const { host } = mount(1100, [longFile]);
    await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')).not.toBeNull();
    const viewport = host.querySelector<HTMLElement>('.git-patch-viewer__viewport')!;
    const detail = host.querySelector<HTMLElement>('.git-diff-split__detail')!;
    expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth);
    expect(getComputedStyle(viewport).overflowX).toBe('auto');
    await expect.poll(() => host.querySelector('[data-floe-horizontal-scrollbar]')).not.toBeNull();
    const scrollbar = host.querySelector<HTMLElement>('[data-floe-horizontal-scrollbar]')!;
    const thumb = scrollbar.querySelector<HTMLElement>('[data-floe-horizontal-scrollbar-thumb]')!;
    expect(scrollbar.getAttribute('role')).toBe('scrollbar');
    expect(scrollbar.getAttribute('aria-controls')).toBe(viewport.id);
    expect(getComputedStyle(thumb).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    const top = scrollbar.getBoundingClientRect().top;
    viewport.scrollTop = 300;
    expect(scrollbar.getBoundingClientRect().top).toBe(top);
    viewport.scrollLeft = 250;
    await expect.poll(() => Number(scrollbar.getAttribute('aria-valuenow'))).toBe(250);
    expect(parseFloat(thumb.style.left)).toBeGreaterThan(0);
    expect(scrollbar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(scrollbar.getBoundingClientRect().height).toBeGreaterThanOrEqual(10);
    expect(thumb.getBoundingClientRect().width).toBeGreaterThan(20);
    expect(scrollbar.getBoundingClientRect().bottom).toBeLessThanOrEqual(detail.getBoundingClientRect().bottom + 1);

    scrollbar.focus();
    await userEvent.keyboard('{End}');
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    await userEvent.keyboard('{Home}');
    expect(viewport.scrollLeft).toBe(0);
  });

  it('remeasures content and resizing, and removes the track for short files', async () => {
    await page.viewport(1280, 800);
    const { host, setItems } = mount(1100, [files[0]]);
    await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')).not.toBeNull();
    expect(host.querySelector('[data-floe-horizontal-scrollbar]')).toBeNull();
    setItems([{ ...files[0], patchText: `@@ -1 +1 @@\n+${'wide'.repeat(200)}` }]);
    await expect.poll(() => host.querySelector('[data-floe-horizontal-scrollbar]')).not.toBeNull();
    const scrollbar = host.querySelector<HTMLElement>('[data-floe-horizontal-scrollbar]')!;
    const maximum = Number(scrollbar.getAttribute('aria-valuemax'));
    host.style.width = '800px';
    await expect.poll(() => Number(scrollbar.getAttribute('aria-valuemax'))).toBeGreaterThan(maximum);
    setItems([files[1]]);
    await expect.poll(() => host.querySelector('[data-floe-horizontal-scrollbar]')).toBeNull();
  });

  it('drags the thumb precisely under Workbench scaling and seeks on track clicks', async () => {
    await page.viewport(1280, 800);
    const { host } = mount(1100, [{ ...files[0], patchText: `@@ -1 +1 @@\n+${'wide'.repeat(400)}` }]);
    host.style.transform = 'scale(0.6)';
    host.style.transformOrigin = 'top left';
    await expect.poll(() => host.querySelector('[data-floe-horizontal-scrollbar]')).not.toBeNull();
    const interaction = commands as unknown as { exerciseGitScrollbar: () => Promise<{ fraction: number; afterTrackClick: number }> };
    const result = await interaction.exerciseGitScrollbar();
    expect(result.fraction).toBeCloseTo(0.5, 1);
    expect(result.afterTrackClick).toBeGreaterThan(0.9);
  });

});
