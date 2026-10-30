import type { useFileBrowser, FileItem } from '@floegence/floe-webapp-core/file-browser';

export function showDirectoryMenu(browser: ReturnType<typeof useFileBrowser>, path: string, event: MouseEvent | KeyboardEvent, item?: FileItem) {
  event.preventDefault(); event.stopPropagation();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const pointer = event instanceof MouseEvent && event.type === 'contextmenu';
  const captured = item ? {...item, path} : undefined;
  browser.showContextMenu({
    x: pointer ? event.clientX : rect.left, y: pointer ? event.clientY : rect.bottom,
    items: captured ? [captured] : [], targetKind: captured ? 'item' : 'directory-background',
    source: captured ? 'tree' : 'background', directory: {path,item:captured},
  });
}
export function isMenuKey(event: KeyboardEvent) { return event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10'; }
