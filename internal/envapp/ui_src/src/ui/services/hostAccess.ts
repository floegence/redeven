import { fetchSessionJSON } from './sessionHTTP';

export type HostAccessState = 'unconfigured' | 'enabled' | 'paused';

export function setHostAccess(feature: 'applications' | 'desktop', state: HostAccessState) {
  const resource = feature === 'applications' ? 'host-applications' : 'remote-desktop';
  return fetchSessionJSON<{ state: HostAccessState }>(`/_redeven_proxy/api/${resource}/access`, {
    method: 'PUT',
    body: JSON.stringify({ state }),
  });
}

// Older runtimes expose readiness without persisted feature intent.
export const hostAccessState = (state: HostAccessState | undefined, ready: boolean): HostAccessState =>
  state ?? (ready ? 'enabled' : 'unconfigured');
