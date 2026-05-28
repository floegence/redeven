import { Globe } from '@floegence/floe-webapp-core/icons';

export type DesktopShellCommandPaletteActions = Readonly<{
  openEnvironmentLauncher: () => Promise<void>;
  labels?: Readonly<{
    category: string;
    title: string;
    description: string;
  }>;
}>;

export function buildDesktopShellCommandPaletteEntries(actions: DesktopShellCommandPaletteActions) {
  return [
    {
      id: 'redeven.desktop.openEnvironment',
      title: actions.labels?.title ?? 'Open Environment...',
      description: actions.labels?.description ?? 'Open the desktop environment launcher.',
      category: actions.labels?.category ?? 'Desktop',
      icon: Globe,
      execute: actions.openEnvironmentLauncher,
    },
  ] as const;
}
