// @vitest-environment jsdom
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createFilePreviewWorkspace, type FilePreviewWorkspace } from './createFilePreviewWorkspace';
const read = vi.hoisted(() => vi.fn());
vi.mock('../utils/fileStreamReader', () => ({ openReadFileStreamChannel: (...args: unknown[]) => read(...args) }));
const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.clearAllMocks(); });
const file = (name: string) => ({ id: name, name, path: '/workspace/' + name, type: 'file' as const });
function channel(text: string) {
  const bytes = new TextEncoder().encode(text);
  return { meta: { content_len: bytes.length }, channel: { reader: { readExactly: async () => bytes }, close: vi.fn(), stream: { reset: vi.fn() } } };
}
function mount(writeFile = vi.fn(async () => ({}))) {
  let workspace!: FilePreviewWorkspace;
  disposers.push(createRoot(dispose => { workspace = createFilePreviewWorkspace({ client: () => ({} as never), rpc: () => ({ fs: { writeFile } } as never), canWrite: () => true }); return dispose; }));
  read.mockImplementation(async () => channel('Original content'));
  return workspace;
}
it('retains separate dirty drafts and deduplicates reopened files without reloading', async () => {
  const workspace = mount();
  await workspace.openPreview(file('a.txt')); const first = workspace.activeController();
  first.beginEditing(); first.updateDraft('Draft A');
  await workspace.openPreview(file('b.txt')); const second = workspace.activeController();
  second.beginEditing(); second.updateDraft('Draft B');
  expect(workspace.entries()).toHaveLength(2);
  expect(first.draftText()).toBe('Draft A'); expect(first.closeConfirmOpen()).toBe(false);
  workspace.select('/workspace/a.txt'); expect(workspace.activeController()).toBe(first);
  await workspace.openPreview(file('a.txt')); expect(workspace.entries()).toHaveLength(2); expect(read).toHaveBeenCalledTimes(2);
  expect(second.draftText()).toBe('Draft B');
});
it('guards closing inactive dirty tabs and closes the last tab as a window', async () => {
  const workspace = mount();
  await workspace.openPreview(file('a.txt')); const first = workspace.activeController();
  first.beginEditing(); first.updateDraft('Draft');
  await workspace.openPreview(file('b.txt'));
  workspace.requestClose('/workspace/a.txt'); expect(workspace.pendingDirty()).toHaveLength(1);
  expect(workspace.activeId()).toBe('/workspace/b.txt');
  workspace.cancelClose(); expect(workspace.entries()).toHaveLength(2); expect(first.dirty()).toBe(true);
  workspace.requestClose('/workspace/a.txt'); workspace.confirmClose();
  expect(workspace.entries()).toHaveLength(1); expect(workspace.open()).toBe(true);
  workspace.requestClose(); expect(workspace.entries()).toHaveLength(0); expect(workspace.open()).toBe(false);
});
it('confirms all dirty documents atomically and retains content until window retirement', async () => {
  const workspace = mount();
  await workspace.openPreview(file('a.txt')); const a = workspace.active()!; const releaseA = workspace.retainEntry(a);
  a.controller.beginEditing(); a.controller.updateDraft('A');
  await workspace.openPreview(file('b.txt')); const b = workspace.active()!; const releaseB = workspace.retainEntry(b);
  b.controller.beginEditing(); b.controller.updateDraft('B');
  workspace.requestClose(); expect(workspace.pendingDirty()).toHaveLength(2); expect(workspace.open()).toBe(true);
  workspace.cancelClose(); expect(a.controller.dirty()).toBe(true); expect(b.controller.dirty()).toBe(true);
  workspace.requestClose(); workspace.confirmClose(); expect(workspace.open()).toBe(false);
  expect(workspace.entries()).toHaveLength(2); expect(a.controller.draftText()).toBe('A');
  releaseA(); releaseB(); expect(workspace.entries()).toHaveLength(0);
});
it('selects the adjacent tab when closing the active document', async () => {
  const workspace = mount();
  for (const name of ['a.txt', 'b.txt', 'c.txt']) await workspace.openPreview(file(name));
  workspace.select('/workspace/b.txt'); workspace.requestClose('/workspace/b.txt');
  expect(workspace.activeId()).toBe('/workspace/c.txt');
  workspace.requestClose('/workspace/c.txt'); expect(workspace.activeId()).toBe('/workspace/a.txt');
});
it('fences late loads after closure and safely reopens during retirement', async () => {
  const workspace = mount(); let resolve!: (value: ReturnType<typeof channel>) => void;
  read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = workspace.openPreview(file('a.txt')); const old = workspace.active()!; const release = workspace.retainEntry(old);
  workspace.requestClose(); expect(workspace.open()).toBe(false);
  await workspace.openPreview(file('b.txt')); const current = workspace.active()!;
  release(); resolve(channel('Obsolete result')); await pending;
  expect(workspace.entries()).toEqual([current]); expect(workspace.activeId()).toBe('/workspace/b.txt'); expect(workspace.open()).toBe(true);
  expect(current.controller.text()).toBe('Original content');
});

it('keeps pending writes alive and prevents discard until saving settles', async () => {
  let finish!: () => void;
  const writeFile = vi.fn(() => new Promise<object>(resolve => { finish = () => resolve({}); }));
  const workspace = mount(writeFile);
  await workspace.openPreview(file('a.txt'));
  const a = workspace.activeController(); a.beginEditing(); a.updateDraft('Saved A');
  const saving = a.saveCurrent();
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
  await workspace.openPreview(file('b.txt'));
  workspace.requestClose('/workspace/a.txt');
  expect(workspace.pendingSaving()).toBe(true);
  workspace.confirmClose(); expect(workspace.entries()).toHaveLength(2); expect(a.open()).toBe(true);
  finish(); expect(await saving).toBe(true);
  expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/a.txt', content: 'Saved A' }));
  workspace.confirmClose(); expect(workspace.entries()).toHaveLength(1);
  expect(workspace.activeId()).toBe('/workspace/b.txt');
});
it('isolates failed reads and recovers only the retried document', async () => {
  const workspace = mount();
  await workspace.openPreview(file('good.txt')); const good = workspace.activeController();
  read.mockRejectedValueOnce(new Error('Temporary read failure'));
  await workspace.openPreview(file('failed.txt')); const failed = workspace.activeController();
  expect(failed.error()).toBe('Temporary read failure'); expect(good.text()).toBe('Original content');
  workspace.select('/workspace/good.txt'); expect(workspace.activeController()).toBe(good);
  await failed.retry(); expect(failed.error()).toBeNull(); expect(failed.text()).toBe('Original content');
  expect(good.text()).toBe('Original content'); expect(workspace.activeId()).toBe('/workspace/good.txt');
});
