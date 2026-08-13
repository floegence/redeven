// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { PluginIcon } from './PluginPresentationPrimitives';
import type { PluginInventoryItem } from './pluginTypes';

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
      iconURL: 'blob:redeven-installed-icon',
      iconFallback: 'generic',
      category: 'infrastructure',
      searchKeywords: [],
      publisher: 'Redeven',
      lifecycleState: 'enabled',
      trustBadge: 'official',
      pinned: false,
    };

    dispose = render(() => <PluginIcon item={item} />, root);

    expect(root.querySelector('img')?.getAttribute('src')).toBe(item.iconURL);
    expect(root.querySelector('svg')).toBeNull();
    expect(root.querySelector('img')?.className).not.toContain('opacity-0');
  });
});
