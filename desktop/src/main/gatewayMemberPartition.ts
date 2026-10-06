import { app, type Session } from 'electron';
import crypto from 'node:crypto';
import type { GatewayMemberTransport } from './gatewayMemberTransport';

const gatewayMemberCredentials = new Map<number, { token: string; partitions: Set<Session> }>();
app.on('login', (event, webContents, _request, authInfo, callback) => {
  const credentials = authInfo.isProxy && authInfo.host === '127.0.0.1'
    ? gatewayMemberCredentials.get(authInfo.port) : undefined;
  if (!credentials || (webContents && !credentials.partitions.has(webContents.session))) return;
  event.preventDefault();
  callback('redeven', credentials.token);
});

export async function prepareGatewayMemberPartition(webSession: Session, proxy: GatewayMemberTransport): Promise<void> {
  const port = Number(new URL(proxy.proxyURL).port);
  let credentials = gatewayMemberCredentials.get(port);
  if (!credentials) { credentials = { token: proxy.token, partitions: new Set() }; gatewayMemberCredentials.set(port, credentials); }
  credentials.partitions.add(webSession);
  webSession.setCertificateVerifyProc((request, callback) => {
    try {
      const expected = proxy.service;
      const certificate = new crypto.X509Certificate(request.certificate.data);
      const fingerprint = crypto.createHash('sha256').update(certificate.raw).digest('hex');
      callback(request.hostname === new URL(expected.origin).hostname
        && fingerprint === expected.certificate_sha256 && expected.expires_at_unix_ms > Date.now() ? 0 : -2);
    } catch { callback(-2); }
  });
  await webSession.setProxy({ mode: 'fixed_servers', proxyRules: proxy.proxyURL, proxyBypassRules: '<-loopback>' });
  await webSession.closeAllConnections();
}

export function clearGatewayMemberPartition(webSession: Session): void {
  let owned = false;
  for (const credentials of gatewayMemberCredentials.values()) {
    if (credentials.partitions.delete(webSession)) owned = true;
  }
  if (!owned) return;
  webSession.setCertificateVerifyProc(null);
  void Promise.all([webSession.closeAllConnections(), webSession.clearAuthCache()]).catch(() => undefined);
}

export async function closeGatewayMemberTransport(transport: GatewayMemberTransport): Promise<void> {
  const port = Number(new URL(transport.proxyURL).port);
  const credentials = gatewayMemberCredentials.get(port);
  for (const webSession of credentials?.partitions ?? []) clearGatewayMemberPartition(webSession);
  gatewayMemberCredentials.delete(port);
  await transport.close();
}
