import { session } from 'electron';
import { randomUUID } from 'node:crypto';
import { desktopPrivateBridgeRequestHeaders, desktopRequestSourceScope, type DesktopSessionTransport } from '../../src/main/desktopSessionTransport';
import { createLocalNativeCodeSpaceRoute } from '../../src/main/codespaceNativeRoute';

/** Uses the production header policy and route with a real Chromium session. */
export async function createFixtureBridgeSession(baseURL: string, token: string,
  kind: 'native_local_bridge' | 'placement_bridge' = 'native_local_bridge') {
  const partition = `codespace-bridge-${randomUUID()}`;
  const webSession = session.fromPartition(partition);
  await webSession.setProxy({ mode: 'direct' });
  const transport: DesktopSessionTransport = { kind, baseURL, allowedBaseURL: baseURL, entryURL: baseURL,
    displayURL: baseURL, partition, proxyPolicy: 'direct' };
  const startup = { local_ui_bridge_token: token };
  const observations: { type: string; source: boolean; authorized: boolean }[] = [];
  webSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = desktopPrivateBridgeRequestHeaders(transport, startup, details.url, details.requestHeaders,
      desktopRequestSourceScope(details, startup));
    observations.push({ type: details.resourceType, source: !!details.frame || details.initiatorOrigin !== undefined,
      authorized: headers['X-Redeven-Desktop-Bridge-Token'] === token });
    callback({ requestHeaders: headers });
  });
  return { webSession, transport, startup, observations,
    route: (signal: AbortSignal, codeSpaceID = 'native-smoke') => createLocalNativeCodeSpaceRoute({
      transport, startup, webSession, codeSpaceID, signal,
    }),
    dispose: () => webSession.webRequest.onBeforeSendHeaders(null),
  };
}
