// @vitest-environment jsdom

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const fetchPlugin = vi.hoisted(() => vi.fn());

vi.mock('./pluginPlatform', () => ({
  fetchAuthenticatedReDevPlugin: fetchPlugin,
}));
vi.mock('../services/localApi', () => ({
  prepareLocalApiRequestInit: vi.fn(async (init: RequestInit) => init),
}));

import {
  acquireCachedPluginIcon,
  clearPluginIconCache,
  loadPluginIcon,
} from './pluginIconLoader';

const iconURL = '/_redevplugin/api/plugins/instance/icon/' + 'a'.repeat(64);

class TestImage {
  src = '';
  decode = vi.fn(async () => undefined);
}

describe('plugin icon loader', () => {
  let nextObjectURL = 0;
  const createObjectURL = vi.fn(() => `blob:plugin-icon-${nextObjectURL++}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    fetchPlugin.mockReset();
    clearPluginIconCache();
    nextObjectURL = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('Image', TestImage);
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deduplicates concurrent requests and gives each consumer its own releasable URL', async () => {
    const blob = new Blob(['icon'], { type: 'image/png' });
    fetchPlugin.mockResolvedValue(new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const first = loadPluginIcon('/_redevplugin/api/plugins/instance/icon/' + 'a'.repeat(64));
    const second = loadPluginIcon('/_redevplugin/api/plugins/instance/icon/' + 'a'.repeat(64));

    const [firstIcon, secondIcon] = await Promise.all([first, second]);

    expect(fetchPlugin).toHaveBeenCalledOnce();
    expect(firstIcon.url).not.toBe(secondIcon.url);
    firstIcon.release();
    secondIcon.release();
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(acquireCachedPluginIcon('/_redevplugin/api/plugins/instance/icon/' + 'a'.repeat(64))).toBeDefined();
  });

  it('does not retry a definitive 404', async () => {
    fetchPlugin.mockResolvedValue(new Response('', { status: 404 }));

    await expect(loadPluginIcon(iconURL)).rejects.toThrow('HTTP 404');

    expect(fetchPlugin).toHaveBeenCalledOnce();
  });

  it('retries a transient server failure and reports retrying state', async () => {
    fetchPlugin
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(new Blob(['icon'], { type: 'image/png' }), { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const states: string[] = [];

    const result = await loadPluginIcon(iconURL, { onState: (state) => states.push(state) });

    expect(result.url).toContain('blob:plugin-icon-');
    expect(fetchPlugin).toHaveBeenCalledTimes(2);
    expect(states).toContain('retrying');
  });

  it('uses the same loader for market icons', async () => {
    const marketFetch = vi.fn(async () => new Response(
      new Blob(['icon'], { type: 'image/webp' }),
      { status: 200, headers: { 'Content-Type': 'image/webp' } },
    ));
    vi.stubGlobal('fetch', marketFetch);
    const marketURL = '/_redeven_proxy/api/plugins/market/plugins/com.example.plugin/icon?sha256=' + 'b'.repeat(64);

    const icon = await loadPluginIcon(marketURL);

    expect(marketFetch).toHaveBeenCalledOnce();
    expect(fetchPlugin).not.toHaveBeenCalled();
    icon.release();
  });
});
