import type { MenuItemConstructorOptions } from 'electron';

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

function buildWindowMenu(platform: NodeJS.Platform): MenuItemConstructorOptions {
  if (platform === 'darwin') {
    return {
      role: 'windowMenu',
    };
  }

  return {
    label: 'Window',
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
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions = platform === 'darwin'
    ? {
        label: 'Redeven Desktop',
        submenu: [
          { label: 'Connect Environment...', accelerator: 'CommandOrControl+Shift+O', click: actions.openConnectionCenter },
          { type: 'separator' },
          { label: 'Hide Redeven Desktop', role: 'hide' },
          { label: 'Hide Others', role: 'hideOthers' },
          { label: 'Show All', role: 'unhide' },
          { type: 'separator' },
          { label: 'Quit Redeven Desktop', accelerator: 'CommandOrControl+Q', click: actions.requestQuit },
        ],
      }
    : {
        label: 'File',
        submenu: [
          { label: 'Connect Environment...', accelerator: 'CommandOrControl+Shift+O', click: actions.openConnectionCenter },
          { type: 'separator' },
          { label: 'Quit Redeven Desktop', accelerator: 'CommandOrControl+Q', click: actions.requestQuit },
        ],
      };

  return [
    appMenu,
    {
      label: 'Edit',
      submenu: buildEditSubmenu(platform),
    },
    {
      label: 'View',
      submenu: buildViewSubmenu(),
    },
    buildWindowMenu(platform),
  ];
}
