import { createContainerOperationSession } from '../../services/containerOperationSession';
import { useSettingsPanelHost } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { SettingsSelect as Select } from './SettingsSelect';
import { secureRandomUUID } from '@floegence/floe-webapp-core';
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, on, untrack } from 'solid-js';
import { Button, Input, Tabs, Tag, SettingsSection, SettingsList, SettingRow } from '@floegence/floe-webapp-core/ui';
import { AlertTriangle, Eye, EyeOff, Info, Lock, Plus, Refresh, Trash } from '@floegence/floe-webapp-core/icons';
import { SettingsResourceHeader, SettingsResourceList, SettingsResourceRow } from './SettingsResources';
import { ContainersWorkbenchIcon } from '../../icons/ContainersIcon';
import { useEnvContext } from '../EnvContext';
import { useI18n } from '../../i18n';
import { useEnvSettingsPage } from './EnvSettingsPageContext';
import { TextFilePreviewPane } from '../../widgets/TextFilePreviewPane';
import { createEnvCachedResource, createEnvResourceCollection } from '../../services/envResourceCache';
import { containerServiceSnapshot } from '../../services/envResourceSnapshots';
import { ContainerOperationRejectedError, listContainerServices, getContainerServiceConfiguration, preflightContainerOperation, getContainerOperation, getContainerOperationByRequestID,
  type ContainerService, type ContainerServiceConfiguration, type ContainerServiceConfigurationSource, type ContainerServiceConfigurationSourceID, type ContainerPreflight, type ContainerOperation } from '../../services/containerResourcesApi';
import '../container-operation-dialogs.css';

type ContainerServiceConfigurationDraft = Readonly<{
  baseRevision: string;
  content: string;
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
  revealHTTPProxy: boolean;
  revealHTTPSProxy: boolean;
}>;

type ContainerServiceConfigurationSection = 'general' | 'proxy' | 'credentials' | 'advanced';
type DockerCLIConfigurationDocument = Record<string, unknown>;
const dockerCLIOutputFormats = [
  { key: 'psFormat', command: 'docker ps' },
  { key: 'imagesFormat', command: 'docker images' },
  { key: 'networksFormat', command: 'docker network ls' },
  { key: 'pluginsFormat', command: 'docker plugin ls' },
  { key: 'statsFormat', command: 'docker stats' },
  { key: 'servicesFormat', command: 'docker service ls' },
  { key: 'tasksFormat', command: 'docker service ps' },
  { key: 'secretFormat', command: 'docker secret ls' },
  { key: 'configFormat', command: 'docker config ls' },
  { key: 'nodeFormat', command: 'docker node ls' },
] as const;

const jsonObject = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const parseDockerCLIConfiguration = (value: string): DockerCLIConfigurationDocument | null => {
  try {
    return jsonObject(JSON.parse(value)) as DockerCLIConfigurationDocument | null;
  } catch {
    return null;
  }
};

const dockerCLIString = (document: DockerCLIConfigurationDocument | null, key: string): string => (
  typeof document?.[key] === 'string' ? document[key] as string : ''
);

const objectWithString = (value: unknown, key: string, next: string): Record<string, unknown> => {
  const document = { ...(jsonObject(value) ?? {}) };
  if (next === '') delete document[key];
  else document[key] = next;
  return document;
};

// IMPORTANT: Configuration is owned here, never by the container work surface.
// Opening a target performs reads only. An unknown ID must not select another service.
export function ContainerSettingsPanel(props: { resource?: string }) {
  const host = useSettingsPanelHost();
  const env = useEnvContext();
  const i18n = useI18n();
  const ctx = useEnvSettingsPage();
  const cache = createEnvCachedResource(env, () => 'container-services', containerServiceSnapshot);
  const [services, { refetch }] = createResource(() => cache.ready() && !!env.env()?.permissions?.can_read, async () => cache.refresh(listContainerServices));
  const serviceData = () => services.error ? undefined : services();
  const [selected, setSelected] = createSignal('');
  const [refreshRevision, setRefreshRevision] = createSignal(0);
  const stableServices = new Map<string, ContainerService>();
  createEffect(() => { for (const service of serviceData() ?? []) stableServices.set(service.service_id, service); });
  const ids = createMemo(() => (serviceData() ?? []).map(service => service.service_id));
  const target = () => host ? props.resource ?? '' : props.resource ?? selected();
  const presented = () => !host || host.present() && host.target()?.section === 'containers';
  const choose = (id: string) => { if (!presented()) return; setSelected(id); env.openSettings('containers', id ? { resource: id } : undefined); };
  const [visited, setVisited] = createSignal<string[]>([]);
  createEffect(() => { const id = target(); if (id && ids().includes(id)) setVisited(old => old.includes(id) ? old : [...old, id]); });
  return <div class="space-y-5 min-w-0" data-testid="container-settings-panel" aria-busy={services.loading}>
    <SettingsResourceHeader active={presented()}><div class="settings-resource-header">
      <Show when={target()}><div data-settings-resource-picker><Select section="containers" class="w-full" value={target()} onChange={choose}
        options={[{ value: '', label: i18n.t('containers.services.title') }, ...(serviceData() ?? []).map(service => ({ value: service.service_id, label: service.name })), ...(target() && !ids().includes(target()) ? [{ value: target(), label: i18n.t('settings.targetUnavailable'), disabled: true }] : [])]} ariaLabel={i18n.t('containers.services.title')} /></div></Show>
      <Button data-settings-config-refresh size="icon" variant="ghost" icon={Refresh} disabled={services.loading || !ctx.canInteract()} onClick={() => { if (!presented() || !ctx.canInteract()) return; void refetch(); setRefreshRevision(value => value + 1); }} aria-label={i18n.t('common.actions.refresh')} title={i18n.t('common.actions.refresh')} />
    </div></SettingsResourceHeader>
    <Show when={!target() && ids().length}><SettingsResourceList label={i18n.t('containers.services.title')}>
      <For each={serviceData()}>{service => <SettingsResourceRow label={service.name} onClick={() => choose(service.service_id)}><ContainersWorkbenchIcon /><span class="settings-resource-name">{service.name}</span></SettingsResourceRow>}</For>
    </SettingsResourceList></Show>
    <Show when={!target() && !services.loading && !services.error && !ids().length}><p role="status" class="text-xs text-muted-foreground">{i18n.t('containers.empty.title')}</p></Show>
    <Show when={services.error}><p role="alert">{String(services.error)}</p></Show>
    <Show when={target() && !services.loading && !ids().includes(target())}><p role="alert">{i18n.t('settings.targetUnavailable')}</p></Show>
    <For each={visited()}>{id => <div hidden={target() !== id} inert={target() !== id}>
      <ContainerServiceSettings refreshRevision={refreshRevision()} service={(serviceData() ?? []).find(service => service.service_id === id) ?? stableServices.get(id)!} available={() => ids().includes(id)} active={() => target() === id && (!host || host.present() && host.target()?.section === 'containers' && host.target()?.resource === id)} captureAuthority={cache.captureAuthority} />
    </div>}</For>
  </div>;
}

function ContainerServiceSettings(props: { refreshRevision: number; service: ContainerService; available: () => boolean; active: () => boolean; captureAuthority: () => () => boolean }) {
  const env = useEnvContext();
  const operationSession = env.containerOperationSession ?? createContainerOperationSession(env);
  const i18n = useI18n();
  const ctx = useEnvSettingsPage();
  const lifetime = new AbortController();
  const resources = createEnvResourceCollection(env);
  const current = () => !lifetime.signal.aborted && resources.ready() && props.available();
  const capture = () => { const authority = props.captureAuthority(); return () => current() && authority(); };
  const [reviewCurrent, setReviewCurrent] = createSignal<() => boolean>(() => false);
  const [pendingRequestID, setPendingRequestID] = createSignal('');
  const [uncertain, setUncertain] = createSignal(false);
  const [dirtySources, setDirtySources] = createSignal<ReadonlySet<string>>(new Set());
  const dirty = () => dirtySources().size > 0;
  const [pendingSource, setPendingSource] = createSignal<string>();
  let sourceSequence = 0;
  onCleanup(() => lifetime.abort());
  const sessionBusy = () => operationSession.admissions().some(item => item.preflight.resource_kind === 'container_service' && item.preflight.resource_identity === props.service.service_id)
    || operationSession.operations().some(item => item.resource_kind === 'container_service' && item.resource_identity === props.service.service_id && !['succeeded', 'failed', 'canceled', 'interrupted'].includes(item.state));
  const canSave = () => props.active() && !sessionBusy() && !uncertain() && current() && ctx.canInteract() && ctx.canAdmin() && !!env.env()?.permissions?.can_read && !!env.env()?.permissions?.can_write && !!env.env()?.permissions?.can_execute;
  const [busy, setBusy] = createSignal(false);
  const [review, setReview] = createSignal<{ request: Record<string, unknown>; preflight: ContainerPreflight } | null>(null);
  const [operation, setOperation] = createSignal<ContainerOperation>();
  createEffect(() => {
    const admission = operationSession.admissions().find(item => item.preflight.resource_kind === 'container_service' && item.preflight.resource_identity === props.service.service_id);
    if (admission) { setPendingRequestID(admission.requestID); setUncertain(true); }
    const observed = operationSession.operations().find(item => item.request_id === pendingRequestID());
    if (observed) { setOperation(observed); setUncertain(!['succeeded', 'failed', 'canceled', 'interrupted'].includes(observed.state)); }
  });
  const [serviceConfigurationError, setServiceConfigurationError] = createSignal('');
  const [serviceConfigurationLoading, setServiceConfigurationLoading] = createSignal(false);
  const [serviceConfiguration, setServiceConfiguration] = createSignal<ContainerServiceConfiguration | null>(null);
  const serviceConfigurationTarget = () => props.service;
  const [serviceConfigurationSourceID, setServiceConfigurationSourceID] = createSignal<ContainerServiceConfigurationSourceID>('engine');
  const [serviceConfigurationMode, setServiceConfigurationMode] = createSignal<ContainerServiceConfigurationSection>('proxy');
  const [serviceConfigurationSecretsVisible, setServiceConfigurationSecretsVisible] = createSignal(false);
  const [serviceConfigurationDrafts, setServiceConfigurationDrafts] = createSignal<Partial<Record<ContainerServiceConfigurationSourceID, ContainerServiceConfigurationDraft>>>({});
  const serviceConfigurationSource = createMemo<ContainerServiceConfigurationSource | null>(() => (
    serviceConfiguration()?.sources.find((source) => source.source_id === serviceConfigurationSourceID()) ?? null
  ));
  const serviceConfigurationDraft = createMemo<ContainerServiceConfigurationDraft | null>(() => (
    serviceConfigurationDrafts()[serviceConfigurationSourceID()] ?? null
  ));
  const serviceConfigurationSourceEditable = createMemo(() => {
    const source = serviceConfigurationSource();
    if (!source?.base_revision || source.status === 'permission' || source.status === 'unsupported') return false;
    return source.source_id !== 'docker_cli' || source.status !== 'invalid';
  });
  const serviceConfigurationSections = createMemo<readonly ContainerServiceConfigurationSection[]>(() => {
    return serviceConfigurationSource()?.sections ?? [];
  });
  const dockerCLIConfigurationDocument = createMemo(() => (
    serviceConfigurationSource()?.source_id === 'docker_cli'
      ? parseDockerCLIConfiguration(serviceConfigurationDraft()?.content ?? '')
      : null
  ));
  const customizedDockerCLIOutputFormatCount = createMemo(() => {
    const document = dockerCLIConfigurationDocument();
    return dockerCLIOutputFormats.filter(({ key }) => dockerCLIString(document, key).trim() !== '').length;
  });
  const configurationDraftFromSource = (source: ContainerServiceConfigurationSource): ContainerServiceConfigurationDraft => ({
    baseRevision: source.base_revision ?? '',
    content: source.content ?? '',
    httpProxy: source.http_proxy ?? '',
    httpsProxy: source.https_proxy ?? '',
    noProxy: source.no_proxy ?? '',
    revealHTTPProxy: false,
    revealHTTPSProxy: false,
  });

  const updateServiceConfigurationDraft = (update: Partial<ContainerServiceConfigurationDraft>) => {
    const sourceID = serviceConfigurationSourceID();
    setDirtySources(old => new Set(old).add(sourceID));
    setServiceConfigurationDrafts((current) => ({
      ...current,
      [sourceID]: { ...(current[sourceID] ?? { baseRevision: '', content: '', httpProxy: '', httpsProxy: '', noProxy: '', revealHTTPProxy: false, revealHTTPSProxy: false }), ...update },
    }));
  };

  const updateDockerCLIConfiguration = (mutate: (document: DockerCLIConfigurationDocument) => void) => {
    const current = parseDockerCLIConfiguration(serviceConfigurationDraft()?.content ?? '');
    if (!current) return;
    mutate(current);
    updateServiceConfigurationDraft({ content: `${JSON.stringify(current, null, 2)}\n` });
  };

  const setDockerCLIString = (key: string, value: string) => updateDockerCLIConfiguration((document) => {
    if (value === '') delete document[key];
    else document[key] = value;
  });

  const setDockerCLIMapEntry = (section: string, previousKey: string, key: string, value: unknown) => updateDockerCLIConfiguration((document) => {
    const entries = { ...(jsonObject(document[section]) ?? {}) };
    if (previousKey !== key) delete entries[previousKey];
    if (key.trim() !== '') entries[key] = value;
    if (Object.keys(entries).length === 0) delete document[section];
    else document[section] = entries;
  });

  const removeDockerCLIMapEntry = (section: string, key: string) => updateDockerCLIConfiguration((document) => {
    const entries = { ...(jsonObject(document[section]) ?? {}) };
    delete entries[key];
    if (Object.keys(entries).length === 0) delete document[section];
    else document[section] = entries;
  });

  const addDockerCLIMapEntry = (section: 'proxies' | 'credHelpers', preferredKey: string, value: unknown) => updateDockerCLIConfiguration((document) => {
    const entries = { ...(jsonObject(document[section]) ?? {}) };
    let key = preferredKey;
    for (let suffix = 2; Object.hasOwn(entries, key); suffix += 1) key = `${preferredKey}-${suffix}`;
    entries[key] = value;
    document[section] = entries;
  });

  const selectServiceConfigurationSource = (sourceID: ContainerServiceConfigurationSourceID) => {
    const source = serviceConfiguration()?.sources.find((candidate) => candidate.source_id === sourceID);
    if (!source) return;
    setServiceConfigurationSourceID(sourceID);
    setServiceConfigurationMode(source.sections[0] ?? 'advanced');
    setServiceConfigurationError('');
  };

  const openServiceConfiguration = async (service: ContainerService, resetSource?: string) => {
    if (!current()) return;
    const admitted = capture();
    const sequence = ++sourceSequence;
    const requestCurrent = () => admitted() && sequence === sourceSequence;
    setReview(null);
    setServiceConfigurationError('');
    setServiceConfigurationSecretsVisible(false);
    if (service.configuration.mode !== 'local') {
      setServiceConfigurationLoading(false);
      return;
    }
    setServiceConfigurationLoading(true);
    try {
      const configuration = await getContainerServiceConfiguration(service.service_id, lifetime.signal);
      if (!requestCurrent()) return;
      setServiceConfiguration(configuration);
      setServiceConfigurationDrafts(previous => Object.fromEntries(configuration.sources.map(source => [source.source_id,
        dirtySources().has(source.source_id) && source.source_id !== resetSource ? previous[source.source_id] : configurationDraftFromSource(source),
      ])));
      if (resetSource) { setDirtySources(previous => { const next = new Set(previous); next.delete(resetSource); return next; }); setPendingSource(undefined); }
      const initialSource = configuration.sources[0];
      if (initialSource) {
        setServiceConfigurationSourceID(initialSource.source_id);
        setServiceConfigurationMode(initialSource.sections[0] ?? 'advanced');
      }
    } catch (cause) {
      if (requestCurrent()) {
        setServiceConfigurationError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (requestCurrent()) setServiceConfigurationLoading(false);
    }
  };

  // IMPORTANT: Resource navigation retires preflight/confirmation admission,
  // while accepted operations keep their original environment lifetime.
  let presentationRevision = 0;
  createEffect(on(props.active, () => { presentationRevision++; setReview(null); }));
  const submitServiceConfiguration = async (applyMode: 'save' | 'save_and_restart') => {
    const service = serviceConfigurationTarget();
    const source = serviceConfigurationSource();
    const draft = serviceConfigurationDraft();
    if (!service || !source || !draft || !draft.baseRevision || !canSave() || busy()) return;
    const mode = serviceConfigurationMode();
    const request = {
      engine: service.engine,
      service_id: service.service_id,
      source_id: source.source_id,
      confirmation_name: service.name,
      // IMPORTANT: A retained draft keeps its original CAS base across Refresh.
      // A new source revision never authorizes overwriting external edits.
      base_revision: draft.baseRevision,
      mode: source.source_id === 'docker_cli' || mode === 'advanced' ? 'document' : 'proxy',
      apply_mode: applyMode,
      ...(source.source_id !== 'docker_cli' && mode === 'proxy'
        ? { http_proxy: draft.httpProxy, https_proxy: draft.httpsProxy, no_proxy: draft.noProxy }
        : { content: draft.content }),
    };
    const admitted = capture(), presentation = presentationRevision;
    setBusy(true);
    setServiceConfigurationError('');
    try {
      const preflight = await preflightContainerOperation('container.services.configuration.update', request);
      if (admitted() && canSave() && presentation === presentationRevision) { setReviewCurrent(() => admitted); setReview({ preflight, request }); }
    } catch (error) { if (admitted()) setServiceConfigurationError(String(error)); }
    finally { if (admitted()) setBusy(false); }
  };

  createEffect(on(() => [resources.access().generation, resources.ready(), props.available()], () => {
    sourceSequence++; setServiceConfigurationLoading(false); setBusy(false); setReview(null);
    if (current()) untrack(() => { void openServiceConfiguration(props.service); });
  }));
  createEffect(() => { if (!canSave() || !reviewCurrent()()) setReview(null); });
  const runReviewedOperation = async () => {
    const confirmed = review();
    if (!confirmed || !canSave() || busy() || !reviewCurrent()()) return;
    const admitted = capture();
    const requestID = `envapp-${secureRandomUUID()}`; setPendingRequestID(requestID);
    setOperation(undefined); setPendingSource(String(confirmed.request.source_id));
    setUncertain(true);
    setBusy(true); setReview(null); setServiceConfigurationError('');
    // IMPORTANT: Submit only the reviewed request once, fenced to the current
    // environment authority. Never silently replay an uncertain save/restart.
    try {
      const started = await operationSession.submit(confirmed.preflight, confirmed.request, requestID);
      if (!admitted() || started.request_id !== requestID) return;
      setOperation(started);
      const completed = await operationSession.track(started);
      if (admitted() && completed.request_id === requestID) { setOperation(completed); setUncertain(false); }
      if (admitted() && operation()?.state === 'succeeded') await openServiceConfiguration(props.service, pendingSource());
    } catch (error) {
      if (admitted()) { if (error instanceof ContainerOperationRejectedError) setUncertain(false); setServiceConfigurationError(String(error)); }
    } finally { if (admitted()) setBusy(false); }
  };
  const reconcile = async () => {
    if (!current() || busy()) return;
    const admitted = capture(); setBusy(true);
    try {
      const known = operation();
      // IMPORTANT: Recovery uses exact identities, never a bounded recent list.
      // A 404 does not prove rejection and must not unlock an uncertain write.
      const observed = known ? await getContainerOperation(known.operation_id)
        : pendingRequestID() ? await getContainerOperationByRequestID(pendingRequestID()) : undefined;
      if (!admitted()) return;
      const match = observed?.request_id === pendingRequestID() && (!known || observed.operation_id === known.operation_id) ? observed : undefined;
      if (match) { operationSession.acceptAdmission(match.request_id, match); setOperation(match); setUncertain(!['succeeded', 'failed', 'canceled', 'interrupted'].includes(match.state)); }
      await openServiceConfiguration(props.service, match?.state === 'succeeded' ? pendingSource() : undefined);
    } catch (error) { if (admitted()) { await openServiceConfiguration(props.service); setServiceConfigurationError(String(error)); } }
    finally { if (admitted()) setBusy(false); }
  };
  createEffect(on(() => props.refreshRevision, () => { if (props.active()) void reconcile(); }, { defer: true }));
  // IMPORTANT: The global settings page owns scrolling; configuration fields
  // stay in natural flow and do not recreate the work surface's dialog viewport.
  return <section class="container-settings-configuration space-y-4" aria-label={i18n.t('containers.services.configurationTitle', { name: props.service.name })}>
    <Show when={props.service.configuration.mode === 'local' && ((serviceConfiguration()?.sources.length ?? 0) > 1 || dirty())}><header class="flex flex-wrap items-center gap-2">
      {/* IMPORTANT: The dialog header refreshes inventory and reconciles this
          exact editor; it cannot replace drafts or replay uncertain writes. */}
      <Show when={(serviceConfiguration()?.sources.length ?? 0) > 1}><Tabs class="min-w-0 flex-1" items={(serviceConfiguration()?.sources ?? []).map((source) => ({ id: source.source_id, label: i18n.t(source.source_id === 'docker_cli' ? 'containers.services.dockerCLI' : 'containers.services.engineConfiguration'), disabled: !canSave() || busy() || !!review() || serviceConfigurationLoading() }))} activeId={serviceConfigurationSourceID()} onChange={(id) => { if (canSave() && !busy() && !review() && !serviceConfigurationLoading()) selectServiceConfigurationSource(id as ContainerServiceConfigurationSourceID); }} size="md" ariaLabel={i18n.t('containers.services.configurationTitle', { name: serviceConfigurationTarget()?.name ?? '' })} features={{ indicator: { mode: 'slider', thicknessPx: 2, colorToken: 'primary', animated: true }, containerBorder: false }} /></Show>
      <Show when={dirty()}><Button size="sm" variant="ghost" disabled={busy() || uncertain() || !current()} onClick={() => void openServiceConfiguration(props.service, serviceConfigurationSourceID())}>{i18n.t('filePreview.discardChanges')}</Button></Show>
    </header></Show>
    <Show when={uncertain()}><p role="alert">{i18n.t('settings.operationUnknown')}</p></Show>
    <fieldset class="min-w-0 space-y-4" aria-busy={serviceConfigurationLoading()} disabled={!canSave() || busy() || !!review() || serviceConfigurationLoading()}>
      <Show when={props.service.configuration.mode === 'local'} fallback={<div class="container-service-config-unavailable"><AlertTriangle class="h-5 w-5" /><strong>{i18n.t('containers.services.configurationUnavailable')}</strong></div>}>
        <Show when={serviceConfiguration() || !serviceConfigurationLoading()} fallback={<div class="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" aria-hidden="true" />}>
          <Show when={serviceConfiguration()} fallback={<div class="container-service-config-error" role="alert"><AlertTriangle class="h-4 w-4" />{serviceConfigurationError()}</div>}>
            <Show when={serviceConfigurationError()}><div class="container-service-config-error" role="alert"><AlertTriangle class="h-4 w-4" />{serviceConfigurationError()}</div></Show>
            <Show when={serviceConfigurationSource()} keyed>{source => <>
              <SettingsList><SettingRow title={i18n.t('containers.services.configurationPath')} control={<Tag variant={source.status === 'ready' ? 'success' : source.status === 'missing' ? 'neutral' : 'error'} tone="soft" size="sm">{i18n.t(`containers.services.sourceStates.${source.status}` as Parameters<typeof i18n.t>[0])}</Tag>}>
                <code class="break-all text-xs text-muted-foreground">{source.display_path}</code>
              </SettingRow></SettingsList>
              <Show when={source.status === 'missing'}><div class="container-service-config-note"><Info class="h-4 w-4" />{i18n.t('containers.services.fileWillBeCreated')}</div></Show>
              <Show when={source.status === 'invalid'}><div class="container-service-config-note container-service-config-note--warning"><AlertTriangle class="h-4 w-4" />{i18n.t(source.source_id === 'docker_cli' ? 'containers.services.dockerCLIInvalid' : 'containers.services.configurationInvalid')}</div></Show>
              <Show when={source.status !== 'permission' && source.status !== 'unsupported'} fallback={<div class="container-service-config-unavailable"><AlertTriangle class="h-5 w-5" /><strong>{i18n.t(`containers.services.sourceStates.${source.status}` as Parameters<typeof i18n.t>[0])}</strong></div>}>
                <Show when={serviceConfigurationSections().length > 1}><Tabs items={serviceConfigurationSections().map((section) => ({ id: section, label: i18n.t(section === 'general' ? 'containers.services.general' : section === 'proxy' ? 'containers.services.proxies' : section === 'credentials' ? 'containers.services.credentials' : 'containers.services.advanced') }))} activeId={serviceConfigurationMode()} onChange={(id) => setServiceConfigurationMode(id as ContainerServiceConfigurationSection)} size="sm" ariaLabel={i18n.t('containers.services.configurationTitle', { name: serviceConfigurationTarget()?.name ?? '' })} features={{ indicator: { mode: 'slider', thicknessPx: 2, colorToken: 'primary', animated: true }, containerBorder: false }} /></Show>
                <Show when={source.source_id === 'docker_cli'} fallback={
                  <Show when={serviceConfigurationMode() === 'proxy'} fallback={<div class="container-service-config-editor"><TextFilePreviewPane path={source.display_path} descriptor={{ mode: 'text', textPresentation: 'code', language: source.format, wrapText: false }} text={source.content ?? ''} draftText={serviceConfigurationDraft()?.content ?? ''} editing onDraftChange={(content) => updateServiceConfigurationDraft({ content })} /></div>}>
                    <SettingsList>
                      <For each={[
                        { key: 'httpProxy', label: 'containers.services.httpProxy', placeholder: 'http://proxy.example.com:3128' },
                        { key: 'httpsProxy', label: 'containers.services.httpsProxy', placeholder: 'https://proxy.example.com:3129' },
                        { key: 'noProxy', label: 'containers.services.noProxy', placeholder: 'localhost,127.0.0.1,.example.com' },
                      ] as const}>{field => <SettingRow title={i18n.t(field.label)} control={<Input class="w-full sm:w-64" aria-label={i18n.t(field.label)} value={serviceConfigurationDraft()?.[field.key] ?? ''} onInput={event => updateServiceConfigurationDraft({ [field.key]: event.currentTarget.value })} placeholder={field.placeholder} autocomplete="off" />} />}</For>
                    </SettingsList>
                  </Show>
                }>
                  {/* IMPORTANT: Raw JSON drafts can be temporarily invalid while
                      typing. Keep the editor outside the parsed-document guard. */}
                  <Show when={serviceConfigurationMode() === 'advanced'}><div class="space-y-3"><div class="container-service-config-note"><Lock class="h-4 w-4" />{i18n.t('containers.services.advancedProtected')}</div><div class="container-service-config-editor"><TextFilePreviewPane path={source.display_path} descriptor={{ mode: 'text', textPresentation: 'code', language: 'json', wrapText: false }} text={source.content ?? ''} draftText={serviceConfigurationDraft()?.content ?? ''} editing onDraftChange={content => updateServiceConfigurationDraft({ content })} /></div></div></Show>
                  <Show when={serviceConfigurationMode() !== 'advanced'}>
                  {/* IMPORTANT: Parsing creates a new document for every keystroke.
                      Keep the form and map rows mounted by stable field keys so
                      editing never loses focus, selection, or an unfinished draft. */}
                  <Show when={dockerCLIConfigurationDocument()} fallback={<div class="container-service-config-note container-service-config-note--warning" role="alert"><AlertTriangle class="h-4 w-4" />{i18n.t('containers.services.dockerCLIInvalid')}</div>}>{document => <>
                    <Show when={serviceConfigurationMode() === 'general'}>
                      <p class="text-xs text-muted-foreground">{i18n.t('containers.services.dockerCLIScope')}</p>
                      <SettingsList>
                        <SettingRow title={i18n.t('containers.services.currentContext')} control={<Select section="containers" resource={props.service.service_id} active={props.active() && canSave() && !busy()} class="w-full sm:w-64" ariaLabel={i18n.t('containers.services.currentContext')} value={dockerCLIString(document(), 'currentContext') || 'default'} onChange={value => setDockerCLIString('currentContext', value)} options={Array.from(new Set(['default', ...(source.context_options ?? []), dockerCLIString(document(), 'currentContext')].filter(Boolean))).map(value => ({ value, label: value }))} />} />
                        <SettingRow title={i18n.t('containers.services.detachKeys')} control={<Input class="w-full sm:w-64" aria-label={i18n.t('containers.services.detachKeys')} value={dockerCLIString(document(), 'detachKeys')} onInput={event => setDockerCLIString('detachKeys', event.currentTarget.value)} placeholder={i18n.t('containers.services.detachKeysPlaceholder')} autocomplete="off" />} />
                      </SettingsList>
                      <Show when={source.context_overridden_by}><div class="container-service-config-note container-service-config-note--warning"><AlertTriangle class="h-4 w-4" />{i18n.t('containers.services.contextOverridden', { variable: source.context_overridden_by ?? '' })}</div></Show>
                      <details class="space-y-3">
                        <summary class="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-sm"><span>{i18n.t('containers.services.outputFormats')}</span><Tag tone="soft" size="sm">{customizedDockerCLIOutputFormatCount()}/{dockerCLIOutputFormats.length}</Tag></summary>
                        <p class="text-xs text-muted-foreground">{i18n.t('containers.services.outputFormatsDescription')}</p>
                        <SettingsList><For each={dockerCLIOutputFormats}>{format => <SettingRow title={format.command} control={<Input class="w-full sm:w-64" aria-label={format.command} value={dockerCLIString(document(), format.key)} onInput={event => setDockerCLIString(format.key, event.currentTarget.value)} placeholder={i18n.t('containers.services.outputFormatPlaceholder')} autocomplete="off" />} />}</For></SettingsList>
                      </details>
                    </Show>
                    <Show when={serviceConfigurationMode() === 'proxy'}>
                      <SettingsSection title={i18n.t('containers.services.proxyProfiles')} description={i18n.t('containers.services.dockerCLIProxyScope')} actions={<div class="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="ghost" aria-label={i18n.t(serviceConfigurationSecretsVisible() ? 'containers.run.hideValue' : 'containers.run.showValue')} onClick={() => setServiceConfigurationSecretsVisible(visible => !visible)}>{serviceConfigurationSecretsVisible() ? <EyeOff class="h-3.5 w-3.5" /> : <Eye class="h-3.5 w-3.5" />}</Button>
                        <Button size="sm" variant="outline" icon={Plus} onClick={() => addDockerCLIMapEntry('proxies', Object.keys(jsonObject(document().proxies) ?? {}).length === 0 ? 'default' : 'https://docker.example.com:2376', {})}>{i18n.t('containers.services.addProfile')}</Button>
                      </div>}>
                        <For each={Object.keys(jsonObject(document().proxies) ?? {})}>{target => { const profile = () => jsonObject((jsonObject(document().proxies) ?? {})[target]) ?? {}; return <SettingsList>
                          <SettingRow title={i18n.t('containers.services.proxyTarget')} control={<Button size="sm" variant="ghost-destructive" aria-label={i18n.t('containers.services.removeProfile')} onClick={() => removeDockerCLIMapEntry('proxies', target)}><Trash class="h-3.5 w-3.5" /></Button>}><Input class="w-full" value={target} onChange={event => setDockerCLIMapEntry('proxies', target, event.currentTarget.value, profile())} aria-label={i18n.t('containers.services.proxyTarget')} /></SettingRow>
                          <For each={['httpProxy', 'httpsProxy', 'ftpProxy', 'allProxy', 'noProxy'] as const}>{key => <SettingRow title={i18n.t(`containers.services.proxyFields.${key}` as Parameters<typeof i18n.t>[0])} control={<Input class="w-full sm:w-64" aria-label={i18n.t(`containers.services.proxyFields.${key}` as Parameters<typeof i18n.t>[0])} type={key === 'noProxy' || serviceConfigurationSecretsVisible() ? 'text' : 'password'} value={typeof profile()[key] === 'string' ? profile()[key] as string : ''} onInput={event => setDockerCLIMapEntry('proxies', target, target, objectWithString(profile(), key, event.currentTarget.value))} placeholder={i18n.t(key === 'noProxy' ? 'containers.services.proxyBypassPlaceholder' : 'containers.services.proxyURLPlaceholder')} autocomplete="new-password" />} />}</For>
                        </SettingsList>; }}</For>
                        <Show when={Object.keys(jsonObject(document().proxies) ?? {}).length === 0}><p class="text-xs text-muted-foreground">{i18n.t('containers.services.noProxyProfiles')}</p></Show>
                      </SettingsSection>
                    </Show>
                    <Show when={serviceConfigurationMode() === 'credentials'}>
                      <p class="text-xs text-muted-foreground">{i18n.t('containers.services.credentialsScope')}</p>
                      <SettingsList><SettingRow title={i18n.t('containers.services.credentialStore')} control={<Input class="w-full sm:w-64" aria-label={i18n.t('containers.services.credentialStore')} value={dockerCLIString(document(), 'credsStore')} onInput={event => setDockerCLIString('credsStore', event.currentTarget.value)} placeholder={i18n.t('containers.services.credentialStorePlaceholder')} autocomplete="off" />} /></SettingsList>
                      <SettingsSection title={i18n.t('containers.services.credentialHelpers')} actions={<Button size="sm" variant="outline" icon={Plus} onClick={() => addDockerCLIMapEntry('credHelpers', 'registry.example.com', '')}>{i18n.t('containers.services.addHelper')}</Button>}>
                        <For each={Object.keys(jsonObject(document().credHelpers) ?? {})}>{registry => { const helper = () => (jsonObject(document().credHelpers) ?? {})[registry]; return <SettingsList><SettingRow title={i18n.t('containers.services.registry')} control={<Button size="sm" variant="ghost-destructive" aria-label={i18n.t('containers.services.removeHelper')} onClick={() => removeDockerCLIMapEntry('credHelpers', registry)}><Trash class="h-3.5 w-3.5" /></Button>}>
                          <div class="grid min-w-0 gap-3 sm:grid-cols-2"><Input value={registry} onChange={event => setDockerCLIMapEntry('credHelpers', registry, event.currentTarget.value, helper())} aria-label={i18n.t('containers.services.registry')} /><Input value={typeof helper() === 'string' ? helper() as string : ''} onInput={event => setDockerCLIMapEntry('credHelpers', registry, registry, event.currentTarget.value)} placeholder={i18n.t('containers.services.credentialStorePlaceholder')} aria-label={i18n.t('containers.services.credentialHelper')} /></div>
                        </SettingRow></SettingsList>; }}</For>
                      </SettingsSection>
                      <SettingsSection title={i18n.t('containers.services.signedInRegistries')} description={i18n.t('containers.services.registryCredentialsProtected')}><Show when={(source.protected_registries?.length ?? 0) > 0} fallback={<p class="text-xs text-muted-foreground">{i18n.t('containers.services.noSignedInRegistries')}</p>}><div class="flex flex-wrap gap-2"><For each={source.protected_registries}>{registry => <Tag tone="soft" size="sm">{registry}</Tag>}</For></div></Show></SettingsSection>
                    </Show>
                  </>}</Show>
                  </Show>
                </Show>
              </Show>
            </>}</Show>
          </Show>
        </Show>
      </Show>
    </fieldset>
    <Show when={review()}>{value => <SettingsSection title={i18n.t('containers.review.title')} aria-label={i18n.t('containers.review.title')}>
      <For each={value().preflight.plan.summary ?? []}>{summary => <p class="text-sm">{summary}</p>}</For>
      <For each={value().preflight.plan.risk_flags ?? []}>{flag => <SettingRow tone="warning" title={flag.title} description={flag.detail} />}</For>
      <div class="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setReview(null)}>{i18n.t('containers.actions.cancel')}</Button>
      <Button disabled={!canSave() || busy()} onClick={() => void runReviewedOperation()}>{i18n.t('containers.actions.run')}</Button></div>
    </SettingsSection>}</Show>
    <Show when={operation()}>{value => <p role="status">{i18n.t(`containers.operationStates.${value().state}` as Parameters<typeof i18n.t>[0])}</p>}</Show>
    <Show when={operation()?.error_code}><p role="alert">{operation()?.error_code}: {operation()?.error_message}</p></Show>
    <Show when={!review() && props.service.configuration.mode === 'local'}><div class="flex flex-wrap justify-end gap-2">
      <Button variant="outline" disabled={!canSave() || busy() || !serviceConfigurationSourceEditable() || serviceConfigurationLoading()} onClick={() => void submitServiceConfiguration('save')}>{i18n.t('containers.services.save')}</Button>
      <Show when={serviceConfigurationSource()?.apply_modes.includes('save_and_restart')}><Button disabled={!canSave() || busy() || !serviceConfigurationSourceEditable() || !props.service?.capabilities.restart || serviceConfigurationLoading()} onClick={() => void submitServiceConfiguration('save_and_restart')}>{i18n.t('containers.services.saveRestart')}</Button></Show>
    </div></Show>
  </section>;
}
