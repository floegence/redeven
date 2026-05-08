import { isLoopbackHost, isSupportedLocalHostname } from './localUIURL';

type RemoteSessionFamily =
  | Readonly<{
      kind: 'sandbox';
      region: string;
      sandbox_base_domain: string;
      runtime_base_domain: string;
    }>
  | Readonly<{
      kind: 'runtime';
      region: string;
      sandbox_base_domain: string;
      runtime_base_domain: string;
    }>;

function normalizeHTTPPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

function splitHostname(hostname: string): string[] {
  return String(hostname ?? '')
    .trim()
    .toLowerCase()
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

function deriveControlPlaneBaseDomainFromSandboxBaseDomain(sandboxBaseDomain: string): string | null {
  const labels = splitHostname(sandboxBaseDomain);
  if (labels.length < 2) {
    return null;
  }
  const [first, ...rest] = labels;
  if (!first.endsWith('-sandbox')) {
    return null;
  }
  const controlPlaneFirst = first.slice(0, -'-sandbox'.length).trim();
  if (controlPlaneFirst === '') {
    return null;
  }
  return [controlPlaneFirst, ...rest].join('.');
}

function deriveRuntimeIsolationBaseDomain(baseDomain: string): string | null {
  const labels = splitHostname(baseDomain);
  if (labels.length < 2) {
    return null;
  }
  return labels[labels.length - 1] === 'test' ? 'redeven-online.test' : 'redeven.online';
}

function deriveSandboxBaseDomainFromRuntimeIsolationBaseDomain(runtimeBaseDomain: string): string | null {
  const normalized = splitHostname(runtimeBaseDomain).join('.');
  if (normalized === 'redeven-online.test') {
    return 'redeven-sandbox.test';
  }
  if (normalized === 'redeven.online') {
    return 'redeven-sandbox.com';
  }
  return null;
}

function parseSandboxFamily(hostname: string): RemoteSessionFamily | null {
  const labels = splitHostname(hostname);
  if (labels.length < 4) {
    return null;
  }
  const [sandboxID, region, ...rest] = labels;
  if (!sandboxID || !region || !rest[0]?.endsWith('-sandbox')) {
    return null;
  }
  if (!sandboxID.startsWith('env-') && !sandboxID.startsWith('cs-') && !sandboxID.startsWith('pf-')) {
    return null;
  }
  const sandboxBaseDomain = rest.join('.');
  const controlPlaneBaseDomain = deriveControlPlaneBaseDomainFromSandboxBaseDomain(sandboxBaseDomain);
  const runtimeBaseDomain = controlPlaneBaseDomain ? deriveRuntimeIsolationBaseDomain(controlPlaneBaseDomain) : null;
  if (!controlPlaneBaseDomain || !runtimeBaseDomain) {
    return null;
  }
  return {
    kind: 'sandbox',
    region,
    sandbox_base_domain: sandboxBaseDomain,
    runtime_base_domain: runtimeBaseDomain,
  };
}

function parseRuntimeFamily(hostname: string): RemoteSessionFamily | null {
  const labels = splitHostname(hostname);
  if (labels.length < 4) {
    return null;
  }
  const [runtimeID, region, ...rest] = labels;
  if (!runtimeID || !region) {
    return null;
  }
  if (!runtimeID.startsWith('rt-') && !runtimeID.startsWith('app-')) {
    return null;
  }
  const runtimeBaseDomain = rest.join('.');
  const sandboxBaseDomain = deriveSandboxBaseDomainFromRuntimeIsolationBaseDomain(runtimeBaseDomain);
  if (!sandboxBaseDomain) {
    return null;
  }
  return {
    kind: 'runtime',
    region,
    sandbox_base_domain: sandboxBaseDomain,
    runtime_base_domain: runtimeBaseDomain,
  };
}

function parseRemoteSessionFamily(hostname: string): RemoteSessionFamily | null {
  return parseSandboxFamily(hostname) ?? parseRuntimeFamily(hostname);
}

function isSandboxHostInFamily(hostname: string, family: RemoteSessionFamily): boolean {
  const labels = splitHostname(hostname);
  if (labels.length < 4) {
    return false;
  }
  const [sandboxID, region, ...rest] = labels;
  if (!sandboxID || region !== family.region) {
    return false;
  }
  if (!sandboxID.startsWith('env-') && !sandboxID.startsWith('cs-') && !sandboxID.startsWith('pf-')) {
    return false;
  }
  return rest.join('.') === family.sandbox_base_domain;
}

function isRuntimeHostInFamily(hostname: string, family: RemoteSessionFamily): boolean {
  const labels = splitHostname(hostname);
  if (labels.length < 4) {
    return false;
  }
  const [runtimeID, region, ...rest] = labels;
  if (!runtimeID || region !== family.region) {
    return false;
  }
  if (!runtimeID.startsWith('rt-') && !runtimeID.startsWith('app-')) {
    return false;
  }
  return rest.join('.') === family.runtime_base_domain;
}

function isAllowedRemoteSessionNavigation(candidate: URL, allowed: URL): boolean {
  const family = parseRemoteSessionFamily(allowed.hostname);
  if (!family) {
    return candidate.hostname === allowed.hostname;
  }
  return isSandboxHostInFamily(candidate.hostname, family) || isRuntimeHostInFamily(candidate.hostname, family);
}

export function isAllowedAppNavigation(input: string, allowedBaseURL: string): boolean {
  try {
    const candidate = new URL(input);
    const allowed = new URL(allowedBaseURL);
    if ((candidate.protocol !== 'http:' && candidate.protocol !== 'https:') || (allowed.protocol !== 'http:' && allowed.protocol !== 'https:')) {
      return false;
    }
    if (normalizeHTTPPort(candidate) !== normalizeHTTPPort(allowed)) {
      return false;
    }
    if (!isSupportedLocalHostname(allowed.hostname) || !isSupportedLocalHostname(candidate.hostname)) {
      return false;
    }
    if (isLoopbackHost(allowed.hostname) || isLoopbackHost(candidate.hostname)) {
      return isLoopbackHost(allowed.hostname) && isLoopbackHost(candidate.hostname);
    }
    if (candidate.hostname === allowed.hostname) {
      return true;
    }
    return isAllowedRemoteSessionNavigation(candidate, allowed);
  } catch {
    return false;
  }
}
