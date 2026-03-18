import type { MenuItemConstructorOptions } from 'electron';

export type AppMenuActions = Readonly<{
  openSettings: () => void;
  requestQuit: () => void;
}>;

export function buildAppMenuTemplate(actions: AppMenuActions): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions = process.platform === 'darwin'
    ? {
        label: 'Redeven Desktop',
        submenu: [
          { label: 'Settings...', accelerator: 'CommandOrControl+,', click: actions.openSettings },
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
          { label: 'Settings...', accelerator: 'CommandOrControl+,', click: actions.openSettings },
          { type: 'separator' },
          { label: 'Quit Redeven Desktop', accelerator: 'CommandOrControl+Q', click: actions.requestQuit },
        ],
      };

  return [
    appMenu,
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];
}
