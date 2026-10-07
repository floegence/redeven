import '../index.css';
import '../ui/flower-feature.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { commands, page, userEvent } from 'vitest/browser';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { parseAskFlowerContextActionEnvelope } from '../../../../flower_ui/src/contextActionWire';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TessivenFlowerPanel, type CanvasFlowerRequest } from '../../../../tessiven_ui/src/TessivenFlowerPanel';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { CanvasFlowerTestSurface, canvasFlowerAdapter } from './tessiven-flower.test-support';
import { liveBootstrap, thread } from '../ui/FlowerSurface.media.test-support';
import type { FlowerLiveStreamEnvelope, FlowerSurfaceAdapter } from '../../../../flower_ui/src';
beforeEach(async () => { await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('redeven-flower-transport'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); });
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.removeAttribute('style'); document.documentElement.classList.remove('dark', 'light'); });
function mount(transformed = false, overrides: Partial<FlowerSurfaceAdapter> = {}, graph = false) {
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = `position:absolute;left:30px;top:30px;width:1100px;height:700px;${transformed ? 'transform:scale(.8);transform-origin:top left;' : ''}`;
  document.body.append(host);
  const [request, setRequest] = createSignal<CanvasFlowerRequest>({
    selection: { canvas_id: 'commerce', version_id: 2, object_refs: ['orders'] }, label: 'Orders API', nonce: 0,
  });
  const base = { ...canvasFlowerAdapter(), ...overrides };
  const sent = vi.fn(base.launchTurn);
  const queued: FlowerLiveStreamEnvelope[] = [];
  let wake = () => {};
  const connections = vi.fn();
  const adapter: FlowerSurfaceAdapter = { ...base, launchTurn: sent, connectLiveStream: async function* ({ signal }) {
    connections();
    yield { schema_version: 1, kind: 'ready', summaries: [] };
    while (!signal.aborted) {
      const value = queued.shift();
      if (value) { yield value; continue; }
      await new Promise<void>(resolve => { wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
    }
  } };
  const navigate = vi.fn();
  dispose = render(() => <FloeConfigProvider><LayoutProvider>
    {graph && <TessivenGraph t={tessivenText('en-US')} historical={false} onAsk={() => {}} onInspect={() => {}}
      version={{ canvas_id: 'commerce', number: 2, created_at: 1, digest: 'fixture', document_yaml: '', source: 'flower', summary: '',
        document: { apiVersion: 'redeven.io/tessiven/v1', kind: 'ServiceCanvas', metadata: { title: 'Commerce / Production' },
          nodes: [{ id: 'core', name: 'production-01', runtimeRef: 'local:local' }],
          groups: [{ id: 'app', name: 'Application', nodeRefs: ['core'] }],
          services: [{ id: 'orders', name: 'Orders API', kind: 'api' }, { id: 'storefront', name: 'Storefront', kind: 'web' }],
          instances: [{ id: 'orders-01', nodeRef: 'core', serviceRef: 'orders', role: 'standalone' }, { id: 'web-01', nodeRef: 'core', serviceRef: 'storefront', role: 'standalone' }],
          resources: [{ id: 'db', name: 'Orders database', kind: 'database', endpoint: 'postgresql://orders/commerce' }, { id: 'cdn', name: 'Content delivery', kind: 'cdn' }],
          relations: [{ id: 'read', from: 'orders', to: 'db', kind: 'reads', evidenceRefs: ['config'] }, { id: 'route', from: 'cdn', to: 'storefront', kind: 'forwards', evidenceRefs: ['config'] }],
          evidence: [{ id: 'config', source: 'configuration', locator: 'repo://commerce/config.yaml', summary: 'Test configuration' }],
          presentation: { initiallyExpanded: ['app'] },
        } }} />}
    <TessivenFlowerPanel
    request={request()} visible t={tessivenText('en-US')} onOpenConversation={navigate}
    renderSurface={surface => <CanvasFlowerTestSurface {...surface} adapter={adapter} />}
  /></LayoutProvider></FloeConfigProvider>, host);
  return { setRequest, sent, connections, navigate, push: (event: FlowerLiveStreamEnvelope) => { queued.push(event); wake(); } };
}
const editor = () => page.getByRole('textbox');
it('keeps the canonical composer at the bottom and displays real conversation output in the floating window', async () => {
  await page.viewport(1200, 800);
  const runtime = mount();
  await expect.element(editor()).toBeVisible();
  await editor().fill('Explain the database connection');
  await expect.element(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  expect(runtime.sent.mock.calls[0][0].context_action).toMatchObject({ context: [{ kind: 'tessiven_selection', canvas_id: 'commerce', version_id: 2, object_refs: ['orders'] }] });
  const reply = liveBootstrap(thread({ thread_id: 'canvas-thread', messages: [{ id: 'reply', turn_id: 'turn', role: 'assistant', content: 'Orders reads from the primary database.', status: 'complete', created_at_ms: 2 }] }), 2);
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: reply.current });
  await expect.element(page.getByText('Orders reads from the primary database.')).toBeVisible();
  expect(runtime.navigate).not.toHaveBeenCalled();
  expect(runtime.connections).toHaveBeenCalledTimes(1);
  const output = document.querySelector('[data-floe-geometry-surface="floating-window"]')!.getBoundingClientRect();
  const input = host.querySelector('.tessiven-flower-composer')!.getBoundingClientRect();
  expect(output.left).toBeLessThan(60);
  expect(output.top).toBeLessThan(70);
  expect(output.bottom).toBeLessThan(input.top);
  expect(input.bottom).toBeLessThanOrEqual(730);
  expect(host.querySelectorAll('.flower-composer textarea')).toHaveLength(1);
  await page.screenshot({ element: host, path: '__screenshots__/tessiven-floating-conversation.png' });
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await expect.element(editor()).toBeVisible();
  expect(host.querySelector('[data-flower-transcript-visible]')?.getAttribute('data-flower-transcript-visible')).toBe('false');
  await editor().fill('Keep this draft');
  await page.getByRole('button', { name: 'Show replies', exact: true }).click();
  await expect.element(editor()).toHaveValue('Keep this draft');
  await expect.element(page.getByText('Orders reads from the primary database.')).toBeVisible();
});
it('keeps drafts isolated by canvas and a single workspace connection while retargeting objects', async () => {
  await page.viewport(1200, 800);
  const runtime = mount();
  await expect.element(editor()).toBeVisible();
  await editor().fill('Commerce draft');
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, label: 'Analytics', nonce: 1 });
  await expect.element(editor()).toHaveValue('');
  await editor().fill('Analytics draft');
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 1, object_refs: ['db'] }, label: 'Database', nonce: 2 });
  await expect.element(editor()).toHaveValue('Commerce draft');
  expect(runtime.sent).not.toHaveBeenCalled();
  expect(runtime.connections).toHaveBeenCalledTimes(1);
});
it('uses the shared local floating layer inside a projected canvas', async () => {
  await page.viewport(1200, 800);
  mount(true);
  await expect.element(editor()).toBeVisible();
  await expect.poll(() => document.querySelector('[data-floe-geometry-surface="floating-window"]')?.getBoundingClientRect().width).toBeGreaterThan(0);
  const output = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
  expect(output.style.position).not.toBe('fixed');
  expect(output.getAttribute('data-floe-local-interaction-surface')).toBe('true');
  const bounds = host.getBoundingClientRect(), rect = output.getBoundingClientRect();
  await expect.poll(() => output.getBoundingClientRect().left).toBeGreaterThanOrEqual(bounds.left);
  expect(rect.right).toBeLessThanOrEqual(bounds.right);
});

it('moves and resizes replies without moving the composer or selecting canvas text', async () => {
  await page.viewport(1200, 800);
  mount();
  await expect.element(editor()).toBeVisible();
  const output = () => document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
  await expect.poll(() => output().getBoundingClientRect().left).toBeGreaterThan(30);
  const initial = output().getBoundingClientRect();
  const composer = host.querySelector('.tessiven-flower-composer')!.getBoundingClientRect();
  await (commands as unknown as { moveTessivenReplies: (resize: boolean) => Promise<void> }).moveTessivenReplies(false);
  await expect.poll(() => output().getBoundingClientRect().left).toBeGreaterThan(initial.left + 100);
  const moved = output().getBoundingClientRect();
  await (commands as unknown as { moveTessivenReplies: (resize: boolean) => Promise<void> }).moveTessivenReplies(true);
  await expect.poll(() => output().getBoundingClientRect().width).toBeGreaterThan(moved.width + 60);
  expect(output().getBoundingClientRect().height).toBeLessThan(moved.height);
  expect(window.getSelection()?.toString()).toBe('');
  expect(host.querySelector('.tessiven-flower-composer')!.getBoundingClientRect().toJSON()).toEqual(composer.toJSON());
});

it('keeps late acceptance bound to its original canvas and resumes the accepted conversation', async () => {
  await page.viewport(1200, 800);
  let accept!: (value: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  const runtime = mount(false, { launchTurn: () => new Promise(resolve => { accept = resolve; }) });
  await expect.element(editor()).toBeVisible();
  await editor().fill('Inspect commerce');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, label: 'Analytics', nonce: 1 });
  await editor().fill('Unsaved analytics draft');
  accept(await canvasFlowerAdapter().launchTurn(runtime.sent.mock.calls[0][0]));
  await expect.element(editor()).toHaveValue('Unsaved analytics draft');
  await expect.element(page.getByRole('button', { name: 'Open conversation', exact: true })).not.toBeInTheDocument();
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 2, object_refs: [] }, label: 'Commerce', nonce: 2 });
  await expect.element(page.getByRole('button', { name: 'Open conversation', exact: true })).toBeVisible();
  await expect.element(editor()).toHaveValue('');
  await editor().fill('Continue commerce');
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, label: 'Analytics', nonce: 3 });
  await expect.element(editor()).toHaveValue('Unsaved analytics draft');
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 2, object_refs: [] }, label: 'Commerce', nonce: 4 });
  await expect.element(editor()).toHaveValue('Continue commerce');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(2);
  expect(runtime.sent.mock.calls[1][0].thread_id).toBe('canvas-thread');
  expect(runtime.connections).toHaveBeenCalledTimes(1);
});

it('reopens replies on send and does not reopen an older conversation after starting a new one', async () => {
  await page.viewport(1200, 800);
  let accept!: (value: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  const runtime = mount(false, { launchTurn: () => new Promise(resolve => { accept = resolve; }) });
  await expect.element(editor()).toBeVisible();
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await editor().fill('Inspect commerce');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  await expect.element(page.getByRole('button', { name: 'Hide replies', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await editor().fill('A separate question');
  accept(await canvasFlowerAdapter().launchTurn(runtime.sent.mock.calls[0][0]));
  await expect.element(editor()).toHaveValue('A separate question');
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, label: 'Analytics', nonce: 1 });
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 2, object_refs: [] }, label: 'Commerce', nonce: 2 });
  await expect.element(editor()).toHaveValue('A separate question');
  await expect.element(page.getByRole('button', { name: 'Open conversation', exact: true })).not.toBeInTheDocument();
});

it('retries an uncertain send with its original canvas identity after the selection changes', async () => {
  await page.viewport(1200, 800);
  let attempts = 0;
  let fail!: (cause: Error) => void;
  const runtime = mount(false, { launchTurn: async input => {
    if (++attempts === 1) await new Promise<never>((_resolve, reject) => { fail = reject; });
    return canvasFlowerAdapter().launchTurn(input);
  } });
  await expect.element(editor()).toBeVisible();
  await editor().fill('Explain Orders');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 7, object_refs: ['cache'] }, label: 'Analytics cache', nonce: 1 });
  await editor().fill('Separate draft');
  fail(flowerTurnAdmissionError('unknown', new Error('Test response lost')));
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(2);
  expect(runtime.sent.mock.calls[1][0]).toEqual(runtime.sent.mock.calls[0][0]);
  await expect.element(editor()).toHaveValue('Separate draft');
});

it('keeps reply text, context and controls legible across every theme and clamps narrow layouts', async () => {
  await page.viewport(1440, 920);
  const runtime = mount(false, {}, true);
  host.style.width = '1380px'; host.style.height = '850px';
  await expect.element(editor()).toBeVisible();
  await editor().fill('Explain the service distribution');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  const reply = liveBootstrap(thread({ thread_id: 'canvas-thread', messages: [{ id: 'reply', turn_id: 'turn', role: 'assistant',
    content: 'Storefront and Orders API run on **production-01**.\n\nOrders API reads from the external **Orders database**. Content delivery forwards requests to Storefront.\n\nThe canvas preserves this distinction: the dashed area is a logical group; the solid card is the host node.', status: 'complete', created_at_ms: 2 }] }), 2);
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: reply.current });
  await expect.element(page.getByText('Storefront and Orders API run on', { exact: false })).toBeVisible();
  expect(host.querySelector('.tessiven-flower-context')).toBeNull();
  const luminance = (color: string) => {
    const ctx = document.createElement('canvas').getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
    const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const preset of builtInShellThemePresets) {
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(name, value);
    for (const [selector, background, minimum] of [
      ['.tessiven-flower-output h2', '.tessiven-flower-output', 4.5],
      ['.tessiven-flower-output .flower-chat-transcript', '.tessiven-flower-output', 4.5],
      ['.tessiven-flower-output .tessiven-icon-button', '.tessiven-flower-output', 3],
    ] as const) {
      const a = luminance(getComputedStyle(document.querySelector(selector)!).color);
      const b = luminance(getComputedStyle(document.querySelector(background)!).backgroundColor);
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${preset.name}: ${selector}`).toBeGreaterThanOrEqual(minimum);
    }
    if (['porcelain-light', 'porcelain-dark', 'nord', 'solarized-light'].includes(preset.name))
      await page.screenshot({ path: `__screenshots__/tessiven-floating-${preset.name}.png` });
  }
  await page.viewport(390, 844); host.style.cssText = 'position:absolute;inset:0;width:390px;height:844px';
  await expect.poll(() => document.querySelector('.tessiven-flower-output')!.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  await expect.poll(() => document.querySelector('.tessiven-flower-output')!.getBoundingClientRect().bottom - host.querySelector('.tessiven-flower-composer')!.getBoundingClientRect().top).toBeLessThanOrEqual(0);
  const input = host.querySelector('.tessiven-flower-composer')!.getBoundingClientRect();
  expect(input.right).toBeLessThanOrEqual(390);
  expect(input.bottom).toBeLessThanOrEqual(844);
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await expect.element(editor()).toBeVisible();
});

it('sends native file references alongside the exact canvas selection', async () => {
  await page.viewport(1200, 800);
  const runtime = mount(false, {
    getWorkingDirectoryPathContext: async () => ({ agentHomePathAbs: '/workspace', homePathAbs: '/workspace', defaultRootId: 'workspace', roots: [
      { id: 'workspace', label: 'Workspace', pathAbs: '/workspace', kind: 'workspace', permissions: { read: true, write: true } },
    ] }),
    listWorkingDirectoryEntries: async () => [{ name: 'orders.ts', path: '/workspace/orders.ts', isDirectory: false, modifiedAt: 1 }],
  });
  await expect.element(editor()).toBeVisible();
  await editor().click(); await userEvent.keyboard('@');
  await page.getByRole('option', { name: /orders.ts/ }).click();
  await editor().fill('Use this code to explain Orders');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  const context = parseAskFlowerContextActionEnvelope(runtime.sent.mock.calls[0][0].context_action);
  expect(context?.context).toEqual([
    { kind: 'tessiven_selection', canvas_id: 'commerce', version_id: 2, object_refs: ['orders'] },
    { kind: 'file_path', path: '/workspace/orders.ts', is_directory: false },
  ]);
});

it('keeps native approval controls usable at the bottom while replies are hidden', async () => {
  await page.viewport(1200, 800);
  const submitApproval = vi.fn(async () => ({ ok: true, current: liveBootstrap(thread({ thread_id: 'canvas-thread' }), 4).current }));
  const runtime = mount(false, { submitApproval });
  await expect.element(editor()).toBeVisible();
  await editor().fill('Inspect Orders');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Open conversation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: {
    thread_id: 'canvas-thread', view_version: 3, activity: 'active', turn_id: 'turn', run_id: 'run', queue: [], items: [],
    interactions: [{ id: 'approval-1', turn_id: 'turn', run_id: 'run', kind: 'approval', tool_call_id: 'tool-1',
      approval: { label: 'Inspect service configuration', command: 'cat /workspace/orders.yaml', tool_name: 'terminal.exec', tool_call_id: 'tool-1' } }],
  } });
  await expect.element(page.getByRole('button', { name: 'Approve Inspect service configuration', exact: true })).toBeVisible();
  const composer = host.querySelector('.tessiven-flower-composer')!;
  expect(composer.textContent).toContain('Inspect service configuration');
  expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(730);
  await page.getByRole('button', { name: 'Approve Inspect service configuration', exact: true }).click();
  expect(submitApproval).toHaveBeenCalledWith({ thread_id: 'canvas-thread', interaction_id: 'approval-1', approved: true });
});
