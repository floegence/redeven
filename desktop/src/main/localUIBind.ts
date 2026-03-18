import net from 'node:net';

export const DEFAULT_DESKTOP_LOCAL_UI_BIND = '127.0.0.1:0';

export type LocalUIBindFamily = 'ipv4' | 'ipv6';

export type LocalUIBindSpec = Readonly<{
  host: string;
  port: number;
  localhost: boolean;
  wildcard: boolean;
  loopback: boolean;
  family: LocalUIBindFamily;
}>;

function splitHostPort(raw: string): { host: string; port: string } {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new Error('missing host');
  }

  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']');
    if (closingBracket <= 1 || closingBracket === value.length - 1 || value[closingBracket + 1] !== ':') {
      throw new Error('want host:port');
    }
    return {
      host: value.slice(1, closingBracket),
      port: value.slice(closingBracket + 2),
    };
  }

  const separator = value.lastIndexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('want host:port');
  }
  if (value.includes(':', separator + 1)) {
    throw new Error('want host:port');
  }
  return {
    host: value.slice(0, separator),
    port: value.slice(separator + 1),
  };
}

function isIPv4Loopback(host: string): boolean {
  return host === '127.0.0.1' || host.startsWith('127.');
}

function isIPv4Wildcard(host: string): boolean {
  return host === '0.0.0.0';
}

function normalizePort(raw: string): number {
  const port = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port "${raw}"`);
  }
  return port;
}

export function parseLocalUIBind(raw: string): LocalUIBindSpec {
  const value = String(raw ?? '').trim() || DEFAULT_DESKTOP_LOCAL_UI_BIND;
  const split = splitHostPort(value);
  const host = String(split.host ?? '').trim();
  if (!host) {
    throw new Error('missing host');
  }

  const port = normalizePort(split.port);
  if (host.toLowerCase() === 'localhost') {
    if (port === 0) {
      throw new Error('localhost:0 is not supported; use 127.0.0.1:0 or [::1]:0');
    }
    return {
      host: 'localhost',
      port,
      localhost: true,
      wildcard: false,
      loopback: true,
      family: 'ipv4',
    };
  }

  const ipFamily = net.isIP(host);
  if (ipFamily === 0) {
    throw new Error('host must be localhost or an IP literal');
  }

  return {
    host,
    port,
    localhost: false,
    wildcard: ipFamily === 4 ? isIPv4Wildcard(host) : host === '::',
    loopback: ipFamily === 4 ? isIPv4Loopback(host) : host === '::1',
    family: ipFamily === 4 ? 'ipv4' : 'ipv6',
  };
}

export function isLoopbackOnlyBind(bind: LocalUIBindSpec): boolean {
  return bind.localhost || bind.loopback;
}
