import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
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

import { loadPDFDocument } from '../widgets/pdfPreviewRuntime';
import formsFixtureUrl from '../widgets/__fixtures__/pdf/forms.pdf?url';
import unembeddedFixtureUrl from '../widgets/__fixtures__/pdf/mixed-unembedded.pdf?url';
import longFixtureUrl from '../widgets/__fixtures__/pdf/long-text.pdf?url';
import pdfFixtureUrl from '../widgets/__fixtures__/pdf/mixed-embedded.pdf?url';
const pdfCommands = commands as unknown as { selectPdfText: (text: string) => Promise<{ selection: string; clipboard: string }>; recordPdfEvidence: (metrics: { firstPaintMs: number; canvases: number }) => Promise<void> };
const io = vi.hoisted(() => ({
  pdfBytes: null as Uint8Array<ArrayBuffer> | null,
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
    const bytes = io.pdfBytes ?? new TextEncoder().encode(
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
  io.pdfBytes = null;
  io.write.mockReset().mockResolvedValue({});
});

function mount(mode: 'light' | 'dark', scale = 1) {
  document.documentElement.classList.add(mode);
  document.documentElement.dataset.floeShellTheme = mode === 'dark' ? 'classic-dark' : 'paper';
  document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
  const host = document.createElement('div');
  host.style.cssText = 'width:100vw;height:100vh';
  document.body.append(host);
  const file = {
    id: io.pdfBytes ? '/workspace/contract.pdf' : '/workspace/report.md',
    path: io.pdfBytes ? '/workspace/contract.pdf' : '/workspace/report.md',
    name: io.pdfBytes ? 'contract.pdf' : 'A very long preview report filename.md',
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
  it.each([0.65, 1, 1.5])('selects, copies and quotes PDF text under a %s Workbench projection', async scale => {
    await page.viewport(1800, 1200);
    io.pdfBytes = new Uint8Array(await (await fetch(pdfFixtureUrl)).arrayBuffer());
    const { host, state, resize } = mount('light', scale);
    await vi.waitFor(() => expect(host.querySelector('.textLayer span')).toBeTruthy());
    const before = { ...state().viewport };
    const english = await pdfCommands.selectPdfText('Redeven selection');
    expect(english.selection).toContain('Redeven selection test');
    expect(english.clipboard).toBe(english.selection);
    const chinese = await pdfCommands.selectPdfText('中文合同');
    expect(chinese.selection).toContain('中文合同预览');
    expect(chinese.clipboard).toBe(chinese.selection);
    await userEvent.click(page.getByRole('button', { name: 'Ask Flower', exact: true }));
    expect(io.previewIntent).toHaveBeenLastCalledWith(expect.objectContaining({ selectionText: chinese.selection }));
    expect(state().viewport).toEqual(before);
    resize(320);
    await vi.waitFor(() => {
      const tools = host.querySelector<HTMLElement>('.pdf-document-controls')!.getBoundingClientRect();
      const zoom = host.querySelector<HTMLElement>('.preview-zoom-controls')!.getBoundingClientRect();
      expect(tools.right).toBeLessThanOrEqual(zoom.left);
    });
  });

  it('persists native PDF fields and highlights, protects failed saves, and exports the current draft', async () => {
    await page.viewport(1400, 1000);
    io.pdfBytes = new Uint8Array(await (await fetch(formsFixtureUrl)).arrayBuffer());
    const { host, state, resize } = mount('dark', 0.8);
    await vi.waitFor(() => expect(host.querySelector('.textLayer span')).toBeTruthy());
    expect(host.querySelector('.annotationLayer input')).toBeNull();
    const controller = io.controllers.at(-1)!;
    const source = controller.bytes();
    const canvasState = { ...state().viewport };
    await userEvent.click(page.getByRole('button', { name: 'Edit file', exact: true }));
    await vi.waitFor(() => expect(host.querySelector('input[name="full_name"]')).toBeTruthy());
    await userEvent.fill(host.querySelector<HTMLInputElement>('input[name="full_name"]')!, 'Saved PDF value');
    await userEvent.click(host.querySelector<HTMLInputElement>('input[name="accepted"]')!);
    expect(controller.dirty()).toBe(true);
    await userEvent.click(page.getByRole('button', { name: 'Zoom in PDF preview', exact: true }));
    await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('input[name="full_name"]')!.value).toBe('Saved PDF value'));
    await pdfCommands.selectPdfText('中文合同');
    await userEvent.click(page.getByRole('button', { name: 'Highlight selected text', exact: true }));
    await vi.waitFor(() => expect(host.querySelector('.highlightEditor')).toBeTruthy());
    resize(320);
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="More file actions"]')).toBeTruthy());
    const tools = host.querySelector<HTMLElement>('.pdf-document-controls')!.getBoundingClientRect();
    expect(tools.right).toBeLessThanOrEqual(host.querySelector<HTMLElement>('.preview-zoom-controls')!.getBoundingClientRect().left);
    await userEvent.click(page.getByRole('button', { name: 'Annotation history', exact: true }));
    expect(document.querySelector('[role="menu"]')?.closest('[data-floe-surface-portal-layer]')).toBeTruthy();
    await userEvent.click(page.getByRole('menuitem', { name: 'Undo annotation', exact: true }));
    await vi.waitFor(() => expect(host.querySelector('.highlightEditor')).toBeNull());
    await userEvent.click(page.getByRole('button', { name: 'Annotation history', exact: true }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Redo annotation', exact: true }));
    await vi.waitFor(() => expect(host.querySelector('.highlightEditor')).toBeTruthy());
    resize(900);
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="Save file"]')).toBeTruthy());
    const viewport = host.querySelector<HTMLElement>('.pdf-preview-pane')!;
    const scrollBefore = viewport.scrollTop;
    io.write.mockRejectedValueOnce(new Error('Storage temporarily unavailable'));
    await userEvent.click(page.getByRole('button', { name: 'Save file', exact: true }));
    await vi.waitFor(() => expect(controller.saveError()).toBe('Storage temporarily unavailable'));
    expect(controller.dirty()).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Storage temporarily unavailable');
    await userEvent.click(page.getByRole('button', { name: 'Save PDF copy', exact: true }));
    await vi.waitFor(() => expect(io.download).toHaveBeenCalledOnce());
    const command = (io.download.mock.calls[0] as unknown as [{ source: { kind: string; bytes: Uint8Array<ArrayBuffer> } }])[0];
    expect(command.source.kind).toBe('pdf_draft');
    const inspect = async (bytes: Uint8Array<ArrayBuffer>, expectedName: string) => {
      const task = loadPDFDocument(bytes);
      try {
        const doc = await task.promise;
        const fields = await doc.getFieldObjects() as Map<string, Array<{ value: unknown }>> | null;
        expect(fields!.get('full_name')![0]!.value).toBe(expectedName);
        expect(fields!.get('accepted')![0]!.value).toBe('Yes');
        const annotations = await (await doc.getPage(1)).getAnnotations();
        expect(annotations.filter(annotation => annotation.subtype === 'Highlight')).toHaveLength(1);
      } finally { await task.destroy(); }
    };
    await inspect(command.source.bytes, 'Saved PDF value');
    expect(controller.dirty()).toBe(true);
    await userEvent.click(page.getByRole('button', { name: 'Save file', exact: true }));
    await vi.waitFor(() => expect(controller.dirty()).toBe(false));
    expect(controller.bytes()).toBe(source);
    expect(viewport.scrollTop).toBe(scrollBefore);
    const request = (io.write.mock.calls.at(-1) as unknown as [{ encoding: string; content: string }])[0];
    expect(request.encoding).toBe('base64');
    await inspect(Uint8Array.from(atob(request.content), char => char.charCodeAt(0)), 'Saved PDF value');
    expect(state().viewport).toEqual(canvasState);
    await page.screenshot({ path: 'workbench-pdf-edited-dark.png' });
    await userEvent.fill(host.querySelector<HTMLInputElement>('input[name="full_name"]')!, 'Unsaved');
    await userEvent.click(page.getByRole('button', { name: 'Remove widget', exact: true }));
    expect(controller.closeConfirmOpen()).toBe(true);
    await userEvent.click(page.getByRole('button', { name: 'Cancel', exact: true }));
    expect(controller.dirty()).toBe(true);
    await userEvent.click(page.getByRole('button', { name: 'Discard changes', exact: true }));
    await vi.waitFor(() => expect(controller.editing()).toBe(false));
    await userEvent.click(page.getByRole('button', { name: 'Edit file', exact: true }));
    await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('input[name="full_name"]')?.value).toBe('Saved PDF value'));
  });

  it('renders and selects unembedded Chinese through the locally served CMap assets', async () => {
    await page.viewport(1400, 1000);
    io.pdfBytes = new Uint8Array(await (await fetch(unembeddedFixtureUrl)).arrayBuffer());
    const { host } = mount('light');
    await vi.waitFor(() => expect(host.querySelector('.textLayer span')).toBeTruthy());
    const chinese = await pdfCommands.selectPdfText('中文合同');
    expect(chinese.selection).toContain('中文合同预览');
    expect(chinese.clipboard).toBe(chinese.selection);
    await page.screenshot({ path: 'workbench-pdf-cjk-unembedded.png' });
  });

  it('searches the last of 300 pages while keeping only nearby pages and bounded canvases mounted', async () => {
    await page.viewport(1400, 1000);
    io.pdfBytes = new Uint8Array(await (await fetch(longFixtureUrl)).arrayBuffer());
    const start = performance.now();
    const { host } = mount('light');
    await vi.waitFor(() => expect(host.querySelector('.textLayer span')).toBeTruthy(), { timeout: 15000 });
    const firstPaintMs = performance.now() - start;
    expect(host.querySelectorAll('canvas').length).toBeLessThanOrEqual(5);
    await userEvent.click(page.getByRole('button', { name: 'Find in PDF', exact: true }));
    await userEvent.fill(host.querySelector<HTMLInputElement>('input[type="search"]')!, 'REDEVEN-300');
    await vi.waitFor(() => expect(host.querySelector('.textLayer .highlight.selected')).toBeTruthy(), { timeout: 15000 });
    const match = host.querySelector<HTMLElement>('.textLayer .highlight.selected')!;
    expect(match.closest('.pdf-preview-pane__page')?.getAttribute('data-page-number')).toBe('300');
    expect(host.querySelector('.pdf-preview-pane__page[data-page-number="1"]')).toBeNull();
    expect(host.querySelectorAll('canvas').length).toBeLessThanOrEqual(5);
    for (const canvas of host.querySelectorAll('canvas')) expect(canvas.width * canvas.height).toBeLessThanOrEqual(6_000_000);
    await pdfCommands.recordPdfEvidence({ firstPaintMs, canvases: host.querySelectorAll('canvas').length });
    await page.screenshot({ path: 'workbench-pdf-300-page-search.png' });
  });

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
