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
