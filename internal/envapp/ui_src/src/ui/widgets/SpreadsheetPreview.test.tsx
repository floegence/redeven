// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetPreview } from '../../../../../flower_ui/src/preview/SpreadsheetPreview';
import { taskFilesEnUS } from '../../../../../flower_ui/src/taskFilesCopy';

const engine = vi.hoisted(() => ({ load: vi.fn(), fromWorkbook: vi.fn() }));
vi.mock('@silurus/ooxml/xlsx', () => ({ XlsxWorkbook: { load: engine.load }, XlsxSheetViewer: { fromWorkbook: engine.fromWorkbook } }));
vi.mock('@floegence/floe-webapp-core/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>(),
  Button: (props: Record<string, unknown>) => <button {...props} />,
  SurfaceFloatingLayer: (props: any) => <div>{props.children}</div>,
  Select: (props: { value: string; disabled?: boolean; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) =>
    <select value={props.value} disabled={props.disabled} onChange={event => props.onChange(event.currentTarget.value)}>
      {props.options.map(option => <option value={option.value}>{option.label}</option>)}
    </select>,
}));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.resetAllMocks(); });
function fixture() {
  const book = { sheetNames: ['First', 'Hidden', 'Notes'], isHidden: (index: number) => index === 1, getWorksheet: vi.fn(async () => ({})), destroy: vi.fn() };
  const viewer = { sheetCount: 3, sheetIndex: 0, getScale: () => 1, clearFind: vi.fn(), goToSheet: vi.fn(async (index: number) => { viewer.sheetIndex = index; }), destroy: vi.fn() };
  engine.load.mockResolvedValue(book); engine.fromWorkbook.mockReturnValue(viewer);
  return { book, viewer };
}
function mount(bytes = new Uint8Array([80, 75, 3, 4])) {
  const [data, setData] = createSignal(bytes);
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <SpreadsheetPreview bytes={data()} format="xlsx" copy={taskFilesEnUS} />, host);
  return { host, setData };
}
async function ready(host: HTMLElement) {
  await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.disabled).toBe(false));
}
describe('published XLSX preview ownership', () => {
  it('passes an owned copy of exact bytes, skips hidden sheets and releases viewer before workbook', async () => {
    const { book, viewer } = fixture();
    const bytes = new Uint8Array([80, 75, 3, 4]);
    const { host } = mount(bytes); await ready(host);
    const input = engine.load.mock.calls[0][0] as ArrayBuffer;
    expect(new Uint8Array(input)).toEqual(bytes); expect(input).not.toBe(bytes.buffer);
    expect(engine.load.mock.calls[0][1]).toMatchObject({ useGoogleFonts: false });
    expect(engine.fromWorkbook.mock.calls[0][1]).toBe(book);
    expect(engine.fromWorkbook.mock.calls[0][2]).toMatchObject({ comments: true, enableHyperlinks: false, hiddenSheetMode: 'skip' });
    const select = host.querySelector('select')!;
    expect([...select.options].map(option => option.value)).toEqual(['0', '2']);
    select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(viewer.goToSheet).toHaveBeenLastCalledWith(2));
    expect(book.getWorksheet).toHaveBeenLastCalledWith(2);
    expect(host.textContent).not.toContain(taskFilesEnUS.sourceText);
    dispose!(); dispose = undefined;
    expect(viewer.destroy).toHaveBeenCalledOnce(); expect(book.destroy).toHaveBeenCalledOnce();
    expect(viewer.destroy.mock.invocationCallOrder[0]).toBeLessThan(book.destroy.mock.invocationCallOrder[0]);
  });
  it('disposes an obsolete pending workbook without changing its successor', async () => {
    const old = fixture(); let resolve!: (value: typeof old.book) => void;
    engine.load.mockImplementationOnce(() => new Promise(result => { resolve = result; }));
    const { host, setData } = mount();
    await vi.waitFor(() => expect(engine.load).toHaveBeenCalledOnce());
    const current = fixture(); setData(new Uint8Array([5, 6])); await ready(host);
    resolve(old.book); await vi.waitFor(() => expect(old.book.destroy).toHaveBeenCalledOnce());
    expect(current.book.destroy).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')).toBeNull();
  });
  it('keeps a worksheet parse failure visible and creates a fresh workbook on retry', async () => {
    const { book } = fixture(); book.getWorksheet.mockRejectedValueOnce(new Error('Invalid worksheet part'));
    const { host } = mount(); await vi.waitFor(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
    expect(engine.fromWorkbook).not.toHaveBeenCalled();
    [...host.querySelectorAll('button')].find(button => button.textContent === taskFilesEnUS.retry)!.click();
    await ready(host); expect(book.destroy).toHaveBeenCalledOnce(); expect(engine.load).toHaveBeenCalledTimes(2);
  });
  it('does not allow a resolved render call to erase onError', async () => {
    fixture(); engine.fromWorkbook.mockImplementationOnce((_canvas, _book, options) => { options.onError(new Error('Render failed')); return { sheetCount: 1, sheetIndex: 0, goToSheet: vi.fn(async () => {}), destroy: vi.fn() }; });
    const { host } = mount(); await vi.waitFor(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.disabled).toBe(true);
  });
  it('rejects oversized input before constructing an engine', async () => {
    fixture(); const { host } = mount(new Uint8Array(20 * 1024 * 1024 + 1));
    await vi.waitFor(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
    expect(engine.load).not.toHaveBeenCalled();
  });
});
