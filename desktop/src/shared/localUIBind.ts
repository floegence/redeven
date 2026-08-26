export const DEFAULT_DESKTOP_LOCAL_UI_BIND = 'localhost:23998';

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

function normalizePort(raw: string): number {
  const value = String(raw ?? '').trim();
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`invalid port "${raw}"`);
  }
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || String(port) !== value) {
    throw new Error(`invalid port "${raw}"`);
  }
  return port;
}

function canonicalIPv4(host: string): string {
  const parts = host.split('.');
  if (parts.length !== 4) {
    throw new Error('host must be a canonical IPv4 or IPv6 literal');
  }
  const values = parts.map((part) => {
    if (!/^(0|[1-9][0-9]*)$/.test(part)) {
      throw new Error('host must be a canonical IPv4 or IPv6 literal');
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255 || String(value) !== part) {
      throw new Error('host must be a canonical IPv4 or IPv6 literal');
    }
    return value;
  });
  return values.join('.');
}

function canonicalIPv6(host: string): string {
  if (!host.includes(':') || host.includes('%')) {
    throw new Error('host must be a canonical IPv4 or IPv6 literal without a zone');
  }
  let normalized = '';
  try {
    const parsedHost = new URL(`http://[${host}]/`).hostname;
    if (!parsedHost.startsWith('[') || !parsedHost.endsWith(']')) {
      throw new Error('not an IPv6 literal');
    }
    normalized = parsedHost.slice(1, -1).toLowerCase();
  } catch {
    throw new Error('host must be a canonical IPv4 or IPv6 literal');
  }
  if (normalized.startsWith('::ffff:')) {
    throw new Error('IPv4-mapped IPv6 hosts are not supported');
  }
  return normalized;
}

function isIPv4Loopback(host: string): boolean {
  return host === '127.0.0.1' || host.startsWith('127.');
}

function isEligibleIPv4NetworkHost(host: string): boolean {
  const [first, second, third, fourth] = host.split('.').map(Number);
  if (first === 0 || first === 127 || first >= 224 || (first === 169 && second === 254)) {
    return false;
  }
  return !(first === 255 && second === 255 && third === 255 && fourth === 255);
}

function isEligibleIPv6NetworkHost(host: string): boolean {
  const firstGroup = Number.parseInt(host.split(':', 1)[0] || '0', 16);
  return host !== '::'
    && host !== '::1'
    && !host.startsWith('ff')
    && (firstGroup < 0xfe80 || firstGroup > 0xfebf);
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

  const family: LocalUIBindFamily = host.includes(':') ? 'ipv6' : 'ipv4';
  let canonicalHost = '';
  try {
    canonicalHost = family === 'ipv4' ? canonicalIPv4(host) : canonicalIPv6(host);
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('without a zone')
      || error.message.includes('IPv4-mapped IPv6')
    )) {
      throw error;
    }
    throw new Error('host must be localhost or an IP literal');
  }
  const wildcard = family === 'ipv4' ? canonicalHost === '0.0.0.0' : canonicalHost === '::';
  const loopback = family === 'ipv4' ? isIPv4Loopback(canonicalHost) : canonicalHost === '::1';
  if (!loopback && !wildcard) {
    const eligible = family === 'ipv4'
      ? isEligibleIPv4NetworkHost(canonicalHost)
      : isEligibleIPv6NetworkHost(canonicalHost);
    if (!eligible) {
      throw new Error('network host must be a non-loopback unicast IP address');
    }
  }
  if (!loopback && port === 0) {
    throw new Error('network exposure requires a fixed port');
  }

  return {
    host: canonicalHost,
    port,
    localhost: false,
    wildcard,
    loopback,
    family,
  };
}

export function formatLocalUIBind(bind: LocalUIBindSpec): string {
  return bind.family === 'ipv6'
    ? `[${bind.host}]:${bind.port}`
    : `${bind.host}:${bind.port}`;
}

export function canonicalLocalUIBind(raw: string): string {
  return formatLocalUIBind(parseLocalUIBind(raw));
}

export function isLoopbackOnlyBind(bind: LocalUIBindSpec): boolean {
  return bind.localhost || bind.loopback;
}
