import { describe, expect, it, vi } from 'vitest';
import { adapter, flush, renderSurfaceWithDraftCoordinator, waitFor } from './FlowerSurface.navigation.testHarness';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
const home = '/Users/alice';
const target = '/Volumes/team/project';
const context = { agentHomePathAbs: home, homePathAbs: home, defaultRootId: 'home', roots: [
  { id: 'home', label: 'Home', pathAbs: home, kind: 'home', permissions: { read: true, write: true } },
  { id: 'computer', label: 'Computer', pathAbs: '/', kind: 'computer', permissions: { read: true, write: false } },
] };
function button(label: string) { return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label)!; }
async function setup(pathContext = context) {
  const a = { ...adapter(), getWorkingDirectoryPathContext: vi.fn(async () => pathContext), listWorkingDirectoryEntries: vi.fn(async (_input: { path: string; showHidden?: boolean }) => []) };
  const drafts = createFlowerComposerDraftCoordinator();
  const host = renderSurfaceWithDraftCoordinator(a, drafts);
  await waitFor(() => host.querySelector<HTMLElement>('[data-flower-composer-control="working_dir"]')?.title.includes(pathContext.roots.find((root) => root.id === pathContext.defaultRootId)!.pathAbs) === true);
  const open = async () => {
    host.querySelector<HTMLButtonElement>('[data-flower-composer-control="working_dir"]')!.click();
    await waitFor(() => !!document.querySelector('input[aria-label="Directory path"]'));
    await flush();
  };
  const navigate = async (path: string) => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Directory path"]')!;
    input.value = path; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    button('Go').click(); await waitFor(() => !button('Select').disabled);
  };
  const send = async () => {
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Inspect this directory'; textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !host.querySelector<HTMLButtonElement>('.flower-composer-submit')!.disabled);
    host.querySelector<HTMLButtonElement>('.flower-composer-submit')!.click();
    await waitFor(() => vi.mocked(a.launchTurn).mock.calls.length > 0);
  };
  return { a, host, open, navigate, send };
}
describe('Flower published absolute directory picker', () => {
  it('uses the declared default root for both display and creation', async () => {
    const f = await setup({ ...context, defaultRootId: 'project', roots: [
      { id: 'project', label: 'Project', pathAbs: target, kind: 'custom', permissions: { read: true, write: false } },
    ] });
    await f.send();
    expect(f.a.launchTurn).toHaveBeenCalledWith(expect.objectContaining({ working_dir: target }));
  });
  it('commits an external path to the draft only on confirmation, and reopens at that path', async () => {
    const f = await setup(); await f.open(); await f.navigate(target);
    button('Cancel').click(); await flush();
    expect(f.host.querySelector<HTMLElement>('[data-flower-composer-control="working_dir"]')?.title).toContain(home);
    await f.open(); await f.navigate(target); button('Select').click(); await flush();
    expect(f.host.querySelector<HTMLElement>('[data-flower-composer-control="working_dir"]')?.title).toContain(target);
    await f.open();
    expect(f.a.listWorkingDirectoryEntries).toHaveBeenLastCalledWith({ path: target, showHidden: false });
    expect(f.a.listWorkingDirectoryEntries.mock.calls.some(([input]) => input.path.includes('/Users/alice/Volumes'))).toBe(false);
    expect(f.a.getWorkingDirectoryPathContext).toHaveBeenCalledTimes(4);
    button('Cancel').click(); await flush(); await f.send();
    expect(f.a.launchTurn).toHaveBeenCalledWith(expect.objectContaining({ working_dir: target }));
  });
});
