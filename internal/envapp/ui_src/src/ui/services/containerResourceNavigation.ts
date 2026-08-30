import type { ContainerEngine, ContainerResourceView } from './containerResourcesApi';
import { readUIStorageJSON, removeUIStorageItem, writeUIStorageJSON } from './uiStorage';

export type ContainerResourceNavigation = Readonly<{
  version: 1;
  engine: ContainerEngine;
  endpointID: string;
  view: ContainerResourceView;
  selectedIdentity: string;
}>;

const NAVIGATION_STORAGE_KEY = 'containers:navigation-request';
const NAVIGATION_EVENT = 'redeven:container-resource-navigation';

function validNavigation(value: unknown): ContainerResourceNavigation | null {
  const candidate = value as Partial<ContainerResourceNavigation> | null;
  if (candidate?.version !== 1) return null;
  if (candidate.engine !== 'docker' && candidate.engine !== 'podman') return null;
  if (!['containers', 'images', 'volumes', 'compose-projects', 'pods'].includes(String(candidate.view))) return null;
  if (!String(candidate.selectedIdentity ?? '').trim()) return null;
  return {
    version: 1,
    engine: candidate.engine,
    endpointID: String(candidate.endpointID ?? '').trim(),
    view: candidate.view as ContainerResourceView,
    selectedIdentity: String(candidate.selectedIdentity).trim(),
  };
}

export function requestContainerResourceNavigation(target: Readonly<{
  engine: ContainerEngine;
  endpointID?: string;
  view: ContainerResourceView;
  identity: string;
}>): void {
  const request: ContainerResourceNavigation = {
    version: 1,
    engine: target.engine,
    endpointID: String(target.endpointID ?? '').trim(),
    view: target.view,
    selectedIdentity: target.identity.trim(),
  };
  writeUIStorageJSON(NAVIGATION_STORAGE_KEY, request);
  window.dispatchEvent(new CustomEvent<ContainerResourceNavigation>(NAVIGATION_EVENT, { detail: request }));
}

export function consumeContainerResourceNavigation(): ContainerResourceNavigation | null {
  const request = validNavigation(readUIStorageJSON<unknown>(NAVIGATION_STORAGE_KEY, null));
  removeUIStorageItem(NAVIGATION_STORAGE_KEY);
  return request;
}

export function subscribeContainerResourceNavigation(
  receive: (request: ContainerResourceNavigation) => void,
): () => void {
  const listener = (event: Event) => {
    const request = validNavigation((event as CustomEvent<ContainerResourceNavigation>).detail);
    if (!request) return;
    removeUIStorageItem(NAVIGATION_STORAGE_KEY);
    receive(request);
  };
  window.addEventListener(NAVIGATION_EVENT, listener);
  return () => window.removeEventListener(NAVIGATION_EVENT, listener);
}
