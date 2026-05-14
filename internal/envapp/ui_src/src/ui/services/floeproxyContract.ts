export const FLOE_APP_AGENT = 'com.floegence.redeven.agent';
export const FLOE_APP_CODE = 'com.floegence.redeven.code';
export const FLOE_APP_PORT_FORWARD = 'com.floegence.redeven.portforward';

export const CODE_SPACE_ID_ENV_UI = 'env-ui';

export const SESSION_KIND_ENVAPP_PROXY = 'envapp_proxy';
export const SESSION_KIND_ENVAPP_RPC = 'envapp_rpc';
export const SESSION_KIND_CODEAPP = 'codeapp';
export const SESSION_KIND_PORTFORWARD = 'portforward';

export type LauncherFloeApp = typeof FLOE_APP_CODE | typeof FLOE_APP_PORT_FORWARD;
export type LauncherSessionKind = typeof SESSION_KIND_CODEAPP | typeof SESSION_KIND_PORTFORWARD;

export function sessionKindForLauncherApp(floeApp: string): LauncherSessionKind {
  switch (String(floeApp ?? '').trim()) {
    case FLOE_APP_CODE:
      return SESSION_KIND_CODEAPP;
    case FLOE_APP_PORT_FORWARD:
      return SESSION_KIND_PORTFORWARD;
    default:
      throw new Error('Unsupported floe_app');
  }
}

export function isEnvAppTarget(floeApp: string, codeSpaceId: string): boolean {
  return String(floeApp ?? '').trim() === FLOE_APP_AGENT && String(codeSpaceId ?? '').trim() === CODE_SPACE_ID_ENV_UI;
}

export function isInternalEnvAppSessionKind(sessionKind: string | null | undefined): boolean {
  switch (String(sessionKind ?? '').trim()) {
    case SESSION_KIND_ENVAPP_RPC:
    case SESSION_KIND_ENVAPP_PROXY:
      return true;
    default:
      return false;
  }
}
