import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import {
  AlertTriangle,
  FileText,
  Layers,
  Pause,
  Play,
  Plus,
  Refresh,
  Stop,
  Trash,
  X,
} from '@floegence/floe-webapp-core/icons';
import { Button, Input, Tag } from '@floegence/floe-webapp-core/ui';

import { Dialog } from '../primitives/EnvAppModal';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import {
  cancelContainerOperation,
  createContainerOperation,
  getContainerEndpointStatus,
  getContainerResourceDetails,
  getContainerStats,
  listContainerEndpoints,
  listContainerOperations,
  listContainerResources,
  preflightContainerOperation,
  subscribeContainerOperation,
  tailContainerLogs,
  type ComposeProjectInventoryItem,
  type ContainerEndpoint,
  type ContainerEngine,
  type ContainerInventoryItem,
  type ContainerLogLine,
  type ContainerOperation,
  type ContainerPreflight,
  type ContainerResourceInventoryItem,
  type ContainerResourceView,
  type ContainerStats,
  type ImageInventoryItem,
  type PodInventoryItem,
  type VolumeInventoryItem,
} from '../services/containerResourcesApi';
import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { useI18n } from '../i18n';
import { useEnvContext } from './EnvContext';
import './env-containers.css';

type PersistedContainersState = Readonly<{
  version: 1;
  engine: ContainerEngine;
  endpointID: string;
  view: ContainerResourceView;
  selectedIdentity: string;
}>;

type CreationMode = 'container' | 'image' | 'volume' | 'pod' | 'image-tag';

type MutationDraft = Readonly<{
  method: string;
  request: Record<string, unknown>;
  confirmationLabel?: string;
  confirmationValue?: string;
}>;

type ReviewState = Readonly<{
  request: Record<string, unknown>;
  preflight: ContainerPreflight;
}>;

const DEFAULT_STATE: PersistedContainersState = {
  version: 1,
  engine: 'docker',
  endpointID: '',
  view: 'containers',
  selectedIdentity: '',
};

const TERMINAL_OPERATION_STATES = new Set(['succeeded', 'failed', 'canceled', 'interrupted']);

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function sanitizePersistedState(value: unknown): PersistedContainersState {
  const candidate = value as Partial<PersistedContainersState> | null;
  const engine = candidate?.engine === 'podman' ? 'podman' : 'docker';
  const availableViews: readonly ContainerResourceView[] = engine === 'podman'
    ? ['containers', 'images', 'volumes', 'pods']
    : ['containers', 'images', 'volumes', 'compose-projects'];
  const view = availableViews.includes(candidate?.view as ContainerResourceView)
    ? candidate?.view as ContainerResourceView
    : 'containers';
  return {
    version: 1,
    engine,
    endpointID: compact(candidate?.endpointID),
    view,
    selectedIdentity: compact(candidate?.selectedIdentity),
  };
}

function resourceIdentity(view: ContainerResourceView, item: ContainerResourceInventoryItem): string {
  switch (view) {
    case 'containers': return compact((item as ContainerInventoryItem).container_id);
    case 'images': {
      const image = item as ImageInventoryItem;
      return compact(image.reference || image.tags?.[0] || image.digest || image.id);
    }
    case 'volumes': return compact((item as VolumeInventoryItem).name);
    case 'compose-projects': return compact((item as ComposeProjectInventoryItem).project_id);
    case 'pods': return compact((item as PodInventoryItem).pod_id);
  }
}

function resourceName(view: ContainerResourceView, item: ContainerResourceInventoryItem): string {
  switch (view) {
    case 'containers': return compact((item as ContainerInventoryItem).name) || resourceIdentity(view, item).slice(0, 12);
    case 'images': {
      const image = item as ImageInventoryItem;
      return compact(image.reference || image.tags?.[0] || image.digest || image.id);
    }
    case 'volumes': return (item as VolumeInventoryItem).name;
    case 'compose-projects': return (item as ComposeProjectInventoryItem).name;
    case 'pods': return (item as PodInventoryItem).name;
  }
}

function resourceStatus(view: ContainerResourceView, item: ContainerResourceInventoryItem): string {
  switch (view) {
    case 'containers': return compact((item as ContainerInventoryItem).state);
    case 'images': return `${(item as ImageInventoryItem).referenced_containers}`;
    case 'volumes': return `${(item as VolumeInventoryItem).referenced_containers}`;
    case 'compose-projects': return compact((item as ComposeProjectInventoryItem).status);
    case 'pods': return compact((item as PodInventoryItem).status);
  }
}

function resourceManagement(item: ContainerResourceInventoryItem | null) {
  if (!item) return undefined;
  return (item as ContainerInventoryItem | VolumeInventoryItem | ComposeProjectInventoryItem).management;
}

function formatBytes(value: number | undefined): string {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function operationActive(operation: ContainerOperation): boolean {
  return !TERMINAL_OPERATION_STATES.has(operation.state);
}

export function EnvContainersPage(props: { stateScope?: string; variant?: 'activity' | 'workbench' }) {
  const i18n = useI18n();
  const notify = useNotification();
  const env = useEnvContext();
  const storageKey = () => `containers:${compact(props.stateScope) || 'activity'}`;
  const restored = sanitizePersistedState(readUIStorageJSON(storageKey(), DEFAULT_STATE));
  const [engine, setEngine] = createSignal<ContainerEngine>(restored.engine);
  const [endpointID, setEndpointID] = createSignal(restored.endpointID);
  const [view, setView] = createSignal<ContainerResourceView>(restored.view);
  const [selectedIdentity, setSelectedIdentity] = createSignal(restored.selectedIdentity);
  const [endpoints, setEndpoints] = createSignal<ContainerEndpoint[]>([]);
  const [endpointStatus, setEndpointStatus] = createSignal<ContainerEndpoint | null>(null);
  const [inventory, setInventory] = createSignal<ContainerResourceInventoryItem[]>([]);
  const [details, setDetails] = createSignal<unknown>(null);
  const [loading, setLoading] = createSignal(true);
  const [refreshing, setRefreshing] = createSignal(false);
  const [error, setError] = createSignal('');
  const [operations, setOperations] = createSignal<ContainerOperation[]>([]);
  const [operationsOpen, setOperationsOpen] = createSignal(false);
  const [creationMode, setCreationMode] = createSignal<CreationMode | null>(null);
  const [creationName, setCreationName] = createSignal('');
  const [creationImage, setCreationImage] = createSignal('');
  const [creationDriver, setCreationDriver] = createSignal('local');
  const [creationCommand, setCreationCommand] = createSignal('');
  const [creationRestart, setCreationRestart] = createSignal('no');
  const [creationCPUs, setCreationCPUs] = createSignal('');
  const [creationMemory, setCreationMemory] = createSignal('');
  const [pendingConfirmation, setPendingConfirmation] = createSignal<MutationDraft | null>(null);
  const [confirmation, setConfirmation] = createSignal('');
  const [review, setReview] = createSignal<ReviewState | null>(null);
  const [mutationBusy, setMutationBusy] = createSignal(false);
  const [logs, setLogs] = createSignal<ContainerLogLine[] | null>(null);
  const [stats, setStats] = createSignal<ContainerStats | null>(null);
  const [inspectorMode, setInspectorMode] = createSignal<'details' | 'logs' | 'stats'>('details');
  let endpointLoadSequence = 0;
  let inventoryLoadSequence = 0;
  let operationStreamAbort: AbortController | null = null;

  const permissions = createMemo(() => env.env()?.permissions);
  const canRead = createMemo(() => Boolean(permissions()?.can_read));
  const canExecute = createMemo(() => canRead() && Boolean(permissions()?.can_execute));
  const canRWX = createMemo(() => canExecute() && Boolean(permissions()?.can_write));
  const canAdmin = createMemo(() => Boolean(permissions()?.can_admin || permissions()?.is_owner));
  const availableViews = createMemo<readonly ContainerResourceView[]>(() => engine() === 'podman'
    ? ['containers', 'images', 'volumes', 'pods']
    : ['containers', 'images', 'volumes', 'compose-projects']);
  const selected = createMemo(() => inventory().find((item) => resourceIdentity(view(), item) === selectedIdentity()) ?? null);
  const selectedManagedOwner = createMemo(() => resourceManagement(selected())?.owner ?? null);
  const activeOperationCount = createMemo(() => operations().filter(operationActive).length);

  createEffect(() => {
    writeUIStorageJSON(storageKey(), {
      version: 1,
      engine: engine(),
      endpointID: endpointID(),
      view: view(),
      selectedIdentity: selectedIdentity(),
    } satisfies PersistedContainersState);
  });

  const loadOperations = async () => {
    if (!canRead()) return;
    try {
      setOperations(await listContainerOperations());
    } catch {
      // Inventory remains usable when operation history is temporarily unavailable.
    }
  };

  const loadEndpointInventory = async () => {
    const sequence = ++endpointLoadSequence;
    setLoading(true);
    setError('');
    try {
      const nextEndpoints = await listContainerEndpoints(engine());
      if (sequence !== endpointLoadSequence) return;
      setEndpoints(nextEndpoints);
      const current = nextEndpoints.find((item) => item.endpoint_id === endpointID());
      const nextEndpoint = current ?? nextEndpoints.find((item) => item.default) ?? nextEndpoints[0];
      setEndpointID(nextEndpoint?.endpoint_id ?? '');
      setEndpointStatus(nextEndpoint ?? null);
      if (nextEndpoint?.endpoint_id) {
        getContainerEndpointStatus(engine(), nextEndpoint.endpoint_id)
          .then((status) => sequence === endpointLoadSequence && setEndpointStatus(status))
          .catch(() => undefined);
      }
    } catch (cause) {
      if (sequence !== endpointLoadSequence) return;
      setEndpoints([]);
      setEndpointStatus(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === endpointLoadSequence) setLoading(false);
    }
  };

  const loadInventory = async (quiet = false) => {
    if (!canRead()) {
      setInventory([]);
      setError(i18n.t('containers.permissions.read'));
      return;
    }
    const sequence = ++inventoryLoadSequence;
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const items = await listContainerResources(view(), engine(), endpointID());
      if (sequence !== inventoryLoadSequence) return;
      setInventory(items);
      const currentIdentity = selectedIdentity();
      if (currentIdentity && !items.some((item) => resourceIdentity(view(), item) === currentIdentity)) {
        setSelectedIdentity('');
        setDetails(null);
        setLogs(null);
        setStats(null);
        notify.info(i18n.t('containers.notifications.inventoryChangedTitle'), i18n.t('containers.notifications.inventoryChangedMessage'));
      }
    } catch (cause) {
      if (sequence !== inventoryLoadSequence) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === inventoryLoadSequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  createEffect(() => {
    engine();
    void loadEndpointInventory().then(loadOperations);
  });

  createEffect(() => {
    endpointID();
    view();
    void loadInventory();
  });

  createEffect(() => {
    const identity = selectedIdentity();
    const currentView = view();
    if (!identity) {
      setDetails(null);
      return;
    }
    getContainerResourceDetails(currentView, identity, engine(), endpointID())
      .then(setDetails)
      .catch(() => setDetails(null));
  });

  createEffect(() => {
    if (!operations().some(operationActive)) return;
    const timer = window.setInterval(() => void loadOperations(), 1200);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    if (inspectorMode() !== 'stats' || view() !== 'containers' || !selectedIdentity()) return;
    const refresh = () => getContainerStats(selectedIdentity(), engine(), endpointID()).then(setStats).catch(() => setStats(null));
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  onMount(() => void loadOperations());
  onCleanup(() => operationStreamAbort?.abort());

  const setCurrentEngine = (next: ContainerEngine) => {
    setEngine(next);
    setEndpointID('');
    setSelectedIdentity('');
    setDetails(null);
    if (next === 'podman' && view() === 'compose-projects') setView('pods');
    if (next === 'docker' && view() === 'pods') setView('compose-projects');
  };

  const selectResource = (item: ContainerResourceInventoryItem) => {
    setSelectedIdentity(resourceIdentity(view(), item));
    setInspectorMode('details');
    setLogs(null);
    setStats(null);
  };

  const viewLabel = (value: ContainerResourceView): string => i18n.t(`containers.views.${value}` as Parameters<typeof i18n.t>[0]);

  const beginPreflight = async (draft: MutationDraft) => {
    setMutationBusy(true);
    try {
      const preflight = await preflightContainerOperation(draft.method, draft.request);
      setReview({ request: draft.request, preflight });
      setPendingConfirmation(null);
      setConfirmation('');
    } catch (cause) {
      notify.error(i18n.t('containers.notifications.preflightFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMutationBusy(false);
    }
  };

  const beginMutation = (draft: MutationDraft) => {
    if (draft.confirmationValue) {
      setConfirmation('');
      setPendingConfirmation(draft);
      return;
    }
    void beginPreflight(draft);
  };

  const submitConfirmation = () => {
    const pending = pendingConfirmation();
    if (!pending || confirmation() !== pending.confirmationValue) return;
    const request = { ...pending.request, confirmation_name: confirmation() };
    void beginPreflight({ ...pending, request });
  };

  const runReviewedOperation = async () => {
    const current = review();
    if (!current || (current.preflight.plan.requires_admin && !canAdmin())) return;
    setMutationBusy(true);
    try {
      const operation = await createContainerOperation(current.preflight, current.request);
      setReview(null);
      setOperationsOpen(true);
      setOperations((previous) => [operation, ...previous.filter((item) => item.operation_id !== operation.operation_id)]);
      operationStreamAbort?.abort();
      const controller = new AbortController();
      operationStreamAbort = controller;
      void subscribeContainerOperation(operation.operation_id, (next) => {
        setOperations((previous) => [next, ...previous.filter((item) => item.operation_id !== next.operation_id)]);
        if (TERMINAL_OPERATION_STATES.has(next.state)) {
          void loadInventory(true);
          if (next.state === 'succeeded') {
            notify.success(i18n.t('containers.notifications.operationCompleteTitle'), i18n.t('containers.notifications.operationCompleteMessage'));
          }
        }
      }, controller.signal).catch(() => loadOperations());
    } catch (cause) {
      notify.error(i18n.t('containers.notifications.operationFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMutationBusy(false);
    }
  };

  const actionRequest = (method: string): MutationDraft | null => {
    const item = selected();
    if (!item) return null;
    const base = { engine: engine(), endpoint_id: endpointID() };
    if (view() === 'containers') {
      const container = item as ContainerInventoryItem;
      const name = resourceName('containers', container);
      const force = method === 'containers.remove' && ['running', 'paused', 'restarting'].includes(container.state);
      return {
        method,
        request: { ...base, container_id: container.container_id, ...(force ? { force: true } : {}) },
        ...(method === 'containers.remove' || method === 'containers.kill'
          ? { confirmationLabel: name, confirmationValue: name }
          : {}),
      };
    }
    if (view() === 'images') {
      const image = item as ImageInventoryItem;
      const identity = resourceIdentity('images', image);
      return {
        method,
        request: { ...base, image: identity, ...(image.referenced_containers > 0 ? { force: true } : {}) },
        confirmationLabel: identity,
        confirmationValue: identity,
      };
    }
    if (view() === 'volumes') {
      const volume = item as VolumeInventoryItem;
      return { method, request: { ...base, name: volume.name }, confirmationLabel: volume.name, confirmationValue: volume.name };
    }
    if (view() === 'compose-projects') {
      const project = item as ComposeProjectInventoryItem;
      return {
        method,
        request: { ...base, project_id: project.project_id },
        ...(method === 'compose.projects.down' ? { confirmationLabel: project.name, confirmationValue: project.name } : {}),
      };
    }
    const pod = item as PodInventoryItem;
    return {
      method,
      request: { ...base, pod_id: pod.pod_id },
      ...(method === 'pods.remove' ? { confirmationLabel: pod.name, confirmationValue: pod.name } : {}),
    };
  };

  const runAction = (method: string) => {
    const request = actionRequest(method);
    if (request) beginMutation(request);
  };

  const prune = () => {
    const identities = inventory().filter((item) => {
      if (view() === 'images') return (item as ImageInventoryItem).referenced_containers === 0;
      if (view() === 'volumes') return (item as VolumeInventoryItem).referenced_containers === 0 && !resourceManagement(item)?.managed;
      return false;
    }).map((item) => resourceIdentity(view(), item));
    if (identities.length === 0) return;
    beginMutation({
      method: view() === 'images' ? 'images.prune' : 'volumes.prune',
      request: { engine: engine(), endpoint_id: endpointID(), resource_identities: identities },
    });
  };

  const submitCreation = () => {
    const mode = creationMode();
    const base = { engine: engine(), endpoint_id: endpointID() };
    let draft: MutationDraft | null = null;
    if (mode === 'container') {
      const memoryMiB = Number(creationMemory());
      const cpus = Number(creationCPUs());
      draft = {
        method: 'containers.create',
        request: {
          ...base,
          name: compact(creationName()),
          image: compact(creationImage()),
          ...(compact(creationCommand()) ? { command: [compact(creationCommand())] } : {}),
          ...(creationRestart() !== 'no' ? { restart_policy: creationRestart() } : {}),
          ...(Number.isFinite(cpus) && cpus > 0 ? { cpu_count: cpus } : {}),
          ...(Number.isFinite(memoryMiB) && memoryMiB > 0 ? { memory_bytes: Math.round(memoryMiB * 1024 * 1024) } : {}),
        },
      };
    } else if (mode === 'image') {
      draft = { method: 'images.pull', request: { ...base, image_ref: compact(creationImage()) } };
    } else if (mode === 'volume') {
      draft = { method: 'volumes.create', request: { ...base, name: compact(creationName()), driver: compact(creationDriver()) || 'local' } };
    } else if (mode === 'pod') {
      draft = { method: 'pods.create', request: { ...base, name: compact(creationName()) } };
    } else if (mode === 'image-tag' && selected()) {
      draft = { method: 'images.tag', request: { ...base, image: resourceIdentity('images', selected()!), tag: compact(creationImage()) } };
    }
    if (!draft) return;
    setCreationMode(null);
    beginMutation(draft);
  };

  const openCreation = (mode: CreationMode) => {
    setCreationName('');
    setCreationImage('');
    setCreationDriver('local');
    setCreationCommand('');
    setCreationRestart('no');
    setCreationCPUs('');
    setCreationMemory('');
    setCreationMode(mode);
  };

  const loadLogs = async () => {
    if (!selectedIdentity()) return;
    setInspectorMode('logs');
    try {
      setLogs(await tailContainerLogs(selectedIdentity(), engine(), endpointID()));
    } catch (cause) {
      notify.error(i18n.t('containers.notifications.logsFailedTitle'), cause instanceof Error ? cause.message : String(cause));
    }
  };

  const openManagedService = () => {
    const owner = selectedManagedOwner();
    if (!owner) return;
    writeUIStorageJSON('webServices:focus', { version: 1, serviceID: owner.service_id });
    env.goActivity('ports');
  };

  const handleTableKey = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.key === 'Enter') {
      const item = inventory()[index];
      if (item) selectResource(item);
      return;
    }
    const nextIndex = Math.max(0, Math.min(inventory().length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const row = document.querySelector<HTMLElement>(`[data-container-resource-row-index="${nextIndex}"]`);
    row?.focus();
  };

  const renderResourceActions = () => {
    if (!selected() || selectedManagedOwner()) return null;
    if (view() === 'containers') {
      const state = (selected() as ContainerInventoryItem).state;
      return (
        <>
          <Show when={state !== 'running'}><Button size="sm" onClick={() => runAction('containers.start')} disabled={!canExecute()}><Play class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.start')}</Button></Show>
          <Show when={state === 'running'}><Button size="sm" variant="outline" onClick={() => runAction('containers.stop')} disabled={!canExecute()}><Stop class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.stop')}</Button></Show>
          <Button size="sm" variant="outline" onClick={() => runAction('containers.restart')} disabled={!canExecute()}><Refresh class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.restart')}</Button>
          <Show when={state === 'running'}><Button size="sm" variant="ghost" onClick={() => runAction('containers.pause')} disabled={!canExecute()}><Pause class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.pause')}</Button></Show>
          <Show when={state === 'paused'}><Button size="sm" variant="ghost" onClick={() => runAction('containers.unpause')} disabled={!canExecute()}><Play class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.resume')}</Button></Show>
          <Button size="sm" variant="ghost" onClick={() => runAction('containers.kill')} disabled={!canExecute() || !canAdmin()}>{i18n.t('containers.actions.kill')}</Button>
          <Button size="sm" variant="ghost" onClick={() => runAction('containers.remove')} disabled={!canRWX() || !canAdmin()}><Trash class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>
        </>
      );
    }
    if (view() === 'images') return (
      <>
        <Button size="sm" variant="outline" onClick={() => openCreation('image-tag')} disabled={!canRWX()}>{i18n.t('containers.actions.tag')}</Button>
        <Button size="sm" variant="ghost" onClick={() => runAction('images.remove')} disabled={!canRWX() || !canAdmin()}><Trash class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>
      </>
    );
    if (view() === 'volumes') return <Button size="sm" variant="ghost" onClick={() => runAction('volumes.remove')} disabled={!canRWX() || !canAdmin()}><Trash class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.actions.remove')}</Button>;
    if (view() === 'compose-projects') return (
      <>
        <Button size="sm" onClick={() => runAction('compose.projects.start')} disabled={!canExecute()}>{i18n.t('containers.actions.start')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('compose.projects.stop')} disabled={!canExecute()}>{i18n.t('containers.actions.stop')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('compose.projects.restart')} disabled={!canExecute()}>{i18n.t('containers.actions.restart')}</Button>
        <Button size="sm" variant="ghost" onClick={() => runAction('compose.projects.down')} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.actions.down')}</Button>
      </>
    );
    return (
      <>
        <Button size="sm" onClick={() => runAction('pods.start')} disabled={!canExecute()}>{i18n.t('containers.actions.start')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('pods.stop')} disabled={!canExecute()}>{i18n.t('containers.actions.stop')}</Button>
        <Button size="sm" variant="outline" onClick={() => runAction('pods.restart')} disabled={!canExecute()}>{i18n.t('containers.actions.restart')}</Button>
        <Button size="sm" variant="ghost" onClick={() => runAction('pods.remove')} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.actions.remove')}</Button>
      </>
    );
  };

  return (
    <div class="redeven-containers flex h-full min-h-0 flex-col bg-background" data-container-page data-variant={props.variant ?? 'activity'}>
      <header class="border-b bg-background/95 px-3 py-3 backdrop-blur md:px-5">
        <div class="flex flex-wrap items-center gap-3">
          <div class="min-w-0">
            <h1 class="text-base font-semibold tracking-tight">{i18n.t('containers.title')}</h1>
            <p class="hidden text-xs text-muted-foreground sm:block">{i18n.t('containers.description')}</p>
          </div>
          <div class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div class="inline-flex rounded-lg border bg-muted/30 p-0.5" role="radiogroup" aria-label={i18n.t('containers.engine')}>
              <For each={['docker', 'podman'] as const}>{(value) => (
                <button type="button" role="radio" aria-checked={engine() === value} class={`container-touch-target rounded-md px-3 text-xs font-semibold uppercase tracking-wide ${engine() === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`} onClick={() => setCurrentEngine(value)}>{value}</button>
              )}</For>
            </div>
            <label class="sr-only" for={`container-endpoint-${props.stateScope ?? 'activity'}`}>{i18n.t('containers.endpoint')}</label>
            <select id={`container-endpoint-${props.stateScope ?? 'activity'}`} class="container-touch-target max-w-[220px] rounded-lg border bg-background px-3 text-sm" value={endpointID()} onChange={(event) => setEndpointID(event.currentTarget.value)}>
              <For each={endpoints()}>{(endpoint) => <option value={endpoint.endpoint_id}>{endpoint.display_name}</option>}</For>
            </select>
            <Tag variant={endpointStatus()?.available ? 'success' : 'warning'} tone="soft" size="sm">
              {endpointStatus()?.available ? i18n.t('containers.status.connected') : i18n.t('containers.status.unavailable')}
            </Tag>
            <Button size="sm" variant="ghost" onClick={() => void loadInventory(true)} disabled={refreshing()} aria-label={i18n.t('containers.actions.refresh')}><Refresh class={`h-4 w-4 ${refreshing() ? 'animate-spin motion-reduce:animate-none' : ''}`} /></Button>
            <Button size="sm" variant="outline" onClick={() => setOperationsOpen(true)}>{i18n.t('containers.operations.title')}<Show when={activeOperationCount() > 0}><span class="ml-2 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{activeOperationCount()}</span></Show></Button>
          </div>
        </div>
      </header>

      <nav class="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 md:px-5" aria-label={i18n.t('containers.resourceNavigation')}>
        <For each={availableViews()}>{(item) => (
          <button type="button" class={`container-touch-target whitespace-nowrap rounded-lg px-3 text-sm font-medium ${view() === item ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} aria-current={view() === item ? 'page' : undefined} onClick={() => { setView(item); setSelectedIdentity(''); }}>{viewLabel(item)}</button>
        )}</For>
      </nav>

      <div class="flex min-h-0 flex-1">
        <main class="min-w-0 flex-1 overflow-auto p-3 md:p-5" aria-busy={loading()}>
          <div class="mb-3 flex min-h-11 items-center gap-2">
            <div class="text-sm font-medium">{viewLabel(view())}</div>
            <span class="text-xs text-muted-foreground">{inventory().length}</span>
            <div class="ml-auto flex items-center gap-2">
              <Show when={view() === 'images' || view() === 'volumes'}><Button size="sm" variant="outline" onClick={prune} disabled={!canRWX() || !canAdmin()}>{i18n.t('containers.actions.prune')}</Button></Show>
              <Show when={view() === 'containers'}><Button size="sm" onClick={() => openCreation('container')} disabled={!canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.container')}</Button></Show>
              <Show when={view() === 'images'}><Button size="sm" onClick={() => openCreation('image')} disabled={!canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.image')}</Button></Show>
              <Show when={view() === 'volumes'}><Button size="sm" onClick={() => openCreation('volume')} disabled={!canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.volume')}</Button></Show>
              <Show when={view() === 'pods'}><Button size="sm" onClick={() => openCreation('pod')} disabled={!canRWX()}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.create.pod')}</Button></Show>
            </div>
          </div>

          <Show when={error()}><div class="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />{error()}</div></Show>
          <Show when={!loading()} fallback={<div class="grid gap-2" aria-label={i18n.t('containers.loading')}><For each={[1, 2, 3, 4]}>{() => <div class="h-12 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />}</For></div>}>
            <Show when={inventory().length > 0} fallback={<div class="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed text-center"><Layers class="h-8 w-8 text-muted-foreground/50" /><div class="mt-3 text-sm font-medium">{i18n.t('containers.empty.title')}</div><p class="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{i18n.t('containers.empty.description')}</p></div>}>
              <div class="hidden overflow-hidden rounded-xl border md:block">
                <table class="w-full table-fixed text-left text-sm">
                  <thead class="bg-muted/45 text-xs text-muted-foreground"><tr><th class="w-[38%] px-3 py-2.5 font-medium">{i18n.t('containers.columns.name')}</th><th class="w-[24%] px-3 py-2.5 font-medium">{i18n.t('containers.columns.status')}</th><th class="px-3 py-2.5 font-medium">{i18n.t('containers.columns.details')}</th></tr></thead>
                  <tbody class="divide-y">
                    <For each={inventory()}>{(item, index) => (
                      <tr tabindex={0} data-container-resource-row-index={index()} aria-selected={selectedIdentity() === resourceIdentity(view(), item)} class={`cursor-pointer outline-none hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${selectedIdentity() === resourceIdentity(view(), item) ? 'bg-primary/[0.06]' : ''}`} onClick={() => selectResource(item)} onKeyDown={(event) => handleTableKey(event, index())}>
                        <td class="px-3 py-3"><div class="truncate font-medium">{resourceName(view(), item)}</div><div class="truncate font-mono text-[11px] text-muted-foreground">{resourceIdentity(view(), item)}</div></td>
                        <td class="px-3 py-3"><Tag variant={resourceStatus(view(), item) === 'running' ? 'success' : 'neutral'} tone="soft" size="sm">{resourceStatus(view(), item) || '—'}</Tag></td>
                        <td class="px-3 py-3 text-xs text-muted-foreground"><Show when={resourceManagement(item)?.managed} fallback={view() === 'images' ? formatBytes((item as ImageInventoryItem).size_bytes) : '—'}>{i18n.t('containers.managed.badge')}</Show></td>
                      </tr>
                    )}</For>
                  </tbody>
                </table>
              </div>
              <div class="grid gap-2 md:hidden">
                <For each={inventory()}>{(item) => (
                  <button type="button" class="container-touch-target rounded-xl border bg-card p-3 text-left" onClick={() => selectResource(item)}>
                    <div class="flex items-start gap-3"><div class="min-w-0 flex-1"><div class="truncate text-sm font-medium">{resourceName(view(), item)}</div><div class="mt-1 truncate font-mono text-[10px] text-muted-foreground">{resourceIdentity(view(), item)}</div></div><Tag variant={resourceStatus(view(), item) === 'running' ? 'success' : 'neutral'} tone="soft" size="sm">{resourceStatus(view(), item) || '—'}</Tag></div>
                    <Show when={resourceManagement(item)?.managed}><div class="mt-2 text-xs text-primary">{i18n.t('containers.managed.badge')}</div></Show>
                  </button>
                )}</For>
              </div>
            </Show>
          </Show>
        </main>

        <Show when={selected()}>
          <aside class="container-inspector z-20 flex w-[380px] shrink-0 flex-col border-l bg-background max-md:fixed max-md:inset-0 max-md:w-auto" aria-label={i18n.t('containers.inspector.title')}>
            <div class="flex min-h-14 items-center gap-2 border-b px-4"><div class="min-w-0 flex-1"><div class="truncate text-sm font-semibold">{resourceName(view(), selected()!)}</div><div class="truncate font-mono text-[10px] text-muted-foreground">{selectedIdentity()}</div></div><Button size="sm" variant="ghost" onClick={() => setSelectedIdentity('')} aria-label={i18n.t('containers.actions.close')}><X class="h-4 w-4" /></Button></div>
            <Show when={view() === 'containers'}><div class="flex gap-1 border-b p-2"><Button size="sm" variant={inspectorMode() === 'details' ? 'default' : 'ghost'} onClick={() => setInspectorMode('details')}>{i18n.t('containers.inspector.details')}</Button><Button size="sm" variant={inspectorMode() === 'logs' ? 'default' : 'ghost'} onClick={() => void loadLogs()}><FileText class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.inspector.logs')}</Button><Button size="sm" variant={inspectorMode() === 'stats' ? 'default' : 'ghost'} onClick={() => setInspectorMode('stats')}>{i18n.t('containers.inspector.stats')}</Button></div></Show>
            <div class="min-h-0 flex-1 overflow-auto p-4">
              <Show when={selectedManagedOwner()} keyed>{(owner) => <div class="mb-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-3"><div class="text-sm font-medium">{i18n.t('containers.managed.title')}</div><p class="mt-1 text-xs leading-5 text-muted-foreground">{i18n.t('containers.managed.description', { name: owner.name })}</p><Button size="sm" class="mt-3" onClick={openManagedService}>{i18n.t('containers.managed.openService')}</Button></div>}</Show>
              <Show when={inspectorMode() === 'details'}><pre class="whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-[11px] leading-5">{JSON.stringify(details() ?? selected(), null, 2)}</pre></Show>
              <Show when={inspectorMode() === 'logs'}><div class="rounded-lg bg-[var(--redeven-terminal-background,var(--muted))] p-3 font-mono text-[11px] leading-5"><Show when={logs()} fallback={<span class="text-muted-foreground">{i18n.t('containers.loading')}</span>}><For each={logs() ?? []}>{(line) => <div class="whitespace-pre-wrap break-all">{line.message}</div>}</For></Show></div></Show>
              <Show when={inspectorMode() === 'stats'}><Show when={stats()} fallback={<div class="text-sm text-muted-foreground">{i18n.t('containers.loading')}</div>}>{(value) => <div class="grid grid-cols-2 gap-3"><StatCard label={i18n.t('containers.stats.cpu')} value={`${value().cpu_percent.toFixed(1)}%`} /><StatCard label={i18n.t('containers.stats.memory')} value={formatBytes(value().memory_bytes)} /><StatCard label={i18n.t('containers.stats.networkIn')} value={formatBytes(value().network_rx_bytes)} /><StatCard label={i18n.t('containers.stats.networkOut')} value={formatBytes(value().network_tx_bytes)} /></div>}</Show></Show>
            </div>
            <div class="flex flex-wrap gap-2 border-t p-3">{renderResourceActions()}</div>
          </aside>
        </Show>
      </div>

      <EnvAppDrawer open={operationsOpen()} onOpenChange={setOperationsOpen} title={i18n.t('containers.operations.title')} description={i18n.t('containers.operations.description')} bodyClass="min-h-0">
        <div class="max-h-[70vh] space-y-2 overflow-auto p-1">
          <Show when={operations().length > 0} fallback={<div class="py-12 text-center text-sm text-muted-foreground">{i18n.t('containers.operations.empty')}</div>}>
            <For each={operations()}>{(operation) => <div class="rounded-xl border p-3"><div class="flex items-start gap-3"><div class="min-w-0 flex-1"><div class="truncate text-sm font-medium">{operation.method}</div><div class="mt-1 truncate font-mono text-[10px] text-muted-foreground">{operation.resource_identity}</div></div><Tag variant={operation.state === 'succeeded' ? 'success' : operation.state === 'failed' || operation.state === 'interrupted' ? 'error' : 'neutral'} tone="soft" size="sm">{operation.state}</Tag></div><Show when={operation.error_message}><p class="mt-2 text-xs text-destructive">{operation.error_message}</p></Show><Show when={operationActive(operation)}><Button size="sm" variant="ghost" class="mt-2" onClick={() => void cancelContainerOperation(operation.operation_id).then(loadOperations)} disabled={!canExecute()}>{i18n.t('containers.actions.cancel')}</Button></Show></div>}</For>
          </Show>
        </div>
      </EnvAppDrawer>

      <Dialog open={creationMode() !== null} onOpenChange={(open) => !open && setCreationMode(null)} title={creationMode() === 'image-tag' ? i18n.t('containers.create.tagTitle') : i18n.t('containers.create.title')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setCreationMode(null)}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" onClick={submitCreation} disabled={mutationBusy() || (creationMode() === 'container' && !compact(creationImage())) || (creationMode() !== 'container' && !compact(creationName() || creationImage()))}>{i18n.t('containers.actions.review')}</Button></div>}>
        <div class="space-y-4">
          <Show when={creationMode() === 'container'}><label class="block text-sm font-medium">{i18n.t('containers.fields.name')}<Input class="mt-1.5" value={creationName()} onInput={(event) => setCreationName(event.currentTarget.value)} /></label><label class="block text-sm font-medium">{i18n.t('containers.fields.image')}<Input class="mt-1.5" value={creationImage()} onInput={(event) => setCreationImage(event.currentTarget.value)} placeholder="ghcr.io/example/app:latest" /></label><details class="rounded-lg border p-3"><summary class="cursor-pointer text-sm font-medium">{i18n.t('containers.create.advanced')}</summary><div class="mt-3 grid gap-3 sm:grid-cols-2"><label class="text-xs">{i18n.t('containers.fields.command')}<Input class="mt-1" value={creationCommand()} onInput={(event) => setCreationCommand(event.currentTarget.value)} /></label><label class="text-xs">{i18n.t('containers.fields.restartPolicy')}<select class="container-touch-target mt-1 w-full rounded-md border bg-background px-2" value={creationRestart()} onChange={(event) => setCreationRestart(event.currentTarget.value)}><option value="no">no</option><option value="always">always</option><option value="unless-stopped">unless-stopped</option><option value="on-failure">on-failure</option></select></label><label class="text-xs">{i18n.t('containers.fields.cpus')}<Input class="mt-1" inputmode="decimal" value={creationCPUs()} onInput={(event) => setCreationCPUs(event.currentTarget.value)} /></label><label class="text-xs">{i18n.t('containers.fields.memory')}<Input class="mt-1" inputmode="numeric" value={creationMemory()} onInput={(event) => setCreationMemory(event.currentTarget.value)} /></label></div></details></Show>
          <Show when={creationMode() === 'image'}><label class="block text-sm font-medium">{i18n.t('containers.fields.image')}<Input class="mt-1.5" value={creationImage()} onInput={(event) => setCreationImage(event.currentTarget.value)} placeholder="docker.io/library/nginx:latest" /></label></Show>
          <Show when={creationMode() === 'volume'}><label class="block text-sm font-medium">{i18n.t('containers.fields.name')}<Input class="mt-1.5" value={creationName()} onInput={(event) => setCreationName(event.currentTarget.value)} /></label><label class="block text-sm font-medium">{i18n.t('containers.fields.driver')}<Input class="mt-1.5" value={creationDriver()} onInput={(event) => setCreationDriver(event.currentTarget.value)} /></label></Show>
          <Show when={creationMode() === 'pod'}><label class="block text-sm font-medium">{i18n.t('containers.fields.name')}<Input class="mt-1.5" value={creationName()} onInput={(event) => setCreationName(event.currentTarget.value)} /></label></Show>
          <Show when={creationMode() === 'image-tag'}><label class="block text-sm font-medium">{i18n.t('containers.fields.tag')}<Input class="mt-1.5" value={creationImage()} onInput={(event) => setCreationImage(event.currentTarget.value)} placeholder="example/app:release" /></label></Show>
        </div>
      </Dialog>

      <Dialog open={pendingConfirmation() !== null} onOpenChange={(open) => !open && setPendingConfirmation(null)} title={i18n.t('containers.confirm.title')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setPendingConfirmation(null)}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" variant="default" onClick={submitConfirmation} disabled={confirmation() !== pendingConfirmation()?.confirmationValue || mutationBusy()}>{i18n.t('containers.actions.review')}</Button></div>}>
        <div class="rounded-lg border border-[var(--redeven-status-warning-border)] bg-[var(--redeven-status-warning-soft)] p-3"><div class="flex gap-2 text-sm font-medium text-[var(--redeven-status-warning-foreground)]"><AlertTriangle class="h-4 w-4" />{i18n.t('containers.confirm.warning')}</div><p class="mt-2 text-xs leading-5 text-muted-foreground">{i18n.t('containers.confirm.typeName', { name: pendingConfirmation()?.confirmationLabel ?? '' })}</p></div>
        <Input class="mt-4" value={confirmation()} onInput={(event) => setConfirmation(event.currentTarget.value)} autocomplete="off" />
      </Dialog>

      <Dialog open={review() !== null} onOpenChange={(open) => !open && setReview(null)} title={i18n.t('containers.review.title')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setReview(null)}>{i18n.t('containers.actions.cancel')}</Button><Button size="sm" onClick={() => void runReviewedOperation()} disabled={mutationBusy() || (review()?.preflight.plan.requires_admin && !canAdmin())}>{i18n.t('containers.actions.run')}</Button></div>}>
        <Show when={review()} keyed>{(current) => <div class="space-y-3"><div class="flex items-center justify-between rounded-lg border p-3"><div><div class="text-xs text-muted-foreground">{i18n.t('containers.review.operation')}</div><div class="mt-1 font-mono text-sm">{current.preflight.method}</div></div><Tag variant={current.preflight.plan.risk_level === 'high' || current.preflight.plan.risk_level === 'critical' ? 'warning' : 'neutral'} tone="soft" size="sm">{current.preflight.plan.risk_level}</Tag></div><For each={current.preflight.plan.summary ?? []}>{(summary) => <p class="text-sm text-muted-foreground">{summary}</p>}</For><For each={current.preflight.plan.risk_flags ?? []}>{(flag) => <div class="rounded-lg border border-[var(--redeven-status-warning-border)] bg-[var(--redeven-status-warning-soft)] p-3"><div class="text-sm font-medium text-[var(--redeven-status-warning-foreground)]">{flag.title}</div><p class="mt-1 text-xs leading-5 text-muted-foreground">{flag.detail}</p></div>}</For><Show when={current.preflight.plan.requires_admin && !canAdmin()}><p class="text-sm text-destructive">{i18n.t('containers.permissions.admin')}</p></Show><div class="grid gap-1 rounded-lg bg-muted/40 p-3 font-mono text-[10px] text-muted-foreground"><span>{current.preflight.request_hash}</span><span>{current.preflight.plan_hash}</span></div></div>}</Show>
      </Dialog>
    </div>
  );
}

function StatCard(props: { label: string; value: string }) {
  return <div class="rounded-xl border bg-card p-3"><div class="text-[11px] text-muted-foreground">{props.label}</div><div class="mt-1 text-lg font-semibold tabular-nums">{props.value}</div></div>;
}
