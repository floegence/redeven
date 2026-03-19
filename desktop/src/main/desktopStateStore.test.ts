import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { defaultDesktopStateStorePath, DesktopStateStore } from './desktopStateStore';

async function createTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-state-store-test-'));
}

describe('DesktopStateStore', () => {
  const cleanupRoots = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupRoots, async (root) => {
      await fs.rm(root, { recursive: true, force: true });
      cleanupRoots.delete(root);
    }));
  });

  it('round-trips renderer values and window state through the backing file', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultDesktopStateStorePath(root);

    const store = new DesktopStateStore(filePath);
    store.setRendererItem('layout', '{"sidebar":240}');
    store.setRendererItem('theme', '"light"');
    store.setWindowState('window:main', {
      x: 100,
      y: 80,
      width: 1280,
      height: 840,
      maximized: true,
    });

    const nextStore = new DesktopStateStore(filePath);
    expect(nextStore.getRendererItem('layout')).toBe('{"sidebar":240}');
    expect(nextStore.rendererKeys()).toEqual(['layout', 'theme']);
    expect(nextStore.getWindowState('window:main')).toEqual({
      x: 100,
      y: 80,
      width: 1280,
      height: 840,
      maximized: true,
      full_screen: false,
    });
  });

  it('falls back to an empty snapshot when the file contains invalid data', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultDesktopStateStorePath(root);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{not json}\n');

    const store = new DesktopStateStore(filePath);
    expect(store.getRendererItem('missing')).toBeNull();
    expect(store.rendererKeys()).toEqual([]);
    expect(store.getWindowState('window:main')).toBeNull();
  });

  it('removes renderer and window entries cleanly', async () => {
    const root = await createTempRoot();
    cleanupRoots.add(root);
    const filePath = defaultDesktopStateStorePath(root);

    const store = new DesktopStateStore(filePath);
    store.setRendererItem('alpha', '1');
    store.setWindowState('window:settings', { x: 10, y: 20, width: 700, height: 800 });
    store.removeRendererItem('alpha');
    store.removeWindowState('window:settings');

    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
    expect(raw.renderer_storage).toEqual({});
    expect(raw.windows).toEqual({});
  });
});
