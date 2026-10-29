import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerTaskFiles } from '../../../../flower_ui/src/FlowerTaskFiles';
import { taskFilesEnUS } from '../../../../flower_ui/src/taskFilesCopy';
import type { FlowerTaskMaterial } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createEnvLocalFlowerSurfaceAdapter } from './flower/envLocalFlowerSurfaceAdapter';
import { createDownloadManager } from './downloads/createDownloadManager';
import { createRuntimeDownloadSource } from './downloads/runtimeDownloadSource';
import { DownloadTaskPanel } from './downloads/DownloadTaskPanel';
import { waitFor } from './FlowerSurface.navigation.testHarness';
import '../index.css';
import './flower-feature.css';

const imageBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRFkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
const item = (kind: 'input' | 'media'): FlowerTaskMaterial => ({ id: kind, kind, name: kind === 'input' ? 'source.txt' : 'screenshot.png',
  mime: kind === 'input' ? 'text/plain' : 'image/png', size: kind === 'input' ? 6 : imageBytes.length,
  url: kind === 'input' ? '/_redeven_proxy/api/ai/uploads/upl_one?thread_id=one&turn_id=turn' : '/_redeven_proxy/api/ai/threads/one/tool-media/locator/' + 'a'.repeat(64),
  locator: 'attachment://v1/upl_one/source.txt', item_id: 'user:one', turn_id: 'turn', created_at: '2026-10-29T00:00:00Z' });

async function setup() {
  await page.viewport(1280, 900);
  const rows = { files: [{ file_path: '/project/report.txt', name: 'report.txt', title: '', mime: 'text/plain', size: 6,
    sha256: 'a'.repeat(64), endpoint_id: 'runtime-one', thread_id: 'one', turn_id: 'turn', run_id: 'run', status: 'available' }],
    working: [{ path: '/state/scratch/helper.py', name: 'helper.py', size: 6 }], working_files: 1, working_bytes: 6,
    working_path: '/state', working_truncated: false, can_clean: true, state_in_workspace: false };
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input), location.origin);
    if (url.pathname.endsWith('/task-files')) return Response.json(rows);
    if (url.pathname.endsWith('/task-materials')) return Response.json({ items: [item('input'), item('media')] });
    if (url.pathname.endsWith('/task-file-content')) return Response.json({ bytes: btoa('report'), size: 6, next_offset: 6, version: 'v1' });
    if (url.pathname.includes('/uploads/')) return new Response('source', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname.includes('/tool-media/')) return new Response(imageBytes, { headers: { 'content-type': 'image/png' } });
    throw new Error('Unexpected source: ' + url.pathname);
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const destination = { label: 'Downloads', canReveal: true, canOpen: true, actions: { reveal: vi.fn(async () => {}), open: vi.fn(async () => {}) } };
  const write = vi.fn(async () => { await gate; }), complete = vi.fn(async () => destination), abort = vi.fn(async () => {});
  const manager = createDownloadManager({ source: createRuntimeDownloadSource(() => undefined),
    sink: { kind: 'desktop_file_system', prepare: async () => ({ destination, write, complete, abort }) } });
  const adapter = createEnvLocalFlowerSurfaceAdapter({ envPublicID: 'env', envLabel: 'Environment', rpc: {} as never, downloadManager: manager });
  const host = document.createElement('div'); document.body.append(host);
  const [open, setOpen] = createSignal(true), [panel, setPanel] = createSignal(false);
  const dispose = render(() => <><button onClick={() => setOpen(true)}>Conversation files</button>
    <button onClick={() => setPanel(value => !value)}>Downloads</button>
    <Show when={panel()}><DownloadTaskPanel manager={manager} inline /></Show>
    <FlowerTaskFiles open={open()} onOpenChange={setOpen} threadID="one" adapter={adapter} copy={taskFilesEnUS} />
  </>, host);
  onTestFinished(() => { release(); for (const task of manager.tasks()) manager.cancel(task.id); dispose(); host.remove(); fetch.mockRestore(); });
  await waitFor(() => document.querySelectorAll('.flower-task-file-row').length === 2);
  return { manager, write, complete, abort, release, destination };
}

for (const entry of [
  { kind: 'delivered', preview: false, name: 'report.txt' },
  { kind: 'temporary', preview: true, name: 'helper.py' },
  { kind: 'input', preview: false, name: 'source.txt' },
  { kind: 'media', preview: true, name: 'screenshot.png' },
]) it('retains ' + entry.kind + ' downloads in the toolbar after closing ' + (entry.preview ? 'the preview' : 'the dialog'), async () => {
  const state = await setup();
  if (entry.kind === 'temporary' || entry.kind === 'media') await userEvent.click(page.getByRole('button', { name: taskFilesEnUS.process, exact: true }));
  if (entry.kind === 'temporary') await userEvent.click(page.getByRole('button', { name: taskFilesEnUS.working, exact: true }));
  const row = page.getByRole('article').filter({ hasText: entry.name });
  if (entry.preview) {
    await userEvent.click(row.getByRole('button', { name: new RegExp('^Preview') }));
    await waitFor(() => Boolean(document.querySelector('.flower-task-file-preview-dialog')));
    await userEvent.click(page.getByRole('button', { name: 'Download', exact: true }).last());
  } else await userEvent.click(row.getByRole('button', { name: 'Download', exact: true }));
  await waitFor(() => state.write.mock.calls.length === 1);
  expect(state.manager.tasks()).toHaveLength(1);
  expect(state.manager.tasks()[0].command.source.name).toBe(entry.name);
  if (entry.preview) await userEvent.keyboard('{Escape}');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => !document.querySelector('.flower-task-files-dialog'));
  await userEvent.click(page.getByRole('button', { name: 'Downloads', exact: true }));
  expect(page.getByRole('region', { name: 'Downloads' }).element().textContent).toContain(entry.name);
  expect(state.manager.activeCount()).toBe(1);
  expect(state.abort).not.toHaveBeenCalled();
  if (entry.kind === 'temporary') {
    await userEvent.click(page.getByRole('button', { name: 'Conversation files', exact: true }));
    await userEvent.click(page.getByRole('button', { name: taskFilesEnUS.process, exact: true }));
    await userEvent.click(page.getByRole('button', { name: taskFilesEnUS.working, exact: true }));
    expect(page.getByRole('button', { name: taskFilesEnUS.clean, exact: true }).element()).toHaveProperty('disabled', true);
    await userEvent.keyboard('{Escape}');
  }
  state.release();
  await waitFor(() => state.manager.tasks()[0]?.status === 'completed');
  const panel = page.getByRole('region', { name: 'Downloads' });
  expect(panel.element().textContent).toContain('Completed');
  expect(panel.element().textContent).toContain(entry.name);
  await userEvent.click(panel.getByRole('button', { name: 'Reveal', exact: true }));
  await userEvent.click(panel.getByRole('button', { name: 'Open', exact: true }));
  expect(state.destination.actions.reveal).toHaveBeenCalledOnce();
  expect(state.destination.actions.open).toHaveBeenCalledOnce();
  expect(state.complete).toHaveBeenCalledOnce();
  if (entry.kind === 'delivered') {
    await page.screenshot({ path: './__screenshots__/flower-managed-downloads-completed.png' });
  }
});
