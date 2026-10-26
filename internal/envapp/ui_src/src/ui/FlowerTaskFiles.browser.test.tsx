import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { it, expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FlowerTaskFiles } from '../../../../flower_ui/src/FlowerTaskFiles';
import { taskFilesEnUS } from '../../../../flower_ui/src/taskFilesCopy';
import type {
  FlowerTaskFiles as TaskFiles,
  FlowerSurfaceAdapter,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, renderSurfaceWithAdapter, waitFor } from './FlowerSurface.navigation.testHarness';
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
