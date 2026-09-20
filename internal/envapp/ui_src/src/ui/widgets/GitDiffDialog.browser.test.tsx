import '../../index.css';
import { FloeConfigProvider, LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitDiffDialog } from './GitDiffDialog';
import { floatingWindowStorageKey } from './PersistentFloatingWindow';

const getDiffContent = vi.hoisted(() => vi.fn());
vi.mock('../protocol/redeven_v1', async () => ({
  ...await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1'),
  useRedevenRpc: () => ({ git: { getDiffContent } }),
}));

const file = {
  changeType: 'added' as const,
  path: 'sample.py',
  displayPath: 'sample.py',
  additions: 380,
  deletions: 0,
  patchText: [
    'diff --git a/sample.py b/sample.py',
    '--- /dev/null',
    '+++ b/sample.py',
    '@@ -0,0 +1,380 @@',
    ...Array.from({ length: 380 }, (_, index) => `+line_${index + 1} = "${'long diff content '.repeat(18)}"`),
  ].join('\n'),
};
let dispose: (() => void) | undefined;

beforeEach(() => {
  localStorage.removeItem(floatingWindowStorageKey('git-diff-dialog'));
  getDiffContent.mockReset();
  getDiffContent.mockResolvedValue({ repoRootPath: '/workspace/repo', mode: 'full', file });
});
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  localStorage.removeItem(floatingWindowStorageKey('git-diff-dialog'));
});

async function mount(floating: boolean, projected = false) {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => {
    const [open, setOpen] = createSignal(true);
    const [backgroundClicks, setBackgroundClicks] = createSignal(0);
    return <FloeConfigProvider><LayoutProvider><NotificationProvider>
      <button data-testid="background-action" style={{ position: 'fixed', left: '0', top: '0' }} onClick={() => setBackgroundClicks(count => count + 1)}>Background action</button>
      <output data-testid="background-count">{backgroundClicks()}</output>
      <div data-testid="diff-owner" data-floe-dialog-surface-host={projected ? 'true' : undefined}
        style={projected ? { width: '420px', height: '320px', transform: 'translate(24px, 16px) scale(0.7)' } : undefined}>
        <GitDiffDialog open={open()} onOpenChange={setOpen} title="Workspace Diff" description="sample.py"
          desktopFloatingWindow={floating} item={file}
          source={{ kind: 'workspace', repoRootPath: '/workspace/repo', workspaceSection: 'untracked' }}
          emptyMessage="Select a file to inspect its diff." />
      </div>
    </NotificationProvider></LayoutProvider></FloeConfigProvider>;
  }, host);
  await expect.poll(() => document.querySelector('.git-patch-viewer__viewport')).not.toBeNull();
  return {
    viewport: document.querySelector<HTMLElement>('.git-patch-viewer__viewport')!,
    surface: document.querySelector<HTMLElement>('[role="dialog"]')!,
  };
}

function expectScrollableAndContained(viewport: HTMLElement, surface: HTMLElement) {
  expect(viewport.clientHeight).toBeGreaterThan(100);
  expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
  expect(getComputedStyle(viewport).overflowY).toBe('auto');
  expect(viewport.getBoundingClientRect().bottom).toBeLessThanOrEqual(surface.getBoundingClientRect().bottom + 1);
  const toolbar = surface.querySelector<HTMLElement>('.git-diff-panel__toolbar')!;
  const top = toolbar.getBoundingClientRect().top;
  viewport.scrollTop = viewport.scrollHeight;
  expect(viewport.scrollTop).toBeGreaterThan(0);
  expect(toolbar.getBoundingClientRect().top).toBe(top);
  const last = viewport.firstElementChild!.lastElementChild!;
  expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom + 1);
}

async function expandAndReachLastLine(viewport: HTMLElement, surface: HTMLElement) {
  const expand = page.getByRole('button', { name: 'Show all 384 lines', exact: true });
  await expand.click();
  await expect.poll(() => viewport.textContent).toContain('+line_380 =');
  expectScrollableAndContained(viewport, surface);
  const scrollbar = surface.querySelector<HTMLElement>('[data-floe-horizontal-scrollbar]')!;
  expect(scrollbar).not.toBeNull();
  expect(scrollbar.getBoundingClientRect().bottom).toBeLessThanOrEqual(surface.getBoundingClientRect().bottom + 1);
  expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth);
}

describe('Git diff reading surfaces', () => {
  it.each([
    { name: 'desktop dialog', floating: false, width: 1440, height: 900 },
    { name: 'desktop floating window', floating: true, width: 1440, height: 900 },
    { name: 'mobile diff', floating: true, width: 390, height: 740 },
  ])('scrolls and expands long patches inside the $name', async ({ floating, width, height }) => {
    await page.viewport(width, height);
    const { viewport, surface } = await mount(floating);
    expectScrollableAndContained(viewport, surface);
    await expandAndReachLastLine(viewport, surface);
  });

  it('keeps desktop diff inspection nonmodal, scrollable after resizing, and closable', async () => {
    await page.viewport(1440, 900);
    const { viewport, surface } = await mount(true);
    expect(document.querySelector('[data-floe-geometry-surface="floating-window"]')).not.toBeNull();
    expect(document.querySelector('[data-floe-dialog-backdrop]')).toBeNull();
    await page.getByTestId('background-action').click();
    expect(document.querySelector('[data-testid="background-count"]')?.textContent).toBe('1');
    await page.getByRole('button', { name: 'Full Context', exact: true }).click();
    await expect.poll(() => getDiffContent.mock.calls.length).toBe(1);
    await expect.poll(() => surface.querySelector('.git-diff-panel__modes [aria-pressed="true"]')?.textContent).toBe('Full Context');
    await expandAndReachLastLine(document.querySelector<HTMLElement>('.git-patch-viewer__viewport')!, surface);
    const previousHeight = viewport.clientHeight;
    await page.viewport(1000, 650);
    await expect.poll(() => surface.getBoundingClientRect().bottom).toBeLessThanOrEqual(650);
    const resizedViewport = surface.querySelector<HTMLElement>('.git-patch-viewer__viewport')!;
    expectScrollableAndContained(resizedViewport, surface);
    expect(resizedViewport.clientHeight).toBeLessThan(previousHeight);
    await userEvent.click(surface.querySelector<HTMLElement>('[data-floe-floating-window-control="close"]')!);
    await expect.poll(() => document.querySelector('[data-floe-geometry-surface="floating-window"]')).toBeNull();
  });

  it('keeps a diff launched from a transformed Files surface in the shared floating layer', async () => {
    await page.viewport(1440, 900);
    const { viewport, surface } = await mount(true, true);
    const windowRoot = surface.closest<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
    expect(windowRoot).not.toBeNull();
    expect(windowRoot.getAttribute('data-floe-local-interaction-surface')).toBe('true');
    expect(document.querySelector('[data-testid="diff-owner"]')!.contains(windowRoot)).toBe(false);
    expect(windowRoot.getBoundingClientRect().width).toBe(1100);
    expectScrollableAndContained(viewport, surface);
    await expandAndReachLastLine(viewport, surface);
  });
});
