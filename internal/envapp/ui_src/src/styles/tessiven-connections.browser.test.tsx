import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { toRenderVersion } from '../../../../tessiven_ui/src/presentation';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { connectionVersion } from './tessiven-connections.fixture';

let host: HTMLDivElement, dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); host?.remove(); vi.restoreAllMocks(); });
const ids = () => [...host.querySelectorAll('.floe-graph__edge')].map(edge => edge.parentElement!.getAttribute('data-graph-object')).sort();
const geometry = () => ({
  nodes: [...host.querySelectorAll<HTMLElement>('.floe-graph__node,.floe-graph__group')].map(node => [node.dataset.graphObject, node.style.cssText]),
  viewport: getComputedStyle(host.querySelector('.floe-infinite-canvas__viewport')!).transform,
  minimap: host.querySelector('.floe-graph__minimap')!.getAttribute('viewBox'),
  overview: host.querySelector('.floe-graph__minimap-edges')!.getAttribute('d'),
});
async function mount(onSelectionChange?: (selection: unknown) => void) {
  await page.viewport(1440, 960);
  host = document.createElement('div'); host.className = 'tessiven';
  host.style.cssText = 'width:1400px;height:900px;position:relative'; document.body.append(host);
  dispose = render(() => <TessivenGraph version={toRenderVersion(connectionVersion())} historical={false} t={tessivenText('en-US')}
    onAsk={() => {}} onInspect={() => {}} onSelectionChange={onSelectionChange} />, host);
  await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).hover();
  await expect.poll(ids).toEqual(['@overview/a/b', '@overview/b/a', '@overview/b/store', '@overview/outside/a']);
}
describe('canvas overview and focused connectors', () => {
  it('switches overview/group/node scopes without layout, geometry or minimap changes', async () => {
    const messages = vi.spyOn(Worker.prototype, 'postMessage');
    await mount(); const before = geometry();
    const layouts = () => messages.mock.calls.filter(([request]) => request.kind === 'layout').length;
    const routes = () => messages.mock.calls.filter(([request]) => request.kind === 'route' && request.edges.some((edge: { id: string }) => edge.id.startsWith('@detail/'))).length;
    const count = layouts();
    await page.getByRole('group', { name: 'Application', exact: true }).hover({ position: { x: 20, y: 20 } });
    await expect.poll(ids).toEqual(['@overview/a/b', '@overview/b/a', '@overview/outside/a']);
    const started = performance.now();
    await page.getByRole('group', { name: 'a1', exact: true }).hover({ position: { x: 80, y: 20 } });
    await expect.poll(ids).toEqual(['@detail/a1/a2', '@detail/a1/b1', '@detail/b1/a1', '@detail/outside/a1']);
    const coldMs = performance.now() - started;
    expect(geometry()).toEqual(before); expect(layouts()).toBe(count);
    const computed = routes();
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).hover();
    await expect.poll(ids).toHaveLength(4);
    await expect.poll(() => host.querySelector('.tessiven-canvas')!.getAttribute('data-connection-focus')).toBeNull();
    await page.getByRole('group', { name: 'a1', exact: true }).hover({ position: { x: 80, y: 20 } });
    await expect.poll(ids).toEqual(['@detail/a1/a2', '@detail/a1/b1', '@detail/b1/a1', '@detail/outside/a1']);
    expect(routes()).toBe(computed); expect(layouts()).toBe(count);
    expect(coldMs).toBeLessThan(2000);
    expect(host.querySelectorAll('.tessiven-error')).toHaveLength(0);
    await page.screenshot({ path: '../../.vitest-attachments/tessiven-node-connections-light.png' });
  });
  it('opens complete overview details and preserves native exact selection', async () => {
    const selection = vi.fn(); await mount(selection);
    host.querySelector<SVGElement>('[data-graph-object="@overview/a/b"] .floe-graph__edge-target')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect.poll(() => document.querySelectorAll('.tessiven-relation-detail-row').length).toBe(1);
    expect(selection.mock.calls.at(-1)![0].object_refs).toEqual(['a', 'b']);
    await page.getByRole('button', { name: /API → Worker/ }).click();
    await expect.poll(() => document.querySelectorAll('[data-exact-relation-id]').length).toBe(2);
    await page.getByRole('button', { name: /instance-a2 → instance-b2/ }).click();
    expect(selection.mock.calls.at(-1)![0].object_refs).toEqual(['a2-b2']);
    expect(document.querySelector('.tessiven-popup')).toBeNull();
  });
  it('uses keyboard focus and returns to overview on Escape', async () => {
    await mount();
    page.getByRole('group', { name: 'a2', exact: true }).element().focus();
    await expect.poll(ids).toEqual(['@detail/a1/a2', '@detail/a2/b2']);
    page.getByRole('group', { name: 'a2', exact: true }).element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.poll(ids).toEqual(['@overview/a/b', '@overview/b/a', '@overview/b/store', '@overview/outside/a']);
  });
});
