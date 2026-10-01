import { DESKTOP_TITLE_BAR_HEIGHT } from './windowChromePlatform';
import type { ForwardWindowPresentation } from './desktopShellWebServiceWindowIPC';

export const WEB_SERVICE_BROWSER_TOOLBAR_HEIGHT = 54;
export const WEB_SERVICE_BROWSER_CHROME_HEIGHT = DESKTOP_TITLE_BAR_HEIGHT + WEB_SERVICE_BROWSER_TOOLBAR_HEIGHT;

export function webServiceBrowserContentBounds(width: number, height: number, presentation: ForwardWindowPresentation = 'browser') {
  const chromeHeight = presentation !== 'browser' ? 0 : WEB_SERVICE_BROWSER_CHROME_HEIGHT;
  return {
    x: 0,
    y: chromeHeight,
    width: Math.max(1, width),
    height: Math.max(1, height - chromeHeight),
  };
}
