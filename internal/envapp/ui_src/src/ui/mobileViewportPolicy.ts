export const ENVAPP_MOBILE_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

export function resolveTerminalSurfaceTouchAction(isMobile: boolean): string {
  return isMobile ? 'pan-x' : '';
}
