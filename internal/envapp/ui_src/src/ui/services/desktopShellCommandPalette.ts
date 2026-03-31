import { Globe } from '@floegence/floe-webapp-core/icons';

export type DesktopShellCommandPaletteActions = Readonly<{
  openDeviceChooser: () => Promise<void>;
}>;

export function buildDesktopShellCommandPaletteEntries(actions: DesktopShellCommandPaletteActions) {
  return [
    {
      id: 'redeven.desktop.switchDevice',
      title: 'Switch Device...',
      description: 'Choose This device or another Redeven device from the desktop shell.',
      category: 'Desktop',
      icon: Globe,
      execute: actions.openDeviceChooser,
    },
  ] as const;
}
