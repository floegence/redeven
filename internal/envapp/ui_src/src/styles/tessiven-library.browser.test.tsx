import '../index.css';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { TessivenPage } from '../../../../tessiven_ui/src/TessivenPage';
import { TessivenResourceDialog } from '../../../../tessiven_ui/src/TessivenResourceDialog';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type {
  Canvas,
  Version,
  TessivenTransport,
} from '../../../../tessiven_ui/src/types';
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.unstubAllGlobals();
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
it('opens exact history for Ask Flower and retains conflicting DSL edits', async () => {
  await page.viewport(1200, 800);
  createHost();
  const ask = vi.fn();
  let rejected = false;
  const request = vi.fn(async (_method: string, path: string) => {
    if (path.startsWith('/canvases?')) return { canvases: [canvas] };
    if (path === '/canvases/commerce') return canvas;
    if (path === '/canvases/commerce/versions/latest') return version(2);
    if (path === '/canvases/commerce/versions/1') return version(1);
    if (path === '/canvases/commerce/versions') {
      rejected = true;
      throw new Error('Canvas version conflict');
    }
    if (path === '/validate') return { valid: true, diagnostics: [] };
    throw new Error(`Unexpected path ${path}`);
  });
  const transport = { request, subscribe: () => () => {} } as TessivenTransport;
  dispose = render(
    () => (
      <TessivenPage
        t={tessivenText('en-US')}
        canWrite
        transport={transport}
        onAsk={ask}
        onOpenService={() => {}}
        openRequest={{ canvasID: 'commerce', version: 1, nonce: 1 }}
      />
    ),
    host,
  );
  await expect
    .element(
      page.getByText(
        'You are viewing a saved version. Service changes are disabled.',
      ),
    )
    .toBeVisible();
  await expect.element(page.getByRole('heading', { name: 'Commerce', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ask Flower', exact: true }).click();
  expect(ask).toHaveBeenCalledWith({
    canvas_id: 'commerce',
    version_id: 1,
    object_refs: [],
  });
  await page
    .getByRole('button', { name: 'Open latest version', exact: true })
    .click();
  await expect
    .poll(() => host.textContent?.includes('You are viewing a saved version.'))
    .toBe(false);
  // Public HTTP contexts expose secure random bytes but not randomUUID.
  vi.stubGlobal('crypto', {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  });
  await page.getByRole('button', { name: 'DSL document', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Canvas YAML document' });
  await editor.fill('my unsaved document');
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect.poll(() => rejected).toBe(true);
  await expect.element(editor).toHaveValue('my unsaved document');
  await expect
    .element(page.getByRole('dialog').getByRole('alert'))
    .toHaveTextContent('Canvas version conflict');
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
