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
  it('does not reset expansion when a page object changes but its scope stays equal', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const [state, setState] = createSignal({ items: [folder], directoryPath: '', generation: 1, loading: false });
    dispose = render(() => <GitWorkspaceTree items={state().items} directoryPath={state().directoryPath} section="changes" generation={state().generation} refreshing={state().loading} loadDirectory={vi.fn().mockResolvedValue(response())} />, host);
    host.querySelector<HTMLButtonElement>('[data-git-tree-select="src"]')!.click(); await flush();
    host.querySelector<HTMLButtonElement>('[data-git-tree-select="src/deep"]')!.click();
    const leaf = host.querySelector(`[data-git-tree-select="${file.path}"]`);
    setState(old => ({ ...old, loading: true })); await flush();
    expect(host.querySelector(`[data-git-tree-select="${file.path}"]`)).toBe(leaf);
    setState(old => ({ ...old, items: [{ ...folder }], generation: 2, loading: false })); await flush();
    expect(host.querySelector(`[data-git-tree-select="${file.path}"]`)).toBe(leaf);
  });

  it('retains loaded nodes, focus and labels while a folder page refreshes', async () => {
    let finish!: (value: GitListWorkspacePageResponse) => void;
    const load = vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { host, click, setGeneration } = mount(load);
    click('src'); await flush(); click('src/deep');
    const root = host.querySelector<HTMLButtonElement>('[data-git-tree-select="src"]')!;
    const leaf = host.querySelector<HTMLButtonElement>(`[data-git-tree-select="${file.path}"]`)!;
    leaf.focus();
    setGeneration(1); await flush();
    expect(host.querySelector(`[data-git-tree-select="${file.path}"]`)).toBe(leaf);
    expect(host.querySelector('[data-git-content-skeleton]')).toBeNull();
    finish(response([{ ...file, changeType: 'added' }])); await flush();
    expect(host.querySelector('[data-git-tree-select="src"]')).toBe(root);
    expect(host.querySelector(`[data-git-tree-select="${file.path}"]`)).toBe(leaf);
    expect(document.activeElement).toBe(leaf);
    expect(leaf.innerHTML).toContain('--redeven-status-success-foreground');
  });

  it('keeps existing directory descendants mounted when appending files', async () => {
    const load = vi.fn().mockResolvedValueOnce(response([file], true)).mockResolvedValueOnce(response([{ ...file, path: 'src/deep/second.ts' }]));
    const { host, click } = mount(load);
    click('src'); await flush(); click('src/deep');
    const leaf = host.querySelector(`[data-git-tree-select="${file.path}"]`);
    Array.from(host.querySelectorAll('button')).find(button => button.textContent?.toLowerCase().includes('load more'))!.click();
    await flush();
    expect(host.querySelector(`[data-git-tree-select="${file.path}"]`)).toBe(leaf);
    expect(host.querySelector('[data-git-tree-select="src/deep/second.ts"]')).not.toBeNull();
  });

  it('reports visible expansion, filtering and removal for collapse controls', () => {
    const host = document.createElement('div'); document.body.append(host);
    const [items, setItems] = createSignal([file]);
    const [filter, setFilter] = createSignal('');
    const [collapseToken, setCollapseToken] = createSignal(0);
    const expanded = vi.fn();
    dispose = render(() => <GitWorkspaceTree items={items()} directoryPath="" section="changes" generation={0} filter={filter()} collapseToken={collapseToken()} onExpandedChange={expanded} />, host);
    expect(expanded).toHaveBeenLastCalledWith(false);
    host.querySelector<HTMLButtonElement>('[data-git-tree-select="src"]')!.click();
    expect(expanded).toHaveBeenLastCalledWith(true);
    setCollapseToken(1);
    expect(expanded).toHaveBeenLastCalledWith(false);
    setFilter('component');
    expect(expanded).toHaveBeenLastCalledWith(true);
    setItems([]);
    expect(expanded).toHaveBeenLastCalledWith(false);
  });

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
  it('expands a slow directory without inserting flashing skeleton rows', async () => {
    let finish!: (value: GitListWorkspacePageResponse) => void;
    const load = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { host, click } = mount(load);
    const row = host.querySelector('[data-git-tree-select="src"]');
    click('src'); await flush();
    expect(host.querySelector('[data-git-tree-select="src"]')).toBe(row);
    expect(host.querySelector('[data-git-tree-path="src"]')?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('[data-git-content-skeleton]')).toBeNull();
    finish(response()); await flush();
    expect(host.querySelector('[data-git-tree-select="src/deep"]')).not.toBeNull();
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
