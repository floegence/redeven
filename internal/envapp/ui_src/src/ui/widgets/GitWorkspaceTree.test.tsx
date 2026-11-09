// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitWorkspaceTree } from './GitWorkspaceTree';
import type { GitListWorkspacePageResponse } from '../protocol/redeven_v1';

const folder = { entryKind: 'directory', path: 'src', directoryPath: 'src', section: 'changes', descendantFileCount: 900 };
const file = { path: 'src/deep/component.tsx', section: 'unstaged', changeType: 'modified' };
const response = (items = [file], hasMore = false): GitListWorkspacePageResponse => ({ repoRootPath: '/repo', directoryPath: 'src', section: 'changes', summary: {}, items, nextOffset: 1, hasMore });
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function mount(load = vi.fn().mockResolvedValue(response())) {
  const host = document.createElement('div'); document.body.append(host);
  const [generation, setGeneration] = createSignal(0);
  const select = vi.fn();
  dispose = render(() => <GitWorkspaceTree items={[folder]} directoryPath="" section="changes" generation={generation()} loadDirectory={load} onSelect={select} />, host);
  const click = (path: string) => host.querySelector<HTMLButtonElement>(`[data-git-tree-select="${path}"]`)!.click();
  return { host, setGeneration, click, select };
}
describe('GitWorkspaceTree directory reads', () => {
  it('starts collapsed, loads on demand, retains exact leaf actions and omits verbose counts', async () => {
    const load = vi.fn().mockResolvedValue(response());
    const { host, click, select } = mount(load);
    expect(load).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('900');
    click('src'); await flush();
    expect(load).toHaveBeenCalledWith('changes', 'src', 0);
    click('src/deep'); click(file.path);
    expect(select).toHaveBeenCalledWith(file);
    click('src'); click('src'); await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('rejects an old pending folder page after a generation change', async () => {
    let resolveOld!: (value: GitListWorkspacePageResponse) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(response([{ ...file, path: 'src/fresh.ts' }]));
    const { host, click, setGeneration } = mount(load);
    click('src'); setGeneration(1); await flush();
    resolveOld(response([{ ...file, path: 'src/stale.ts' }])); await flush();
    expect(host.querySelector('[data-git-tree-select="src/fresh.ts"]')).not.toBeNull();
    expect(host.querySelector('[data-git-tree-select="src/stale.ts"]')).toBeNull();
  });
  it('retries a failed append at the same offset without losing loaded rows', async () => {
    const load = vi.fn().mockResolvedValueOnce(response([{ ...file, path: 'src/first.ts' }], true)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response([{ ...file, path: 'src/second.ts' }]));
    const { host, click } = mount(load);
    click('src'); await flush();
    Array.from(host.querySelectorAll('button')).find(button => button.textContent?.toLowerCase().includes('load more'))!.click(); await flush();
    expect(host.querySelector('[data-git-tree-select="src/first.ts"]')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); await flush();
    expect(load.mock.calls.map(call => call[2])).toEqual([0, 1, 1]);
    expect(host.querySelector('[data-git-tree-select="src/second.ts"]')).not.toBeNull();
  });
  it('uses tree keyboard navigation without triggering file actions on focus alone', async () => {
    const { host, click, select } = mount();
    click('src'); await flush(); click('src/deep');
    const root = host.querySelector<HTMLButtonElement>('[data-git-tree-select="src"]')!;
    root.focus(); root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect((document.activeElement as HTMLElement).dataset.gitTreeSelect).toBe(file.path);
    expect(select).not.toHaveBeenCalled();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect((document.activeElement as HTMLElement).dataset.gitTreeSelect).toBe('src/deep');
  });
});
