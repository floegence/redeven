import net from 'node:net';
import tls from 'node:tls';
import type { Agent } from 'node:https';
import type { Duplex } from 'node:stream';
import type { Session } from 'electron';
import type { NativeCodeSpaceRoute } from './codespaceNativeGateway';
import type { DesktopSessionTransport } from './desktopSessionTransport';
import { desktopPrivateBridgeRequestHeaders } from './desktopSessionTransport';
import type { StartupReport } from './startup';
import { isLocalAccessCookieName } from './localAccessCookie';

/** Reuses the EnvironmentSession's selected listener, including placement's H2 bridge. */
export async function createLocalNativeCodeSpaceRoute(
  input: Readonly<{
    transport: DesktopSessionTransport;
    startup: StartupReport;
    webSession: Session;
    codeSpaceID: string;
    signal: AbortSignal;
    connectionAgent?: Agent;
  }>,
): Promise<NativeCodeSpaceRoute> {
  if (input.transport.kind === 'gateway_member' && !input.connectionAgent) throw new Error('codespace_member_transport_missing');
  const base = new URL(input.transport.baseURL);
  const host = base.hostname.startsWith('[') ? base.hostname.slice(1, -1) : base.hostname;
  const privateHeaders = desktopPrivateBridgeRequestHeaders(
    input.transport,
    input.startup,
    base.href,
    {},
  );
  const descriptor = new URL(
    `/api/local/codespaces/${encodeURIComponent(input.codeSpaceID)}`,
    base,
  );
  const response = await input.webSession.fetch(descriptor.href, {
    headers: privateHeaders as Record<string, string>,
    credentials: 'include',
    redirect: 'error',
    signal: input.signal,
  });
  if (!response.ok) throw new Error('codespace_unavailable');
  const payload = (await response.json()) as {
    ok?: boolean;
    data?: { instance_id?: string; access_cookie_name?: string };
  };
  const instance = payload.data?.instance_id;
  if (
    payload.ok !== true ||
    !instance ||
    !/^[a-zA-Z0-9_-]{16,128}$/u.test(instance) ||
    !isLocalAccessCookieName(payload.data?.access_cookie_name)
  )
    throw new Error('codespace_unavailable');
  const access = await input.webSession.cookies.get({
    url: base.href,
    name: payload.data.access_cookie_name,
  });
  input.signal.throwIfAborted();
  const lifetime = new AbortController();
  const sockets = new Set<Duplex>();
  const close = async () => {
    input.signal.removeEventListener('abort', abort);
    lifetime.abort();
    for (const socket of sockets) socket.destroy();
  };
  const abort = () => { void close(); };
  input.signal.addEventListener('abort', abort, { once: true });
  return {
    pathPrefix: `${descriptor.pathname}/${instance}`,
    authority: base.host,
    headers: {
      ...(privateHeaders as Record<string, string>),
      // Authenticate to the Runtime's actual origin. Its native editor handler
      // restores the separate Desktop presentation origin after authorization.
      origin: base.origin,
      ...(access.length ? { 'X-Redeven-Code-Access': access[0]!.value } : {}),
    },
    openConnection: async (requestedSignal) => {
      const signal = AbortSignal.any([lifetime.signal, input.signal, requestedSignal]);
      signal.throwIfAborted();
      // Track the socket during TLS negotiation too. Closing a route or aborting
      // a pending connection must settle the caller even before secureConnect.
      return new Promise<Duplex>((resolve, reject) => {
        let socket: Duplex | undefined;
        let settled = false;
        const event = base.protocol === 'https:' ? 'secureConnect' : 'connect';
        const cleanup = () => {
          signal.removeEventListener('abort', failed);
          socket?.removeListener(event, ready);
          socket?.removeListener('error', failed);
          socket?.removeListener('close', failed);
        };
        const failed = () => {
          if (settled) return;
          settled = true; cleanup(); socket?.destroy();
          reject(new Error(signal.aborted ? 'codespace_closed' : 'codespace_transport_unavailable'));
        };
        const ready = () => {
          if (signal.aborted) { failed(); return; }
          if (settled || !socket) return;
          settled = true; cleanup(); resolve(socket);
        };
        const created = (error: Error | null | undefined, stream?: Duplex) => {
          if (settled) { stream?.destroy(); return; }
          if (error || !stream) { stream?.destroy(); failed(); return; }
          socket = stream;
          sockets.add(socket);
          socket.once('close', () => sockets.delete(stream));
          socket.once('close', failed);
          socket.once('error', failed);
          socket.once(event, ready);
          if (signal.aborted || stream.destroyed) failed();
        };
        signal.addEventListener('abort', failed, { once: true });
        const options = { host, port: Number(base.port || (base.protocol === 'https:' ? 443 : 80)), signal };
        try {
          if (input.connectionAgent) {
            // The public Flowersec Agent owns the mandatory path and target TLS.
            input.connectionAgent.createConnection(options, created);
          } else {
            created(null, base.protocol === 'https:' ? tls.connect({
              ...options, servername: net.isIP(host) ? undefined : host,
              ca: [...tls.getCACertificates('default'), ...tls.getCACertificates('system')],
              rejectUnauthorized: true,
            }) : net.connect(options));
          }
        } catch { failed(); }
      });
    },
    close,
  };
}
