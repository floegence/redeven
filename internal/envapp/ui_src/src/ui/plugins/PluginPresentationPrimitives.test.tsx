// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginIcon } from './PluginPresentationPrimitives';
import type { PluginInventoryItem } from './pluginTypes';

const iconLoaderMocks = vi.hoisted(() => ({
  acquireCachedPluginIcon: vi.fn(),
  loadPluginIcon: vi.fn(),
}));

vi.mock('./pluginIconLoader', () => iconLoaderMocks);

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

describe('PluginIcon', () => {
  it('renders a preloaded installed icon on the first frame without a fallback', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const item: PluginInventoryItem = {
      inventoryKey: 'instance:containers',
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'containers',
      displayName: 'Containers',
      description: 'Containers',
      iconURL: '/_redevplugin/api/plugins/containers/icon/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      iconFallback: 'generic',
      category: 'infrastructure',
      searchKeywords: [],
      publisher: 'Redeven',
      lifecycleState: 'enabled',
      trustBadge: 'official',
      pinned: false,
    };

    iconLoaderMocks.acquireCachedPluginIcon.mockReturnValue({ url: 'blob:redeven-installed-icon', release: vi.fn() });
    dispose = render(() => <PluginIcon item={item} />, root);

    expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:redeven-installed-icon');
    expect(root.querySelector('svg')).toBeNull();
    expect(root.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a real icon placeholder while a network request is in flight', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const item: PluginInventoryItem = {
      inventoryKey: 'instance:containers',
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'containers',
      displayName: 'Containers',
      description: 'Containers',
      iconURL: '/_redeven_proxy/api/plugins/market/plugins/com.redeven.official.containers/icon?sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      iconFallback: 'generic',
      category: 'infrastructure',
      searchKeywords: [],
      publisher: 'Redeven',
      lifecycleState: 'enabled',
      trustBadge: 'official',
      pinned: false,
    };
    iconLoaderMocks.acquireCachedPluginIcon.mockReturnValue(undefined);
    iconLoaderMocks.loadPluginIcon.mockReturnValue(new Promise<string>(() => {}));

    dispose = render(() => <PluginIcon item={item} />, root);

    expect(root.querySelector('svg')).toBeNull();
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows the fallback only after icon loading fails', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const item: PluginInventoryItem = {
      inventoryKey: 'instance:containers',
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'containers',
      displayName: 'Containers',
      description: 'Containers',
      iconURL: '/_redeven_proxy/api/plugins/market/plugins/com.redeven.official.containers/icon?sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      iconFallback: 'generic',
      category: 'infrastructure',
      searchKeywords: [],
      publisher: 'Redeven',
      lifecycleState: 'enabled',
      trustBadge: 'official',
      pinned: false,
    };
    iconLoaderMocks.acquireCachedPluginIcon.mockReturnValue(undefined);
    iconLoaderMocks.loadPluginIcon.mockRejectedValue(new Error('not found'));

    dispose = render(() => <PluginIcon item={item} />, root);
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector('svg')).not.toBeNull();
    expect(root.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
