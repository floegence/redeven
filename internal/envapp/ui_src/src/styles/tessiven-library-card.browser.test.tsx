import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { TessivenLibraryCard } from '../../../../tessiven_ui/src/TessivenLibraryCard';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type { Canvas, TessivenTransport, Version } from '../../../../tessiven_ui/src/types';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); });

const canvas: Canvas = {
  id: 'commerce', title: 'Commerce / Production',
  description: 'Storefront, order processing, and shared data services.',
  latest_version: 3, archived: false, created_at: 1, updated_at: 1791324000000,
};
const version: Version = {
  canvas_id: canvas.id, number: 3, document_yaml: '', digest: 'fixture',
  created_at: 1, source: 'flower', summary: '',
  document: {
    apiVersion: 'redeven.io/tessiven/v1', kind: 'ServiceCanvas',
    metadata: { title: canvas.title, description: canvas.description },
    nodes: [
      { id: 'app', name: 'app-01', runtimeRef: 'local:app' },
      { id: 'data', name: 'data-01', runtimeRef: 'local:data' },
    ],
    groups: [{ id: 'cluster', name: 'Data cluster', nodeRefs: ['data'] }],
    services: [
      { id: 'web', name: 'Storefront', kind: 'web' },
      { id: 'api', name: 'Orders API', kind: 'api' },
      { id: 'db', name: 'Orders database', kind: 'database' },
    ],
    instances: [
      { id: 'web-app', serviceRef: 'web', nodeRef: 'app', role: 'standalone' },
      { id: 'api-app', serviceRef: 'api', nodeRef: 'app', role: 'standalone' },
      { id: 'db-data', serviceRef: 'db', nodeRef: 'data', role: 'primary' },
    ],
    resources: [{ id: 'domain', name: 'shop.example.com', kind: 'domain' }],
    relations: [
      { id: 'entry', from: 'domain', to: 'web', kind: 'resolves', evidenceRefs: [] },
      { id: 'orders', from: 'api', to: 'db', kind: 'writes', protocol: 'SQL', evidenceRefs: [] },
    ],
  },
};
const media = commands as unknown as { emulateMediaPreferences: (preferences: { forcedColors?: 'active' | 'none'; reducedMotion?: 'reduce' | 'no-preference' }) => Promise<void> };
const touch = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };

it('previews the saved topology with groups and routed relationships under an information overlay', async () => {
  await page.viewport(1200, 800);
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = 'width:340px;height:280px';
  document.body.append(host);
  const open = vi.fn();
  const request = vi.fn(async () => version);
  dispose = render(() => <TessivenLibraryCard canvas={canvas} transport={{ request } as unknown as TessivenTransport} t={tessivenText('en-US')} onOpen={open} />, host);
  await expect.poll(() => host.querySelectorAll('[data-preview-object]').length).toBe(3);
  expect(host.querySelector('[data-preview-object="cluster"]')?.textContent).toContain('Orders database');
  expect(host.querySelectorAll('[data-preview-edge]')).toHaveLength(2);
  const button = host.querySelector('button')!;
  const overlay = host.querySelector('.tessiven-card-information')!;
  expect(getComputedStyle(overlay).position).toBe('absolute');
  expect(host.querySelectorAll('button, [tabindex]')).toHaveLength(1);
  expect(request).toHaveBeenCalledWith('GET', '/canvases/commerce/versions/3');
  await page.screenshot({ element: host, path: '__screenshots__/tessiven-card-initial.png' });
  await userEvent.hover(page.elementLocator(button));
  await page.screenshot({ element: host, path: '__screenshots__/tessiven-card-hover.png' });
  const initialBounds = button.getBoundingClientRect().toJSON();
  expect(initialBounds.height).toBeGreaterThan(250);
  expect(overlay.getBoundingClientRect().bottom <= overlay.closest('.tessiven-library-card')!.getBoundingClientRect().bottom).toBe(true);
  button.blur();
  await userEvent.keyboard('{Tab}');
  expect(button.matches(':focus-visible')).toBe(true);
  expect(getComputedStyle(host.querySelector('.tessiven-card-reveal')!).gridTemplateRows).not.toBe('0px');
  const focusedBounds = button.getBoundingClientRect();
  expect(focusedBounds.width).toBe(initialBounds.width);
  expect(focusedBounds.height).toBe(initialBounds.height);
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  expect(getComputedStyle(host.querySelector('.tessiven-thumbnail')!).transitionDuration).toBe('0s');
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  expect(getComputedStyle(overlay).borderTopWidth).toBe('1px');
  await media.emulateMediaPreferences({ forcedColors: 'none' });
  await page.viewport(360, 780);
  await page.screenshot({ element: host, path: '__screenshots__/tessiven-card-narrow.png' });
  await touch.emulateTouchInput(true);
  try {
    expect(matchMedia('(hover: none)').matches).toBe(true);
    expect(getComputedStyle(host.querySelector('.tessiven-card-reveal')!).gridTemplateRows).not.toBe('0px');
    await page.screenshot({ element: host, path: '__screenshots__/tessiven-card-touch.png' });
  } finally {
    await touch.emulateTouchInput(false);
  }
  await page.elementLocator(button).click();
  expect(open).toHaveBeenCalledOnce();
});

it('distinguishes an empty canvas from an unavailable saved preview', async () => {
  await page.viewport(900, 600);
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = 'width:700px;height:300px';
  document.body.append(host);
  const emptyVersion = { ...version, document: { ...version.document, nodes: [], groups: [], services: [], instances: [], resources: [], relations: [] } };
  const emptyCanvas = { ...canvas, id: 'empty', title: 'Empty canvas' };
  const unavailableCanvas = { ...canvas, id: 'unavailable', title: 'Unavailable canvas' };
  const request = vi.fn(async (_method: string, path: string) => {
    if (path.startsWith('/canvases/empty/')) return { ...emptyVersion, canvas_id: 'empty' };
    throw new Error('Preview request failed');
  });
  dispose = render(() => <>
    <TessivenLibraryCard canvas={emptyCanvas} transport={{ request } as unknown as TessivenTransport} t={tessivenText('en-US')} onOpen={() => {}} />
    <TessivenLibraryCard canvas={unavailableCanvas} transport={{ request } as unknown as TessivenTransport} t={tessivenText('en-US')} onOpen={() => {}} />
  </>, host);
  await expect.poll(() => host.querySelectorAll('.tessiven-preview-placeholder').length).toBe(2);
  expect(host.querySelectorAll('.tessiven-preview-placeholder')[0]?.textContent).toBe('Empty canvas');
  expect(host.querySelectorAll('.tessiven-preview-placeholder')[1]?.textContent).toBe('Preview unavailable');
});
