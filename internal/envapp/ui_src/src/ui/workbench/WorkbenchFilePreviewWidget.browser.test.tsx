import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { builtInShellThemePresets, FloeConfigProvider, ThemeProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import {
  createDefaultWorkbenchState,
  type WorkbenchState,
  type WorkbenchWidgetDefinition,
} from '@floegence/floe-webapp-core/workbench';
import { EnvContext } from '../pages/EnvContext';
import { EnvWorkbenchInstancesContext } from './EnvWorkbenchInstancesContext';
import { FilePreviewContext } from '../widgets/FilePreviewContext';
import { createFilePreviewController } from '../widgets/createFilePreviewController';
import { WorkbenchFilePreviewWidget } from './WorkbenchFilePreviewWidget';
import { RedevenWorkbenchSurface } from './surface/RedevenWorkbenchSurface';

const io = vi.hoisted(() => ({
  controllers: [] as ReturnType<typeof createFilePreviewController>[],
  copy: vi.fn(async () => {}),
  download: vi.fn(),
  ask: vi.fn(),
  previewIntent: vi.fn(),
  write: vi.fn(async () => ({})),
}));
vi.mock('../widgets/createFilePreviewController', async (original) => {
  const actual = await original<typeof import('../widgets/createFilePreviewController')>();
  return {
    ...actual,
    createFilePreviewController: (options: Parameters<typeof createFilePreviewController>[0]) => {
      const controller = actual.createFilePreviewController(options);
      io.controllers.push(controller);
      return controller;
    },
  };
});
vi.mock('@floegence/floe-webapp-core', async (original) => ({
  ...(await original<typeof import('@floegence/floe-webapp-core')>()),
  useNotification: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@floegence/floe-webapp-protocol', () => ({ useProtocol: () => ({ session: () => ({}) }) }));
vi.mock('../protocol/redeven_v1', () => ({ useRedevenRpc: () => ({ fs: { writeFile: io.write } }) }));
vi.mock('../services/workspaceEffects', () => ({ createWorkspaceEffectRpc: (_: unknown, rpc: unknown) => rpc }));
vi.mock('../utils/filePreviewAskFlower', async (original) => {
  const actual = await original<typeof import('../utils/filePreviewAskFlower')>();
  return { ...actual, buildFilePreviewFlowerTurnLauncherIntent: (options: Parameters<typeof actual.buildFilePreviewFlowerTurnLauncherIntent>[0]) => {
    io.previewIntent(options);
    return actual.buildFilePreviewFlowerTurnLauncherIntent(options);
  } };
});
vi.mock('../utils/clipboard', () => ({ writeTextToClipboard: io.copy }));
vi.mock('../downloads/DownloadContext', () => ({ useDownloadManager: () => ({ enqueue: io.download }) }));
vi.mock('../utils/fileStreamReader', () => ({
  openReadFileStreamChannel: async () => {
    const bytes = new TextEncoder().encode(
      '# Preview report\n\nSelected preview paragraph.\n\n## Findings\n\nSaved content.',
    );
    let offset = 0;
    return {
      meta: { content_len: bytes.length, truncated: false },
      channel: {
        reader: {
          readExactly: async (size: number) => {
            const part = bytes.slice(offset, offset + size);
            offset += part.length;
            return part;
          },
        },
        close: async () => {},
        stream: { reset: () => {} },
      },
    };
  },
}));
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  vi.clearAllMocks();
  io.controllers.length = 0;
});

function mount(mode: 'light' | 'dark', scale = 1) {
  document.documentElement.classList.add(mode);
  document.documentElement.dataset.floeShellTheme = mode === 'dark' ? 'classic-dark' : 'paper';
  document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
  const host = document.createElement('div');
  host.style.cssText = 'width:100vw;height:100vh';
  document.body.append(host);
  const file = {
    id: '/workspace/report.md',
    path: '/workspace/report.md',
    name: 'A very long preview report filename.md',
    type: 'file' as const,
  };
  const definitions: WorkbenchWidgetDefinition[] = [
    {
      type: 'redeven.preview',
      label: 'Preview',
      defaultTitle: 'Preview',
      icon: () => null,
      body: WorkbenchFilePreviewWidget,
      defaultSize: { width: 900, height: 600 },
      renderMode: 'projected_surface',
    },
  ];
  const [state, setState] = createSignal<WorkbenchState>({
    ...createDefaultWorkbenchState(definitions),
    theme: 'mica',
    mode: 'work',
    stickyNotes: [], backgroundLayers: [], annotations: [],
    viewport: { x: 0, y: 0, scale },
    selectedWidgetId: 'preview',
    widgets: [
      {
        id: 'preview',
        type: 'redeven.preview',
        title: file.name,
        x: 60,
        y: 50,
        width: 900,
        height: 600,
        z_index: 1,
        created_at_unix_ms: 1,
      },
    ],
  });
  const removeGuards = new Map<string, () => boolean>();
  dispose = render(() => {
    const controller = createFilePreviewController({
      client: () => undefined,
      rpc: () => undefined,
      canWrite: () => false,
    });
    return (
      <FloeConfigProvider config={{
        storage: { enabled: false },
        theme: {
          defaultTheme: mode,
          defaultSurfaceStyle: 'soft-neumorphic',
          shellPresets: builtInShellThemePresets,
          defaultShellPreset: { light: 'paper', dark: 'classic-dark' },
        },
      }}>
        <ThemeProvider>
          <LayoutProvider>
            <EnvContext.Provider
              value={{ env: () => ({ permissions: { can_write: true } }), openFlowerTurnLauncher: io.ask } as any}
            >
              <FilePreviewContext.Provider
                value={{ controller, openPreview: controller.openPreview, closePreview: controller.closePreview }}
              >
                <EnvWorkbenchInstancesContext.Provider
                  value={
                    {
                      previewItem: () => file,
                      pendingSyncedPreviewItem: () => null,
                      previewOpenRequest: () => null,
                      updatePreviewItem: () => {},
                      registerWidgetRemoveGuard: (id: string, guard: (() => boolean) | null) => {
                        if (guard) removeGuards.set(id, guard);
                        else removeGuards.delete(id);
                      },
                      removeWidget: (id: string) =>
                        setState((s) => ({ ...s, widgets: s.widgets.filter((w) => w.id !== id) })),
                    } as any
                  }
                >
                  <RedevenWorkbenchSurface
                    state={state}
                    setState={setState}
                    widgetDefinitions={definitions}
                    onRequestDelete={(id) => {
                      if (removeGuards.get(id)?.())
                        setState((s) => ({ ...s, widgets: s.widgets.filter((w) => w.id !== id) }));
                    }}
                  />
                </EnvWorkbenchInstancesContext.Provider>
              </FilePreviewContext.Provider>
            </EnvContext.Provider>
          </LayoutProvider>
        </ThemeProvider>
      </FloeConfigProvider>
    );
  }, host);
  const resize = (width: number) => setState((s) => ({ ...s, widgets: s.widgets.map((w) => ({ ...w, width })) }));
  return { host, state, setState, resize, file };
}

function select(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

describe('Workbench preview header', () => {
  it.each(['light', 'dark'] as const)('keeps one row and usable actions at narrow widths in %s', async (mode) => {
    await page.viewport(1200, 900);
    const { host, state, resize, file } = mount(mode, 0.8);
    await vi.waitFor(() => expect(host.querySelector('.file-markdown-body p')).toBeTruthy());
    expect(document.documentElement.classList.contains(mode)).toBe(true);
    const root = host.querySelector<HTMLElement>('.workbench-widget')!;
    const header = root.querySelector<HTMLElement>('header')!;
    const height = header.getBoundingClientRect().height;
    const actions = header.querySelector<HTMLElement>('[data-floe-workbench-header-actions]')!;
    expect(actions).toBeTruthy();
    expect(root.querySelector('.redeven-file-preview-toolbar')).toBeNull();
    expect(header.querySelector('.workbench-widget__title')?.getAttribute('title')).toBe(file.path);
    const reading = root.querySelector<HTMLElement>('.redeven-file-preview')!;
    expect(Math.abs(reading.getBoundingClientRect().top - header.getBoundingClientRect().bottom)).toBeLessThan(1);
    const viewport = { ...state().viewport };
    await userEvent.click(page.getByRole('button', { name: 'Copy path', exact: true }));
    expect(io.copy).toHaveBeenCalledWith(file.path);
    select(root.querySelector('.file-markdown-body p')!);
    await userEvent.click(page.getByRole('button', { name: 'Ask Flower', exact: true }));
    expect(io.previewIntent).toHaveBeenLastCalledWith(expect.objectContaining({ selectionText: 'Selected preview paragraph.' }));
    expect(state().viewport).toEqual(viewport);
    const body = root.querySelector('.file-markdown-body');
    for (const width of [480, 479, 320, 220, 900]) {
      resize(width);
      await vi.waitFor(() =>
        expect(Boolean(header.querySelector('button[aria-label="More file actions"]'))).toBe(width < 480),
      );
      expect(header.getBoundingClientRect().height).toBe(height);
      expect(root.querySelector('.file-markdown-body')).toBe(body);
      const title = header.querySelector<HTMLElement>('.workbench-widget__title-area')!;
      expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(actions.getBoundingClientRect().left + 1);
      for (const button of actions.querySelectorAll('button')) {
        const rect = button.getBoundingClientRect();
        expect(rect.right).toBeLessThanOrEqual(header.getBoundingClientRect().right);
        expect(button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))).toBe(
          true,
        );
      }
      if (width === 220) {
        select(root.querySelector('.file-markdown-body p')!);
        await userEvent.click(page.getByRole('button', { name: 'More file actions', exact: true }));
        const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
        expect(menu).toBeTruthy();
        expect(getComputedStyle(menu).position).not.toBe('fixed');
        expect(menu.closest('[data-floe-surface-portal-layer]')).toBeTruthy();
        expect(menu.hasAttribute('data-floe-local-interaction-surface')).toBe(true);
        await Promise.all(menu.getAnimations().map((animation) => animation.finished));
        await page.screenshot({ path: `workbench-preview-${mode}-narrow.png` });
        await userEvent.click(page.getByRole('menuitem', { name: 'Ask Flower', exact: true }));
        expect(io.previewIntent).toHaveBeenLastCalledWith(expect.objectContaining({ selectionText: 'Selected preview paragraph.' }));
      }
    }
    await userEvent.click(page.getByRole('button', { name: 'Download file', exact: true }));
    expect(io.download).toHaveBeenCalledOnce();
    await page.screenshot({ path: `workbench-preview-${mode}-wide.png` });
    expect(state().viewport).toEqual(viewport);
  });

  it('supports keyboard menus and restores focus without moving the canvas', async () => {
    await page.viewport(1200, 900);
    const { host, state, resize } = mount('light');
    resize(320);
    await vi.waitFor(() => expect(host.querySelector('.file-markdown-body p')).toBeTruthy());
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="More file actions"]')!;
    const viewport = { ...state().viewport };
    more.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.activeElement).toBe(more));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Tab}');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await userEvent.click(more);
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    await userEvent.click(more);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await userEvent.click(more);
    resize(900);
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    expect(state().viewport).toEqual(viewport);
  });
  it('keeps edit, save, draft download, and unsaved-close protection in the same controller', async () => {
    await page.viewport(1200, 900);
    const { host, resize } = mount('light');
    await vi.waitFor(() => expect(host.querySelector('.file-markdown-body p')).toBeTruthy());
    const controller = io.controllers.at(-1)!;
    await userEvent.click(page.getByRole('button', { name: 'Edit file', exact: true }));
    expect(controller.editing()).toBe(true);
    controller.updateDraft('# Updated draft');
    controller.updateSelection('Editor selection');
    await userEvent.click(page.getByRole('button', { name: 'Ask Flower', exact: true }));
    expect(io.previewIntent).toHaveBeenLastCalledWith(expect.objectContaining({ selectionText: 'Editor selection' }));
    resize(320);
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="More file actions"]')).toBeTruthy());
    await userEvent.click(page.getByRole('button', { name: 'More file actions', exact: true }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Save file', exact: true }));
    await vi.waitFor(() => expect(controller.dirty()).toBe(false));
    expect(io.write).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/report.md', content: '# Updated draft' }),
    );
    controller.updateDraft('# Unsaved local draft');
    await userEvent.click(page.getByRole('button', { name: 'More file actions', exact: true }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Download file', exact: true }));
    expect(JSON.stringify(io.download.mock.calls.at(-1))).toContain('workbench_preview');
    await userEvent.click(page.getByRole('button', { name: 'Remove widget', exact: true }));
    expect(controller.closeConfirmOpen()).toBe(true);
    expect(host.querySelector('.workbench-widget')).toBeTruthy();
    await userEvent.click(page.getByRole('button', { name: 'Cancel', exact: true }));
    expect(controller.dirty()).toBe(true);
    await userEvent.click(page.getByRole('button', { name: 'Remove widget', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Discard changes', exact: true }));
    await vi.waitFor(() => expect(host.querySelector('.workbench-widget')).toBeNull());
  });
});
