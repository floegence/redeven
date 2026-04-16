import {
  desktopWindowChromeCSSVariables as desktopWindowChromeCSSVariablesFromSnapshot,
  type DesktopWindowChromeMode,
  type DesktopWindowControlsSide,
  type DesktopWindowChromeSnapshot,
} from './windowChromeContract';

export const DESKTOP_TITLE_BAR_HEIGHT = 40;
export const DESKTOP_WINDOW_EDGE_INSET = 16;

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

export type DesktopWindowChromeState = Readonly<{
  fullScreen?: boolean;
}>;

const DARWIN_CHROME_CONFIG: DesktopWindowChromeConfig = {
  mode: 'hidden-inset',
  controlsSide: 'left',
  titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
  contentInsetStart: 84,
  contentInsetEnd: DESKTOP_WINDOW_EDGE_INSET,
  trafficLightPosition: { x: 14, y: 12 },
};

const DARWIN_FULLSCREEN_CHROME_CONFIG: DesktopWindowChromeConfig = {
  mode: 'hidden-inset',
  controlsSide: 'left',
  titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
  contentInsetStart: DESKTOP_WINDOW_EDGE_INSET,
  contentInsetEnd: DESKTOP_WINDOW_EDGE_INSET,
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
  state: DesktopWindowChromeState = {},
): DesktopWindowChromeConfig {
  switch (platform) {
    case 'darwin':
      return state.fullScreen === true ? DARWIN_FULLSCREEN_CHROME_CONFIG : DARWIN_CHROME_CONFIG;
    case 'win32':
      return WIN32_CHROME_CONFIG;
    case 'linux':
    default:
      return LINUX_CHROME_CONFIG;
  }
}

export function resolveDesktopWindowChromeSnapshot(
  platform: NodeJS.Platform = process.platform,
  state: DesktopWindowChromeState = {},
): DesktopWindowChromeSnapshot {
  const config = resolveDesktopWindowChromeConfig(platform, state);
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
  state: DesktopWindowChromeState = {},
): Readonly<Record<string, string>> {
  return desktopWindowChromeCSSVariablesFromSnapshot(resolveDesktopWindowChromeSnapshot(platform, state));
}
