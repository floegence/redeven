// Interaction mode is independent of local content width and the last input event.
export const REDEVEN_BROWSER_MOBILE_QUERY = '(max-width: 767px) and (pointer: coarse) and (hover: none)';

export const ENVAPP_MOBILE_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

export function resolveTerminalSurfaceTouchAction(isMobile: boolean): string {
  return isMobile ? 'pan-x' : '';
}
