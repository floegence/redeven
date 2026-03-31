import type { MenuItemConstructorOptions } from 'electron';

export type AppMenuActions = Readonly<{
  openConnectionCenter: () => void;
  openAdvancedSettings: () => void;
  requestQuit: () => void;
}>;

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
          { label: 'Switch Device...', accelerator: 'CommandOrControl+Shift+O', click: actions.openConnectionCenter },
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
          { label: 'Switch Device...', accelerator: 'CommandOrControl+Shift+O', click: actions.openConnectionCenter },
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
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];
}
