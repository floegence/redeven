// Product DNS routing only. The platform authorizes every plugin resource.
export function isGatewayPluginHostname(parent: string, hostname: string): boolean {
  if (!/^r-[0-9a-f]{40}\.redeven\.invalid$/.test(parent)) return false;
  const suffix = `.${parent}`;
  return hostname.endsWith(suffix) && /^[0-9a-f]{48}$/.test(hostname.slice(0, -suffix.length));
}

export function isGatewayApplicationHostname(parent: string, hostname: string): boolean {
  return hostname === parent || isGatewayPluginHostname(parent, hostname);
}
