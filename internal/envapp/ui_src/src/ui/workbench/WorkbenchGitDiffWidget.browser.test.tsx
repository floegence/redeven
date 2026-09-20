import '../../index.css';
import { FloeConfigProvider, LayoutProvider, ThemeProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createDefaultWorkbenchState, type WorkbenchState, type WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import { createSignal } from 'solid-js';
import { RpcError } from '@floegence/floe-webapp-protocol';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvWorkbenchInstancesContext, type EnvWorkbenchInstancesContextValue } from './EnvWorkbenchInstancesContext';
import { WorkbenchGitDiffWidget } from './WorkbenchGitDiffWidget';
import { RedevenWorkbenchSurface } from './surface/RedevenWorkbenchSurface';

const getDiffContent = vi.hoisted(() => vi.fn());
const rpcTransport = vi.hoisted(() => ({}));
const connection = vi.hoisted(() => ({ transport: () => rpcTransport as object | null }));
vi.mock('@floegence/floe-webapp-protocol', async () => ({
  ...await vi.importActual<typeof import('@floegence/floe-webapp-protocol')>('@floegence/floe-webapp-protocol'),
  useProtocol: () => ({ rpcTransport: () => connection.transport() }),
}));
vi.mock('../protocol/redeven_v1', () => ({ useRedevenRpc: () => ({ git: { getDiffContent } }) }));
const file = { path: 'deleted.ts', changeType: 'deleted', patchText: ['diff --git a/deleted.ts b/deleted.ts', '--- a/deleted.ts', '+++ /dev/null', '@@ -1,380 +0,0 @@', ...Array.from({ length: 380 }, (_, i) => `-line_${i + 1} = "${'long content '.repeat(18)}"`)].join('\n') };
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.clearAllMocks(); connection.transport = () => rpcTransport; });
function mount(scale: number) {
  const host = document.createElement('div');
  host.style.cssText = 'width:100vw;height:100vh';
  document.body.append(host);
  const definitions: WorkbenchWidgetDefinition[] = [{ type: 'redeven.git-diff', label: 'Diff', defaultTitle: 'Diff', icon: () => null, body: WorkbenchGitDiffWidget, defaultSize: { width: 900, height: 600 }, renderMode: 'projected_surface' }];
  const [state, setState] = createSignal<WorkbenchState>({ ...createDefaultWorkbenchState(definitions), theme: 'mica', stickyNotes: [], annotations: [], backgroundLayers: [], viewport: { x: 0, y: 0, scale }, selectedWidgetId: 'diff', widgets: [{ id: 'diff', type: 'redeven.git-diff', title: 'Diff · deleted.ts', x: 60, y: 50, width: 900, height: 600, z_index: 1, created_at_unix_ms: 1 }] });
  const target = { repoRootPath: '/repo', workspaceSection: 'unstaged' as const, path: 'deleted.ts', changeType: 'deleted' };
  dispose = render(() => <FloeConfigProvider config={{ storage: { enabled: false } }}><ThemeProvider><LayoutProvider><NotificationProvider>
    <EnvWorkbenchInstancesContext.Provider value={{ gitDiffTarget: () => target, updateWidgetTitle: () => {} } as unknown as EnvWorkbenchInstancesContextValue}>
      <RedevenWorkbenchSurface state={state} setState={setState} widgetDefinitions={definitions} onRequestDelete={(id) => setState((value) => ({ ...value, widgets: value.widgets.filter((widget) => widget.id !== id) }))} />
    </EnvWorkbenchInstancesContext.Provider>
  </NotificationProvider></LayoutProvider></ThemeProvider></FloeConfigProvider>, host);
  return { host, state, setState };
}
const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; deltaY: number }) => Promise<{ before: number; after: number }> };

describe('Workbench diff canvas component', () => {
  it('restores before connection and reloads through session replacement without moving or remounting the widget', async () => {
    await page.viewport(1400, 950);
    const [transport, setTransport] = createSignal<object | null>(null);
    connection.transport = transport;
    getDiffContent.mockResolvedValue({ file });
    const { host, state } = mount(0.8);
    await expect.poll(() => host.textContent).toContain('Waiting for connection');
    expect(getDiffContent).not.toHaveBeenCalled();
    const root = host.querySelector('.workbench-widget');
    const before = JSON.stringify(state());
    setTransport({});
    await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')).not.toBeNull();
    expect(getDiffContent).toHaveBeenCalledTimes(1);
    setTransport(null);
    await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')).toBeNull();
    expect(getDiffContent).toHaveBeenCalledTimes(1);
    setTransport({});
    await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')).not.toBeNull();
    expect(getDiffContent).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.workbench-widget')).toBe(root);
    expect(JSON.stringify(state())).toBe(before);
    expect(host.textContent).not.toContain('no longer available');
  });

  it.each([0.7, 1])('reads the final patch line and resizes within the projected widget at scale %s', async (scale) => {
    await page.viewport(1400, 950);
    getDiffContent.mockResolvedValue({ file });
    const { host, state, setState } = mount(scale);
    await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[data-floe-geometry-surface="floating-window"]')).toBeNull();
    const root = host.querySelector<HTMLElement>('.workbench-widget')!;
    expect(root.contains(host.querySelector('[data-workbench-git-diff]'))).toBe(true);
    await page.getByRole('button', { name: 'Show all 384 lines', exact: true }).click();
    const viewport = host.querySelector<HTMLElement>('.git-patch-viewer__viewport')!;
    const before = { ...state().viewport };
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    const scrolled = await wheel.wheelScrollRegion({ regionSelector: '.git-patch-viewer__viewport', deltaY: 500 });
    expect(scrolled.after).toBeGreaterThan(scrolled.before);
    expect(state().viewport).toEqual(before);
    for (const height of [600, 400]) {
      setState((current) => ({ ...current, widgets: current.widgets.map((widget) => ({ ...widget, height })) }));
      await expect.poll(() => viewport.getBoundingClientRect().bottom).toBeLessThanOrEqual(root.getBoundingClientRect().bottom + 1);
      viewport.scrollTop = viewport.scrollHeight;
      const last = viewport.firstElementChild!.lastElementChild!;
      expect(last.textContent).toContain('line_380');
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom + 1);
    }
    const range = document.createRange();
    range.selectNodeContents(viewport.firstElementChild!.lastElementChild!);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    expect(window.getSelection()!.toString()).toContain('line_380');
    await page.getByRole('button', { name: 'Full Context', exact: true }).click();
    await expect.poll(() => getDiffContent.mock.calls.some(([request]) => request.mode === 'full')).toBe(true);
    await page.screenshot({ path: `workbench-diff-${scale}.png` });
    await page.getByRole('button', { name: 'Remove widget', exact: true }).click();
    expect(state().widgets).toHaveLength(0);
  });

  it('leaves wheel ownership with the canvas while the diff widget is unselected', async () => {
    await page.viewport(1400, 950);
    getDiffContent.mockResolvedValue({ file });
    const { host, state, setState } = mount(1);
    await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')).not.toBeNull();
    setState((current) => ({ ...current, selectedWidgetId: null }));
    const before = { ...state().viewport };
    const scrolled = await wheel.wheelScrollRegion({ regionSelector: '.git-patch-viewer__viewport', deltaY: 100 });
    expect(scrolled.after).toBe(scrolled.before);
    await expect.poll(() => state().viewport.scale).not.toBe(before.scale);
  });

  it('keeps an unavailable diff placed and recovers through refresh', async () => {
    await page.viewport(1400, 950);
    getDiffContent.mockRejectedValue(new RpcError({ typeId: 1119, code: 404, message: 'file not found in diff' }));
    const { host, state } = mount(0.8);
    await expect.poll(() => host.textContent).toContain('no longer available');
    const placed = { ...state().widgets[0] };
    getDiffContent.mockResolvedValue({ file: null });
    await page.getByRole('button', { name: 'Refresh diff', exact: true }).click();
    await expect.poll(() => host.querySelector('[data-git-diff-empty]')).not.toBeNull();
    getDiffContent.mockResolvedValue({ file });
    await page.getByRole('button', { name: 'Refresh diff', exact: true }).click();
    await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')).not.toBeNull();
    expect(state().widgets[0]).toEqual(placed);
  });
});
