import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter, flush, renderSurfaceWithDraftCoordinator, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { restoreTransportOutbox } from '../../../../flower_ui/src/transportOutbox';

beforeEach(async () => {
  // Mock launches have no canonical admission stream; isolate their durable requests.
  let outbox = await restoreTransportOutbox();
  for (const requestID of outbox.entries.keys()) outbox = outbox.drop(requestID);
  await outbox.flushPersistence();
  outbox.dispose();
});

const home = '/Users/alice';
const target = '/Volumes/team/project';
const context = { agentHomePathAbs: home, homePathAbs: home, defaultRootId: 'home', roots: [
  { id: 'home', label: 'Home', pathAbs: home, kind: 'home', permissions: { read: true, write: true } },
  { id: 'computer', label: 'Computer', pathAbs: '/', kind: 'computer', permissions: { read: true, write: false } },
] };
function button(label: string) { return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label)!; }
async function setup(pathContext = context, history: ReturnType<typeof thread>[] = []) {
  const a = { ...adapter(), listThreads: vi.fn(async () => history), openWorkingDirectoryInFileBrowser: vi.fn(async () => undefined), getWorkingDirectoryPathContext: vi.fn(async () => pathContext), listWorkingDirectoryEntries: vi.fn(async (_input: { path: string; showHidden?: boolean }) => []) };
  const drafts = createFlowerComposerDraftCoordinator();
  const host = renderSurfaceWithDraftCoordinator(a, drafts);
  await waitFor(() => host.querySelector<HTMLElement>('.flower-working-directory-select')?.title.includes(pathContext.roots.find((root) => root.id === pathContext.defaultRootId)!.pathAbs) === true);
  const open = async () => {
    host.querySelector<HTMLButtonElement>('.flower-working-directory-select')!.click();
    await waitFor(() => !!document.querySelector('[data-filesystem-picker]'));
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
  it('recommends unique recent conversation directories and validates them before draft confirmation', async () => {
    const f = await setup(context, [
      thread({ thread_id: 'older-pinned', working_dir: '/Volumes/older', updated_at_ms: 1, pinned_at_ms: 500 }),
      thread({ thread_id: 'recent', working_dir: target, updated_at_ms: 90 }),
      thread({ thread_id: 'duplicate', working_dir: target + '/', updated_at_ms: 80 }),
      thread({ thread_id: 'other-project', working_dir: '/Volumes/other/project', updated_at_ms: 70 }),
      thread({ thread_id: 'third', working_dir: '/Volumes/third', updated_at_ms: 60 }),
      thread({ thread_id: 'invalid', working_dir: 'relative', updated_at_ms: 100 }),
      thread({ thread_id: 'child', parent_thread_id: 'recent', working_dir: '/Volumes/child-task', updated_at_ms: 110 }),
    ]);
    await f.open();
    const recents = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-picker-suggested-path]'));
    expect(recents.map(item => item.title)).toEqual([target, '/Volumes/other/project', '/Volumes/third']);
    expect(button('Recently used').getAttribute('aria-selected')).toBe('true');
    expect(button('Home').closest('[role="tablist"]')).toBe(button('Recently used').parentElement);
    expect(document.querySelector('input[aria-label="Directory path"]')).toBeNull();
    expect(button('Select').disabled).toBe(true);
    recents[0].click();
    await waitFor(() => !button('Select').disabled);
    expect(f.a.listWorkingDirectoryEntries).toHaveBeenLastCalledWith({ path: target, showHidden: false });
    expect(f.host.querySelector('.flower-working-directory-select')?.getAttribute('title')).toContain(home);
    button('Cancel').click(); await flush();
    expect(f.host.querySelector('.flower-working-directory-select')?.getAttribute('title')).toContain(home);
    await f.open();
    document.querySelector<HTMLButtonElement>('[data-picker-suggested-path]')!.click();
    await waitFor(() => !button('Select').disabled);
    button('Select').click(); await flush();
    await f.send();
    expect(f.a.launchTurn).toHaveBeenCalledWith(expect.objectContaining({ working_dir: target }));
  });

  it('shows no recent tab when this environment has no conversation history', async () => {
    const f = await setup(); await f.open();
    expect(document.querySelector('[data-picker-suggestions]')).toBeNull();
  });

  it('keeps an unavailable recent directory unconfirmed and preserves the draft on cancel', async () => {
    const f = await setup(context, [thread({ working_dir: target })]);
    await f.open();
    f.a.listWorkingDirectoryEntries.mockRejectedValueOnce({ code: 404, message: 'Directory no longer exists' });
    document.querySelector<HTMLButtonElement>('[data-picker-suggested-path]')!.click();
    await waitFor(() => !!document.querySelector('[role="alert"]'));
    expect(button('Select').disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Directory path"]')?.value).toBe(target);
    expect(f.host.querySelector('.flower-working-directory-select')?.getAttribute('title')).toContain(home);
    button('Cancel').click(); await flush();
    await f.send();
    expect(f.a.launchTurn).toHaveBeenCalledWith(expect.objectContaining({ working_dir: home }));
  });

  it('browses the draft from the header without changing the draft or opening its picker', async () => {
    const f = await setup();
    expect(f.host.querySelector('[data-flower-composer-control="working_dir"]')).toBeNull();
    expect(f.host.querySelector('.flower-empty-hero .flower-working-directory-select')).not.toBeNull();
    f.host.querySelector<HTMLButtonElement>('.flower-chat-header .flower-working-directory-browse')!.click();
    await flush();
    expect(f.a.openWorkingDirectoryInFileBrowser).toHaveBeenCalledExactlyOnceWith({ path: home });
    expect(document.querySelector('input[aria-label="Directory path"]')).toBeNull();
    await f.send();
    expect(f.a.launchTurn).toHaveBeenCalledWith(expect.objectContaining({ working_dir: home }));
  });

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
    expect(f.host.querySelector<HTMLElement>('.flower-working-directory-select')?.title).toContain(home);
    await f.open(); await f.navigate(target); button('Select').click(); await flush();
    expect(f.host.querySelector<HTMLElement>('.flower-working-directory-select')?.title).toContain(target);
    f.host.querySelector<HTMLButtonElement>('.flower-working-directory-browse')!.click();
    await flush();
    expect(f.a.openWorkingDirectoryInFileBrowser).toHaveBeenCalledExactlyOnceWith({ path: target });
    await f.open();
    expect(f.a.listWorkingDirectoryEntries).toHaveBeenLastCalledWith({ path: target, showHidden: false });
    expect(f.a.listWorkingDirectoryEntries.mock.calls.some(([input]) => input.path.includes('/Users/alice/Volumes'))).toBe(false);
    expect(f.a.getWorkingDirectoryPathContext).toHaveBeenCalledTimes(4);
    button('Cancel').click(); await flush(); await f.send();
    expect(f.a.launchTurn).toHaveBeenCalledWith(expect.objectContaining({ working_dir: target }));
  });
});
