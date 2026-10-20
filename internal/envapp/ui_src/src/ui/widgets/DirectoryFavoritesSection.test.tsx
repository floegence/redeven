// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { filesystemPickerEnUS } from '../../../../../flower_ui/src/i18n/filesystemPickerMessages';
import { DirectoryFavoritesSection } from './DirectoryFavoritesSection';

describe('directory favorites sidebar', () => {
  it.each(['/', '/JianDisk', '/Volumes/团队磁盘/项目 文件'])('keeps the complete path identity for %s', path => {
    const host = document.createElement('div');
    const dispose = render(() => <DirectoryFavoritesSection favorites={{ paths: [path] }}
      copy={{ ...filesystemPickerEnUS, selectedCount: (count) => `Selected: ${count}` }}
      onNavigate={vi.fn()} onContextMenu={vi.fn()} />, host);
    try {
      const row = host.querySelector('button')!;
      expect(row.textContent).toBe(path);
      expect(row.getAttribute('aria-label')).toBe(path);
      expect(row.querySelector('[data-directory-favorite-name]')?.textContent).toBe(path.slice(path.lastIndexOf('/')));
    } finally { dispose(); }
  });

  it('uses a compact path row with a full-path tooltip and a separate menu action', () => {
    const path = '/Volumes/JianDisk';
    const navigate = vi.fn();
    const contextMenu = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <DirectoryFavoritesSection
      favorites={{ paths: [path] }} copy={{ ...filesystemPickerEnUS, selectedCount: (count) => `Selected: ${count}` }}
      onNavigate={navigate} onContextMenu={contextMenu} />, host);
    try {
      const row = host.querySelector<HTMLButtonElement>('[aria-label="/Volumes/JianDisk"]')!;
      expect(row.textContent).toBe(path);
      expect(row.querySelector('[data-directory-favorite-parent]')?.textContent).toBe('/Volumes');
      expect(row.querySelector('[data-directory-favorite-name]')?.textContent).toBe('/JianDisk');
      expect(host.querySelector('[data-redeven-tooltip-anchor]')).not.toBeNull();
      expect(host.textContent).not.toContain('Favorites');
      const menu = host.querySelector<HTMLButtonElement>('[data-directory-favorite-menu]')!;
      expect(menu).not.toBeNull();
      menu.click();
      expect(contextMenu).toHaveBeenCalledWith(expect.any(MouseEvent), path);
      expect(navigate).not.toHaveBeenCalled();
      row.click();
      expect(navigate).toHaveBeenCalledWith(path);
    } finally { dispose(); host.remove(); }
  });

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
