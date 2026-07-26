const PLUGIN_SESSION_HEADER = 'X-Redeven-Plugin-Session';

let pluginSessionCredential = '';

export function writePluginSessionCredential(credential: string): void {
  pluginSessionCredential = String(credential ?? '').trim();
}

export function readPluginSessionCredential(): string {
  return pluginSessionCredential;
}

export function clearPluginSessionCredential(): void {
  pluginSessionCredential = '';
}

export function applyPluginSessionCredential(headers: Headers): void {
  const credential = readPluginSessionCredential();
  if (!credential) return;
  headers.set(PLUGIN_SESSION_HEADER, credential);
}
