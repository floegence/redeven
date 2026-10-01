import '../../index.css';
import { commands, page, userEvent } from 'vitest/browser';
import { createSignal, onMount, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloeConfigProvider, LayoutProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { createDefaultWorkbenchState, type WorkbenchState, type WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import { RedevenWorkbenchSurface } from '../workbench/surface/RedevenWorkbenchSurface';
import { I18nProvider } from '../i18n';
import { describeFilePreview } from '../utils/filePreview';
import { FilePreviewSurface } from './FilePreviewSurface';
import { FilePreviewContent } from './FilePreviewContent';
import { createFilePreviewController, type FilePreviewController } from './createFilePreviewController';
import { removeUIStorageItem } from '../services/uiStorage';
import { floatingWindowStorageKey } from './PersistentFloatingWindow';

const sample = `<!doctype html><html lang="en"><head><title>Report</title>
  <style>body{margin:24px;background:#f5f7f4;color:#213c31}h1{color:rgb(12,80,48)}button{cursor:pointer}section{height:1800px}</style>
  </head><body><h1>Preview report</h1><button onclick="this.textContent='Updated'">Update report</button>
  <section>Scrollable report</section><script>document.body.dataset.scriptRan='true'</script></body></html>`;
const file = { id: '/workspace/report.html', path: '/workspace/report.html', name: 'report.html', type: 'file' as const };

vi.mock('../utils/fileStreamReader', () => ({
  openReadFileStreamChannel: async () => {
    const bytes = new TextEncoder().encode(sample);
    return { meta: { content_len: bytes.length, truncated: false }, channel: {
      reader: { readExactly: async () => bytes }, close: async () => undefined, stream: { reset: () => undefined },
    } };
  },
}));

type HtmlInspection = {
  heading: string; headingColor: string; button: string; scriptRan: boolean;
  parentBlocked: boolean; storageBlocked: boolean; networkBlocked: boolean;
  scrollY: number; viewportWidth: number;
};
const htmlCommands = commands as unknown as {
  pasteFilePreviewSource: (source: string) => Promise<void>;
  inspectHtmlFilePreview: (action?: 'inspect' | 'click' | 'wheel') => Promise<HtmlInspection>;
};
const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose());
  document.body.replaceChildren();
  removeUIStorageItem(floatingWindowStorageKey('file-preview'));
});

function mount(view: () => JSX.Element) {
  const host = document.createElement('div');
  Object.assign(host.style, { width: '100%', height: '850px' });
  document.body.appendChild(host);
  disposers.push(render(() => <FloeConfigProvider config={{ storage: { enabled: false } }}>
    <ThemeProvider><LayoutProvider><I18nProvider>{view()}</I18nProvider></LayoutProvider></ThemeProvider>
  </FloeConfigProvider>, host));
  return host;
}

describe('HTML file page preview', () => {
  it('opens a styled interactive page in the floating preview and preserves explicit source editing', async () => {
    await page.viewport(1200, 900);
    let controller!: FilePreviewController;
    const writeFile = vi.fn(async () => ({ success: true }));
    mount(() => {
      controller = createFilePreviewController({ client: () => ({} as never), rpc: () => ({ fs: { writeFile } } as never), canWrite: () => true });
      onMount(() => void controller.openPreview(file));
      return <FilePreviewSurface open={controller.open()} onOpenChange={controller.handleOpenChange}
        item={controller.item()} descriptor={controller.descriptor()} text={controller.text()}
        draftText={controller.draftText()} editing={controller.editing()} canEdit={controller.canEdit()}
        dirty={controller.dirty()} saving={controller.saving()} loading={controller.loading()}
        onStartEdit={controller.beginEditing} onDraftChange={controller.updateDraft}
        onSave={() => void controller.saveCurrent()} onDiscard={controller.revertCurrent}
      />;
    });
    await vi.waitFor(() => expect(document.querySelector('iframe.html-preview-frame')).toBeTruthy());
    expect(document.querySelector('.monaco-editor')).toBeNull();
    const inspected = await htmlCommands.inspectHtmlFilePreview('click');
    expect(inspected).toMatchObject({ heading: 'Preview report', headingColor: 'rgb(12, 80, 48)', button: 'Updated',
      scriptRan: true, parentBlocked: true, storageBlocked: true, networkBlocked: true });
    const originalFrame = document.querySelector('iframe');
    controller.updateSelection('Unrelated selection update');
    expect(document.querySelector('iframe')).toBe(originalFrame);

    await userEvent.click(page.getByRole('button', { name: 'Edit file', exact: true }));
    await vi.waitFor(() => expect(document.querySelector('.monaco-editor')).toBeTruthy(), { timeout: 10_000 });
    await vi.waitFor(() => expect(document.querySelector('.monaco-editor .view-lines')?.textContent).toMatch(/Preview\sreport/), { timeout: 10_000 });
    expect(document.querySelector('iframe.html-preview-frame')).toBeNull();
    await htmlCommands.pasteFilePreviewSource('<h1>Saved report</h1><button>Saved</button>');
    await vi.waitFor(() => expect(controller.dirty()).toBe(true));
    // Persist exactly the source exposed by the editor after the user edit.
    const savedSource = controller.draftText();
    expect(savedSource).toContain('<h1>Saved report</h1>');
    expect(savedSource).not.toContain('Preview report');
    await userEvent.click(page.getByRole('button', { name: 'Save file', exact: true }));
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    expect(writeFile.mock.calls[0]).toEqual([{ path: file.path, content: savedSource, encoding: 'utf8', createDirs: false }]);
    await userEvent.click(page.getByRole('button', { name: 'Discard changes', exact: true }));
    await vi.waitFor(() => expect(document.querySelector('iframe.html-preview-frame')).toBeTruthy());
    expect((await htmlCommands.inspectHtmlFilePreview()).heading).toBe('Saved report');
  }, 20_000);

  it('fits a narrow mobile preview without loading the source editor', async () => {
    await page.viewport(390, 844);
    mount(() => <FilePreviewSurface open onOpenChange={() => undefined} item={file}
      descriptor={describeFilePreview(file.name)} text={sample} />);
    await vi.waitFor(() => expect(document.querySelector('iframe.html-preview-frame')).toBeTruthy());
    const frame = document.querySelector<HTMLIFrameElement>('iframe.html-preview-frame')!;
    await vi.waitFor(() => {
      const rect = frame.getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(250);
      expect(rect.right).toBeLessThanOrEqual(390);
      expect(rect.height).toBeGreaterThan(200);
      expect(rect.bottom).toBeLessThanOrEqual(844);
    });
    expect((await htmlCommands.inspectHtmlFilePreview('click')).button).toBe('Updated');
    expect(document.querySelector('.monaco-editor')).toBeNull();
  });

  it('keeps HTML scrolling local only to the selected Workbench widget', async () => {
    await page.viewport(1400, 1000);
    const definitions: WorkbenchWidgetDefinition[] = [{ type: 'test.html', label: 'HTML preview', defaultTitle: 'HTML preview', icon: () => null,
      defaultSize: { width: 600, height: 480 }, renderMode: 'projected_surface',
      body: props => <FilePreviewContent showHeader={false} item={file} descriptor={describeFilePreview(file.name)} text={sample} allowLocalWheel={props.selected === true} />,
    }];
    const [state, setState] = createSignal<WorkbenchState>({ ...createDefaultWorkbenchState(definitions),
      mode: 'work', viewport: { x: 0, y: 0, scale: 0.75 },
      widgets: [{ id: 'html', type: 'test.html', title: 'HTML preview', x: 120, y: 120, width: 600, height: 480, z_index: 1, created_at_unix_ms: 1 }],
      selectedWidgetId: 'html', selectedObject: { kind: 'widget', id: 'html' },
    });
    const host = mount(() => <RedevenWorkbenchSurface state={state} setState={setState} widgetDefinitions={definitions} />);
    await vi.waitFor(() => expect(host.querySelector('.html-preview-frame')).toBeTruthy());
    const frame = host.querySelector<HTMLIFrameElement>('.html-preview-frame')!;
    expect(frame.inert).toBe(false);
    expect(frame.clientHeight).toBe(frame.parentElement!.clientHeight);
    await htmlCommands.inspectHtmlFilePreview('wheel');
    await vi.waitFor(async () => expect((await htmlCommands.inspectHtmlFilePreview()).scrollY).toBeGreaterThan(0));
    expect(state().viewport.scale).toBe(0.75);
    const scrollY = (await htmlCommands.inspectHtmlFilePreview()).scrollY;
    setState(current => ({ ...current, selectedWidgetId: null, selectedObject: null }));
    await vi.waitFor(() => expect(frame.inert).toBe(true));
    expect(frame.tabIndex).toBe(-1);
    expect(getComputedStyle(frame).pointerEvents).toBe('none');
    await htmlCommands.inspectHtmlFilePreview('wheel');
    await vi.waitFor(() => expect(state().viewport.scale).not.toBe(0.75));
    expect((await htmlCommands.inspectHtmlFilePreview()).scrollY).toBe(scrollY);
    expect(host.querySelector('.html-preview-frame')).toBe(frame);
  });
});
