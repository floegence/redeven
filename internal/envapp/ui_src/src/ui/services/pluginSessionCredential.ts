const PLUGIN_SESSION_HEADER = 'X-Redeven-Plugin-Session';

export type PluginSessionCredentialBinding = Readonly<{
  generation: number;
  channelID: string;
}>;

type StoredPluginSessionCredential = PluginSessionCredentialBinding & Readonly<{
  credential: string;
}>;

let nextGeneration = 0;
let activePluginSessionCredential: StoredPluginSessionCredential | undefined;
let stagedPluginSessionCredential: StoredPluginSessionCredential | undefined;

export function replacePendingPluginSessionCredential(
  channelID: string,
  credential: string,
): PluginSessionCredentialBinding | undefined {
  const normalizedChannelID = String(channelID ?? '').trim();
  const normalizedCredential = String(credential ?? '').trim();
  if (!normalizedChannelID || !normalizedCredential) return undefined;
  const staged = Object.freeze({
    generation: ++nextGeneration,
    channelID: normalizedChannelID,
    credential: normalizedCredential,
  });
  stagedPluginSessionCredential = staged;
  return Object.freeze({ generation: staged.generation, channelID: staged.channelID });
}

export function activatePluginSessionCredential(binding: PluginSessionCredentialBinding): boolean {
  const staged = stagedPluginSessionCredential;
  if (!staged || staged.generation !== binding.generation || staged.channelID !== binding.channelID) return false;
  activePluginSessionCredential = staged;
  stagedPluginSessionCredential = undefined;
  return true;
}

export function applyPendingPluginSessionCredential(
  headers: Headers,
  binding: PluginSessionCredentialBinding,
): boolean {
  const staged = stagedPluginSessionCredential;
  if (!staged || staged.generation !== binding.generation || staged.channelID !== binding.channelID) return false;
  headers.set(PLUGIN_SESSION_HEADER, staged.credential);
  return true;
}

export function readPluginSessionCredential(): string {
  return activePluginSessionCredential?.credential ?? '';
}

export function clearPluginSessionCredential(): void {
  activePluginSessionCredential = undefined;
  stagedPluginSessionCredential = undefined;
}

export function applyPluginSessionCredential(headers: Headers): void {
  const credential = readPluginSessionCredential();
  if (credential) headers.set(PLUGIN_SESSION_HEADER, credential);
}
