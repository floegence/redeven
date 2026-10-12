import '../index.css';
import '../ui/flower-feature.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TessivenPage } from '../../../../tessiven_ui/src/TessivenPage';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type { Canvas, TessivenTransport, Version } from '../../../../tessiven_ui/src/types';
import type { FlowerLiveStreamEnvelope, FlowerSurfaceAdapter } from '../../../../flower_ui/src';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { CanvasFlowerTestSurface, canvasFlowerAdapter } from './tessiven-flower.test-support';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('redeven-flower-transport');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  await page.viewport(1200, 850);
});
afterEach(() => { dispose?.(); host?.remove(); });

function fixture(canvasID: string, number: number): Version {
  return {
    canvas_id: canvasID, number, document_yaml: '', digest: `fixture-${number}`, created_at: 1, source: 'flower', summary: '',
    document: {
      apiVersion: 'redeven.io/tessiven/v1.0.0', kind: 'ServiceCanvas', metadata: { title: canvasID },
      nodes: [{ id: 'core', name: 'Core runtime', runtimeRef: 'local:local' }],
      services: [{ id: 'orders', name: 'Orders API', kind: 'api' }, { id: 'worker', name: 'Background worker', kind: 'worker' }],
      instances: [{ id: 'orders-01', nodeRef: 'core', serviceRef: 'orders', role: 'standalone' },
        { id: 'worker-01', nodeRef: 'core', serviceRef: 'worker', role: 'standalone' }],
    },
  };
}

function mount(overrides: Partial<FlowerSurfaceAdapter> = {}, savedThread = '') {
  host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:20px;top:20px;width:1100px;height:760px';
  document.body.append(host);
  const canvases = new Map<string, Canvas>(['commerce', 'analytics'].map(id => [id, {
    id, title: id, description: '', latest_version: 3, archived: false, created_at: 1, updated_at: 1,
    ...(savedThread && id === 'commerce' ? { flower_thread_id: savedThread } : {}),
  }]));
  const request = vi.fn(async (method: string, path: string, body?: unknown) => {
    if (path.startsWith('/canvases?')) return { canvases: [...canvases.values()] };
    const match = /^\/canvases\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (!match) throw new Error(`Unexpected Tessiven path: ${path}`);
    const [, canvasID, suffix] = match;
    const canvas = canvases.get(canvasID)!;
    if (!suffix && method === 'GET') return canvas;
    if (suffix === 'flower-thread' && method === 'POST') {
      const next = { ...canvas, flower_thread_id: (body as { thread_id: string }).thread_id };
      canvases.set(canvasID, next);
      return next;
    }
    if (suffix?.startsWith('versions/')) {
      const value = suffix.split('/')[1];
      return fixture(canvasID, value === 'latest' ? canvas.latest_version : Number(value));
    }
    throw new Error(`Unexpected Tessiven path: ${path}`);
  });
  const transport = { request, subscribe: () => () => {} } as TessivenTransport;
  const [openRequest, setOpenRequest] = createSignal({ canvasID: 'commerce', version: 2, nonce: 0 });
  const base = { ...canvasFlowerAdapter(), ...overrides };
  const sent = vi.fn(base.launchTurn);
  const queued: FlowerLiveStreamEnvelope[] = [];
  let wake = () => {};
  const adapter: FlowerSurfaceAdapter = {
    ...base, launchTurn: sent,
    connectLiveStream: async function* ({ signal }) {
      yield { schema_version: 1, kind: 'ready', summaries: await base.listThreads() };
      while (!signal.aborted) {
        const next = queued.shift();
        if (next) { yield next; continue; }
        await new Promise<void>(resolve => {
          wake = resolve;
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    },
  };
  dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <TessivenPage t={tessivenText('en-US')} canWrite transport={transport} openRequest={openRequest()}
      renderFlower={surface => <CanvasFlowerTestSurface {...surface} adapter={adapter} />}
      onOpenFlower={() => {}} onOpenService={() => {}} />
  </LayoutProvider></FloeConfigProvider>, host);
  return {
    sent, request, canvases,
    bindings: () => request.mock.calls.filter(([method, path]) => method === 'POST' && path.endsWith('/flower-thread')),
    open: (canvasID: string, version = 2) => setOpenRequest(previous => ({ canvasID, version, nonce: previous.nonce + 1 })),
    push: (event: FlowerLiveStreamEnvelope) => { queued.push(event); wake(); },
  };
}

const editor = () => page.getByRole('textbox');
async function select(serviceID = 'orders') {
  await expect.poll(() => host.querySelector(`.tessiven-service[data-service-id="${serviceID}"]`)).not.toBeNull();
  host.querySelector<HTMLElement>(`.tessiven-service[data-service-id="${serviceID}"]`)!.click();
  await page.getByRole('button', { name: 'Ask Flower', exact: true }).click();
  await expect.element(editor()).toBeVisible();
}
async function send(prompt = 'Explain the selected objects') {
  await editor().fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
const referenceText = () => document.querySelector('.flower-composer-context-references')?.textContent;

it.each([false, true])('consumes accepted canvas references on first and later sends (saved thread: %s)', async saved => {
  const runtime = mount({}, saved ? 'saved-canvas-thread' : '');
  await select();
  expect(referenceText()).toContain('Orders API');
  await send();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  await expect.poll(referenceText).toBeUndefined();
  await expect.element(editor()).toHaveValue('');
  expect(runtime.sent.mock.calls[0][0].context_action).toMatchObject({ context: [
    { kind: 'tessiven_selection', canvas_id: 'commerce', version_id: 2, object_refs: ['orders-01'] },
  ] });
  await send('Continue without the old selection');
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(2);
  expect(runtime.sent.mock.calls[1][0].context_action).toBeUndefined();
  await select('worker');
  await send('Explain the worker');
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(3);
  await expect.poll(referenceText).toBeUndefined();
  expect(runtime.sent.mock.calls[2][0].context_action).toMatchObject({ context: [
    { kind: 'tessiven_selection', canvas_id: 'commerce', version_id: 2, object_refs: ['worker-01'] },
  ] });
});

it.each(['current-first', 'receipt-first'])('settles selection and canvas binding once with %s confirmation', async order => {
  let accept!: (receipt: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  const runtime = mount({ launchTurn: () => new Promise(resolve => { accept = resolve; }) });
  await select();
  await send();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  const receipt = await canvasFlowerAdapter().launchTurn(runtime.sent.mock.calls[0][0]);
  const pushCurrent = () => runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: receipt.thread_id, current: receipt.current! });
  if (order === 'current-first') pushCurrent();
  else accept({ client_request_id: receipt.client_request_id, thread_id: receipt.thread_id });
  await expect.poll(referenceText).toBeUndefined();
  await expect.poll(() => runtime.bindings().length).toBe(1);
  if (order === 'current-first') accept(receipt);
  else pushCurrent();
  await expect.element(editor()).toHaveValue('');
  // A second selection must survive the duplicate admission evidence.
  await select('worker');
  expect(referenceText()).toContain('Background worker');
  expect(runtime.bindings()).toHaveLength(1);
});

it('consumes references when the canonical queue accepts a send before its turn starts', async () => {
  let accept!: (receipt: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  const runtime = mount({ launchTurn: () => new Promise(resolve => { accept = resolve; }) }, 'canvas-thread');
  await select();
  await send('Queue this selection');
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  const input = runtime.sent.mock.calls[0][0];
  const current = {
    thread_id: 'canvas-thread', view_version: 2, activity: 'active' as const, turn_id: 'prior-turn', run_id: 'prior-run',
    run_progress: { phase: 'streaming' as const },
    items: [], interactions: [],
    queue: [{ id: `queue:${input.client_request_id}`, request_key: input.client_request_id, input: { text: input.prompt } }],
  };
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current });
  await expect.poll(referenceText).toBeUndefined();
  await expect.element(editor()).toHaveValue('');
  expect(current.queue).toHaveLength(1);
  expect(runtime.bindings()).toHaveLength(0);
  accept({ client_request_id: input.client_request_id, thread_id: 'canvas-thread', current });
});

it('keeps a rejected send editable with its canvas references', async () => {
  const runtime = mount({ launchTurn: async () => { throw flowerTurnAdmissionError('rejected', new Error('Test admission rejected')); } });
  await select();
  await send('Keep this draft');
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  await expect.element(editor()).toHaveValue('Keep this draft');
  await expect.element(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  expect(referenceText()).toContain('Orders API');
  expect(runtime.bindings()).toHaveLength(0);
});

it('retains references while admission is unknown and consumes them after the frozen retry succeeds', async () => {
  let accept!: (receipt: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  let attempts = 0;
  const runtime = mount({ launchTurn: async () => {
    if (++attempts === 1) throw flowerTurnAdmissionError('unknown', new Error('Test response lost'));
    return new Promise(resolve => { accept = resolve; });
  } });
  await select();
  await send('Keep until confirmed');
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(2);
  expect(referenceText()).toContain('Orders API');
  expect(runtime.bindings()).toHaveLength(0);
  expect(runtime.sent.mock.calls[1][0]).toEqual(runtime.sent.mock.calls[0][0]);
  accept(await canvasFlowerAdapter().launchTurn(runtime.sent.mock.calls[1][0]));
  await expect.poll(referenceText).toBeUndefined();
  await expect.poll(() => runtime.bindings().length).toBe(1);
});

it.each(['objects', 'same-objects', 'version', 'canvas'])('preserves a newer %s selection during admission and binds the submitted canvas', async change => {
  let accept!: (receipt: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  const runtime = mount({ launchTurn: () => new Promise(resolve => { accept = resolve; }) });
  await select();
  await send();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  if (change === 'canvas') {
    runtime.open('analytics');
    await expect.poll(() => host.querySelector('.tessiven-toolbar')?.textContent).toContain('analytics');
    await select('worker');
  } else if (change === 'version') {
    runtime.open('commerce', 3);
    await expect.poll(() => document.querySelector('.flower-composer-context-source')?.getAttribute('title')).toContain('Version 3');
  } else await select(change === 'same-objects' ? 'orders' : 'worker');
  const retained = referenceText();
  expect(retained).toContain(change === 'objects' || change === 'canvas' ? 'Background worker' : 'Orders API');
  accept(await canvasFlowerAdapter().launchTurn(runtime.sent.mock.calls[0][0]));
  await expect.poll(() => runtime.bindings().length).toBe(1);
  expect(runtime.bindings()[0]).toEqual(['POST', '/canvases/commerce/flower-thread', { thread_id: 'canvas-thread' }]);
  expect(referenceText()).toBe(retained);
  if (change === 'canvas') {
    expect(runtime.canvases.get('analytics')?.flower_thread_id).toBeUndefined();
    runtime.open('commerce');
    await expect.poll(referenceText).toBeUndefined();
  }
});

it('keeps a saved canvas binding when acceptance arrives after switching canvases', async () => {
  let accept!: (receipt: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  const runtime = mount({ launchTurn: () => new Promise(resolve => { accept = resolve; }) }, 'canvas-thread');
  await select();
  await send();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  runtime.open('analytics');
  await expect.poll(() => host.querySelector('.tessiven-toolbar')?.textContent).toContain('analytics');
  await select('worker');
  accept(await canvasFlowerAdapter().launchTurn(runtime.sent.mock.calls[0][0]));
  expect(referenceText()).toContain('Background worker');
  runtime.open('commerce');
  await expect.poll(() => host.querySelector('.tessiven-toolbar')?.textContent).toContain('commerce');
  await expect.poll(referenceText).toBeUndefined();
  expect(runtime.bindings()).toHaveLength(0);
});
