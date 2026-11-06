import { Menu, type BrowserWindow, type WebContents, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron';
import { createDesktopI18n } from '../shared/i18n/desktopI18n';
import type { RedevenLocale } from '../shared/i18n/localeMeta';

/** Native editing preserves Chromium selection, undo and rich clipboard paste. */
export function desktopEditMenuItems(params: Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags'>, locale: RedevenLocale): MenuItemConstructorOptions[] {
  const i18n = createDesktopI18n(locale);
  const item = (role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll', enabled: boolean): MenuItemConstructorOptions => ({
    role, label: i18n.t(`editContextMenu.${role}`), enabled,
  });
  const flags = params.editFlags;
  if (params.isEditable) return [
    item('undo', flags.canUndo), item('redo', flags.canRedo), { type: 'separator' },
    item('cut', flags.canCut), item('copy', flags.canCopy), item('paste', flags.canPaste),
    { type: 'separator' }, item('selectAll', flags.canSelectAll),
  ];
  return params.selectionText ? [item('copy', flags.canCopy)] : [];
}

/** Renderer-owned menus preventDefault; only unhandled native requests arrive here. */
export function attachDesktopEditContextMenu(window: BrowserWindow, locale: () => RedevenLocale, options?: {
  contents?: WebContents;
  actions?: (params: ContextMenuParams) => MenuItemConstructorOptions[];
}): void {
  const contents = options?.contents ?? window.webContents;
  let active: Menu | undefined;
  const close = () => { active?.closePopup(window); active = undefined; };
  contents.on('context-menu', (_event, params) => {
    const extras = options?.actions?.(params) ?? [];
    const editing = desktopEditMenuItems(params, locale());
    const items = [...extras, ...(extras.length && editing.length ? [{ type: 'separator' as const }] : []), ...editing];
    close();
    if (!items.length || window.isDestroyed() || contents.isDestroyed()) return;
    const menu = Menu.buildFromTemplate(items);
    active = menu;
    menu.popup({ window, frame: params.frame ?? undefined, x: params.x, y: params.y, sourceType: params.menuSourceType,
      callback: () => { if (active === menu) active = undefined; },
    });
  });
  contents.on('did-start-navigation', close);
  window.on('close', close);
}
