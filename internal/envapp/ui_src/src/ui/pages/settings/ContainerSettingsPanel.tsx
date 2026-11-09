import { secureRandomUUID } from '@floegence/floe-webapp-core';
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, on, untrack } from 'solid-js';
import { Button, Input, Select, Tabs, Tag } from '@floegence/floe-webapp-core/ui';
import { AlertTriangle, ChevronRight, Eye, EyeOff, FileText, Info, Layers, Terminal, Lock, Plus, Refresh, Trash } from '@floegence/floe-webapp-core/icons';
import { useEnvContext } from '../EnvContext';
import { useI18n } from '../../i18n';
import { useEnvSettingsPage } from './EnvSettingsPageContext';
import { TextFilePreviewPane } from '../../widgets/TextFilePreviewPane';
import { createEnvCachedResource, createEnvResourceCollection } from '../../services/envResourceCache';
import { containerServiceSnapshot } from '../../services/envResourceSnapshots';
import { ContainerOperationRejectedError, listContainerServices, getContainerServiceConfiguration, preflightContainerOperation, createContainerOperation, subscribeContainerOperation, getContainerOperation, getContainerOperationByRequestID,
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
  const env = useEnvContext();
  const i18n = useI18n();
  const ctx = useEnvSettingsPage();
  const cache = createEnvCachedResource(env, () => 'container-services', containerServiceSnapshot);
  const [services, { refetch }] = createResource(() => cache.ready() && !!env.env()?.permissions?.can_read, async () => cache.refresh(listContainerServices));
  const serviceData = () => services.error ? undefined : services();
  const [selected, setSelected] = createSignal('');
  const stableServices = new Map<string, ContainerService>();
  createEffect(() => { for (const service of serviceData() ?? []) stableServices.set(service.service_id, service); });
  const ids = createMemo(() => (serviceData() ?? []).map(service => service.service_id));
  const target = () => props.resource ?? selected();
  const [visited, setVisited] = createSignal<string[]>([]);
  createEffect(() => { const id = target(); if (id && ids().includes(id)) setVisited(old => old.includes(id) ? old : [...old, id]); });
  return <div class="space-y-4" data-testid="container-settings-panel">
    <h2 class="text-lg font-semibold">{i18n.t('containers.services.title')}</h2>
    <div class="flex gap-2"><Select value={target()} onChange={id => { setSelected(id); env.openSettings('containers', { resource: id }); }}
      options={ (serviceData() ?? []).map(service => ({ value: service.service_id, label: service.name })) } placeholder={i18n.t('containers.services.title')} ariaLabel={i18n.t('containers.services.title')} />
      <Button variant="ghost" disabled={services.loading || !ctx.canInteract()} onClick={() => void refetch()} aria-label={i18n.t('common.actions.refresh')}><Refresh class="h-4 w-4" /></Button></div>
    <Show when={services.error}><p role="alert">{String(services.error)}</p></Show>
    <Show when={services.loading}><p role="status">{i18n.t('containers.loading')}</p></Show>
    <Show when={target() && !services.loading && !ids().includes(target())}><p role="alert">{i18n.t('settings.targetUnavailable')}</p></Show>
    <For each={visited()}>{id => <div hidden={target() !== id} inert={target() !== id}>
      <ContainerServiceSettings service={(serviceData() ?? []).find(service => service.service_id === id) ?? stableServices.get(id)!} available={() => ids().includes(id)} captureAuthority={cache.captureAuthority} />
    </div>}</For>
  </div>;
}

function ContainerServiceSettings(props: { service: ContainerService; available: () => boolean; captureAuthority: () => () => boolean }) {
  const env = useEnvContext();
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
  const canSave = () => !uncertain() && current() && ctx.canInteract() && ctx.canAdmin() && !!env.env()?.permissions?.can_read && !!env.env()?.permissions?.can_write && !!env.env()?.permissions?.can_execute;
  const [busy, setBusy] = createSignal(false);
  const [review, setReview] = createSignal<{ request: Record<string, unknown>; preflight: ContainerPreflight } | null>(null);
  const [operation, setOperation] = createSignal<ContainerOperation>();
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
    const admitted = capture();
    setBusy(true);
    setServiceConfigurationError('');
    try {
      const preflight = await preflightContainerOperation('container.services.configuration.update', request);
      if (admitted() && canSave()) { setReviewCurrent(() => admitted); setReview({ preflight, request }); }
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
      const started = await createContainerOperation(confirmed.preflight, confirmed.request, requestID);
      if (!admitted() || started.request_id !== requestID) return;
      setOperation(started);
      await subscribeContainerOperation(started.operation_id, next => {
        if (!admitted() || next.request_id !== requestID) return;
        setOperation(next);
        if (['succeeded', 'failed', 'canceled', 'interrupted'].includes(next.state)) setUncertain(false);
      }, lifetime.signal);
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
      if (match) { setOperation(match); setUncertain(!['succeeded', 'failed', 'canceled', 'interrupted'].includes(match.state)); }
      await openServiceConfiguration(props.service, match?.state === 'succeeded' ? pendingSource() : undefined);
    } catch (error) { if (admitted()) { await openServiceConfiguration(props.service); setServiceConfigurationError(String(error)); } }
    finally { if (admitted()) setBusy(false); }
  };
  return <div class="container-service-config-content space-y-4">
    <div class="flex justify-end"><Button variant="ghost" disabled={!current() || busy()} onClick={() => void reconcile()}>{i18n.t('common.actions.refresh')}</Button></div>
    <Show when={uncertain()}><p role="alert">{i18n.t('settings.operationUnknown')}</p></Show>
    <Show when={dirty()}><Button variant="ghost" disabled={busy() || uncertain() || !current()} onClick={() => void openServiceConfiguration(props.service, serviceConfigurationSourceID())}>{i18n.t('filePreview.discardChanges')}</Button></Show>
    <fieldset disabled={!canSave() || busy() || !!review()}>
        <Show when={serviceConfigurationTarget()?.configuration.mode === 'local'} fallback={<div class="container-service-config-unavailable"><AlertTriangle class="h-5 w-5" /><strong>{i18n.t('containers.services.configurationUnavailable')}</strong></div>}>
          <Show when={!serviceConfigurationLoading()} fallback={<div class="container-service-config-loading"><Refresh class="h-4 w-4 animate-spin motion-reduce:animate-none" />{i18n.t('containers.loading')}</div>}>
            <Show when={serviceConfiguration()} fallback={<div class="container-service-config-error" role="alert"><AlertTriangle class="h-4 w-4" />{serviceConfigurationError()}</div>}>
              <Show when={serviceConfigurationError()}><div class="container-service-config-error" role="alert"><AlertTriangle class="h-4 w-4" />{serviceConfigurationError()}</div></Show>
              <Tabs class="container-service-config-source-tabs" items={(serviceConfiguration()?.sources ?? []).map((source) => ({ id: source.source_id, label: i18n.t(source.source_id === 'docker_cli' ? 'containers.services.dockerCLI' : 'containers.services.engineConfiguration') }))} activeId={serviceConfigurationSourceID()} onChange={(id) => selectServiceConfigurationSource(id as ContainerServiceConfigurationSourceID)} size="md" ariaLabel={i18n.t('containers.services.configurationTitle', { name: serviceConfigurationTarget()?.name ?? '' })} features={{ indicator: { mode: 'slider', thicknessPx: 2, colorToken: 'primary', animated: true }, containerBorder: false }} />
              <Show when={serviceConfigurationSource()} keyed>{(source) => <>
                <div class="container-service-config-source-meta">
                  <div><span>{i18n.t('containers.services.configurationPath')}</span><code>{source.display_path}</code></div>
                  <Tag variant={source.status === 'ready' ? 'success' : source.status === 'missing' ? 'neutral' : 'error'} tone="soft" size="sm">{i18n.t(`containers.services.sourceStates.${source.status}` as Parameters<typeof i18n.t>[0])}</Tag>
                </div>
                <Show when={source.status === 'missing'}><div class="container-service-config-note"><Info class="h-4 w-4" />{i18n.t('containers.services.fileWillBeCreated')}</div></Show>
                <Show when={source.status === 'invalid'}><div class="container-service-config-note container-service-config-note--warning"><AlertTriangle class="h-4 w-4" />{i18n.t(source.source_id === 'docker_cli' ? 'containers.services.dockerCLIInvalid' : 'containers.services.configurationInvalid')}</div></Show>
                <Show when={source.status !== 'permission' && source.status !== 'unsupported'} fallback={<div class="container-service-config-unavailable"><AlertTriangle class="h-5 w-5" /><strong>{i18n.t(`containers.services.sourceStates.${source.status}` as Parameters<typeof i18n.t>[0])}</strong></div>}>
                  <Show when={serviceConfigurationSections().length > 1}><Tabs class="container-service-config-tabs" items={serviceConfigurationSections().map((section) => ({ id: section, label: i18n.t(section === 'general' ? 'containers.services.general' : section === 'proxy' ? 'containers.services.proxies' : section === 'credentials' ? 'containers.services.credentials' : 'containers.services.advanced') }))} activeId={serviceConfigurationMode()} onChange={(id) => setServiceConfigurationMode(id as ContainerServiceConfigurationSection)} size="sm" ariaLabel={i18n.t('containers.services.configurationTitle', { name: serviceConfigurationTarget()?.name ?? '' })} features={{ indicator: { mode: 'slider', thicknessPx: 2, colorToken: 'primary', animated: true }, containerBorder: false }} /></Show>
                  <Show when={source.source_id === 'docker_cli'} fallback={<Show when={serviceConfigurationMode() === 'proxy'} fallback={<div class="container-service-config-editor"><TextFilePreviewPane path={source.display_path} descriptor={{ mode: 'text', textPresentation: 'code', language: source.format, wrapText: false }} text={source.content ?? ''} draftText={serviceConfigurationDraft()?.content ?? ''} editing onDraftChange={(content) => updateServiceConfigurationDraft({ content })} /></div>}><div class="container-service-proxy-form"><label><span>{i18n.t('containers.services.httpProxy')}</span><Input value={serviceConfigurationDraft()?.httpProxy ?? ''} onInput={(event) => updateServiceConfigurationDraft({ httpProxy: event.currentTarget.value })} placeholder="http://proxy.example.com:3128" autocomplete="off" /></label><label><span>{i18n.t('containers.services.httpsProxy')}</span><Input value={serviceConfigurationDraft()?.httpsProxy ?? ''} onInput={(event) => updateServiceConfigurationDraft({ httpsProxy: event.currentTarget.value })} placeholder="https://proxy.example.com:3129" autocomplete="off" /></label><label><span>{i18n.t('containers.services.noProxy')}</span><Input value={serviceConfigurationDraft()?.noProxy ?? ''} onInput={(event) => updateServiceConfigurationDraft({ noProxy: event.currentTarget.value })} placeholder="localhost,127.0.0.1,.example.com" autocomplete="off" /></label></div></Show>}>
                    <Show when={dockerCLIConfigurationDocument()} keyed>{(document) => <>
                      <Show when={serviceConfigurationMode() === 'general'}>
                        <div class="container-service-cli-form">
                          <div class="container-service-cli-intro"><Info class="h-4 w-4" aria-hidden="true" /><p>{i18n.t('containers.services.dockerCLIScope')}</p></div>
                          <div class="container-service-cli-common-grid">
                            <label class="container-service-cli-setting-card"><span class="container-service-cli-setting-card__heading"><Layers class="h-4 w-4" aria-hidden="true" /><span><strong>{i18n.t('containers.services.currentContext')}</strong><code>currentContext</code></span></span><Select value={dockerCLIString(document, 'currentContext') || 'default'} onChange={(value) => setDockerCLIString('currentContext', value)} options={Array.from(new Set(['default', ...(source.context_options ?? []), dockerCLIString(document, 'currentContext')].filter(Boolean))).map((value) => ({ value, label: value }))} /></label>
                            <label class="container-service-cli-setting-card"><span class="container-service-cli-setting-card__heading"><Terminal class="h-4 w-4" aria-hidden="true" /><span><strong>{i18n.t('containers.services.detachKeys')}</strong><code>detachKeys</code></span></span><Input value={dockerCLIString(document, 'detachKeys')} onInput={(event) => setDockerCLIString('detachKeys', event.currentTarget.value)} placeholder={i18n.t('containers.services.detachKeysPlaceholder')} autocomplete="off" /></label>
                          </div>
                          <Show when={source.context_overridden_by}><div class="container-service-config-note container-service-config-note--warning"><AlertTriangle class="h-4 w-4" />{i18n.t('containers.services.contextOverridden', { variable: source.context_overridden_by ?? '' })}</div></Show>
                          <details class="container-service-cli-disclosure">
                            <summary><span class="container-service-cli-disclosure__mark"><FileText class="h-4 w-4" aria-hidden="true" /></span><span class="container-service-cli-disclosure__copy"><strong>{i18n.t('containers.services.outputFormats')}</strong><small>{i18n.t('containers.services.outputFormatsDescription')}</small></span><Tag tone="soft" size="sm">{customizedDockerCLIOutputFormatCount()}/{dockerCLIOutputFormats.length}</Tag><ChevronRight class="container-service-cli-disclosure__chevron h-4 w-4" aria-hidden="true" /></summary>
                            <div class="container-service-cli-output-grid"><For each={dockerCLIOutputFormats}>{(format) => <label><span><strong>{format.command}</strong><code>{format.key}</code></span><Input value={dockerCLIString(document, format.key)} onInput={(event) => setDockerCLIString(format.key, event.currentTarget.value)} placeholder={i18n.t('containers.services.outputFormatPlaceholder')} autocomplete="off" /></label>}</For></div>
                          </details>
                        </div>
                      </Show>
                      <Show when={serviceConfigurationMode() === 'proxy'}>
                        <div class="container-service-cli-section">
                          <div class="container-service-cli-section__heading"><div><strong>{i18n.t('containers.services.proxyProfiles')}</strong><p>{i18n.t('containers.services.dockerCLIProxyScope')}</p></div><div class="container-service-cli-heading-actions"><Button size="sm" variant="ghost" class="container-icon-action" aria-label={i18n.t(serviceConfigurationSecretsVisible() ? 'containers.run.hideValue' : 'containers.run.showValue')} onClick={() => setServiceConfigurationSecretsVisible((visible) => !visible)}>{serviceConfigurationSecretsVisible() ? <EyeOff class="h-3.5 w-3.5" /> : <Eye class="h-3.5 w-3.5" />}</Button><Button size="sm" variant="outline" onClick={() => addDockerCLIMapEntry('proxies', Object.keys(jsonObject(document.proxies) ?? {}).length === 0 ? 'default' : 'https://docker.example.com:2376', {})}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.services.addProfile')}</Button></div></div>
                          <For each={Object.entries(jsonObject(document.proxies) ?? {})}>{(entry) => { const target = () => entry[0]; const profile = () => jsonObject(entry[1]) ?? {}; return <section class="container-service-cli-profile"><header><Input value={target()} onChange={(event) => setDockerCLIMapEntry('proxies', target(), event.currentTarget.value, profile())} aria-label={i18n.t('containers.services.proxyTarget')} /><Button size="sm" variant="ghost" class="container-icon-action container-destructive-action" aria-label={i18n.t('containers.services.removeProfile')} onClick={() => removeDockerCLIMapEntry('proxies', target())}><Trash class="h-3.5 w-3.5" /></Button></header><div class="container-service-cli-grid"><For each={['httpProxy', 'httpsProxy', 'ftpProxy', 'allProxy', 'noProxy'] as const}>{(key) => <label><span>{i18n.t(`containers.services.proxyFields.${key}` as Parameters<typeof i18n.t>[0])}</span><Input type={key === 'noProxy' || serviceConfigurationSecretsVisible() ? 'text' : 'password'} value={typeof profile()[key] === 'string' ? profile()[key] as string : ''} onInput={(event) => setDockerCLIMapEntry('proxies', target(), target(), objectWithString(profile(), key, event.currentTarget.value))} placeholder={i18n.t(key === 'noProxy' ? 'containers.services.proxyBypassPlaceholder' : 'containers.services.proxyURLPlaceholder')} autocomplete="new-password" /></label>}</For></div></section>; }}</For>
                          <Show when={Object.keys(jsonObject(document.proxies) ?? {}).length === 0}><div class="container-service-cli-empty">{i18n.t('containers.services.noProxyProfiles')}</div></Show>
                        </div>
                      </Show>
                      <Show when={serviceConfigurationMode() === 'credentials'}>
                        <div class="container-service-cli-section">
                          <p class="container-service-config-lead">{i18n.t('containers.services.credentialsScope')}</p>
                          <label class="container-service-cli-field"><span>{i18n.t('containers.services.credentialStore')}</span><Input value={dockerCLIString(document, 'credsStore')} onInput={(event) => setDockerCLIString('credsStore', event.currentTarget.value)} placeholder={i18n.t('containers.services.credentialStorePlaceholder')} autocomplete="off" /></label>
                          <div class="container-service-cli-section__heading"><strong>{i18n.t('containers.services.credentialHelpers')}</strong><Button size="sm" variant="outline" onClick={() => addDockerCLIMapEntry('credHelpers', 'registry.example.com', '')}><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.services.addHelper')}</Button></div>
                          <div class="container-service-cli-pairs"><For each={Object.entries(jsonObject(document.credHelpers) ?? {})}>{(entry) => <div><Input value={entry[0]} onChange={(event) => setDockerCLIMapEntry('credHelpers', entry[0], event.currentTarget.value, entry[1])} aria-label={i18n.t('containers.services.registry')} /><Input value={typeof entry[1] === 'string' ? entry[1] as string : ''} onInput={(event) => setDockerCLIMapEntry('credHelpers', entry[0], entry[0], event.currentTarget.value)} placeholder={i18n.t('containers.services.credentialStorePlaceholder')} aria-label={i18n.t('containers.services.credentialHelper')} /><Button size="sm" variant="ghost" class="container-icon-action container-destructive-action" aria-label={i18n.t('containers.services.removeHelper')} onClick={() => removeDockerCLIMapEntry('credHelpers', entry[0])}><Trash class="h-3.5 w-3.5" /></Button></div>}</For></div>
                          <div class="container-service-protected-registries"><strong>{i18n.t('containers.services.signedInRegistries')}</strong><Show when={(source.protected_registries?.length ?? 0) > 0} fallback={<p>{i18n.t('containers.services.noSignedInRegistries')}</p>}><div><For each={source.protected_registries}>{(registry) => <Tag tone="soft" size="sm">{registry}</Tag>}</For></div></Show><p>{i18n.t('containers.services.registryCredentialsProtected')}</p></div>
                        </div>
                      </Show>
                      <Show when={serviceConfigurationMode() === 'advanced'}><div class="container-service-cli-section"><div class="container-service-config-note"><Lock class="h-4 w-4" />{i18n.t('containers.services.advancedProtected')}</div><div class="container-service-config-editor"><TextFilePreviewPane path={source.display_path} descriptor={{ mode: 'text', textPresentation: 'code', language: 'json', wrapText: false }} text={source.content ?? ''} draftText={serviceConfigurationDraft()?.content ?? ''} editing onDraftChange={(content) => updateServiceConfigurationDraft({ content })} /></div></div></Show>
                    </>}</Show>
                  </Show>
                </Show>
              </>}</Show>
            </Show>
          </Show>
        </Show>
    </fieldset>
    <Show when={review()}>{value => <section class="space-y-3 rounded-lg border p-4" aria-label={i18n.t('containers.review.title')}>
      <h3 class="font-semibold">{i18n.t('containers.review.title')}</h3>
      <For each={value().preflight.plan.summary ?? []}>{summary => <p>{summary}</p>}</For>
      <For each={value().preflight.plan.risk_flags ?? []}>{flag => <div><strong>{flag.title}</strong><p>{flag.detail}</p></div>}</For>
      <div class="flex justify-end gap-2"><Button variant="outline" onClick={() => setReview(null)}>{i18n.t('containers.actions.cancel')}</Button>
      <Button disabled={!canSave() || busy()} onClick={() => void runReviewedOperation()}>{i18n.t('containers.actions.run')}</Button></div>
    </section>}</Show>
    <Show when={operation()}>{value => <p role="status">{i18n.t(`containers.operationStates.${value().state}` as Parameters<typeof i18n.t>[0])}</p>}</Show>
    <Show when={operation()?.error_code}><p role="alert">{operation()?.error_code}: {operation()?.error_message}</p></Show>
    <Show when={!review()}><div class="flex justify-end gap-2">
      <Button variant="outline" disabled={!canSave() || busy() || !serviceConfigurationSourceEditable() || serviceConfigurationLoading()} onClick={() => void submitServiceConfiguration('save')}>{i18n.t('containers.services.save')}</Button>
      <Show when={serviceConfigurationSource()?.apply_modes.includes('save_and_restart')}><Button disabled={!canSave() || busy() || !serviceConfigurationSourceEditable() || !props.service?.capabilities.restart || serviceConfigurationLoading()} onClick={() => void submitServiceConfiguration('save_and_restart')}>{i18n.t('containers.services.saveRestart')}</Button></Show>
    </div></Show>
  </div>;
}
