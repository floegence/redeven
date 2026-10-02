import { getEnvPublicIDFromSession, mintEnvEntryTicketForApp, type LocalRuntimeInfo } from './controlplaneApi';
import type { DesktopSessionContextSnapshot } from './desktopSessionContext';
import { FLOE_APP_PORT_FORWARD } from './floeproxyContract';
import { fetchLocalApiJSON } from './localApi';
import { trustedLauncherOriginFromSandboxLocation } from './sandboxOrigins';
import { registerSandboxWindow } from './sandboxWindowRegistry';
import { openWebServiceWindowInDesktopShell } from './desktopShellBridge';
import type { ForwardWindowPresentation } from '../../../../../../desktop/src/shared/desktopShellWebServiceWindowIPC';
type WebServiceAccessMode = 'unified_proxy' | 'desktop_loopback';

export type WebServiceOpenRoute =
  | Readonly<{ kind: 'local_proxy'; url: string; label: 'Local proxy' }>
  | Readonly<{ kind: 'e2ee_tunnel'; forward_id: string; label: 'Secure tunnel' }>;

type BrowserLocationLike = Pick<Location, 'hostname' | 'href' | 'origin'>;

function portForwardOrigin(forwardID: string): string {
  return trustedLauncherOriginFromSandboxLocation(window.location, 'pf', forwardID);
}

function base64UrlEncode(raw: string): string {
  const b64 = btoa(raw);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}


function normalizeAppPath(value: string | undefined): string {
  const raw = compact(value) || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function localWebServiceProxyURL(
  forwardID: string,
  appPath: string,
  locationLike: BrowserLocationLike,
  desktopPrivateBridge: boolean,
): string {
  const navigation = new URL(normalizeAppPath(appPath), 'http://redeven.invalid');
  const base = new URL(locationLike.origin || locationLike.href);
  if (desktopPrivateBridge) {
    base.hostname = `pf-${forwardID}.localhost`;
    base.pathname = navigation.pathname;
  } else {
    base.pathname = `/pf/${encodeURIComponent(forwardID)}/${navigation.pathname.replace(/^\//u, '')}`;
  }
  base.search = navigation.search;
  base.hash = navigation.hash;
  return base.toString();
}

export function resolveWebServiceOpenRoute(args: Readonly<{
  forwardID: string;
  localRuntime: LocalRuntimeInfo | null;
  desktopContext?: DesktopSessionContextSnapshot | null;
  browserLocation?: BrowserLocationLike;
  appPath?: string;
  desktopWindowAvailable?: boolean;
  presentation?: ForwardWindowPresentation;
}>): WebServiceOpenRoute {
  const forwardID = compact(args.forwardID);
  if (!args.localRuntime) {
    return { kind: 'e2ee_tunnel', forward_id: forwardID, label: 'Secure tunnel' };
  }

  const locationLike = args.browserLocation ?? window.location;
  const desktopPrivateBridge = args.presentation !== 'application' && args.presentation !== 'desktop'
    && args.desktopWindowAvailable === true
    && args.desktopContext?.document_transport === 'desktop_private_bridge_v2';

  return {
    kind: 'local_proxy',
    url: localWebServiceProxyURL(
      forwardID,
      normalizeAppPath(args.appPath),
      locationLike,
      desktopPrivateBridge,
    ),
    label: 'Local proxy',
  };
}


type OpenWebServiceCopy = Readonly<{
  missingEnvContext: string;
  opening: string;
  openingLocalProxy: string;
  requestingEntryTicket: string;
  updating: string;
  desktopWindowFailed: string;
  popupBlocked: string;
}>;

async function touchWebService(forwardID: string, setStatus: (s: string) => void, copy: Pick<OpenWebServiceCopy, 'updating'>): Promise<void> {
  setStatus(copy.updating);
  await fetchLocalApiJSON(`/_redeven_proxy/api/forwards/${encodeURIComponent(forwardID)}/touch`, { method: 'POST' });
}

async function preparePortForwardTunnel(
  forwardID: string,
  appPath: string,
  setStatus: (s: string) => void,
  copy: OpenWebServiceCopy,
): Promise<Readonly<{ origin: string; url: string }>> {
  const envPublicID = getEnvPublicIDFromSession();
  if (!envPublicID) throw new Error(copy.missingEnvContext);

  const origin = portForwardOrigin(forwardID);
  const bootURL = `${origin}/_redeven_boot/?env=${encodeURIComponent(envPublicID)}`;

  await touchWebService(forwardID, setStatus, copy);
  setStatus(copy.requestingEntryTicket);
  const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp: FLOE_APP_PORT_FORWARD, codeSpaceId: forwardID });
  const init = {
    v: 2,
    env_public_id: envPublicID,
    floe_app: FLOE_APP_PORT_FORWARD,
    code_space_id: forwardID,
    app_path: normalizeAppPath(appPath),
    entry_ticket: entryTicket,
  };
  return { origin, url: `${bootURL}#redeven=${base64UrlEncode(JSON.stringify(init))}` };
}

export async function openWebServiceRoute(
  route: WebServiceOpenRoute,
  forwardID: string,
  serviceTargetURL: string,
  accessMode: WebServiceAccessMode,
  appPath: string,
  useDesktopWindow: boolean,
  setStatus: (s: string) => void,
  copy: OpenWebServiceCopy,
  win?: Window | null,
  presentation: ForwardWindowPresentation = 'browser',
  preparationID?: string,
): Promise<void> {
  let browserTargetURL: string;
  if (route.kind === 'e2ee_tunnel') {
    const prepared = await preparePortForwardTunnel(forwardID, appPath, setStatus, copy);
    browserTargetURL = prepared.url;
    if (win) registerSandboxWindow(win, { origin: prepared.origin, floe_app: FLOE_APP_PORT_FORWARD, code_space_id: forwardID, app_path: normalizeAppPath(appPath) });
  } else {
    await touchWebService(forwardID, setStatus, copy);
    setStatus(copy.openingLocalProxy);
    browserTargetURL = route.url;
  }

  if (useDesktopWindow) {
    setStatus(copy.opening);
    const response = await openWebServiceWindowInDesktopShell({
      url: browserTargetURL,
      forward_id: forwardID,
      target_url: serviceTargetURL,
      access_mode: accessMode,
      presentation,
      ...(preparationID ? { preparation_id: preparationID } : {}),
    });
    if (!response?.ok) throw new Error(response?.message || copy.desktopWindowFailed);
    return;
  }
  if (!win) throw new Error(copy.popupBlocked);
  win.location.assign(browserTargetURL);
}
