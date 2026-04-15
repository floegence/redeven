import {
  desktopWindowChromeCSSVariables as desktopWindowChromeCSSVariablesFromSnapshot,
  type DesktopWindowChromeMode,
  type DesktopWindowControlsSide,
  type DesktopWindowChromeSnapshot,
} from './windowChromeContract';

export const DESKTOP_TITLE_BAR_HEIGHT = 40;

export type DesktopTrafficLightPosition = Readonly<{
  x: number;
  y: number;
}>;

export type DesktopWindowChromeConfig = Readonly<{
  mode: DesktopWindowChromeMode;
  controlsSide: DesktopWindowControlsSide;
  titleBarHeight: number;
  contentInsetStart: number;
  contentInsetEnd: number;
  trafficLightPosition?: DesktopTrafficLightPosition;
}>;

const DARWIN_CHROME_CONFIG: DesktopWindowChromeConfig = {
  mode: 'hidden-inset',
  controlsSide: 'left',
  titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
  contentInsetStart: 84,
  contentInsetEnd: 16,
  trafficLightPosition: { x: 14, y: 12 },
};

const WIN32_CHROME_CONFIG: DesktopWindowChromeConfig = {
  mode: 'overlay',
  controlsSide: 'right',
  titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
  contentInsetStart: 16,
  contentInsetEnd: 144,
};

const LINUX_CHROME_CONFIG: DesktopWindowChromeConfig = {
  mode: 'overlay',
  controlsSide: 'right',
  titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
  contentInsetStart: 16,
  contentInsetEnd: 136,
};

export function resolveDesktopWindowChromeConfig(
  platform: NodeJS.Platform = process.platform,
): DesktopWindowChromeConfig {
  switch (platform) {
    case 'darwin':
      return DARWIN_CHROME_CONFIG;
    case 'win32':
      return WIN32_CHROME_CONFIG;
    case 'linux':
    default:
      return LINUX_CHROME_CONFIG;
  }
}

export function resolveDesktopWindowChromeSnapshot(
  platform: NodeJS.Platform = process.platform,
): DesktopWindowChromeSnapshot {
  const config = resolveDesktopWindowChromeConfig(platform);
  return {
    mode: config.mode,
    controlsSide: config.controlsSide,
    titleBarHeight: config.titleBarHeight,
    contentInsetStart: config.contentInsetStart,
    contentInsetEnd: config.contentInsetEnd,
  };
}

export function usesDesktopWindowThemeOverlay(platform: NodeJS.Platform = process.platform): boolean {
  return resolveDesktopWindowChromeConfig(platform).mode === 'overlay';
}

export function desktopWindowTitleBarInsetCSSValue(platform: NodeJS.Platform = process.platform): string {
  const config = resolveDesktopWindowChromeConfig(platform);
  if (config.mode === 'overlay') {
    return `env(titlebar-area-height, ${config.titleBarHeight}px)`;
  }
  return `${config.titleBarHeight}px`;
}

export function desktopWindowChromeCSSVariables(
  platform: NodeJS.Platform = process.platform,
): Readonly<Record<string, string>> {
  return desktopWindowChromeCSSVariablesFromSnapshot(resolveDesktopWindowChromeSnapshot(platform));
}
