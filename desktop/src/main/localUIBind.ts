import {
  canonicalLocalUIBind,
  DEFAULT_DESKTOP_LOCAL_UI_BIND,
  formatLocalUIBind,
  isLoopbackOnlyBind,
  parseLocalUIBind,
  type LocalUIBindFamily,
  type LocalUIBindSpec,
} from '../shared/localUIBind';

export {
  canonicalLocalUIBind,
  DEFAULT_DESKTOP_LOCAL_UI_BIND,
  formatLocalUIBind,
  isLoopbackOnlyBind,
  parseLocalUIBind,
  type LocalUIBindFamily,
  type LocalUIBindSpec,
};

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
