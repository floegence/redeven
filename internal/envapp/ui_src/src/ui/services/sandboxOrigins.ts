export interface OriginLocationLike {
  protocol: string;
  hostname: string;
  port?: string;
}

export type TrustedLauncherApp = 'env' | 'cs' | 'pf';

function splitHostname(hostname: string): string[] {
  return String(hostname ?? '')
    .trim()
    .toLowerCase()
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

function originFromLocationLike(loc: OriginLocationLike, hostname: string): string {
  const protocol = String(loc.protocol ?? '').trim();
  if (!protocol) throw new Error('Invalid location protocol');
  const port = String(loc.port ?? '').trim();
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}

export function deriveControlPlaneBaseDomainFromSandboxBaseDomain(sandboxBaseDomain: string): string {
  const labels = splitHostname(sandboxBaseDomain);
  if (labels.length < 2) throw new Error('Invalid sandbox base domain');

  const [first, ...rest] = labels;
  if (!first.endsWith('-sandbox')) throw new Error('Invalid sandbox base domain');

  const controlPlaneFirst = first.slice(0, -'-sandbox'.length).trim();
  if (!controlPlaneFirst) throw new Error('Invalid sandbox base domain');
  return [controlPlaneFirst, ...rest].join('.');
}

export function controlPlaneOriginFromSandboxLocation(loc: OriginLocationLike): string {
  const labels = splitHostname(loc.hostname);
  if (labels.length < 4) throw new Error('Invalid sandbox host');

  const [, region, ...rest] = labels;
  if (!region) throw new Error('Invalid sandbox host');

  const sandboxBaseDomain = rest.join('.');
  const controlPlaneBaseDomain = deriveControlPlaneBaseDomainFromSandboxBaseDomain(sandboxBaseDomain);
  return originFromLocationLike(loc, `${region}.${controlPlaneBaseDomain}`);
}

export function trustedLauncherOriginFromSandboxLocation(
  loc: OriginLocationLike,
  app: TrustedLauncherApp,
  sandboxID: string,
): string {
  const labels = splitHostname(loc.hostname);
  if (labels.length < 4) throw new Error('Invalid sandbox host');

  const [, region, ...rest] = labels;
  const normalizedSandboxID = String(sandboxID ?? '').trim().toLowerCase();
  if (!region || !normalizedSandboxID) throw new Error('Invalid sandbox host');

  const sandboxBaseDomain = rest.join('.');
  if (!sandboxBaseDomain) throw new Error('Invalid sandbox host');

  return originFromLocationLike(loc, `${app}-${normalizedSandboxID}.${region}.${sandboxBaseDomain}`);
}
