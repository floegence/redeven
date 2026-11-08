import { createSignal, onCleanup } from 'solid-js';

export const SETTINGS_DESTINATIONS = ['appearance', 'storage', 'terminal', 'browser', 'extensions', 'applications', 'services', 'plugins', 'config', 'connection', 'agent', 'runtime', 'logging', 'debug_console', 'codespaces', 'permission_policy', 'ai'] as const;
export type SettingsSection = typeof SETTINGS_DESTINATIONS[number];
export type SettingsTarget = Readonly<{ section: SettingsSection; resource?: string }>;

export function settingsProviderFocus(resource: string | undefined, sequence: number) {
  if (!resource) return undefined;
  try {
    const value = JSON.parse(resource);
    if (!value || typeof value.providerID !== 'string' || !value.providerID.trim() || typeof value.modelName !== 'string') return undefined;
    return { providerID: value.providerID, modelName: value.modelName, sequence };
  } catch { return undefined; }
}
export function settingsTargetSupported(target: SettingsTarget) {
  return !target.resource || ['terminal', 'browser', 'services', 'connection'].includes(target.section)
    || target.section === 'ai' && !!settingsProviderFocus(target.resource, 0);
}

export function readSettingsTarget(url: URL): SettingsTarget | null {
  const section = url.searchParams.get('settings');
  const resource = url.searchParams.get('settings_resource') ?? undefined;
  if (!SETTINGS_DESTINATIONS.includes(section as SettingsSection) || (resource?.length ?? 0) > 2048) return null;
  return { section: section as SettingsSection, ...(resource ? { resource } : {}) };
}

/** Product navigation only. The published Floe Dialog owns modal mechanics. */
export function createSettingsSession(options: { history?: boolean } = {}) {
  const [target, setTarget] = createSignal<SettingsTarget | null>(options.history ? readSettingsTarget(new URL(window.location.href)) : null);
  const [present, setPresent] = createSignal(false);
  const [revision, setRevision] = createSignal(target() ? 1 : 0);
  const writeHistory = (next: SettingsTarget | null, replace = false) => {
    if (!options.history) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('settings'); url.searchParams.delete('settings_resource');
    if (next) { url.searchParams.set('settings', next.section); if (next.resource) url.searchParams.set('settings_resource', next.resource); }
    if (url.href !== window.location.href) window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', url);
  };
  if (options.history) {
    const pop = () => { setTarget(readSettingsTarget(new URL(window.location.href))); setRevision(value => value + 1); };
    window.addEventListener('popstate', pop);
    onCleanup(() => window.removeEventListener('popstate', pop));
  }
  return {
    target, present, revision,
    // IMPORTANT: Settings never changes work navigation, starts a runtime, or
    // substitutes an environment. A host's authority lifetime owns this session.
    open(next: SettingsTarget) {
      if (!SETTINGS_DESTINATIONS.includes(next.section)) throw new Error('Unknown settings destination.');
      writeHistory(next); setTarget(next); setRevision(value => value + 1);
    },
    close() { writeHistory(null, true); setTarget(null); },
    // IMPORTANT: Floe alone restores focus. A second restoration races the
    // next overlay's admission and can dismiss a save/restart handoff.
    setPresent,
  };
}
