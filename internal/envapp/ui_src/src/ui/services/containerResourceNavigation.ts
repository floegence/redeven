import type { ContainerEngine, ContainerResourceView } from './containerResourcesApi';
import { writeUIStorageJSON } from './uiStorage';

export type ContainerResourceNavigation = Readonly<{
  version: 1;
  engine: ContainerEngine;
  endpointID: string;
  view: ContainerResourceView;
  selectedIdentity: string;
}>;

const ACTIVITY_STORAGE_KEY = 'containers:activity';
const NAVIGATION_EVENT = 'redeven:container-resource-navigation';

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
  writeUIStorageJSON(ACTIVITY_STORAGE_KEY, request);
  window.dispatchEvent(new CustomEvent<ContainerResourceNavigation>(NAVIGATION_EVENT, { detail: request }));
}

export function subscribeContainerResourceNavigation(
  receive: (request: ContainerResourceNavigation) => void,
): () => void {
  const listener = (event: Event) => {
    const request = (event as CustomEvent<ContainerResourceNavigation>).detail;
    if (request?.version === 1) receive(request);
  };
  window.addEventListener(NAVIGATION_EVENT, listener);
  return () => window.removeEventListener(NAVIGATION_EVENT, listener);
}
