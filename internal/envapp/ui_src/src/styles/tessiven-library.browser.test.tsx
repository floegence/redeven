import '../index.css';
import '../ui/flower-feature.css';
import { CanvasFlowerTestSurface, canvasFlowerAdapter } from './tessiven-flower.test-support';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { TessivenIcon } from '../../../../tessiven_ui/src/TessivenIcon';
import { TessivenPage } from '../../../../tessiven_ui/src/TessivenPage';
import { TessivenResourceDialog } from '../../../../tessiven_ui/src/TessivenResourceDialog';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type {
  Canvas,
  Version,
  TessivenTransport,
} from '../../../../tessiven_ui/src/types';
beforeEach(async () => { await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('redeven-flower-transport'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); });
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
});

const canvas: Canvas = {
  id: 'commerce',
  title: 'Commerce / Current',
  description: '',
  latest_version: 2,
  archived: false,
  created_at: 1,
  updated_at: 2,
};
const version = (number: number): Version => ({
  canvas_id: 'commerce',
  number,
  document_yaml:
    'apiVersion: redeven.io/tessiven/v1\nkind: ServiceCanvas\nmetadata: {title: Commerce}\n',
  document: {
    apiVersion: 'redeven.io/tessiven/v1',
    kind: 'ServiceCanvas',
    metadata: { title: 'Commerce' },
  },
  digest: 'fixture',
  created_at: 1,
  source: 'flower',
  summary: 'Observed commerce',
});
function createHost() {
  host = document.createElement('div');
  host.style.cssText = 'width:1100px;height:700px';
  document.body.append(host);
}

it('marks the standalone canvas toolbar as the native titlebar drag surface', async () => {
  createHost();
  const transport = {
    request: vi.fn(async () => ({ canvases: [] })),
    subscribe: () => () => {},
  } as unknown as TessivenTransport;
  dispose = render(
    () => (
      <TessivenPage
        t={tessivenText('en-US')}
        canWrite
        standalone
        transport={transport}
        renderFlower={() => <div />}
        onOpenFlower={() => {}}
        onOpenService={() => {}}
      />
    ),
    host,
  );
  const toolbar = host.querySelector('.tessiven-toolbar');
  expect(toolbar?.getAttribute('data-redeven-desktop-titlebar-drag-region')).toBe('true');
  expect(toolbar?.getAttribute('data-redeven-desktop-window-titlebar')).toBe('true');
  expect(toolbar?.getAttribute('data-redeven-desktop-window-titlebar-content')).toBe('true');
  expect(toolbar?.classList.contains('redeven-resource-header')).toBe(true);
  expect(toolbar?.classList.contains('tessiven-toolbar--standalone')).toBe(true);
});

it('creates immediately, delegates edits to Flower, and follows current versions without changing history', async () => {
  await page.viewport(1200, 800);
  createHost();
  const ask = vi.fn(canvasFlowerAdapter().launchTurn);
  let current = { ...canvas };
  let changed: () => void = () => {};
  const request = vi.fn(async (method: string, path: string) => {
    if (path.startsWith('/canvases?')) return { canvases: [current] };
    if (path === '/canvases' && method === 'POST')
      return {
        canvas: { ...canvas, title: 'Untitled canvas', latest_version: 1 },
        version: {
          ...version(1),
          source: 'created',
          document: {
            ...version(1).document,
            metadata: { title: 'Untitled canvas' },
          },
        },
      };
    if (path === '/canvases/commerce') return current;
    if (path.startsWith('/canvases/commerce/versions/')) {
      const number = path.endsWith('/latest')
        ? current.latest_version
        : Number(path.split('/').at(-1));
      return {
        ...version(number),
        document: {
          ...version(number).document,
          metadata: { title: `Commerce v${number}` },
          ...(number >= 2
            ? {
                nodes: [
                  {
                    id: 'new-runtime',
                    name: 'Mapped Runtime',
                    runtimeRef: 'local:local',
                  },
                ],
                presentation: {
                  positions: [{ objectRef: 'new-runtime', x: 5000, y: 3000 }],
                },
              }
            : {}),
        },
      };
    }
    throw new Error(`Unexpected path ${path}`);
  });
  const transport = {
    request,
    subscribe: (notify: () => void) => {
      changed = notify;
      return () => {};
    },
  } as TessivenTransport;
  dispose = render(
    () => (
      <TessivenPage
        t={tessivenText('en-US')}
        canWrite
        transport={transport}
        renderFlower={surface => <CanvasFlowerTestSurface {...surface} adapter={{ ...canvasFlowerAdapter(), launchTurn: ask }} />}
        onOpenFlower={() => {}}
        onOpenService={() => {}}
      />
    ),
    host,
  );
  await expect
    .element(page.getByRole('button', { name: 'New canvas', exact: true }))
    .toBeVisible();
  vi.stubGlobal('crypto', {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  });
  await page.getByRole('button', { name: 'New canvas', exact: true }).click();
  await expect
    .element(
      page.getByRole('heading', { name: 'Untitled canvas', exact: true }),
    )
    .toBeVisible();
  expect(document.querySelector('.tessiven-dialog')).toBeNull();
  expect(
    request.mock.calls.filter(([method]) => method === 'POST'),
  ).toHaveLength(1);
  await page
    .getByRole('button', { name: 'Map connected services', exact: true })
    .click();
  await expect
    .element(page.getByRole('textbox'))
    .toHaveValue(tessivenText('en-US')('mapPrompt'));
  expect(ask).not.toHaveBeenCalled();
  await page
    .getByRole('button', { name: 'Send', exact: true })
    .click();
  await expect.poll(() => ask.mock.calls.length).toBe(1);
  expect(ask.mock.calls.at(-1)?.[0].context_action).toMatchObject({
    context: [
      {
        kind: 'tessiven_selection',
        canvas_id: 'commerce',
        version_id: 1,
        object_refs: [],
      },
    ],
  });
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  changed();
  await expect
    .element(page.getByRole('heading', { name: 'Commerce v2', exact: true }))
    .toBeVisible();
  await expect
    .poll(() => {
      const card = host
        .querySelector('.tessiven-node')
        ?.getBoundingClientRect();
      const viewport = host
        .querySelector('.tessiven-canvas')
        ?.getBoundingClientRect();
      return (
        !!card &&
        !!viewport &&
        card.left >= viewport.left &&
        card.right <= viewport.right &&
        card.top >= viewport.top &&
        card.bottom <= viewport.bottom
      );
    })
    .toBe(true);
  await page
    .getByRole('button', { name: 'Canvas actions', exact: true })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: 'View document', exact: true })
    .click();
  await expect.element(page.getByRole('dialog', { name: 'View document' })).toBeVisible();
  expect(document.querySelector('.tessiven-dialog textarea')).toBeNull();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  dispose();
  dispose = render(
    () => (
      <TessivenPage
        t={tessivenText('en-US')}
        canWrite
        transport={transport}
        renderFlower={surface => <CanvasFlowerTestSurface {...surface} adapter={{ ...canvasFlowerAdapter(), launchTurn: ask }} />}
        onOpenFlower={() => {}}
        onOpenService={() => {}}
        openRequest={{ canvasID: 'commerce', version: 1, nonce: 1 }}
      />
    ),
    host,
  );
  await expect
    .element(page.getByRole('heading', { name: 'Commerce v1', exact: true }))
    .toBeVisible();
  current = { ...current, latest_version: 3 };
  changed();
  await expect
    .poll(
      () =>
        request.mock.calls.filter(([, path]) => path === '/canvases/commerce')
          .length,
    )
    .toBeGreaterThan(1);
  await page.getByRole('textbox').fill('Explain this historical version');
  await page
    .getByRole('button', { name: 'Send', exact: true })
    .click();
  await expect.poll(() => ask.mock.calls.length).toBe(2);
  expect(ask.mock.calls.at(-1)?.[0].context_action).toMatchObject({
    context: [
      {
        kind: 'tessiven_selection',
        canvas_id: 'commerce',
        version_id: 1,
        object_refs: [],
      },
    ],
  });
  await expect
    .element(page.getByRole('heading', { name: 'Commerce v1', exact: true }))
    .toBeVisible();
});
it('requires a user gesture to open a prepared service and never mutates history', async () => {
  createHost();
  const open = vi.fn();
  const instance = {
    id: 'orders',
    nodeRef: 'host',
    serviceRef: 'api',
    role: 'standalone',
  };
  const doc = version(1);
  doc.document.nodes = [
    { id: 'host', name: 'Runtime', runtimeRef: 'local:local' },
  ];
  const request = vi.fn(
    async (_method: string, _path: string, body: unknown) => {
      const { action } = body as { action: string };
      if (action === 'inspect')
        return {
          runtime_ref: 'local:local',
          inspection: {
            name: 'Orders',
            state: 'ready',
            observed_at: '2026-10-05T00:00:00Z',
            identity: 'service:1',
            actions: ['inspect', 'open', 'stop'],
          },
        };
      if (action === 'open')
        return {
          runtime_ref: 'local:local',
          opening: {
            state: 'ready',
            app_path: '/',
            forward: { forward_id: 'fixture' },
          },
        };
      throw new Error('Unexpected mutation');
    },
  );
  dispose = render(
    () => (
      <TessivenResourceDialog
        instance={instance}
        version={doc}
        historical={false}
        transport={{ request, subscribe: () => () => {} } as TessivenTransport}
        t={tessivenText('en-US')}
        onClose={() => {}}
        onOpen={open}
      />
    ),
    host,
  );
  await page.getByRole('button', { name: 'Open service', exact: true }).click();
  await expect.poll(() => request.mock.calls.length).toBe(2);
  expect(open).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Open service', exact: true }).click();
  expect(open).toHaveBeenCalledOnce();
  dispose();
  dispose = render(
    () => (
      <TessivenResourceDialog
        instance={instance}
        version={doc}
        historical
        transport={{ request, subscribe: () => () => {} } as TessivenTransport}
        t={tessivenText('en-US')}
        onClose={() => {}}
        onOpen={open}
      />
    ),
    host,
  );
  await expect
    .element(page.getByRole('button', { name: 'Stop', exact: true }))
    .toBeDisabled();
  await expect
    .element(page.getByRole('button', { name: 'Open service', exact: true }))
    .toBeDisabled();
});

it('keeps global navigation and library text visible in every published theme', async () => {
  await page.viewport(1200, 800);
  createHost();
  const transport = {
    request: async (_method: string, path: string) =>
      path.startsWith('/canvases?') ? { canvases: [canvas] } : version(2),
    subscribe: () => () => {},
  } as TessivenTransport;
  dispose = render(
    () => (
      <>
        <button
          class="global-tessiven-navigation"
          style={{
            color: 'var(--foreground)',
            background: 'var(--background)',
          }}
          aria-label="Open Tessiven"
        >
          <TessivenIcon kind="tessiven" />
        </button>
        <TessivenPage
          t={tessivenText('en-US')}
          canWrite
          transport={transport}
          renderFlower={surface => <CanvasFlowerTestSurface {...surface} adapter={canvasFlowerAdapter()} />}
          onOpenFlower={() => {}}
          onOpenService={() => {}}
        />
      </>
    ),
    host,
  );
  await expect
    .element(page.getByRole('heading', { name: canvas.title }))
    .toBeVisible();
  function luminance(color: string) {
    const context = document.createElement('canvas').getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const values = [...context.getImageData(0, 0, 1, 1).data]
      .slice(0, 3)
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  }
  for (const preset of builtInShellThemePresets) {
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    for (const [name, value] of Object.entries(preset.semanticTokens ?? {}))
      if (value) document.documentElement.style.setProperty(name, value);
    for (const [selector, background, property, minimum] of [
      [
        '.global-tessiven-navigation .glyph-main',
        '.global-tessiven-navigation',
        'fill',
        3,
      ],
      ['.tessiven-heading h1', '.tessiven', 'color', 4.5],
      ['.tessiven-card-information h3', '.tessiven-library-card', 'color', 4.5],
      ['.tessiven-card-meta', '.tessiven-library-card', 'color', 4.5],
    ] as const) {
      const foreground = getComputedStyle(
        host.querySelector(selector)!,
      ).getPropertyValue(property);
      const surface = getComputedStyle(
        host.querySelector(background)!,
      ).backgroundColor;
      const [light, dark] = [luminance(foreground), luminance(surface)].sort(
        (a, b) => b - a,
      );
      expect(
        (light + 0.05) / (dark + 0.05),
        `${preset.name}: ${selector}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  }
});

it('keeps graph panning from creating a browser text selection', async () => {
  await page.viewport(1200, 800);
  createHost();
  const current = version(2);
  current.document.nodes = [{ id: 'host', name: 'Runtime', runtimeRef: 'local:local' }];
  current.document.services = [{ id: 'api', name: 'Orders API', kind: 'api' }];
  current.document.instances = [{ id: 'orders', nodeRef: 'host', serviceRef: 'api', role: 'standalone' }];
  const transport = {
    request: vi.fn(async (_method: string, path: string) => {
      if (path.startsWith('/canvases?')) return { canvases: [canvas] };
      if (path === '/canvases/commerce') return canvas;
      return current;
    }),
    subscribe: () => () => {},
  } as unknown as TessivenTransport;
  dispose = render(
    () => (
      <TessivenPage
        t={tessivenText('en-US')}
        canWrite
        transport={transport}
        openRequest={{ canvasID: 'commerce', nonce: 1 }}
        renderFlower={() => <div />}
        onOpenFlower={() => {}}
        onOpenService={() => {}}
      />
    ),
    host,
  );
  await expect.element(page.getByRole('heading', { name: 'Commerce', exact: true })).toBeVisible();
  const graph = page.getByRole('region', { name: 'Tessiven service canvas', exact: true });
  await expect.element(graph).toBeVisible();
  const graphElement = graph.element();
  expect(getComputedStyle(graphElement).userSelect).toBe('none');
  const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });
  expect(graphElement.dispatchEvent(selectStart)).toBe(false);
  expect(window.getSelection()?.toString() ?? '').toBe('');
});
