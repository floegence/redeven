import { DESKTOP_TITLE_BAR_HEIGHT } from './windowChromePlatform';

export const WEB_SERVICE_BROWSER_TOOLBAR_HEIGHT = 54;
export const WEB_SERVICE_BROWSER_CHROME_HEIGHT = DESKTOP_TITLE_BAR_HEIGHT + WEB_SERVICE_BROWSER_TOOLBAR_HEIGHT;

export function webServiceBrowserContentBounds(width: number, height: number) {
  return {
    x: 0,
    y: WEB_SERVICE_BROWSER_CHROME_HEIGHT,
    width: Math.max(1, width),
    height: Math.max(1, height - WEB_SERVICE_BROWSER_CHROME_HEIGHT),
  };
}
