import type { ContainerResourceView } from '../services/containerResourcesApi';

export type PersistedContainersState = Readonly<{
  version: 2;
  view: ContainerResourceView;
  selectedResourceKey: string;
}>;

export const DEFAULT_STATE: PersistedContainersState = {
  version: 2,
  view: 'containers',
  selectedResourceKey: '',
};

export function sanitizePersistedState(value: unknown): PersistedContainersState {
  const candidate = value as Partial<PersistedContainersState> | null;
  if (candidate?.version !== 2) return DEFAULT_STATE;
  const views: readonly ContainerResourceView[] = ['containers', 'images', 'volumes', 'compose-projects', 'pods'];
  const view = views.includes(candidate.view as ContainerResourceView)
    ? candidate?.view as ContainerResourceView
    : 'containers';
  return {
    version: 2,
    view,
    selectedResourceKey: String(candidate?.selectedResourceKey ?? '').trim(),
  };
}
