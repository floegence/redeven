import '../../index.css';
import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { redevenV1Contract } from '../protocol/redeven_v1';
import type { GitSeededWorkspaceChange } from '../utils/gitWorkbench';
import { GitChangesPanel } from './GitChangesPanel';

const files: GitSeededWorkspaceChange[] = Array.from({ length: 24 }, (_, index) => ({
  section: 'unstaged', changeType: 'modified', path: `src/feature-${index}.ts`, displayPath: `src/feature-${index}.ts`,
  additions: 70, deletions: 1,
  patchText: `@@ -1,1 +1,70 @@\n-old${index}\n` + Array.from({ length: 70 }, (_, line) => `+const file${index}Line${line} = ${line};`).join('\n'),
}));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

function mount(width: number) {
  const host = document.createElement('div');
  Object.assign(host.style, { width: `${width}px`, height: '640px' });
  document.body.append(host);
  const [items, setItems] = createSignal(files);
  dispose = render(() => (
    <LayoutProvider><NotificationProvider><ProtocolProvider contract={redevenV1Contract}>
      <GitChangesPanel selectedSection="changes" workspace={{
        repoRootPath: '/workspace/repo', summary: { unstagedCount: items().length, stagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
        staged: [], unstaged: items(), untracked: [], conflicted: [],
      }} />
    </ProtocolProvider></NotificationProvider></LayoutProvider>
  ), host);
  return { host, setItems };
}

describe('Git inline diff browsing', () => {
  it('keeps both viewports contained, navigates files with the keyboard, and reconciles a removed selection', async () => {
    await page.viewport(1280, 800);
    const { host, setItems } = mount(1100);
    await expect.poll(() => host.querySelector('[data-git-diff-panel]')?.textContent).toContain('file0Line0');
    const rail = host.querySelector<HTMLElement>('.git-diff-split__files')!;
    const detail = host.querySelector<HTMLElement>('.git-diff-split__detail')!;
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
});
