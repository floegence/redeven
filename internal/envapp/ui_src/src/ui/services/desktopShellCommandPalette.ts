import { Globe, Settings } from '@floegence/floe-webapp-core/icons';

export type DesktopShellCommandPaletteActions = Readonly<{
  openConnectionCenter: () => Promise<void>;
  openAdvancedSettings: () => Promise<void>;
}>;

export function buildDesktopShellCommandPaletteEntries(actions: DesktopShellCommandPaletteActions) {
  return [
    {
      id: 'redeven.desktop.openConnectionCenter',
      title: 'Open Connection Center...',
      description: 'Open, share, or link This device, or switch Desktop to another Redeven device.',
      category: 'Desktop',
      icon: Globe,
      execute: actions.openConnectionCenter,
    },
    {
      id: 'redeven.desktop.openAdvancedSettings',
      title: 'Open Advanced Settings...',
      description: 'Open the raw Desktop startup, access, and one-shot bootstrap inputs.',
      category: 'Desktop',
      icon: Settings,
      execute: actions.openAdvancedSettings,
    },
  ] as const;
}
