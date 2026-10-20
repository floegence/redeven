// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { filesystemPickerEnUS } from '../../../../../flower_ui/src/i18n/filesystemPickerMessages';
import { DirectoryFavoritesSection } from './DirectoryFavoritesSection';

describe('directory favorites sidebar', () => {
  it('tracks keyboard targets when filtering retained rows and inserting a new favorite', () => {
    const [paths, setPaths] = createSignal<readonly string[]>(['/a', '/beta', '/beta-two', '/c', '/d', '/e']);
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <DirectoryFavoritesSection
      favorites={{ get paths() { return paths(); } }} copy={{ ...filesystemPickerEnUS, selectedCount: (count) => `Selected: ${count}` }}
      onNavigate={vi.fn()} onContextMenu={vi.fn()} />, host);
    try {
      const filter = host.querySelector<HTMLInputElement>('input')!;
      filter.value = 'beta'; filter.dispatchEvent(new Event('input', { bubbles: true }));
      const beta = host.querySelector<HTMLButtonElement>('[aria-label="/beta"]')!;
      beta.focus(); beta.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(host.querySelector('[aria-label="/beta-two"]'));
      filter.value = ''; filter.dispatchEvent(new Event('input', { bubbles: true }));
      setPaths(['/first', ...paths()]);
      const first = host.querySelector<HTMLButtonElement>('[aria-label="/first"]')!;
      first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(host.querySelector('[aria-label="/a"]'));
    } finally { dispose(); host.remove(); }
  });
});
