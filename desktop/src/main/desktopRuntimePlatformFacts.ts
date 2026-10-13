import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { normalizeDesktopRuntimeLinuxDistribution, normalizeDesktopRuntimePlatform,
  type DesktopRuntimePlatformFacts, type DesktopRuntimePlatformFactsMap } from '../shared/desktopRuntimePlatform';

type PlatformFactsStore = Readonly<{
  runtimePlatformFacts: () => DesktopRuntimePlatformFactsMap;
  setRuntimePlatformFacts: (facts: DesktopRuntimePlatformFactsMap) => void;
}>;

/** Last observed display facts survive transport loss; they grant no runtime capability. */
export function retainDesktopRuntimePlatformFacts(
  environments: readonly DesktopEnvironmentEntry[],
  store: PlatformFactsStore,
): readonly DesktopEnvironmentEntry[] {
  const saved = store.runtimePlatformFacts();
  const next = { ...saved };
  let changed = false;
  const entries = environments.map(entry => {
    // Editing a saved URL selects a different Runtime, while labels do not.
    const key = `${entry.kind}:${entry.id}${entry.kind === 'external_local_ui' ? `:${entry.secondary_text}` : ''}`;
    const previous = Object.hasOwn(saved, key) ? saved[key] : undefined;
    const canUpdate = !previous || (entry.kind === 'gateway_environment'
      ? Boolean(entry.open_session_key) : entry.runtime_health.status === 'online');
    const platform = canUpdate ? normalizeDesktopRuntimePlatform(entry.runtime_platform) : undefined;
    const facts: DesktopRuntimePlatformFacts | undefined = platform ? {
      runtime_platform: platform,
      runtime_linux_distribution: platform === 'linux'
        ? normalizeDesktopRuntimeLinuxDistribution(entry.runtime_linux_distribution, platform)
          ?? (previous?.runtime_platform === 'linux' ? previous.runtime_linux_distribution : undefined)
        : undefined,
    } : previous;
    if (!facts) return entry;
    if (facts.runtime_platform !== previous?.runtime_platform
      || facts.runtime_linux_distribution !== previous?.runtime_linux_distribution) {
      next[key] = facts;
      changed = true;
    }
    return entry.runtime_platform === facts.runtime_platform
      && entry.runtime_linux_distribution === facts.runtime_linux_distribution ? entry : { ...entry, ...facts };
  });
  if (changed) store.setRuntimePlatformFacts(next);
  return entries;
}
