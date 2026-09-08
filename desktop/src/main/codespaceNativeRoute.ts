import net from 'node:net';
import tls from 'node:tls';
import type { Duplex } from 'node:stream';
import type { Session } from 'electron';
import type { NativeCodeSpaceRoute } from './codespaceNativeGateway';
import type { DesktopSessionTransport } from './desktopSessionTransport';
import { desktopPrivateBridgeRequestHeaders } from './desktopSessionTransport';
import type { StartupReport } from './startup';

/** Reuses the EnvironmentSession's selected listener, including placement's H2 bridge. */
export async function createLocalNativeCodeSpaceRoute(
  input: Readonly<{
    transport: DesktopSessionTransport;
    startup: StartupReport;
    webSession: Session;
    codeSpaceID: string;
    signal: AbortSignal;
  }>,
): Promise<NativeCodeSpaceRoute> {
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
    data?: { instance_id?: string };
  };
  const instance = payload.data?.instance_id;
  if (
    payload.ok !== true ||
    !instance ||
    !/^[a-zA-Z0-9_-]{16,128}$/u.test(instance)
  )
    throw new Error('codespace_unavailable');
  const access = await input.webSession.cookies.get({
    url: base.href,
    name: 'redeven_local_access',
  });
  const sockets = new Set<Duplex>();
  let closed = false;
  return {
    pathPrefix: `${descriptor.pathname}/${instance}`,
    authority: base.host,
    headers: {
      ...(privateHeaders as Record<string, string>),
      ...(access.length ? { 'X-Redeven-Code-Access': access[0]!.value } : {}),
    },
    openConnection: async (signal) => {
      if (closed) throw new Error('codespace_closed');
      const options = {
        host,
        port: Number(base.port || (base.protocol === 'https:' ? 443 : 80)),
        signal,
      };
      const socket =
        base.protocol === 'https:'
          ? tls.connect({
              ...options,
              servername: net.isIP(host) ? undefined : host,
              ca: [
                ...tls.getCACertificates('default'),
                ...tls.getCACertificates('system'),
              ],
              rejectUnauthorized: true,
            })
          : net.connect(options);
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      await new Promise<void>((resolve, reject) => {
        const ready = (): void => {
          socket.removeListener('error', failed);
          resolve();
        };
        const failed = (): void => {
          socket.removeListener(
            base.protocol === 'https:' ? 'secureConnect' : 'connect',
            ready,
          );
          reject(new Error('codespace_transport_unavailable'));
        };
        socket.once(
          base.protocol === 'https:' ? 'secureConnect' : 'connect',
          ready,
        );
        socket.once('error', failed);
      });
      return socket;
    },
    close: async () => {
      closed = true;
      for (const socket of sockets) socket.destroy();
    },
  };
}
