import { createSignal } from 'solid-js';
import { DialogPlacementProvider } from '@floegence/floe-webapp-core/ui';
import { render } from 'solid-js/web';
import { it, expect, vi, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { messageAttachmentPath } from '../../../../flower_ui/host/messageAttachmentPath';
import { FlowerTaskFiles } from '../../../../flower_ui/src/FlowerTaskFiles';
import { FlowerTaskFilePreviewContent } from './flower/FlowerTaskFilePreviewContent';
import { taskFilesEnUS } from '../../../../flower_ui/src/taskFilesCopy';
import zhCN from './i18n/locales/catalogs/zh-CN.json';
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
  await waitFor(() => Boolean(surface.querySelector('button[aria-label="Conversation files"]:not(:disabled)')));
  surface.querySelector<HTMLButtonElement>('button[aria-label="Conversation files"]')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-task-file-row')));
  const preview = document.querySelector<HTMLButtonElement>('.flower-task-file-preview');
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
    preview = vi.fn(async () => new Blob(['Report'], { type: 'text/plain' })),
    folder = vi.fn(async () => {});
  const a = {
    ...adapter(),
    loadTaskFiles: vi.fn(async () => fixture()),
    loadTaskMaterials: async () => ({items: [{id:'source',locator:'attachment://v1/upl_one/source.csv',name:'source.csv',mime:'text/plain',size:16,kind:'input',url:'/_redeven_proxy/api/ai/uploads/upl_one?thread_id=one&turn_id=turn',item_id:'user:one',turn_id:'turn',created_at:'2026-10-28T12:00:00Z'}]}),
    loadMessageAttachment: async () => new Blob(['input'],{type:'text/plain'}),
    cleanTaskFiles: clean,
    downloadTaskFile: download,
    loadTaskFile: preview,
    openLinkedDirectoryBrowser: folder,
  } as FlowerSurfaceAdapter;
  const dispose = render(
    () => <FlowerTaskFiles open threadID="one" adapter={a} copy={taskFilesEnUS} onOpenChange={() => {}} />,
    host,
  );
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('.flower-task-files-dialog button')].find(
      (b) => b.getAttribute('aria-label') === text || b.getAttribute('aria-label')?.startsWith(text + ': ') || b.textContent?.trim() === text,
    )!;
  try {
    await waitFor(() => Boolean(document.querySelector('.flower-task-file-row')));
    button('Preview').focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => preview.mock.calls.length === 1);
    expect(preview).toHaveBeenCalledWith('one', '/project/report.html', false, expect.any(AbortSignal));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => !document.querySelector('.flower-task-file-preview-dialog'));
    button('Open folder').click();
    expect(folder).toHaveBeenCalledWith(expect.objectContaining({ path: '/project' }));
    button('Download').click();
    await waitFor(() => download.mock.calls.length === 1);
    expect(download).toHaveBeenCalledWith('one', '/project/report.html', false);
    button(taskFilesEnUS.process).click();
    button(taskFilesEnUS.working).click();
    const working = document.querySelector<HTMLElement>('.flower-task-working')!;
    expect(working.textContent).not.toContain(fixture().working_path);
    expect([...working.querySelectorAll('[title]')].some(el => el.getAttribute('title')?.includes(fixture().working_path))).toBe(false);
    [...working.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === 'Download')!.click();
    await waitFor(() => download.mock.calls.length === 2);
    expect(download).toHaveBeenLastCalledWith('one', '/state/task-files/one/scratch/helper.py', true);
    for (const width of [1280, 390]) {
      await page.viewport(width, 900);
      const dialog = document.querySelector<HTMLElement>('.flower-task-files-dialog')!;
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
      await page.screenshot({ element: dialog, path: '__screenshots__/flower-task-files-' + width + '.png' });
    }
    button(taskFilesEnUS.clean).click();
    expect(clean).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Delivered files stay in their saved locations',
    );
    button('Cancel').click();
    expect(clean).not.toHaveBeenCalled();
    button(taskFilesEnUS.clean).click();
    button(taskFilesEnUS.clean).click();
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
    loadTaskFile: vi.fn(),
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
    expect(document.querySelector('.flower-task-file-row')?.textContent).toContain('New result');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.flower-task-files-dialog button')];
    for (const text of ['Preview', 'Download'])
      expect(buttons.find((b) => b.getAttribute('aria-label') === text || b.getAttribute('aria-label')?.startsWith(text + ': ') || b.textContent?.trim() === text)?.disabled).toBe(true);
    dialogButton(taskFilesEnUS.process).click();
    dialogButton(taskFilesEnUS.working).click();
    expect([...document.querySelectorAll<HTMLButtonElement>('.flower-task-working button')].find(b => b.textContent?.trim() === taskFilesEnUS.clean)?.disabled).toBe(true);
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
  await waitFor(()=>Boolean(surface.querySelector('button[aria-label="Conversation files"]:not(:disabled)')));
  surface.querySelector<HTMLButtonElement>('button[aria-label="Conversation files"]')!.click();
  await waitFor(()=>Boolean(document.querySelector('.flower-task-files-dialog')));
  dialogButton(taskFilesEnUS.process).click();
  await waitFor(()=>Boolean(document.querySelector('.flower-task-material-row')));
  [...document.querySelectorAll<HTMLButtonElement>('.flower-task-material-row button')].find(b=>b.getAttribute('aria-label')===taskFilesEnUS.source)!.click();
  await waitFor(()=>Boolean(surface.querySelector('[data-flower-message-id="source-image"]')));
  expect(history).toHaveBeenCalledWith('source-thread',expect.objectContaining({anchor_id:'source-image',direction:'around',limit:50}),expect.any(AbortSignal));
  const target=surface.querySelector<HTMLElement>('[data-flower-message-id="source-image"]')!;
  expect(target.getBoundingClientRect().height).toBeGreaterThan(0);
});


for (const theme of ['light', 'dark'] as const) {
  it('keeps long localized filenames and actions readable in ' + theme, async () => {
    const host = document.createElement('div');
    document.body.append(host);
    document.documentElement.classList.add(theme);
    const copy = zhCN.flowerSurface.taskFiles;
    const base = fixture();
    const path = '/Volumes/JianDisk/code/floegence/cloudflare-security-insights-2026-10-28.html';
    const dispose = render(() => <FlowerTaskFiles open threadID="one" onOpenChange={() => {}} copy={copy}
      adapter={{ ...adapter(), loadTaskFiles: async () => ({ ...base, files: [
        { ...base.files[0], title: 'Cloudflare 账号安全洞察汇总（可视化报告）', name: 'cloudflare-security-insights-2026-10-28.html', file_path: path, mime: 'text/html; charset=utf-8' },
        { ...base.files[0], title: 'Cloudflare 安全洞察汇总（Markdown）', name: 'cloudflare-security-insights-2026-10-28.md', file_path: path.replace('.html', '.md') },
      ] }), downloadTaskFile: async () => {}, loadTaskFile: async () => new Blob(['report']), openLinkedDirectoryBrowser: async () => {},
      loadTaskMaterials: async () => ({ items: [{ id: 'image', kind: 'media', name: 'Screenshot.png', mime: 'image/png', size: 5120,
        locator: 'media:v1:' + 'a'.repeat(64), url: '', item_id: 'image', turn_id: 'turn', created_at: '2026-10-28T12:00:00Z' }] }),
      }} />, host);
    onTestFinished(() => { dispose(); host.remove(); document.documentElement.classList.remove(theme); });
    await waitFor(() => Boolean(document.querySelector('.flower-task-file-row')));
    const dialog = document.querySelector<HTMLElement>('.flower-task-files-dialog')!;
    for (const width of [1280, 768, 430, 390, 320]) {
      await page.viewport(width, 900);
      await new Promise(resolve => setTimeout(resolve, 300));
      const body = dialog.querySelector<HTMLElement>('.flower-task-files-content')!;
      expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
      const cards = [...dialog.querySelectorAll<HTMLElement>('.flower-task-file-row')];
      const title = cards[0].querySelector<HTMLElement>('.flower-task-file-name')!;
      expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth + 1);
      const identityBounds = cards[0].querySelector('.flower-task-file-identity')!.getBoundingClientRect();
      const actionsBounds = cards[0].querySelector('.flower-task-file-actions')!.getBoundingClientRect();
      expect(actionsBounds.left).toBeGreaterThanOrEqual(identityBounds.right);
      expect(actionsBounds.top).toBeLessThan(identityBounds.bottom);
      expect(dialog.textContent).not.toContain('runtime-one');
      expect(dialog.textContent).not.toContain(path);
      expect(dialog.querySelector('.flower-task-file-path')).toBeNull();
      expect([...dialog.querySelectorAll('[title], [aria-label]')].some(element =>
        element.getAttribute('title')?.includes(path) || element.getAttribute('aria-label')?.includes(path))).toBe(false);
      expect(cards[0].querySelector('.flower-task-file-meta')?.textContent).not.toContain('charset');
      expect(cards[0].querySelector('.flower-task-file-icon svg')).not.toBeNull();
      expect(cards[0].querySelector('[data-status="available"]')).toBeNull();
      expect(dialog.querySelector('.flower-task-files-toolbar')).not.toBeNull();
      expect(dialog.querySelectorAll('button[aria-label="关闭"]').length).toBe(1);
      expect(getComputedStyle(cards[0]).borderTopWidth).toBe('0px');
      expect(getComputedStyle(cards[0]).borderRadius).toBe('0px');
      const preview = cards[0].querySelector<HTMLButtonElement>('.flower-task-file-preview')!;
      expect(preview.getAttribute('aria-label')).toBe('预览: Cloudflare 账号安全洞察汇总（可视化报告）');
      preview.focus();
      expect(document.activeElement).toBe(preview);
      expect(getComputedStyle(preview).outlineStyle).not.toBe('none');
      preview.blur();
      for (const button of cards.flatMap(card => [...card.querySelectorAll('button')])) {
        expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
        const bounds = button.getBoundingClientRect(), card = button.closest('article')!.getBoundingClientRect();
        expect(bounds.right).toBeLessThanOrEqual(card.right);
      }
      expect(dialog.querySelector('details')).toBeNull();
      await page.screenshot({ element: dialog, path: '__screenshots__/files-clean-' + theme + '-' + width + '.png' });
    }
  });
}

it('keeps execution images in process files without count headings or manual paging', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const load = vi.fn(async (_id: string, cursor?: string) => cursor ? { items: [{ id: 'screenshot', locator: 'media:v1:' + 'a'.repeat(64), name: 'Workflow.png', kind: 'media' as const, mime: 'image/png', size: 512,
    url: '', item_id: 'tool:one', turn_id: 'turn', created_at: '2026-10-29T12:00:00Z' }] } : { items: [], next_cursor: 'older' });
  const dispose = render(() => <FlowerTaskFiles open threadID="one" onOpenChange={() => {}} copy={taskFilesEnUS}
    adapter={{ ...adapter(), loadTaskFiles: async () => ({ ...fixture(), files: [], working: [], working_files: 0, working_bytes: 0 }), loadTaskMaterials: load }} />, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => load.mock.calls.length === 2);
  expect(fileDialog().textContent).not.toContain('Workflow.png');
  dialogButton(taskFilesEnUS.process).click();
  await waitFor(() => Boolean(document.querySelector('.flower-task-file-row')));
  const dialog = fileDialog();
  expect(dialog.textContent).toContain('Workflow.png');
  expect(dialog.querySelector('details')).toBeNull();
  expect(dialog.querySelector('.flower-task-count')).toBeNull();
  expect(dialog.querySelector('.flower-task-load-more')).toBeNull();
  expect(dialog.querySelector('.flower-task-working')).toBeNull();
});

const material = (id = 'source', kind: 'input' | 'media' = 'input') => ({ id, locator: 'attachment://v1/upl_one/' + id, name: id + '.txt', mime: 'text/plain', size: 16, kind,
  url: '/_redeven_proxy/api/ai/uploads/upl_one?thread_id=one&turn_id=turn', item_id: 'user:' + id, turn_id: 'turn', created_at: '2026-10-28T12:00:00Z' });
const emptyFiles = (): TaskFiles => ({ ...fixture(), files: [], working: [], working_files: 0, working_bytes: 0 });
const fileDialog = () => document.querySelector<HTMLElement>('.flower-task-files-dialog')!;
const dialogButton = (label: string) => [...fileDialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
function renderFiles(overrides: Partial<FlowerSurfaceAdapter>) {
  const host = document.createElement('div'); document.body.append(host);
  const source = vi.fn();
  const dispose = render(() => <FlowerTaskFiles open threadID="one" adapter={{ ...adapter(), loadTaskFiles: async () => emptyFiles(), ...overrides }}
    copy={taskFilesEnUS} onOpenChange={() => {}} onSource={source} />, host);
  onTestFinished(() => { dispose(); host.remove(); });
  return { host, source };
}

it('restores all files when refresh removes the selected source category', async () => {
  const files = vi.fn(async () => fixture());
  renderFiles({ loadTaskFiles: files, loadTaskMaterials: async () => ({ items: [material()] }) });
  await waitFor(() => fileDialog()?.querySelectorAll('.flower-task-file-row').length === 2);
  dialogButton(taskFilesEnUS.results).click();
  expect(fileDialog().querySelectorAll('.flower-task-file-row')).toHaveLength(1);
  files.mockResolvedValue(emptyFiles()); dialogButton(taskFilesEnUS.refresh).click();
  await waitFor(() => fileDialog().textContent?.includes('source.txt') === true);
  expect(fileDialog().querySelector('.flower-task-file-filters')).toBeNull();
});

it('pauses process paging in temporary files and restores the process viewport', async () => {
  await page.viewport(1280, 900);
  let finish!: (page: { items: ReturnType<typeof material>[]; next_cursor: string }) => void;
  const load = vi.fn((_thread: string, cursor?: string) => cursor === 'last' ? Promise.resolve({ items: [material('needle', 'media')] })
    : cursor === 'older' ? new Promise<{ items: ReturnType<typeof material>[]; next_cursor: string }>(resolve => { finish = resolve; })
    : Promise.resolve({ items: Array.from({ length: 24 }, (_, i) => material('page-' + i, 'media')), next_cursor: 'older' }));
  renderFiles({ loadTaskFiles: async () => fixture(), loadTaskMaterials: load });
  await waitFor(() => Boolean(fileDialog()));
  dialogButton(taskFilesEnUS.process).click();
  await waitFor(() => fileDialog()?.querySelectorAll('.flower-task-material-row').length === 24);
  const viewport = fileDialog().querySelector<HTMLElement>('.flower-task-files-viewport')!;
  viewport.scrollTop = 200;
  dialogButton(taskFilesEnUS.working).click();
  expect(viewport.scrollTop).toBe(0);
  dialogButton(taskFilesEnUS.process).click();
  await waitFor(() => viewport.scrollTop === 200);
  const input = fileDialog().querySelector<HTMLInputElement>('input')!;
  input.value = 'needle'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await waitFor(() => load.mock.calls.length === 2);
  dialogButton(taskFilesEnUS.working).click();
  finish({ items: [], next_cursor: 'last' });
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(load).toHaveBeenCalledTimes(2);
  dialogButton(taskFilesEnUS.process).click();
  await waitFor(() => fileDialog().textContent?.includes('needle.txt') === true);
  expect(load).toHaveBeenCalledTimes(3);
});

it('keeps a successful source visible when the other fails, then pages delivered files after retry', async () => {
  const first = fixture().files[0];
  const files = vi.fn(async (_thread: string, cursor?: string): Promise<TaskFiles> => cursor
    ? { ...emptyFiles(), files: [first, { ...first, file_path: '/project/older.txt', name: 'older.txt', title: 'Older result' }] }
    : { ...fixture(), next_cursor: 'older-files' });
  files.mockRejectedValueOnce(new Error('Unavailable'));
  renderFiles({ loadTaskFiles: files, loadTaskMaterials: async () => ({ items: [material()] }) });
  await waitFor(() => Boolean(fileDialog()?.querySelector('.flower-task-files-notice[role="alert"]')));
  expect(fileDialog().textContent).toContain('source.txt');
  expect(fileDialog().textContent).not.toContain(taskFilesEnUS.emptyHint);
  dialogButton(taskFilesEnUS.retry).click();
  await waitFor(() => fileDialog().querySelectorAll('.flower-task-file-row').length === 3);
  expect(files).toHaveBeenLastCalledWith('one', 'older-files', expect.any(AbortSignal));
  expect(fileDialog().textContent).toContain('Older result');
  expect(fileDialog().querySelector('.flower-task-files-notice[role="alert"]')).toBeNull();
});

it('automatically passes empty pages, deduplicates identities, previews originals and opens their source', async () => {
  const item = material(), image = { ...material('image', 'media'), mime: 'image/png' };
  const load = vi.fn(async (_thread: string, cursor?: string) => cursor === 'last' ? { items: [item, image] }
    : cursor === 'older' ? { items: [item], next_cursor: 'last' } : { items: [], next_cursor: 'older' });
  const bytes = vi.fn(async () => new Blob(['amount\n4\n8\n15'], { type: 'text/plain' }));
  const download = vi.fn(async () => {});
  const { source } = renderFiles({ loadTaskMaterials: load, loadMessageAttachment: bytes, downloadTaskMaterial: download });
  await waitFor(() => load.mock.calls.length === 3);
  await waitFor(() => fileDialog()?.querySelectorAll('.flower-task-material-row').length === 1);
  expect(load).toHaveBeenCalledTimes(3);
  expect(fileDialog().querySelector('details')).toBeNull();
  fileDialog().querySelector<HTMLButtonElement>('.flower-task-file-preview')!.click();
  await waitFor(() => document.querySelector('.flower-attachment-preview-text')?.textContent === 'amount\n4\n8\n15');
  expect(bytes).toHaveBeenCalledWith(expect.objectContaining({ url: item.url }));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => !document.querySelector('.flower-task-file-preview-dialog'));
  dialogButton(taskFilesEnUS.download).click();
  await waitFor(() => download.mock.calls.length === 1);
  expect(download).toHaveBeenCalledWith('one', item);
  dialogButton(taskFilesEnUS.source).click(); expect(source).toHaveBeenCalledWith('user:source');
});

it('searches unloaded history, filters sources, and never declares an incomplete search empty', async () => {
  await page.viewport(1280, 900);
  let resolve!: (page: { items: ReturnType<typeof material>[] }) => void;
  const many = Array.from({ length: 24 }, (_, i) => material('input-' + i));
  const load = vi.fn((_thread: string, cursor?: string) => cursor ? new Promise<{items: ReturnType<typeof material>[]}>(done => { resolve = done; })
    : Promise.resolve({ items: many, next_cursor: 'older' }));
  renderFiles({ loadTaskFiles: async () => fixture(), loadTaskMaterials: load });
  await waitFor(() => fileDialog()?.querySelectorAll('.flower-task-material-row').length === 24);
  const search = fileDialog().querySelector<HTMLInputElement>('input[type="search"]')!;
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(load).toHaveBeenCalledTimes(1);
  search.value = 'needle'; search.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await waitFor(() => load.mock.calls.length === 2);
  expect(fileDialog().textContent).not.toContain(taskFilesEnUS.noResults);
  resolve({ items: [material('needle')] });
  await waitFor(() => fileDialog().querySelector('.flower-task-file-row')?.textContent?.includes('needle') === true);
  expect(fileDialog().querySelectorAll('.flower-task-file-row')).toHaveLength(1);
  search.value = ''; search.dispatchEvent(new InputEvent('input', { bubbles: true }));
  dialogButton(taskFilesEnUS.results).click();
  expect(fileDialog().querySelectorAll('.flower-task-file-row')).toHaveLength(1);
  expect(fileDialog().textContent).toContain('Quarterly report');
  dialogButton(taskFilesEnUS.uploads).click();
  expect(fileDialog().querySelectorAll('.flower-task-material-row')).toHaveLength(25);
});

it('appends on scroll without replacing focused rows or moving the viewport', async () => {
  await page.viewport(1280, 900);
  const items = Array.from({ length: 20 }, (_, i) => material('page-' + i));
  let resolve!: (page: { items: ReturnType<typeof material>[] }) => void;
  const load = vi.fn((_thread: string, cursor?: string) => cursor ? new Promise<{items: ReturnType<typeof material>[]}>(done => { resolve = done; })
    : Promise.resolve({ items, next_cursor: 'older' }));
  renderFiles({ loadTaskMaterials: load, loadMessageAttachment: async () => new Blob(['input'], { type: 'text/plain' }) });
  await waitFor(() => fileDialog()?.querySelectorAll('.flower-task-material-row').length === 20);
  const viewport = fileDialog().querySelector<HTMLElement>('.flower-task-files-viewport')!;
  const row = fileDialog().querySelector<HTMLElement>('.flower-task-file-row')!;
  const button = row.querySelector<HTMLButtonElement>('button')!;
  button.focus({ preventScroll: true });
  viewport.scrollTop = viewport.scrollHeight;
  const top = viewport.scrollTop;
  await waitFor(() => load.mock.calls.length === 2);
  expect(fileDialog().querySelector('.flower-task-file-row')).toBe(row);
  expect(viewport.scrollTop).toBe(top); expect(document.activeElement).toBe(button);
  resolve({ items: [material('next')] });
  await waitFor(() => fileDialog().querySelectorAll('.flower-task-material-row').length === 21);
  expect(fileDialog().querySelector('.flower-task-file-row')).toBe(row);
  expect(viewport.scrollTop).toBe(top); expect(document.activeElement).toBe(button);
  dialogButton(taskFilesEnUS.refresh).click();
  await waitFor(() => load.mock.calls.length >= 3);
  expect(fileDialog().querySelector('.flower-task-file-row')).toBe(row);
});

it('cancels material requests and ignores late results across threads, runtimes and close', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [id, setID] = createSignal('old'), [open, setOpen] = createSignal(true);
  const signals: AbortSignal[] = [];
  const pending: ((page: {items: ReturnType<typeof material>[]}) => void)[] = [];
  const load = vi.fn((_thread: string, _cursor?: string, signal?: AbortSignal) => { signals.push(signal!); return new Promise<{items: ReturnType<typeof material>[]}>(resolve => pending.push(resolve)); });
  const [current, setCurrent] = createSignal({ ...adapter(), loadTaskFiles: async () => emptyFiles(), loadTaskMaterials: load });
  const dispose = render(() => <FlowerTaskFiles open={open()} threadID={id()} adapter={current()} copy={taskFilesEnUS} onOpenChange={setOpen} />, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => signals.length === 1); setID('new');
  await waitFor(() => signals.length === 2); expect(signals[0].aborted).toBe(true);
  pending[0]({ items: [material('stale')] }); pending[1]({ items: [material('current')] });
  await waitFor(() => fileDialog()?.textContent?.includes('current.txt') === true);
  expect(fileDialog().textContent).not.toContain('stale.txt');
  setCurrent({ ...current(), runtime: { ...current().runtime!, runtime_id: 'new-runtime' } });
  await waitFor(() => signals.length === 3);
  expect(fileDialog().textContent).not.toContain('current.txt');
  setOpen(false); expect(signals[2].aborted).toBe(true);
  pending[2]({ items: [material('closed')] }); await Promise.resolve();
  expect(document.querySelector('.flower-task-file-row')).toBeNull();
});

it('retains empty state and geometry during refresh but clears it when runtime ownership changes', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const load = vi.fn().mockResolvedValue({ items: [] });
  const [current, setCurrent] = createSignal({ ...adapter(), loadTaskFiles: async () => emptyFiles(), loadTaskMaterials: load });
  const dispose = render(() => <FlowerTaskFiles open threadID="one" adapter={current()} copy={taskFilesEnUS} onOpenChange={() => {}} />, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => fileDialog()?.textContent?.includes(taskFilesEnUS.emptyHint) === true);
  const before = fileDialog().getBoundingClientRect();
  load.mockImplementationOnce(() => new Promise(() => {})); dialogButton(taskFilesEnUS.refresh).click();
  expect(fileDialog().textContent).toContain(taskFilesEnUS.emptyHint);
  expect(fileDialog().querySelector('.flower-loading-rows')).toBeNull();
  expect(fileDialog().getBoundingClientRect().height).toBe(before.height);
  setCurrent({ ...current(), runtime: { ...current().runtime!, runtime_id: 'another-runtime' }, loadTaskMaterials: vi.fn(() => new Promise(() => {})) });
  await waitFor(() => Boolean(fileDialog().querySelector('.flower-loading-rows')));
  expect(fileDialog().textContent).not.toContain(taskFilesEnUS.emptyHint);
});

it('retains successful rows on page failure and stops repeated cursors without retry loops', async () => {
  const load = vi.fn(async () => ({ items: [material()], next_cursor: 'repeated' }));
  renderFiles({ loadTaskMaterials: load });
  await waitFor(() => Boolean(fileDialog()?.querySelector('.flower-task-files-notice[role="alert"]')));
  expect(load).toHaveBeenCalledTimes(2);
  expect(fileDialog().querySelectorAll('.flower-task-file-row')).toHaveLength(1);
  expect(fileDialog().textContent).toContain(taskFilesEnUS.failed);
  load.mockResolvedValue({ items: [material('recovered')], next_cursor: '' });
  dialogButton(taskFilesEnUS.retry).click();
  await waitFor(() => fileDialog().textContent?.includes('recovered.txt') === true);
  expect(fileDialog().querySelector('.flower-task-files-notice[role="alert"]')).toBeNull();
});


it('keeps a dialog-owned preview above the product modal and returns focus on Escape', async () => {
  await page.viewport(1280, 900);
  const host = document.createElement('div'); document.body.append(host);
  const [open, setOpen] = createSignal(true);
  const dispose = render(() => <DialogPlacementProvider mode="global" globalZIndex={4000}>
    <FlowerTaskFiles open={open()} onOpenChange={setOpen} threadID="one" copy={taskFilesEnUS}
      adapter={{ ...adapter(), loadTaskFiles: async () => emptyFiles(),
        loadTaskMaterials: async () => ({ items: [material()] }),
        loadMessageAttachment: async () => new Blob(['Preview above the dialog'], { type: 'text/plain' }) }} />
  </DialogPlacementProvider>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => Boolean(fileDialog()?.querySelector('.flower-task-file-preview')));
  const trigger = fileDialog().querySelector<HTMLButtonElement>('.flower-task-file-preview')!;
  trigger.focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => Boolean(document.querySelector('.flower-attachment-preview-text')));
  const content = document.querySelector<HTMLElement>('.flower-attachment-preview-text')!;
  const preview = content.closest('[role="dialog"]')!;
  await new Promise(resolve => setTimeout(resolve, 300));
  const rect = content.getBoundingClientRect();
  expect(preview.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))).toBe(true);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => !document.querySelector('.flower-attachment-preview-text'));
  expect(open()).toBe(true);
  await waitFor(() => document.activeElement === trigger);
});


for (const width of [1280, 390]) {
  it('previews process images and temporary files with retained navigation at ' + width, async () => {
    await page.viewport(width, 900);
    const host = document.createElement('div'); document.body.append(host);
    const [open, setOpen] = createSignal(true);
    const clean = vi.fn(async () => {});
    const read = vi.fn(async (_thread: string, path: string) => new Blob([path.endsWith('.py') ? 'print(1)' : 'report'], { type: 'text/plain' }));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="teal"/></svg>';
    const images = Array.from({ length: 16 }, (_, i) => ({ ...material('capture-' + i, 'media'), name: 'browser-screenshot.png', mime: 'image/svg+xml', created_at: '2026-10-29T12:00:' + String(i).padStart(2, '0') + 'Z' }));
    const dispose = render(() => <DialogPlacementProvider mode="global" globalZIndex={4000}>
      <FlowerTaskFiles open={open()} onOpenChange={setOpen} threadID="one" copy={taskFilesEnUS}
        adapter={{ ...adapter(), loadTaskFiles: async () => fixture(), loadTaskMaterials: async () => ({ items: images }),
          loadTaskFile: read, cleanTaskFiles: clean, downloadTaskFile: async () => {},
          loadMessageAttachment: async () => new Blob([svg], { type: 'image/svg+xml' }) }} />
    </DialogPlacementProvider>, host);
    onTestFinished(() => { dispose(); host.remove(); });
    await waitFor(() => fileDialog()?.textContent?.includes('Quarterly report') === true);
    expect(fileDialog().textContent).not.toContain('browser-screenshot.png');
    dialogButton(taskFilesEnUS.process).click();
    await waitFor(() => fileDialog().querySelectorAll('.flower-task-material-row').length === 16);
    expect(fileDialog().textContent).not.toContain('Quarterly report');
    expect(new Set([...fileDialog().querySelectorAll('.flower-task-file-meta')].map(el => el.textContent)).size).toBe(16);
    expect(fileDialog().textContent).not.toContain(taskFilesEnUS.clean);
    const viewport = fileDialog().querySelector<HTMLElement>('.flower-task-files-viewport')!;
    viewport.scrollTop = 160;
    const top = viewport.scrollTop;
    const trigger = fileDialog().querySelectorAll<HTMLButtonElement>('.flower-task-file-preview')[3];
    trigger.focus({ preventScroll: true }); trigger.click();
    await waitFor(() => Boolean(document.querySelector('.flower-task-file-preview-dialog img')));
    await new Promise(resolve => setTimeout(resolve, 250));
    const image = document.querySelector<HTMLImageElement>('.flower-task-file-preview-dialog img')!;
    const rect = image.getBoundingClientRect();
    expect(image.closest('[role="dialog"]')!.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))).toBe(true);
    expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: '__screenshots__/files-process-preview-' + width + '.png' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => document.activeElement === trigger);
    expect(open()).toBe(true); expect(viewport.scrollTop).toBe(top);
    dialogButton(taskFilesEnUS.working).click();
    const temporary = fileDialog().querySelector<HTMLButtonElement>('.flower-task-file-preview')!;
    temporary.focus(); temporary.click();
    await waitFor(() => document.querySelector('.flower-attachment-preview-text')?.textContent === 'print(1)');
    expect(read).toHaveBeenCalledWith('one', '/state/task-files/one/scratch/helper.py', true, expect.any(AbortSignal));
    await userEvent.keyboard('{Escape}'); await waitFor(() => document.activeElement === temporary);
    expect(fileDialog().textContent).toContain(taskFilesEnUS.clean); expect(clean).not.toHaveBeenCalled();
    dialogButton(taskFilesEnUS.process).click();
    await waitFor(() => viewport.scrollTop === top);
  });
}

it('retains search and filter while a failed preview retries or closes', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('gone')).mockResolvedValue(new Blob(['Ready'], { type: 'text/plain' }));
  renderFiles({ loadTaskFiles: async () => fixture(), loadTaskMaterials: async () => ({ items: [material()] }), loadTaskFile: read });
  await waitFor(() => fileDialog()?.querySelectorAll('.flower-task-file-row').length === 2);
  dialogButton(taskFilesEnUS.results).click();
  const search = fileDialog().querySelector<HTMLInputElement>('input')!;
  search.value = 'Quarterly'; search.dispatchEvent(new InputEvent('input', { bubbles: true }));
  const trigger = fileDialog().querySelector<HTMLButtonElement>('.flower-task-file-preview')!; trigger.focus(); trigger.click();
  await waitFor(() => Boolean(document.querySelector('.flower-task-file-preview-dialog [role="alert"]')));
  expect(document.querySelector('.flower-task-file-preview-dialog')!.textContent).toContain(taskFilesEnUS.previewFailed);
  await page.getByRole('button', { name: taskFilesEnUS.retry, exact: true }).click();
  await waitFor(() => document.querySelector('.flower-attachment-preview-text')?.textContent === 'Ready');
  await userEvent.keyboard('{Tab}');
  expect(document.querySelector('.flower-task-file-preview-dialog')!.contains(document.activeElement)).toBe(true);
  await userEvent.keyboard('{Escape}'); await waitFor(() => document.activeElement === trigger);
  expect(search.value).toBe('Quarterly'); expect(dialogButton(taskFilesEnUS.results).getAttribute('aria-pressed')).toBe('true');
});

for (const hostKind of ['desktop', 'env'] as const) {
  it('renders HTML and Markdown inside the foreground preview for ' + hostKind, async () => {
    await page.viewport(1280, 900);
    const host = document.createElement('div'); document.body.append(host);
    const files = fixture();
    const markdown = { ...files.files[0], name: 'report.md', file_path: '/project/report.md', title: 'Markdown report', mime: 'text/markdown' };
    const dispose = render(() => <DialogPlacementProvider mode="global" globalZIndex={4000}>
      <FlowerTaskFiles open onOpenChange={() => {}} threadID="one" copy={taskFilesEnUS}
        renderPreviewContent={hostKind === 'env' ? FlowerTaskFilePreviewContent : undefined}
        adapter={{ ...adapter(), loadTaskFiles: async () => ({ ...files, files: [...files.files, markdown] }),
          loadTaskFile: async (_id, path) => new Blob([path.endsWith('.md') ? '# Quarterly summary\n\n**Revenue** increased.' : '<h1>Quarterly report</h1><button>Explore</button>'], { type: path.endsWith('.md') ? 'text/markdown' : 'text/html' }) }} />
    </DialogPlacementProvider>, host);
    onTestFinished(() => { dispose(); host.remove(); });
    await waitFor(() => fileDialog()?.querySelectorAll('.flower-task-file-preview').length === 2);
    fileDialog().querySelector<HTMLButtonElement>('.flower-task-file-preview')!.click();
    await waitFor(() => Boolean(document.querySelector('.flower-task-file-preview-dialog iframe')));
    const frame = document.querySelector<HTMLIFrameElement>('.flower-task-file-preview-dialog iframe')!;
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.srcdoc).toContain('Quarterly report');
    await page.getByRole('button', { name: taskFilesEnUS.back, exact: true }).click();
    await waitFor(() => !document.querySelector('.flower-task-file-preview-dialog'));
    fileDialog().querySelectorAll<HTMLButtonElement>('.flower-task-file-preview')[1].click();
    await waitFor(() => document.querySelector('.flower-task-file-preview-dialog h1')?.textContent === 'Quarterly summary');
    expect(document.querySelector('.flower-task-file-preview-dialog strong')?.textContent).toBe('Revenue');
  });
}


it('aborts an open preview on owner changes and ignores late bytes', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [id, setID] = createSignal('one');
  const signals: AbortSignal[] = [];
  let finish!: (value: Blob) => void;
  const dispose = render(() => <FlowerTaskFiles open threadID={id()} copy={taskFilesEnUS} onOpenChange={() => {}}
    adapter={{ ...adapter(), loadTaskFiles: async () => fixture(), loadTaskFile: async (_thread, _path, _working, signal) => {
      signals.push(signal); return new Promise<Blob>(resolve => { finish = resolve; });
    } }} />, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => Boolean(fileDialog()?.querySelector('.flower-task-file-preview')));
  fileDialog().querySelector<HTMLButtonElement>('.flower-task-file-preview')!.click();
  await waitFor(() => signals.length === 1);
  setID('two'); expect(signals[0].aborted).toBe(true);
  finish(new Blob(['Stale bytes'], { type: 'text/plain' }));
  await Promise.resolve();
  expect(document.querySelector('.flower-task-file-preview-dialog')).toBeNull();
  expect(document.body.textContent).not.toContain('Stale bytes');
});

it('keeps unsupported downloads and their errors visible inside the child preview', async () => {
  const download = vi.fn(async () => { throw new Error('offline'); });
  renderFiles({ loadTaskMaterials: async () => ({ items: [{ ...material(), mime: 'application/octet-stream' }] }),
    loadMessageAttachment: async () => new Blob([new Uint8Array([0, 1, 2])], { type: 'application/octet-stream' }),
    loadTaskFiles: async () => ({ ...fixture(), files: [{ ...fixture().files[0], name: 'data.bin', mime: 'application/octet-stream' }] }),
    loadTaskFile: async () => new Blob([new Uint8Array([0, 1, 2])], { type: 'application/octet-stream' }), downloadTaskFile: download });
  await waitFor(() => Boolean(fileDialog()?.querySelector('.flower-task-file-preview')));
  fileDialog().querySelector<HTMLButtonElement>('.flower-task-file-preview')!.click();
  await waitFor(() => document.querySelector('.flower-task-file-preview-dialog')?.textContent?.includes(taskFilesEnUS.unsupported) === true);
  const child = document.querySelector('.flower-task-file-preview-dialog')!;
  [...child.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === taskFilesEnUS.download)!.click();
  await waitFor(() => Boolean(child.querySelector('[role="alert"]')));
  expect(download).toHaveBeenCalledOnce(); expect(child.textContent).toContain(taskFilesEnUS.unavailable);
});
