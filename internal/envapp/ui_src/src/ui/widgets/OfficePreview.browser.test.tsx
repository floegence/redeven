import '../../index.css';
import '../../../../../flower_ui/src/styles/flower.css';
import { render } from 'solid-js/web';
import { createSignal, type JSX } from 'solid-js';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelimitedTextPreview } from '../../../../../flower_ui/src/preview/DelimitedTextPreview';
import { FlowerRichFilePreview } from '../../../../../flower_ui/src/preview/FlowerRichFilePreview';
import { FlowerTaskFilePreview } from '../../../../../flower_ui/src/FlowerTaskFilePreview';
import { FlowerAttachmentPreviewWindow } from '../../../../../flower_ui/src/attachments/FlowerAttachmentPreviewWindow';
import { taskFilesEnUS } from '../../../../../flower_ui/src/taskFilesCopy';
import { FloeConfigProvider, LayoutProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { createDefaultWorkbenchState, type WorkbenchState, type WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import { RedevenWorkbenchSurface } from '../workbench/surface/RedevenWorkbenchSurface';
import { FilePreviewContent } from './FilePreviewContent';
import { FlowerTaskFilePreviewContent } from '../flower/FlowerTaskFilePreviewContent';
import { I18nProvider } from '../i18n';
import docxURL from './__fixtures__/preview-pages.docx?url';
import xlsxURL from './__fixtures__/preview-workbook.xlsx?url';
import { SpreadsheetPreview } from '../../../../../flower_ui/src/preview/SpreadsheetPreview';
import pptxURL from './__fixtures__/preview-pages.pptx?url';

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
function mount(view: () => JSX.Element, width = 800) {
  const host = document.createElement('div');
  Object.assign(host.style, { width: width + 'px', height: '600px' });
  document.body.append(host); disposers.push(render(view, host)); return host;
}
const csv = '\ufeffname,id,expression,notes\r\n中文,00123,"=SUM(1,2)","line one\nline two"\r\nBeta,12345678901234567890,text,"comma,quote"';
const bytes = new TextEncoder().encode(csv);
async function gridReady(host: HTMLElement) {
  await vi.waitFor(() => {
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.disabled).toBe(false);
    const canvas = host.querySelector('canvas'); expect(canvas!.width).toBeGreaterThan(0);
    const holder = host.querySelector('.flower-delimited-canvas')!;
    expect(canvas!.getBoundingClientRect().width).toBeGreaterThan(holder.clientWidth - 25);
    expect(canvas!.getBoundingClientRect().height).toBeGreaterThan(holder.clientHeight - 25);
  }, { timeout: 8000 });
}
async function find(host: HTMLElement, value: string) {
  if (!document.querySelector('input[type=search]')) await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="Find"]')!);
  const input = document.querySelector<HTMLInputElement>('input[type=search]')!;
  await userEvent.fill(input, value); await userEvent.keyboard('{Enter}');
  await vi.waitFor(() => expect(document.querySelector('output')?.textContent).toBe('1 / 1'));
}
describe('Office and delimited preview acceptance', () => {
  it.each([['csv', 'light'], ['csv', 'dark'], ['tsv', 'light'], ['tsv', 'dark']] as const)('distinguishes the current %s match in %s while focus stays in search', async (format, theme) => {
    await page.viewport(1280, 900);
    const data = new TextEncoder().encode(['match,match', 'match,end'].join('\n').replaceAll(',', format === 'csv' ? ',' : '\t'));
    const host = mount(() => <FloeConfigProvider config={{ storage: { enabled: false }, theme: { defaultTheme: theme } }}><ThemeProvider><SpreadsheetPreview bytes={data} format={format} copy={taskFilesEnUS} /></ThemeProvider></FloeConfigProvider>);
    await gridReady(host);
    const input = host.querySelector<HTMLInputElement>('input[type=search]')!;
    const highlights = () => [...host.querySelectorAll<HTMLDivElement>('.flower-delimited-canvas div')].filter(element => element.style.borderWidth === '2px' && element.style.pointerEvents === 'none');
    await userEvent.fill(input, 'match'); await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => {
      expect(highlights()).toHaveLength(3);
      expect(new Set(highlights().map(element => getComputedStyle(element).backgroundColor)).size).toBe(2);
    });
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[data-xlsx-selection-border]')).not.toBeNull();
    expect(host.querySelector('output')?.textContent).toBe('1 / 3');
    const colors = highlights().map(element => getComputedStyle(element).backgroundColor);
    expect(colors[0]).not.toBe(colors[1]); expect(colors[1]).toBe(colors[2]);
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(host.querySelector('output')?.textContent).toBe('2 / 3'));
    expect(highlights().map(element => getComputedStyle(element).backgroundColor)).toEqual([colors[1], colors[0], colors[1]]);
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    await vi.waitFor(() => expect(host.querySelector('output')?.textContent).toBe('1 / 3'));
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    await vi.waitFor(() => expect(host.querySelector('output')?.textContent).toBe('3 / 3'));
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(host.querySelector('output')?.textContent).toBe('1 / 3'));
    await userEvent.fill(input, 'missing'); await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(highlights()).toHaveLength(0));
    expect(host.querySelector('output')?.textContent).toBe('0 / 0');
  });
  it('reveals and selects XLSX results across scrolling, zoom and sheet transitions', async () => {
    await page.viewport(1280, 900);
    const data = new Uint8Array(await (await fetch(xlsxURL)).arrayBuffer());
    const host = mount(() => <SpreadsheetPreview bytes={data} format="xlsx" copy={taskFilesEnUS} />);
    await gridReady(host);
    const bounds = host.querySelector('.flower-delimited-body')!.getBoundingClientRect().toJSON();
    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label=Find]')!);
    const input = document.querySelector<HTMLInputElement>('input[type=search]')!;
    await userEvent.fill(input, 'Row 30'); await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(document.querySelector('output')?.textContent).toBe('1 / 2'));
    const scroll = host.querySelector<HTMLElement>('[data-redeven-workbench-wheel-role]')!;
    expect(scroll.scrollTop).toBeGreaterThan(0);
    const first = scroll.scrollTop;
    expect(host.querySelector('[data-xlsx-selection-border]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Selected cell value"]')?.textContent).toBe('Row 30');
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(document.querySelector('output')?.textContent).toBe('2 / 2'));
    expect(scroll.scrollTop).toBeGreaterThan(first);
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Selected cell value"]')?.textContent).toBe('Row 300'));
    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!);
    expect(host.querySelector('[aria-label="Selected cell value"]')?.textContent).toBe('Row 300');
    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label=Find]')!);
    expect(document.querySelector('output')?.textContent).toBe('2 / 2');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    await vi.waitFor(() => expect(document.querySelector('output')?.textContent).toBe('1 / 2'));
    await vi.waitFor(() => expect(host.querySelector('[data-xlsx-selection-border]')).not.toBeNull());
    expect(host.querySelector('.flower-delimited-body')!.getBoundingClientRect().toJSON()).toEqual(bounds);
    await find(host, 'Commented cell');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Selected cell value"]')?.textContent).toBe('Commented cell'));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(host.querySelector<HTMLElement>('[role=combobox][aria-label=Worksheet]')!);
    await userEvent.click(page.getByRole('option', { name: 'Identity', exact: true }));
    await gridReady(host);
    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label=Find]')!);
    expect(document.querySelector('output')).toBeNull();
    expect(host.querySelector('.flower-delimited-body')!.getBoundingClientRect().toJSON()).toEqual(bounds);
  });
  it('preserves literal CSV values, searches, zooms and offers source at narrow widths', async () => {
    await page.viewport(1280, 900);
    const host = mount(() => <DelimitedTextPreview bytes={bytes} format="csv" copy={taskFilesEnUS} source={<pre>{csv}</pre>} />);
    await gridReady(host);
    for (const value of ['00123', '12345678901234567890', '=SUM(1,2)', '中文']) await find(host, value);
    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!);
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Actual size"]')?.textContent).toBe('110%'));
    for (const width of [390, 320]) {
      host.style.width = width + 'px';
      await vi.waitFor(() => expect(host.scrollWidth).toBeLessThanOrEqual(width));
      for (const control of host.querySelectorAll<HTMLElement>('button,input,select')) {
        const box = control.getBoundingClientRect(), bounds = host.getBoundingClientRect();
        expect(box.right).toBeLessThanOrEqual(bounds.right + 1);
      }
    }
    await userEvent.click(page.getByRole('button', { name: 'Source', exact: true }));
    expect(host.querySelector('pre')?.textContent).toBe(csv.replaceAll('\r\n', '\n'));
    expect(host.querySelector('canvas')).toBeNull();
    await userEvent.click(page.getByRole('button', { name: 'Table', exact: true }));
    await gridReady(host);
  });
  it('switches source bytes and uses TSV without leaking prior results', async () => {
    const [data, setData] = createSignal(bytes);
    const [kind, setKind] = createSignal<'csv' | 'tsv'>('csv');
    const host = mount(() => <DelimitedTextPreview bytes={data()} format={kind()} copy={taskFilesEnUS} source={<pre />} />);
    await gridReady(host); setKind('tsv'); setData(new TextEncoder().encode('name\tid\nReplacement\t0007'));
    await gridReady(host); await find(host, '0007');
    expect(host.textContent).not.toContain('Could not preview');
  });
  it('renders DOCX and every PPTX page through the shared desktop path', async () => {
    const docx = await (await fetch(docxURL)).blob();
    const pptx = await (await fetch(pptxURL)).blob();
    const [document, setDocument] = createSignal({ name: 'pages.docx', blob: docx });
    const host = mount(() => <FlowerRichFilePreview {...document()} mime="application/octet-stream" copy={taskFilesEnUS} />);
    await vi.waitFor(() => expect(host.querySelectorAll('section.flower-docx').length).toBeGreaterThan(0), { timeout: 15000 });
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Actual size"]')?.textContent).not.toBe('--'));
    setDocument({ name: 'slides.pptx', blob: pptx });
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Next slide"]')).toBeTruthy(), { timeout: 15000 });
    expect(host.querySelector('[role=alert]')).toBeNull();
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Next slide"]')!;
    while (!next.disabled) { await userEvent.click(next); await new Promise(resolve => setTimeout(resolve, 80)); expect(host.querySelector('[role=alert]')).toBeNull(); }
    expect(host.querySelector('.flower-rich-scroll')?.children.length).toBeGreaterThan(0);
  });
  it('loads CSV through both task-file and attachment windows', async () => {
    const source = { id: 'csv', name: 'literal.csv', mimeType: 'text/csv', load: async () => new Blob([bytes], { type: 'text/csv' }) };
    mount(() => <FlowerTaskFilePreview source={source} copy={taskFilesEnUS} onClose={() => {}} downloading={false} />);
    await gridReady(document.body);
    disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren();
    mount(() => <FlowerAttachmentPreviewWindow source={source} copy={taskFilesEnUS} loadingLabel={taskFilesEnUS.loading} unavailableLabel={taskFilesEnUS.unsupported} onClose={() => {}} />);
    await gridReady(document.body);
  });
  it('uses the published XLSX renderer in Desktop and Env with styles, all visible sheets and no legacy limits', async () => {
    const blob = await (await fetch(xlsxURL)).blob();
    const props = { name: 'identity.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', blob };
    for (const env of [false, true]) {
      const host = mount(() => env ? <I18nProvider><FlowerTaskFilePreviewContent {...props} /></I18nProvider> : <FlowerRichFilePreview {...props} copy={taskFilesEnUS} />);
      await gridReady(host);
      expect(host.querySelector('table')).toBeNull();
      expect(host.querySelector('[aria-label="Text encoding"]')).toBeNull();
      expect(host.textContent).not.toContain('Basic preview');
      const sheets = host.querySelector<HTMLElement>('[role="combobox"][aria-label="Worksheet"]')!;
      await userEvent.click(sheets);
      expect([...document.querySelectorAll('[role="option"]')].map(option => option.textContent)).toEqual(['Identity', 'Notes']);
      await userEvent.keyboard('{Escape}');
      for (const value of ['00123', '12345678901234567890', 'Beyond legacy limits']) await find(host, value);
      await userEvent.click(sheets); await userEvent.click(page.getByRole('option', { name: 'Notes', exact: true })); await gridReady(host);
      await find(host, 'Commented cell');
      await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!);
      expect(host.querySelector('[aria-label="Actual size"]')?.textContent).toBe('110%');
      await userEvent.click(sheets); await userEvent.click(page.getByRole('option', { name: 'Identity', exact: true })); await gridReady(host);
      disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren();
    }
  });
  it('reports corrupt XLSX input and recovers when a different workbook arrives', async () => {
    const [data, setData] = createSignal(new Uint8Array([1, 2, 3]));
    const host = mount(() => <SpreadsheetPreview bytes={data()} format="xlsx" copy={taskFilesEnUS} />);
    await vi.waitFor(() => expect(host.querySelector('[role=alert]')?.textContent).toContain(taskFilesEnUS.previewFailed));
    setData(new Uint8Array(await (await fetch(xlsxURL)).arrayBuffer()));
    await gridReady(host); await find(host, '00123');
  });
  it('keeps XLSX controls in one row and opens search and details only on demand', async () => {
    await page.viewport(320, 760);
    const data = new Uint8Array(await (await fetch(xlsxURL)).arrayBuffer());
    const host = mount(() => <SpreadsheetPreview bytes={data} format="xlsx" copy={taskFilesEnUS} />, 304);
    await gridReady(host);
    const toolbar = host.querySelector<HTMLElement>('.flower-spreadsheet-toolbar')!;
    expect(toolbar.getBoundingClientRect().height, JSON.stringify([...toolbar.children].map(element => ({ tag: element.tagName, height: element.getBoundingClientRect().height, minHeight: getComputedStyle(element).minHeight })))).toBeLessThanOrEqual(40);
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    const controls = [...toolbar.querySelectorAll<HTMLElement>('button,select')].filter(element => element.getAttribute('aria-hidden') !== 'true' && element.getBoundingClientRect().width > 0);
    for (let index = 1; index < controls.length; index++) {
      expect(controls[index].getBoundingClientRect().left).toBeGreaterThanOrEqual(controls[index - 1].getBoundingClientRect().right);
    }
    expect(host.querySelector('input[type=search]')).toBeNull();
    expect(host.querySelector('.flower-delimited-value')).toBeNull();
    expect(host.textContent).not.toContain(taskFilesEnUS.spreadsheetNotice);
    const findButton = host.querySelector<HTMLButtonElement>('[aria-label="Find"]')!;
    findButton.focus();
    await userEvent.keyboard('{Control>}f{/Control}');
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('type')).toBe('search'));
    const panel = document.querySelector<HTMLElement>('[data-spreadsheet-panel]')!;
    await vi.waitFor(() => {
      const box = panel.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(320);
    });
    await find(host, '00123');
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.querySelector('[data-spreadsheet-panel]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(findButton));
    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="Preview information"]')!);
    await vi.waitFor(() => expect(document.querySelector('[data-spreadsheet-panel]')?.textContent).toContain(taskFilesEnUS.spreadsheetNotice));
    await userEvent.keyboard('{Escape}');
    await gridReady(host);
    await page.viewport(1280, 900);
  });
  it('renders the optional reported workbook through the Env task-file entry', async () => {
    const input = await (commands as unknown as { readOfficeAcceptanceWorkbook: () => Promise<{ bytes: number[]; name: string } | null> }).readOfficeAcceptanceWorkbook();
    if (!input) return;
    const host = mount(() => <I18nProvider><FlowerTaskFilePreviewContent name={input.name} blob={new Blob([new Uint8Array(input.bytes)])} mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></I18nProvider>);
    await gridReady(host);
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Worksheet"]')!;
    expect(select.options.length).toBeGreaterThan(0);
    for (const option of [...select.options]) { await userEvent.selectOptions(select, option.value); await gridReady(host); }
  });
  it.each([false, true])('dismisses XLSX search before closing its window (attachment %s)', async attachment => {
    await page.viewport(1280, 900);
    const blob = await (await fetch(xlsxURL)).blob();
    const close = vi.fn();
    const source = { id: 'xlsx', name: 'identity.xlsx', mimeType: 'application/octet-stream', load: async () => blob };
    mount(() => attachment ? <FlowerAttachmentPreviewWindow source={source} copy={taskFilesEnUS} loadingLabel={taskFilesEnUS.loading} unavailableLabel={taskFilesEnUS.unsupported} onClose={close} /> : <FlowerTaskFilePreview source={source} copy={taskFilesEnUS} onClose={close} downloading={false} />);
    await gridReady(document.body);
    await find(document.body, '00123');
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.querySelector('[data-spreadsheet-panel]')).toBeNull());
    expect(close).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(['csv', 'xlsx'] as const)('keeps %s wheel ownership local only for the selected Workbench widget', async format => {
    await page.viewport(1400, 1000);
    const longBytes = format === 'xlsx' ? new Uint8Array(await (await fetch(xlsxURL)).arrayBuffer()) : new TextEncoder().encode(Array.from({ length: 500 }, (_, n) => 'row' + n + ',00123').join('\n'));
    const definitions: WorkbenchWidgetDefinition[] = [{ type: 'test.csv', label: 'CSV', defaultTitle: 'CSV', icon: () => null,
      defaultSize: { width: 700, height: 480 }, renderMode: 'projected_surface',
      body: props => <FilePreviewContent descriptor={{ mode: format === 'xlsx' ? 'xlsx' : 'text' }} item={{ id: format, name: 'long.' + format, path: '/long.' + format, type: 'file' }} showHeader={false} bytes={longBytes} allowLocalWheel={props.selected === true} />,
    }];
    const [state, setState] = createSignal<WorkbenchState>({ ...createDefaultWorkbenchState(definitions), mode: 'work',
      viewport: { x: 0, y: 0, scale: 1 }, widgets: [{ id: 'preview', type: 'test.csv', title: 'CSV', x: 30, y: 30, width: 700, height: 480, z_index: 1, created_at_unix_ms: 1 }],
      selectedWidgetId: 'preview', selectedObject: { kind: 'widget', id: 'preview' },
    });
    const host = mount(() => <FloeConfigProvider config={{ storage: { enabled: false } }}><ThemeProvider><LayoutProvider><I18nProvider><RedevenWorkbenchSurface state={state} setState={setState} widgetDefinitions={definitions} /></I18nProvider></LayoutProvider></ThemeProvider></FloeConfigProvider>, 1300);
    await gridReady(host);
    const scroll = host.querySelector<HTMLElement>('.flower-delimited-canvas [data-redeven-workbench-wheel-role]')!;
    expect(scroll).toBeTruthy();
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; targetSelector?: string; deltaY: number }) => Promise<{ before: number; after: number }> };
    const selected = await wheel.wheelScrollRegion({ regionSelector: '.flower-delimited-canvas [data-redeven-workbench-wheel-role]', deltaY: 180 });
    expect(selected.after).toBeGreaterThan(selected.before); expect(state().viewport.scale).toBe(1);
    setState(value => ({ ...value, selectedWidgetId: null, selectedObject: null }));
    const top = scroll.scrollTop;
    await wheel.wheelScrollRegion({ regionSelector: '.flower-delimited-body', deltaY: -100 });
    expect(scroll.scrollTop).toBe(top);
    expect(host.querySelector('.flower-delimited-canvas')?.hasAttribute('inert')).toBe(true);
  });
  it('uses the selected encoding for GB18030 bytes', async () => {
    const data = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 44, 48, 48, 49]);
    const host = mount(() => <DelimitedTextPreview bytes={data} format="csv" copy={taskFilesEnUS} source={<pre />} />);
    await userEvent.selectOptions(host.querySelector('select')!, 'gb18030');
    await gridReady(host); await find(host, '你好');
  });

});
