import '../index.css';
import { KeepAliveStack } from '@floegence/floe-webapp-core/layout';
import { Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { TessivenPage } from '../../../../tessiven_ui/src/TessivenPage';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type { Canvas, TessivenTransport, Version } from '../../../../tessiven_ui/src/types';

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
});

const canvas: Canvas = {
  id: 'runtime-continuity',
  title: 'Runtime continuity',
  description: '',
  latest_version: 1,
  archived: false,
  created_at: 1,
  updated_at: 1,
};
const version: Version = {
  canvas_id: canvas.id,
  number: 1,
  document_yaml: '',
  digest: 'fixture',
  created_at: 1,
  source: 'manual',
  summary: 'Runtime dialog continuity fixture',
  document: {
    apiVersion: 'redeven.io/tessiven/v1.0.0',
    kind: 'ServiceCanvas',
    metadata: { title: canvas.title },
    nodes: [{ id: 'host', name: 'Runtime host', runtimeRef: 'local:local' }],
  },
};

it.each(['activity', 'standalone'] as const)(
  'keeps the %s canvas mounted when opening Runtime details with slow or failed reads',
  async (surface) => {
    await page.viewport(1200, 800);
    host = document.createElement('div');
    host.style.cssText = 'width:1100px;height:700px';
    document.body.append(host);
    let resolveRead: ((value: { targets: []; sources: [] }) => void) | undefined;
    let rejectRead: ((reason: Error) => void) | undefined;
    const request = vi.fn(async (_method: string, path: string) => {
      if (path === '/runtimes') return new Promise((resolve, reject) => {
        resolveRead = resolve;
        rejectRead = reject;
      });
      if (path.startsWith('/canvases?')) return { canvases: [canvas] };
      if (path === `/canvases/${canvas.id}`) return canvas;
      if (path === `/canvases/${canvas.id}/versions/latest`) return version;
      throw new Error(`Unexpected fixture request: ${path}`);
    });
    const transport: TessivenTransport = {
      request: request as TessivenTransport['request'],
      subscribe: () => () => {},
    };
    const renderPage = () => <TessivenPage
      t={tessivenText('en-US')}
      transport={transport}
      canWrite
      standalone={surface === 'standalone'}
      openRequest={{ canvasID: canvas.id, nonce: 1 }}
      renderFlower={() => <input aria-label="Flower draft fixture" />}
      onOpenFlower={() => {}}
      onOpenService={() => {}}
    />;
    const loading = () => <div data-page-loading>Loading page</div>;
    dispose = render(() => surface === 'activity'
      ? <KeepAliveStack activeId="tessiven" views={[{ id: 'tessiven', render: renderPage }]}
          renderFallback={loading} />
      : <Suspense fallback={loading()}>{renderPage()}</Suspense>, host);

    await expect.poll(() => host.querySelector('.tessiven-runtime')).not.toBeNull();
    const graph = host.querySelector<HTMLElement>('.tessiven-canvas')!;
    const toolbar = host.querySelector<HTMLElement>('.tessiven-toolbar')!;
    const flower = host.querySelector<HTMLElement>('.tessiven-flower-canvas')!;
    const draft = flower.querySelector<HTMLInputElement>('input')!;
    draft.value = 'Keep this draft';
    const runtime = host.querySelector<HTMLButtonElement>('.tessiven-runtime')!;
    const assertContinuity = () => {
      expect(graph.isConnected).toBe(true);
      expect(host.querySelector('.tessiven-canvas')).toBe(graph);
      expect(host.querySelector('.tessiven-toolbar')).toBe(toolbar);
      expect(host.querySelector('.tessiven-flower-canvas')).toBe(flower);
      expect(draft.value).toBe('Keep this draft');
      expect(host.querySelector('[data-page-loading]')).toBeNull();
    };

    // Check the click's synchronous result: waiting for a dialog would miss
    // the page-wide fallback during its first dynamic import.
    runtime.click();
    assertContinuity();
    await expect.poll(() => document.querySelector('.tessiven-runtimes-dialog')).not.toBeNull();
    expect(document.querySelector('.tessiven-runtime-list')?.getAttribute('aria-busy')).toBe('true');
    assertContinuity();
    resolveRead?.({ targets: [], sources: [] });
    await expect.poll(() => document.querySelector('.tessiven-runtime-list')?.getAttribute('aria-busy')).toBe('false');
    assertContinuity();

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => document.querySelector('.tessiven-runtimes-dialog')).toBeNull();
    const panelButton = page.getByRole('button', { name: 'Connected environments', exact: true }).element();
    expect(panelButton).toBeInstanceOf(HTMLButtonElement);
    (panelButton as HTMLButtonElement).click();
    assertContinuity();
    await expect.poll(() => document.querySelector('.tessiven-runtime-list')?.getAttribute('aria-busy')).toBe('true');
    rejectRead?.(new Error('Unavailable Runtime directory'));
    await expect.poll(() => document.querySelector('.tessiven-runtimes-dialog [role="alert"]')).not.toBeNull();
    assertContinuity();
    expect(request.mock.calls.filter(([, path]) => path === '/runtimes')).toHaveLength(2);
  },
);
