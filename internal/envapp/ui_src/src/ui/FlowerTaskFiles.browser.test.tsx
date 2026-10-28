import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { it, expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FlowerTaskMaterials } from '../../../../flower_ui/src/FlowerTaskMaterials';
import { messageAttachmentPath } from '../../../../flower_ui/host/messageAttachmentPath';
import { FlowerTaskFiles } from '../../../../flower_ui/src/FlowerTaskFiles';
import { taskFilesEnUS } from '../../../../flower_ui/src/taskFilesCopy';
import type {
  FlowerTaskFiles as TaskFiles,
  FlowerRuntimeCurrentView,
  FlowerSurfaceAdapter,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, thread, renderSurfaceWithAdapter, waitFor } from './FlowerSurface.navigation.testHarness';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import '../index.css';
import './flower-feature.css';

const fixture = (path = '/project/report.html'): TaskFiles => ({
  files: [
    {
      file_path: path,
      name: 'report.html',
      title: 'Quarterly report',
      mime: 'text/html',
      size: 1024,
      sha256: 'a'.repeat(64),
      endpoint_id: 'runtime-one',
      thread_id: 'one',
      turn_id: 'turn',
      run_id: 'run',
      status: 'available',
    },
  ],
  working: [{ path: '/state/task-files/one/scratch/helper.py', name: 'scratch/helper.py', size: 120 }],
  working_path: '/state/task-files/one',
  working_files: 1,
  working_bytes: 120,
  working_truncated: false,
  can_clean: true,
  state_in_workspace: false,
});

it('opens delivered files with the shared desktop preview capability', async () => {
  await page.viewport(1280, 900);
  const loadFile = vi.fn(async () => new Blob(['Delivered report'], { type: 'text/plain' }));
  const surface = renderSurfaceWithAdapter({ ...adapter(), loadTaskFiles: async () => fixture('/project/report.txt'),
    loadMessageFile: loadFile, listWorkingDirectoryEntries: async () => [],
  });
  await waitFor(() => Boolean([...surface.querySelectorAll('button')].find(button => button.textContent?.includes('Deploy plan'))));
  [...surface.querySelectorAll('button')].find(button => button.textContent?.includes('Deploy plan'))!.click();
  await waitFor(() => Boolean(surface.querySelector('button[aria-label="Files"]:not(:disabled)')));
  surface.querySelector<HTMLButtonElement>('button[aria-label="Files"]')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-task-file-card')));
  const preview = [...document.querySelectorAll<HTMLButtonElement>('.flower-task-file-actions button')].find(button => button.textContent?.trim() === 'Preview');
  expect(preview).toBeTruthy();
  preview!.click();
  await waitFor(() => document.querySelector('.flower-attachment-preview-text')?.textContent === 'Delivered report');
  expect(loadFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/project/report.txt' }));
});

it('keeps deliverables usable and confirms only disposable cleanup at desktop and mobile widths', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const clean = vi.fn(async () => {}),
    download = vi.fn(async () => {}),
    preview = vi.fn(async () => {}),
    folder = vi.fn(async () => {});
  const a = {
    ...adapter(),
    loadTaskFiles: vi.fn(async () => fixture()),
    loadTaskMaterials: async () => ({items: [{id:'source',locator:'attachment://v1/upl_one/source.csv',name:'source.csv',mime:'text/plain',size:16,kind:'input',url:'/_redeven_proxy/api/ai/uploads/upl_one?thread_id=one&turn_id=turn',item_id:'user:one',turn_id:'turn',created_at:'2026-10-28T12:00:00Z'}]}),
    loadMessageAttachment: async () => new Blob(['input'],{type:'text/plain'}),
    cleanTaskFiles: clean,
    downloadTaskFile: download,
    openLinkedFilePreview: preview,
    openLinkedDirectoryBrowser: folder,
  } as FlowerSurfaceAdapter;
  const dispose = render(
    () => <FlowerTaskFiles open threadID="one" adapter={a} copy={taskFilesEnUS} onOpenChange={() => {}} />,
    host,
  );
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('.flower-task-files-dialog button')].find(
      (b) => b.textContent?.trim() === text,
    )!;
  try {
    await waitFor(() => Boolean(document.querySelector('.flower-task-file-card')));
    button('Preview').click();
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ path: '/project/report.html', thread_id: 'one' }));
    button('Open folder').click();
    expect(folder).toHaveBeenCalledWith(expect.objectContaining({ path: '/project' }));
    button('Download').click();
    await waitFor(() => download.mock.calls.length === 1);
    expect(download).toHaveBeenCalledWith('one', '/project/report.html', false, expect.any(AbortSignal));
    document.querySelector<HTMLDetailsElement>('.flower-task-working')!.open = true;
    for (const width of [1280, 390]) {
      await page.viewport(width, 900);
      const dialog = document.querySelector<HTMLElement>('.flower-task-files-dialog')!;
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
      await page.screenshot({ element: dialog, path: '__screenshots__/flower-task-files-' + width + '.png' });
    }
    button('Clean working files').click();
    expect(clean).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Delivered files stay in their saved locations',
    );
    button('Cancel').click();
    expect(clean).not.toHaveBeenCalled();
    button('Clean working files').click();
    button('Clean working files').click();
    await waitFor(() => clean.mock.calls.length === 1);
  } finally {
    dispose();
    host.remove();
  }
});

it('ignores stale thread responses and disables missing files and active cleanup', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  let resolveOld!: (value: TaskFiles) => void;
  const [id, setID] = createSignal('old');
  const load = vi.fn((thread: string) =>
    thread === 'old'
      ? new Promise<TaskFiles>((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve({
          ...fixture('/new/result.html'),
          can_clean: false,
          files: [{ ...fixture().files[0], status: 'missing' as const, title: 'New result' }],
        }),
  );
  const a = {
    ...adapter(),
    loadTaskFiles: load,
    cleanTaskFiles: vi.fn(),
    downloadTaskFile: vi.fn(),
    openLinkedFilePreview: vi.fn(),
  } as FlowerSurfaceAdapter;
  const dispose = render(
    () => <FlowerTaskFiles open threadID={id()} adapter={a} copy={taskFilesEnUS} onOpenChange={() => {}} />,
    host,
  );
  try {
    await waitFor(() => load.mock.calls.length === 1);
    setID('new');
    await waitFor(() => document.body.textContent?.includes('New result') === true);
    resolveOld(fixture());
    await Promise.resolve();
    expect(document.querySelector('.flower-task-file-card')?.textContent).toContain('New result');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.flower-task-files-dialog button')];
    for (const text of ['Preview', 'Download', 'Clean working files'])
      expect(buttons.find((b) => b.textContent?.trim() === text)?.disabled).toBe(true);
  } finally {
    dispose();
    host.remove();
  }
});


it('validates exact same-origin canonical media preview paths', () => {
  const path = '/_redeven_proxy/api/ai/threads/thread-1/tool-media/locator/' + 'a'.repeat(64);
  expect(messageAttachmentPath(path)).toBe(path);
  for (const value of ['https://other.test' + path, path + '?owner=x', path + '#fragment', path.replace('thread-1', '../other'), path + '/bytes'])
    expect(() => messageAttachmentPath(value)).toThrow();
});

it('pages materials, folds images, previews originals and opens their source', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const item = { id: 'input-one', locator: 'attachment://v1/upl_one/source.csv', name: 'source.csv', mime: 'text/plain', size: 16, kind: 'input' as const,
    url: '/_redeven_proxy/api/ai/uploads/upl_one?thread_id=one&turn_id=turn', item_id: 'user:one', turn_id: 'turn', created_at: '2026-10-28T12:00:00Z' };
  const image = { ...item, id: 'image-one', name: 'Screenshot.png', kind: 'media' as const, mime: 'image/png' };
  const load = vi.fn(async (_thread: string, cursor?: string) => cursor ? { items: [item, image] } : { items: [], next_cursor: 'older' });
  const bytes = vi.fn(async () => new Blob(['amount\n4\n8\n15'], { type: 'text/plain' }));
  const source = vi.fn();
  const a = { ...adapter(), loadTaskMaterials: load, loadMessageAttachment: bytes };
  const dispose = render(() => <FlowerTaskMaterials threadID="one" refresh={0} adapter={a} copy={taskFilesEnUS} onSource={source} />, host);
  try {
    await waitFor(() => host.textContent?.includes(taskFilesEnUS.materialsEarlier) === true);
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === taskFilesEnUS.more)!.click();
    await waitFor(() => host.querySelectorAll('.flower-task-material-card').length === 2);
    expect(load).toHaveBeenLastCalledWith('one', 'older');
    expect(host.querySelector<HTMLDetailsElement>('details')!.open).toBe(false);
    const first = host.querySelector('.flower-task-material-card')!;
    [...first.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === taskFilesEnUS.preview)!.click();
    await waitFor(() => document.querySelector('.flower-attachment-preview-text')?.textContent === 'amount\n4\n8\n15');
    expect(bytes).toHaveBeenCalledWith(expect.objectContaining({ url: item.url }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      [...first.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === taskFilesEnUS.download)!.click();
      await waitFor(() => click.mock.calls.length === 1);
      const downloaded = click.mock.instances[0] as HTMLAnchorElement;
      expect(downloaded.download).toBe('source.csv');
      expect(downloaded.href).toMatch(/^blob:/u);
    } finally { click.mockRestore(); }
    [...first.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === taskFilesEnUS.source)!.click();
    expect(source).toHaveBeenCalledWith('user:one');
  } finally { dispose(); host.remove(); }
});

it('drops late material pages after switching conversations', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [id, setID] = createSignal('old');
  let resolveOld!: (page: { items: [] }) => void;
  const load = vi.fn((thread: string) => thread === 'old' ? new Promise<{items: []}>(resolve => { resolveOld = resolve; }) : Promise.resolve({ items: [] }));
  const dispose = render(() => <FlowerTaskMaterials threadID={id()} refresh={0} adapter={{...adapter(), loadTaskMaterials:load}} copy={taskFilesEnUS} />, host);
  try {
    await waitFor(() => load.mock.calls.length === 1); setID('new');
    await waitFor(() => host.textContent?.includes(taskFilesEnUS.materialsEmpty) === true);
    resolveOld({items: []}); await Promise.resolve();
    expect(host.textContent).toContain(taskFilesEnUS.materialsEmpty);
    expect(load).toHaveBeenLastCalledWith('new', undefined);
  } finally { dispose(); host.remove(); }
});


it('opens an image source in its historical turn even when tool steps were folded', async () => {
  await page.viewport(1280, 900);
  const seed = thread({ thread_id: 'source-thread', title: 'Source materials', messages: [] });
  const history = vi.fn(async (id: string) => {
    const current: FlowerRuntimeCurrentView = { thread_id:id, turn_id:'source-turn',run_id:'source-run',view_version:1,activity:'idle',last_outcome:'completed',queue:[],interactions:[],
      turns:[{turn_id:'source-turn',run_id:'source-run',started_at:'2026-10-28T12:00:00Z',ended_at:'2026-10-28T12:01:00Z',outcome:'completed',elapsed_ms:60000,waiting_ms:0,work_duration_ms:60000,final_item_ids:['final'],final_boundary_complete:true}],
      items:[{id:'source-user',kind:'user',text:'Review screenshot',turn_id:'source-turn',run_id:'source-run',ordinal:1},
        {id:'source-image',kind:'tool',turn_id:'source-turn',run_id:'source-run',ordinal:2,
          activity:{item_id:'source-image',tool_id:'image-call',tool_name:'image.read',kind:'tool',status:'success',severity:'quiet',needs_attention:false,requires_approval:false}},
        {id:'final',kind:'assistant',text:'Image reviewed',turn_id:'source-turn',run_id:'source-run',ordinal:3}],
      window:{first_item_id:'source-user',last_item_id:'final',has_before:false,has_after:false}};
    return {current,thread:applyFlowerRuntimeCurrentView(seed,current)};
  });
  const surface = renderSurfaceWithAdapter({...adapter(),listThreads:async()=>[seed],loadHistory:history,loadTaskFiles:async()=>fixture(),
    loadTaskMaterials:async()=>({items:[{id:'snapshot',locator:'media:v1:'+ 'a'.repeat(64),name:'Screenshot.png',mime:'image/png',size:100,kind:'media',url:'',item_id:'source-image',turn_id:'source-turn',created_at:'2026-10-28T12:00:10Z'}]})});
  await waitFor(()=>Boolean(surface.querySelector('[data-thread-id="source-thread"] button')));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="source-thread"] button')!.click();
  await waitFor(()=>Boolean(surface.querySelector('button[aria-label="Files"]:not(:disabled)')));
  surface.querySelector<HTMLButtonElement>('button[aria-label="Files"]')!.click();
  await waitFor(()=>Boolean(document.querySelector('.flower-task-media')));
  document.querySelector<HTMLDetailsElement>('.flower-task-media')!.open=true;
  [...document.querySelectorAll<HTMLButtonElement>('.flower-task-material-card button')].find(b=>b.textContent===taskFilesEnUS.source)!.click();
  await waitFor(()=>Boolean(surface.querySelector('[data-flower-message-id="source-image"]')));
  expect(history).toHaveBeenCalledWith('source-thread',expect.objectContaining({anchor_id:'source-image',direction:'around',limit:50}),expect.any(AbortSignal));
  const target=surface.querySelector<HTMLElement>('[data-flower-message-id="source-image"]')!;
  expect(target.getBoundingClientRect().height).toBeGreaterThan(0);
});
