export const LINUX_TITLE_BAR_OVERLAY_HEIGHT = 40;

export function usesDesktopWindowThemeOverlay(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux';
}

export function desktopWindowTitleBarInsetCSSValue(platform: NodeJS.Platform = process.platform): string {
  return usesDesktopWindowThemeOverlay(platform) ? 'env(titlebar-area-height, 0px)' : '0px';
}
