import { Globe } from '@floegence/floe-webapp-core/icons';

export type DesktopShellCommandPaletteActions = Readonly<{
  openEnvironmentLauncher: () => Promise<void>;
}>;

export function buildDesktopShellCommandPaletteEntries(actions: DesktopShellCommandPaletteActions) {
  return [
    {
      id: 'redeven.desktop.openEnvironment',
      title: 'Open Environment...',
      description: 'Open the desktop environment launcher.',
      category: 'Desktop',
      icon: Globe,
      execute: actions.openEnvironmentLauncher,
    },
  ] as const;
}
