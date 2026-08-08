const PLUGIN_SESSION_HEADER = 'X-Redeven-Plugin-Session';

let pluginSessionCredential = '';
const pendingPluginSessionCredentials = new Map<string, string>();

export function stagePluginSessionCredential(channelID: string, credential: string): void {
  const normalizedChannelID = String(channelID ?? '').trim();
  const normalizedCredential = String(credential ?? '').trim();
  if (!normalizedChannelID || !normalizedCredential) return;
  pendingPluginSessionCredentials.set(normalizedChannelID, normalizedCredential);
}

export function activatePluginSessionCredential(channelID: string): boolean {
  const normalizedChannelID = String(channelID ?? '').trim();
  const credential = pendingPluginSessionCredentials.get(normalizedChannelID);
  if (!credential) return false;
  pluginSessionCredential = credential;
  pendingPluginSessionCredentials.clear();
  return true;
}

export function activatePendingPluginSessionCredential(): boolean {
  if (pendingPluginSessionCredentials.size !== 1) return false;
  const [channelID] = pendingPluginSessionCredentials.keys();
  return activatePluginSessionCredential(channelID ?? '');
}

export function readPluginSessionCredential(): string {
  return pluginSessionCredential;
}

export function clearPluginSessionCredential(): void {
  pluginSessionCredential = '';
  pendingPluginSessionCredentials.clear();
}

export function applyPluginSessionCredential(headers: Headers): void {
  const credential = readPluginSessionCredential();
  if (!credential) return;
  headers.set(PLUGIN_SESSION_HEADER, credential);
}
