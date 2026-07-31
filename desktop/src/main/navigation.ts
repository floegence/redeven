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

function isSupportedSandboxID(id: string): boolean {
  return id.startsWith('env-') || id.startsWith('cs-') || id.startsWith('pf-');
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

function deriveRuntimeBaseDomainFromSandboxBaseDomain(sandboxBaseDomain: string): string | null {
  const normalized = splitHostname(sandboxBaseDomain).join('.');
  if (normalized === 'redeven.online') {
    return 'redeven.online';
  }
  const controlPlaneBaseDomain = deriveControlPlaneBaseDomainFromSandboxBaseDomain(sandboxBaseDomain);
  return controlPlaneBaseDomain ? deriveRuntimeIsolationBaseDomain(controlPlaneBaseDomain) : null;
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
    return 'redeven.online';
  }
  return null;
}

function parseSandboxFamily(hostname: string): RemoteSessionFamily | null {
  const labels = splitHostname(hostname);
  if (labels.length < 4) {
    return null;
  }
  const [sandboxID, region, ...rest] = labels;
  if (!sandboxID || !region) {
    return null;
  }
  if (!isSupportedSandboxID(sandboxID)) {
    return null;
  }
  const sandboxBaseDomain = rest.join('.');
  const runtimeBaseDomain = deriveRuntimeBaseDomainFromSandboxBaseDomain(sandboxBaseDomain);
  if (!runtimeBaseDomain) {
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
  if (!isSupportedSandboxID(sandboxID)) {
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
    const remoteFamily = parseRemoteSessionFamily(allowed.hostname);
    if (remoteFamily) {
      return isSandboxHostInFamily(candidate.hostname, remoteFamily) || isRuntimeHostInFamily(candidate.hostname, remoteFamily);
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

function compactCodeSpaceID(value: unknown): string {
  return String(value ?? '').trim();
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isCodespaceURLForCodeSpace(input: string, codeSpaceID: string): boolean {
  const expectedID = compactCodeSpaceID(codeSpaceID);
  if (!expectedID) {
    return false;
  }

  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    const labels = splitHostname(url.hostname);
    if (labels[0] === `cs-${expectedID.toLowerCase()}`) {
      return true;
    }

    const pathSegments = url.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    return pathSegments[0] === 'cs' && decodePathSegment(pathSegments[1] ?? '') === expectedID;
  } catch {
    return false;
  }
}

export function isAllowedCodespaceWindowNavigation(input: string, allowedBaseURL: string, codeSpaceID: string): boolean {
  return isAllowedAppNavigation(input, allowedBaseURL) && isCodespaceURLForCodeSpace(input, codeSpaceID);
}

export function isPortForwardURLForForward(input: string, forwardID: string): boolean {
  const expectedID = compactCodeSpaceID(forwardID);
  if (!expectedID) return false;
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const labels = splitHostname(url.hostname);
    if (labels[0] === `pf-${expectedID.toLowerCase()}`) return true;
    const pathSegments = url.pathname.split('/').map((part) => part.trim()).filter(Boolean);
    return pathSegments[0] === 'pf' && decodePathSegment(pathSegments[1] ?? '') === expectedID;
  } catch {
    return false;
  }
}

export function isAllowedWebServiceWindowNavigation(input: string, allowedBaseURL: string, forwardID: string): boolean {
  return isAllowedAppNavigation(input, allowedBaseURL) && isPortForwardURLForForward(input, forwardID);
}

function webServiceRouteRoot(routeURL: URL, forwardID: string): URL | null {
  const expectedID = compactCodeSpaceID(forwardID);
  if (!expectedID || !isPortForwardURLForForward(routeURL.toString(), expectedID)) return null;
  const labels = splitHostname(routeURL.hostname);
  if (labels[0] === `pf-${expectedID.toLowerCase()}`) return new URL('/', routeURL);
  return new URL(`/pf/${encodeURIComponent(expectedID)}/`, routeURL);
}

function webServiceRouteAppPath(routeURL: URL, forwardID: string): string | null {
  const routeRoot = webServiceRouteRoot(routeURL, forwardID);
  if (!routeRoot) return null;
  if (routeRoot.pathname === '/') {
    if (routeURL.pathname === '/_redeven_boot/' || routeURL.pathname === '/_redeven_boot') return '/';
    return routeURL.pathname || '/';
  }
  const rootWithoutTrailingSlash = routeRoot.pathname.replace(/\/$/u, '');
  if (routeURL.pathname === rootWithoutTrailingSlash) return '/';
  if (!routeURL.pathname.startsWith(routeRoot.pathname)) return null;
  return `/${routeURL.pathname.slice(routeRoot.pathname.length)}`;
}

export function webServiceBrowserDisplayURL(
  routeInput: string,
  targetInput: string,
  forwardID: string,
): string | null {
  try {
    const routeURL = new URL(routeInput);
    const targetURL = new URL(targetInput);
    const appPath = webServiceRouteAppPath(routeURL, forwardID);
    if (!appPath) return null;
    const displayURL = new URL(appPath, targetURL.origin);
    const isRemoteBoot = appPath === '/'
      && (routeURL.pathname === '/_redeven_boot/' || routeURL.pathname === '/_redeven_boot');
    if (!isRemoteBoot) {
      displayURL.search = routeURL.search;
      displayURL.hash = routeURL.hash;
    }
    return displayURL.toString();
  } catch {
    return null;
  }
}

function looksLikeWebServiceAuthority(address: string): boolean {
  const authority = address.split(/[/?#]/u, 1)[0]?.trim() ?? '';
  if (!authority) return false;
  const hostname = authority.startsWith('[')
    ? authority.slice(0, authority.indexOf(']') + 1)
    : authority.replace(/:\d+$/u, '');
  return hostname.toLowerCase() === 'localhost'
    || hostname.startsWith('[')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)
    || hostname.includes('.');
}

function expandWebServicePortShorthand(address: string): string {
  const portMatch = address.match(/^(\d{1,5})([/?#].*)?$/u);
  if (portMatch) return `localhost:${portMatch[1]}${portMatch[2] ?? ''}`;
  return address.startsWith(':') ? `localhost${address}` : address;
}

export function resolveWebServiceBrowserAddress(
  input: string,
  currentRouteURL: string,
  targetInput: string,
  allowedBaseURL: string,
  forwardID: string,
): string | null {
  const address = String(input ?? '').trim();
  if (!address) return null;

  try {
    const currentRoute = new URL(currentRouteURL);
    const targetURL = new URL(targetInput);
    const routeRoot = webServiceRouteRoot(currentRoute, forwardID);
    const currentDisplay = webServiceBrowserDisplayURL(currentRoute.toString(), targetURL.toString(), forwardID);
    if (!routeRoot || !currentDisplay) return null;

    let displayCandidate: URL;
    const expandedAddress = expandWebServicePortShorthand(address);
    if (/^https?:\/\//iu.test(expandedAddress)) {
      displayCandidate = new URL(expandedAddress);
    } else if (looksLikeWebServiceAuthority(expandedAddress)) {
      displayCandidate = new URL(`${targetURL.protocol}//${expandedAddress}`);
    } else if (/^[a-z][a-z0-9+.-]*:/iu.test(expandedAddress)) {
      return null;
    } else if (expandedAddress.startsWith('?') || expandedAddress.startsWith('#')) {
      displayCandidate = new URL(expandedAddress, currentDisplay);
    } else {
      displayCandidate = new URL(expandedAddress.replace(/^\/+/, ''), targetURL.origin + '/');
    }
    if (displayCandidate.origin !== targetURL.origin || displayCandidate.username || displayCandidate.password) {
      return null;
    }

    const routeCandidate = new URL(routeRoot);
    routeCandidate.pathname += displayCandidate.pathname.replace(/^\/+/, '');
    routeCandidate.search = displayCandidate.search;
    routeCandidate.hash = displayCandidate.hash;
    return isAllowedWebServiceWindowNavigation(routeCandidate.toString(), allowedBaseURL, forwardID)
      ? routeCandidate.toString()
      : null;
  } catch {
    return null;
  }
}
