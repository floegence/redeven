import { Globe, Settings } from '@floegence/floe-webapp-core/icons';

export type DesktopShellCommandPaletteActions = Readonly<{
  openConnectToRedeven: () => Promise<void>;
  openDesktopSettings: () => Promise<void>;
}>;

export function buildDesktopShellCommandPaletteEntries(actions: DesktopShellCommandPaletteActions) {
  return [
    {
      id: 'redeven.desktop.connectToRedeven',
      title: 'Connect to Redeven...',
      description: 'Open the Desktop target picker for This device or External Redeven.',
      category: 'Desktop',
      icon: Globe,
      execute: actions.openConnectToRedeven,
    },
    {
      id: 'redeven.desktop.openDesktopSettings',
      title: 'Open Desktop Settings...',
      description: 'Open the Desktop startup and bootstrap settings window.',
      category: 'Desktop',
      icon: Settings,
      execute: actions.openDesktopSettings,
    },
  ] as const;
}
