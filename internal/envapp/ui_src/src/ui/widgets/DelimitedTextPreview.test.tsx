// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelimitedTextPreview } from '../../../../../flower_ui/src/preview/DelimitedTextPreview';
import { taskFilesEnUS } from '../../../../../flower_ui/src/taskFilesCopy';
const state = vi.hoisted(() => ({ viewers: [] as Array<{ load: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; resolve: () => void; reject: (error: Error) => void }> }));
vi.mock('@silurus/ooxml/xlsx', () => ({ XlsxWorkbook: {}, XlsxSheetViewer: class {
  resolve!: () => void; reject!: (error: Error) => void;
  load = vi.fn(() => new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; }));
  sheetCount = 1; sheetIndex = 0; sheetNames = ['Sheet1'];
  destroy = vi.fn(); relayout = vi.fn(async () => {}); getScale = () => 1;
  constructor() { state.viewers.push(this); }
} }));
vi.mock('@floegence/floe-webapp-core/ui', () => ({ Button: (props: Record<string, unknown>) => <button {...props} />, SurfaceFloatingLayer: (props: any) => <div>{props.children}</div> }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); state.viewers.length = 0; vi.unstubAllGlobals(); });
function mount() {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const [bytes, setBytes] = createSignal(new TextEncoder().encode('00123,=SUM(1,2)'));
  const [editing, setEditing] = createSignal(false);
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <DelimitedTextPreview bytes={bytes()} format="csv" copy={taskFilesEnUS} editing={editing()} source={<pre>source editor</pre>} />, host);
  return { host, setBytes, setEditing };
}
describe('delimited preview ownership', () => {
  it('passes exact bytes and explicit format, and destroys obsolete loads', async () => {
    const { setBytes, host } = mount();
    await vi.waitFor(() => expect(state.viewers).toHaveLength(1));
    const old = state.viewers[0];
    expect(new TextDecoder().decode(old.load.mock.calls[0][0])).toBe('00123,=SUM(1,2)');
    expect(old.load.mock.calls[0][1]).toEqual({ format: 'csv', encoding: 'utf-8' });
    setBytes(new TextEncoder().encode('replacement'));
    await vi.waitFor(() => expect(state.viewers).toHaveLength(2));
    expect(old.destroy).toHaveBeenCalledOnce(); old.reject(new Error('obsolete'));
    state.viewers[1].resolve();
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')).toBeNull());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it('retains source editing and disposes the grid when editing starts', async () => {
    const { setEditing, host } = mount();
    await vi.waitFor(() => expect(state.viewers).toHaveLength(1));
    setEditing(true);
    expect(state.viewers[0].destroy).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('source editor');
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Table')?.disabled).toBe(true);
  });
  it('shows a retryable error and creates a fresh renderer on retry', async () => {
    const { host } = mount();
    await vi.waitFor(() => expect(state.viewers).toHaveLength(1));
    state.viewers[0].reject(new Error('bad input'));
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).toBeTruthy());
    [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.click();
    await vi.waitFor(() => expect(state.viewers).toHaveLength(2));
    expect(state.viewers[0].destroy).toHaveBeenCalledOnce();
  });
});
