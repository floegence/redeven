import net from 'node:net';

import { DEFAULT_DESKTOP_LOCAL_UI_BIND } from '../shared/desktopAccessModel';

export { DEFAULT_DESKTOP_LOCAL_UI_BIND };

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
  if (host.includes('%')) {
    throw new Error('host must be a canonical IPv4 or IPv6 literal without a zone');
  }
  const normalized = new URL(`http://[${host}]/`).hostname.slice(1, -1).toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    throw new Error('IPv4-mapped IPv6 hosts are not supported');
  }
  return normalized;
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

  const ipFamily = net.isIP(host);
  if (ipFamily === 0) {
    throw new Error('host must be localhost or an IP literal');
  }
  const canonicalHost = ipFamily === 4 ? canonicalIPv4(host) : canonicalIPv6(host);
  const wildcard = ipFamily === 4 ? isIPv4Wildcard(canonicalHost) : canonicalHost === '::';
  const loopback = ipFamily === 4 ? isIPv4Loopback(canonicalHost) : canonicalHost === '::1';
  if (!loopback && !wildcard) {
    const eligible = ipFamily === 4
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
    family: ipFamily === 4 ? 'ipv4' : 'ipv6',
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

type LocalUIBindOccupancy = Readonly<{
  port: number;
  ipv4_wildcard: boolean;
  ipv6_wildcard: boolean;
  ipv4_hosts: readonly string[];
  ipv6_hosts: readonly string[];
}>;

function localUIBindOccupancy(bind: LocalUIBindSpec): LocalUIBindOccupancy {
  if (bind.localhost) {
    return {
      port: bind.port,
      ipv4_wildcard: false,
      ipv6_wildcard: false,
      ipv4_hosts: ['127.0.0.1'],
      ipv6_hosts: ['::1'],
    };
  }

  if (bind.family === 'ipv4') {
    return {
      port: bind.port,
      ipv4_wildcard: bind.wildcard,
      ipv6_wildcard: false,
      ipv4_hosts: bind.wildcard ? [] : [bind.host],
      ipv6_hosts: [],
    };
  }

  return {
    port: bind.port,
    ipv4_wildcard: false,
    ipv6_wildcard: bind.wildcard,
    ipv4_hosts: [],
    ipv6_hosts: bind.wildcard ? [] : [bind.host],
  };
}

function hasSharedHost(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightHosts = new Set(right);
  return left.some((host) => rightHosts.has(host));
}

function familyOccupancyConflicts(
  leftWildcard: boolean,
  leftHosts: readonly string[],
  rightWildcard: boolean,
  rightHosts: readonly string[],
): boolean {
  if (leftWildcard && (rightWildcard || rightHosts.length > 0)) {
    return true;
  }
  if (rightWildcard && leftHosts.length > 0) {
    return true;
  }
  return hasSharedHost(leftHosts, rightHosts);
}

export function localUIBindsConflict(left: string | LocalUIBindSpec, right: string | LocalUIBindSpec): boolean {
  const leftBind = typeof left === 'string' ? parseLocalUIBind(left) : left;
  const rightBind = typeof right === 'string' ? parseLocalUIBind(right) : right;
  if (leftBind.port === 0 || rightBind.port === 0 || leftBind.port !== rightBind.port) {
    return false;
  }

  const leftOccupancy = localUIBindOccupancy(leftBind);
  const rightOccupancy = localUIBindOccupancy(rightBind);
  return familyOccupancyConflicts(
    leftOccupancy.ipv4_wildcard,
    leftOccupancy.ipv4_hosts,
    rightOccupancy.ipv4_wildcard,
    rightOccupancy.ipv4_hosts,
  ) || familyOccupancyConflicts(
    leftOccupancy.ipv6_wildcard,
    leftOccupancy.ipv6_hosts,
    rightOccupancy.ipv6_wildcard,
    rightOccupancy.ipv6_hosts,
  );
}
