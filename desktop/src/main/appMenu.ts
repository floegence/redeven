import type { MenuItemConstructorOptions } from 'electron';

import type { DesktopI18n } from '../shared/i18n/desktopI18n';

export type AppMenuActions = Readonly<{
  openConnectionCenter: () => void;
  openAdvancedSettings: () => void;
  requestQuit: () => void;
}>;

function buildViewSubmenu(): MenuItemConstructorOptions[] {
  return [
    { role: 'togglefullscreen' },
  ];
}

function buildFileMenu(
  actions: AppMenuActions,
  i18n: DesktopI18n,
  platform: NodeJS.Platform,
): MenuItemConstructorOptions {
  if (platform === 'darwin') {
    return {
      label: i18n.t('nativeMenu.file'),
      submenu: [
        { label: i18n.t('nativeMenu.connectEnvironment'), accelerator: 'CommandOrControl+Shift+O', click: actions.openConnectionCenter },
        { type: 'separator' },
        { role: 'close' },
      ],
    };
  }

  return {
    label: i18n.t('nativeMenu.file'),
    submenu: [
      { label: i18n.t('nativeMenu.connectEnvironment'), accelerator: 'CommandOrControl+Shift+O', click: actions.openConnectionCenter },
      { type: 'separator' },
      { label: i18n.t('nativeMenu.quitDesktop'), accelerator: 'CommandOrControl+Q', click: actions.requestQuit },
    ],
  };
}

function buildWindowMenu(i18n: DesktopI18n, platform: NodeJS.Platform): MenuItemConstructorOptions {
  if (platform === 'darwin') {
    return {
      role: 'windowMenu',
    };
  }

  return {
    label: i18n.t('nativeMenu.window'),
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'close' },
    ],
  };
}

function buildEditSubmenu(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const commonItems: MenuItemConstructorOptions[] = [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
  ];

  if (platform === 'darwin') {
    return [
      ...commonItems,
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    ];
  }

  return [
    ...commonItems,
    { role: 'delete' },
    { type: 'separator' },
    { role: 'selectAll' },
  ];
}

export function buildAppMenuTemplate(
  actions: AppMenuActions,
  i18n: DesktopI18n,
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions | null = platform === 'darwin'
    ? {
        label: i18n.t('desktop.title'),
        submenu: [
          { label: i18n.t('nativeMenu.hideDesktop'), role: 'hide' },
          { label: i18n.t('nativeMenu.hideOthers'), role: 'hideOthers' },
          { label: i18n.t('nativeMenu.showAll'), role: 'unhide' },
          { type: 'separator' },
          { label: i18n.t('nativeMenu.quitDesktop'), accelerator: 'CommandOrControl+Q', click: actions.requestQuit },
        ],
      }
    : null;

  return [
    ...(appMenu ? [appMenu] : []),
    buildFileMenu(actions, i18n, platform),
    {
      label: i18n.t('nativeMenu.edit'),
      submenu: buildEditSubmenu(platform),
    },
    {
      label: i18n.t('nativeMenu.view'),
      submenu: buildViewSubmenu(),
    },
    buildWindowMenu(i18n, platform),
  ];
}
