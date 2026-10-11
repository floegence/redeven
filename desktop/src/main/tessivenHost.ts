import WebSocket from 'ws';
import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import {
  RuntimeControlError,
  runtimeControlServiceURL,
} from './runtimeControlClient';

export type HostMessage = {
  kind: 'resource' | 'runtime';
  id: string;
  scope: { user_public_id: string; floe_app: string };
  request: { runtime_ref: string; action: string; [key: string]: unknown };
  permissions: {
    read: boolean;
    write: boolean;
    execute: boolean;
    admin: boolean;
  };
};
export type TessivenHost = {
  ready: Promise<void>;
  source: () => string;
  active: () => boolean;
  close: () => void;
};

// A connection carries only typed Tessiven requests. It cannot request an
// arbitrary URL, shell command, new target connection, or credential.
export function connectTessivenHost(
  endpoint: DesktopRuntimeControlEndpoint,
  execute: (message: HostMessage, signal: AbortSignal) => Promise<unknown>,
): TessivenHost {
  const url = runtimeControlServiceURL(endpoint, 'v2/tessiven/host');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
    handshakeTimeout: 10000,
    maxPayload: 1 << 20,
    perMessageDeflate: false,
    agent: false,
  });
  let source = '';
  socket.once('upgrade', (response) => {
    source = String(response.headers['x-redeven-tessiven-source'] ?? '');
  });
  const controller = new AbortController();
  const inflight = new Set<string>();
  const ready = new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      if (/^[a-f0-9-]{72}$/.test(source)) resolve();
      else {
        reject(
          new Error('Update Runtime to support scoped Tessiven connections.'),
        );
        socket.close();
      }
    });
    socket.once('error', reject);
    socket.once('close', () =>
      reject(new Error('Tessiven host connection ended')),
    );
  });
  socket.on('error', () => controller.abort());
  socket.on('close', () => controller.abort());
  socket.on('message', (raw) => {
    let message: HostMessage;
    try {
      message = JSON.parse(raw.toString()) as HostMessage;
      if (
        !message ||
        typeof message.id !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(message.id) ||
        !message.request ||
        typeof message.request.runtime_ref !== 'string' ||
        !['resource', 'runtime'].includes(message.kind) ||
        !message.scope ||
        message.scope.user_public_id !== 'user_local' ||
        !['com.floegence.redeven.agent', 'com.floegence.redeven.code'].includes(
          message.scope.floe_app,
        ) ||
        !message.permissions ||
        !['read', 'write', 'execute', 'admin'].every(
          (key) =>
            typeof message.permissions[
              key as keyof HostMessage['permissions']
            ] === 'boolean',
        ) ||
        ![
          'list',
          'inspect',
          'logs',
          'operation',
          'open',
          'start',
          'stop',
          'restart',
          ...(message.kind === 'runtime'
            ? ['directory', 'connect', 'status', 'diagnose', 'update']
            : []),
        ].includes(message.request.action)
      )
        throw new Error('Invalid Tessiven host request');
      if (inflight.has(message.id) || inflight.size >= 32)
        throw new Error('Tessiven request capacity reached');
    } catch {
      socket.close(1008, 'Invalid Tessiven host request');
      return;
    }
    inflight.add(message.id);
    void execute(message, controller.signal)
      .then(
        (result) => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ id: message.id, result }));
        },
        (cause) => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                id: message.id,
                error:
                  cause instanceof RuntimeControlError
                    ? cause.message
                    : 'The connected target did not return a confirmed outcome.',
                ...(cause instanceof RuntimeControlError && cause.statusCode
                  ? { code: cause.code, status: cause.statusCode }
                  : {}),
              }),
            );
        },
      )
      .finally(() => inflight.delete(message.id));
  });
  return {
    ready,
    source: () => source,
    active: () =>
      !controller.signal.aborted &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING),
    close: () => {
      controller.abort();
      socket.close();
    },
  };
}
