import { ManualModelCapabilities } from './ManualModelCapabilities';
import { applyModelOverride, flowerModelNeedsConfiguration, flowerProviderModelCatalog } from '../providerModelProjection';
import { WebSearchCapabilityBadge } from '../WebSearchCapabilityBadge';
import { flowerProviderAPIKeyOptional, missingFlowerProviderCredential } from '../providerCredentials';
import { FlowerProviderBrandIcon } from './FlowerProviderBrandIcon';
import { ModelCatalogControls } from './ModelCatalogControls';
import { applyFlowerModelDiscovery, cloneFlowerModel, filterFlowerModels, flowerProviderModelChoices, setFlowerModelsEnabled } from './modelSelection';
import { flowerModelSupportsImage, formatFlowerTokenCount } from '../flowerModelLabel';
import type { FlowerChatGPTAuth, FlowerChatGPTAccount, FlowerModelCatalogDiscovery } from '../contracts/flowerSurfaceContracts';
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { cn } from '@floegence/floe-webapp-core';
import { Check, ExternalLink, Info, Pencil } from '@floegence/floe-webapp-core/icons';
import { Button, Checkbox, Dialog, Input, Select, StableText } from '@floegence/floe-webapp-core/ui';

import { defaultFlowerProviderModels } from './modelSelection';
import type { FlowerProviderDialogCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import { createFlowerActivityDisclosureMotion } from '../activityDisclosure';
import type { FlowerProviderDraft, FlowerProviderModel, FlowerProviderType, FlowerWebSearchMode } from '../contracts/flowerSurfaceContracts';
import {
  FLOWER_PROVIDER_TYPES,
  defaultBaseURLForFlowerProviderType,
  flowerProviderNeedsWebSearchConfig,
  flowerProviderSupportsCustomModels,
  flowerProviderTypeRequiresBaseURL,
  flowerProviderUsesCustomName,
} from './providerCatalog';
import {
  FLOWER_STORED_SECRET_PLACEHOLDER,
  FlowerFieldLabel,
  FlowerSettingsPill,
} from './FlowerSettingsPrimitives';

export type FlowerProviderDialogMode = 'create' | 'edit';

export type FlowerProviderDialogProps = Readonly<{
  chatGPTAuth?: FlowerChatGPTAuth;
  chatGPTAvailable?: boolean;
  chatGPTBindingID?: string;
  chatGPTAccount?: FlowerChatGPTAccount;
  onDiscoverModels?: FlowerModelCatalogDiscovery;
  open: boolean;
  mode: FlowerProviderDialogMode;
  provider: FlowerProviderDraft | null;
  catalogModels?: readonly FlowerProviderModel[];
  providerDefaults?: Readonly<Partial<Record<FlowerProviderType, readonly FlowerProviderModel[]>>>;
  copy?: FlowerProviderDialogCopy;
  keyConfigured: boolean;
  webSearchKeyConfigured: boolean;
  error?: string;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (draft: FlowerProviderDraft) => void | Promise<void>;
}>;

function cleanModelName(value: unknown): string {
  return String(value ?? '').trim();
}

const cloneModel = cloneFlowerModel;

function modelSelected(provider: FlowerProviderDraft, modelName: string): boolean {
  return provider.models.some((model) => cleanModelName(model.model_name) === cleanModelName(modelName));
}

export function FlowerProviderDialog(props: FlowerProviderDialogProps) {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;
  const [query, setQuery] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [discoveryError, setDiscoveryError] = createSignal('');
  const discoveryIdentity = (draft: FlowerProviderDraft) => JSON.stringify([draft.id, draft.type, draft.base_url, draft.provider_api_key, draft.auth_method, draft.account_id, draft.chatgpt_attempt, draft.web_search, draft.web_search_api_key, props.webSearchKeyConfigured]);
  let discoverySequence = 0;
  const discover = async () => {
    const draft = store.draft;
    if (!draft || !props.onDiscoverModels) return;
    const sequence = ++discoverySequence;
    const identity = discoveryIdentity(draft);
    setLoading(true); setDiscoveryError('');
    try {
      const result = await props.onDiscoverModels({ provider_id: draft.id, type: draft.type, base_url: draft.base_url, api_key: draft.auth_method === 'chatgpt' ? undefined : draft.provider_api_key ?? undefined, auth_method: draft.auth_method, account_id: draft.account_id, ...draft.chatgpt_attempt });
      const current = store.draft;
      if (sequence === discoverySequence && props.open && current && identity === discoveryIdentity(current)) setStore('draft', reconcile(applyFlowerModelDiscovery(current, result.models)));
    } catch (error) { if (sequence === discoverySequence) setDiscoveryError(error instanceof Error ? error.message : String(error)); }
    finally { if (sequence === discoverySequence) setLoading(false); }
  };
  const [customModelName, setCustomModelName] = createSignal('');
  const [editingModelName, setEditingModelName] = createSignal('');
  const [selectedProviderType, setSelectedProviderType] = createSignal<FlowerProviderType | null>(null);
  const [store, setStore] = createStore<{ draft: FlowerProviderDraft | null }>({ draft: null });
  const keyHint = () => {
    if (props.keyConfigured) return store.draft?.provider_api_key?.trim() ? copy().replaceStoredKeyHint : copy().storedKeyKept;
    return store.draft && flowerProviderAPIKeyOptional(store.draft.type) ? copy().catalog.optionalKey : copy().requiredBeforeUse;
  };
  const braveKeyHint = () => {
    if (props.webSearchKeyConfigured) return store.draft?.web_search_api_key?.trim() ? copy().replaceStoredKeyHint : copy().storedKeyKept;
    return copy().requiredForBraveSearch;
  };
  const catalog = createMemo(() => store.draft ? flowerProviderModelChoices(store.draft) : []);
  const catalogByName = createMemo(() => new Map(catalog().map((model) => [model.model_name, model])));
  // Selection and discovery replace metadata objects; model names keep rows and focus stable.
  const visibleModelNames = createMemo(() => filterFlowerModels(catalog(), query()).map((model) => model.model_name));
  const [authorizing, setAuthorizing] = createSignal(false);
  const [authProgress, setAuthProgress] = createSignal<'preparing' | 'waiting' | 'verifying'>('preparing');
  const [authError, setAuthError] = createSignal('');
  let authPrimary: HTMLButtonElement | undefined;
  let authCancel: HTMLButtonElement | undefined;
  let authActions: HTMLDivElement | undefined;
  const finishAuthorization = () => {
    const restoreFocus = document.activeElement === authCancel;
    setAuthorizing(false);
    if (restoreFocus && props.open) authPrimary?.focus({ preventScroll: true });
  };
  let authSequence = 0;
  let pendingAttempt: { id: string; scope: string; auth: FlowerChatGPTAuth } | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelAuthorization = () => {
    authSequence++; clearTimeout(pollTimer); finishAuthorization();
    const pending = pendingAttempt; pendingAttempt = null;
    if (pending) void pending.auth('cancel', { scope_id: pending.scope, attempt_id: pending.id }).catch(() => undefined);
  };
  onCleanup(cancelAuthorization);
  const chatGPTEnabled = () => props.chatGPTAvailable === true && Boolean(props.chatGPTAuth);
  const chatGPTSelected = () => store.draft?.auth_method === 'chatgpt';
  const account = () => store.draft?.chatgpt_account;
  const connected = () => !authorizing() && account()?.state === 'ready';
  const showWelcome = () => props.open && chatGPTSelected() && chatGPTEnabled() && connected() && !account()!.welcome_acknowledged;
  const welcomeMotion = createFlowerActivityDisclosureMotion(showWelcome);
  const startAuthorization = async (newAccount = false) => {
    const auth = props.chatGPTAuth;
    if (!auth || !chatGPTEnabled() || !props.open) return;
    const prior = pendingAttempt;
    authSequence++; clearTimeout(pollTimer); setAuthError('');
    const sequence = authSequence;
    const scope = prior?.scope ?? crypto.randomUUID();
    const focusedAction = document.activeElement;
    const focusFromAction = focusedAction && authActions?.contains(focusedAction);
    setAuthProgress('preparing'); setAuthorizing(true);
    queueMicrotask(() => {
      if (focusFromAction && sequence === authSequence && authorizing() && props.open
        && (document.activeElement === focusedAction || document.activeElement === document.body)) authCancel?.focus({ preventScroll: true });
    });
    try {
      const initial = await auth('start', { scope_id: scope, previous_attempt_id: !newAccount ? store.draft?.chatgpt_attempt?.attempt_id : undefined, account_id: newAccount ? undefined : store.draft?.account_id, reconsent: account()?.state === 'plan_permission_required' });
      if (!initial.id) throw new Error('missing attempt');
      if (sequence !== authSequence || !props.open || !chatGPTEnabled()) {
        void auth('cancel', { scope_id: scope, attempt_id: initial.id }).catch(() => undefined); return;
      }
      pendingAttempt = { id: initial.id, scope, auth };
      if (initial.state === 'waiting' || initial.state === 'verifying') setAuthProgress(initial.state);
      const id = initial.id;
      const poll = async () => {
        try {
          const result = await auth('status', { scope_id: scope, attempt_id: id });
          if (sequence !== authSequence || !props.open || !chatGPTEnabled()) return;
          if (result.state === 'ready' && result.account) {
            finishAuthorization();
            updateProvider({ account_id: result.account.account_id, chatgpt_account: result.account, chatgpt_attempt: { attempt_id: id, scope_id: scope } });
            if (result.account.state !== 'ready') setAuthError(copy().chatGPT.planPermission);
            else void discover();
            return;
          }
          if (result.state === 'failed') { finishAuthorization(); setAuthError(copy().chatGPT.signInFailed); return; }
          if (result.state === 'preparing' || result.state === 'waiting' || result.state === 'verifying') setAuthProgress(result.state);
          pollTimer = setTimeout(() => { void poll(); }, 800);
        } catch {
          if (sequence === authSequence) { finishAuthorization(); setAuthError(copy().chatGPT.signInFailed); }
        }
      };
      void poll();
    } catch {
      if (sequence === authSequence) { finishAuthorization(); setAuthError(copy().chatGPT.signInFailed); }
    }
  };
  const changeAuthentication = (method: 'api_key' | 'chatgpt') => {
    if ((store.draft?.auth_method ?? 'api_key') === method) return;
    if (method === 'chatgpt' && !chatGPTEnabled()) return;
    cancelAuthorization(); setAuthError('');
    discoverySequence++; setLoading(false); setDiscoveryError('');
    updateProvider({ auth_method: method, account_id: undefined, chatgpt_account: undefined, chatgpt_attempt: undefined, catalog_models: undefined });
  };
  let currentAuth: FlowerChatGPTAuth | undefined;
  let currentBinding: string | undefined;
  let bindingObserved = false;
  createEffect(() => {
    const auth = props.chatGPTAuth, binding = props.chatGPTBindingID;
    const open = props.open, enabled = chatGPTEnabled();
    if (auth !== currentAuth || binding !== currentBinding || !open || !enabled) cancelAuthorization();
    if (!open || bindingObserved && binding !== currentBinding) {
      discoverySequence++; setLoading(false);
    }
    if (bindingObserved && binding !== currentBinding && open) {
      setStore('draft', null);
      props.onOpenChange(false);
    }
    bindingObserved = true;
    currentAuth = auth; currentBinding = binding;
  });
  const providerID = () => String(store.draft?.id ?? '').trim();
  const missingCredential = () => store.draft
    ? missingFlowerProviderCredential(store.draft, props.keyConfigured, props.webSearchKeyConfigured)
    : null;
  const connectionReady = () => Boolean(store.draft
    && !missingFlowerProviderCredential({ ...store.draft, enabled: true }, props.keyConfigured, props.webSearchKeyConfigured)
    && (!flowerProviderTypeRequiresBaseURL(store.draft.type) || store.draft.base_url?.trim() || defaultBaseURLForFlowerProviderType(store.draft.type)));
  const incompleteModel = () => store.draft?.models.some(flowerModelNeedsConfiguration) ?? false;
  const providerTypeLabel = (type: FlowerProviderType): string => copy().providerTypeLabels[type] ?? type;

  createEffect(on(() => [props.open, props.provider?.id] as const, () => {
    if (props.open) {
      cancelAuthorization();
      const initial = untrack(() => props.provider ? { ...props.provider, model_defaults: props.providerDefaults?.[props.provider.type] ?? props.provider.model_defaults, chatgpt_account: props.chatGPTAccount } : null);
      if (initial && props.mode === 'create' && initial.type === 'openai' && !initial.auth_method) initial.auth_method = untrack(chatGPTEnabled) ? 'chatgpt' : 'api_key';
      setStore('draft', reconcile(initial));
      setAuthError('');
      setCustomModelName(''); setQuery(''); setDiscoveryError('');
      setEditingModelName('');
      setSelectedProviderType(props.mode === 'edit' && initial ? initial.type : null);
    }
  }));


  createEffect(() => {
    const catalog = props.catalogModels;
    if (!props.open || !catalog) return;
    untrack(() => {
      const draft = store.draft;
      if (draft && draft.id === props.provider?.id && draft.type === props.provider.type && draft.base_url === props.provider.base_url
        && draft.auth_method === props.provider.auth_method && draft.account_id === props.provider.account_id
        && draft.provider_api_key === undefined) {
        setStore('draft', reconcile(applyFlowerModelDiscovery(draft, catalog)));
      }
    });
  });

  createEffect(on(() => [props.open, props.providerDefaults, store.draft?.id, store.draft?.type] as const, () => {
    untrack(() => {
      const defaults = props.providerDefaults?.[store.draft?.type ?? 'openai'];
      if (props.open && store.draft && defaults) setStore('draft', draft => draft ? { ...draft, model_defaults: defaults } : draft);
    });
  }));

  const updateProvider = (patch: Partial<FlowerProviderDraft>) => {
    setStore('draft', (draft) => {
      if (!draft) return draft;
      const next = { ...draft, ...patch };
      if ('base_url' in patch || 'web_search' in patch || 'web_search_api_key' in patch) {
        next.models = next.models.map((model) => ({ ...model, web_search: undefined }));
        next.catalog_models = undefined;
      }
      return next;
    });
  };

  const changeProviderType = (type: FlowerProviderType) => {
    if (!store.draft) return;
    cancelAuthorization();
    discoverySequence++; setLoading(false); setDiscoveryError(''); setAuthError('');
    setQuery(''); setCustomModelName(''); setEditingModelName('');
    const nextModels = defaultFlowerProviderModels(type);
    updateProvider({
      type,
      auth_method: type === 'openai' ? chatGPTEnabled() ? 'chatgpt' : 'api_key' : undefined,
      account_id: undefined, chatgpt_account: undefined, chatgpt_attempt: undefined,
      name: providerTypeLabel(type),
      base_url: defaultBaseURLForFlowerProviderType(type),
      web_search: flowerProviderNeedsWebSearchConfig(type) ? { mode: 'disabled' } : undefined,
      web_search_api_key: null,
      provider_api_key: undefined,
      models: nextModels,
      model_selection: undefined,
      catalog_models: undefined,
      model_defaults: props.providerDefaults?.[type],
    });
  };

  const selectProviderType = (type: FlowerProviderType) => {
    if (props.mode === 'edit') return;
    setSelectedProviderType(type);
    if (store.draft?.type !== type) changeProviderType(type);
  };

  const setModels = (models: readonly FlowerProviderModel[]) => {
    setStore('draft', (draft) => (draft ? { ...draft, models: models.map(cloneModel) } : draft));
  };

  const setEnabled = (models: readonly FlowerProviderModel[], enabled: boolean) => {
    if (store.draft) setStore('draft', reconcile(setFlowerModelsEnabled(store.draft, models, enabled)));
  };
  const addPreset = (model: FlowerProviderModel) => setEnabled([model], true);
  const removePreset = (modelName: string) => setEnabled((store.draft?.models ?? []).filter((model) => model.model_name === modelName), false);
  const addAllPresets = () => setEnabled(catalog(), true);

  const addCustomModel = () => {
    const name = cleanModelName(customModelName());
    if (!store.draft || chatGPTSelected() || !name || modelSelected(store.draft, name)) return;
    setModels([
      ...store.draft.models,
      {
        model_name: name,
        status: 'needs_configuration',
        input_modalities: ['text'],
      },
    ]);
    setEditingModelName(name);
    setCustomModelName('');
  };

  const updateModel = (index: number, patch: Partial<FlowerProviderModel>) => {
    if (!store.draft) return;
    setModels(store.draft.models.map((model, modelIndex) => {
      if (modelIndex !== index) return model;
      const edited = { ...model, ...patch };
      const listed = store.draft?.catalog_models?.find((entry) => (entry.wire_model_name || entry.model_name) === (edited.wire_model_name || edited.model_name));
      return applyModelOverride(listed ?? { model_name: edited.model_name, status: model.status }, edited);
    }));
  };

  const resetModelToPreset = (index: number, preset: FlowerProviderModel) => {
    if (!store.draft) return;
    const rawCatalog = flowerProviderModelCatalog(store.draft);
    const raw = rawCatalog.find(entry => entry.model_name === preset.model_name || (entry.wire_model_name || entry.model_name) === (preset.wire_model_name || preset.model_name)) ?? preset;
    const selected = store.draft.models[index];
    setModels(store.draft.models.map((model, modelIndex) => modelIndex === index ? cloneModel({ ...raw, model_name: selected.model_name, wire_model_name: selected.wire_model_name || raw.wire_model_name }) : model));
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.mode === 'create' ? copy().addTitle : copy().editTitle}
      class="flower-provider-dialog w-[min(72rem,96vw)] max-w-[96vw]"
      contentClass="flower-provider-dialog-body"
      footer={(
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Show when={selectedProviderType() && missingCredential() && !chatGPTSelected()}>
            <span role="status" class="mr-auto text-sm text-muted-foreground">
              {missingCredential() === 'provider' ? copy().needsKey : copy().needsBraveKey}
            </span>
          </Show>
          <Show when={incompleteModel()}><span role="status" class="mr-auto text-sm text-muted-foreground">{copy().catalog.needsConfiguration}</span></Show>
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {copy().discard}
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={props.saving}
            disabled={!selectedProviderType() || props.saving || Boolean(missingCredential()) || incompleteModel() || Boolean(store.draft?.model_selection && !store.draft.model_selection.selected_models)}
            onClick={() => { if (selectedProviderType() && store.draft && !missingCredential() && !incompleteModel()) void props.onConfirm(store.draft); }}
          >
            {copy().saveProvider}
          </Button>
        </div>
      )}
    >
      <Show when={store.draft} fallback={<div class="flower-body-copy text-muted-foreground">{copy().providerRemoved}</div>}>
        <div class="flower-provider-workspace">
          <nav class="flower-provider-picker" aria-label={copy().providerTypeTitle}>
            <h3 class="flower-provider-picker-title">{copy().providerTypeTitle}</h3>
            <div class="flower-provider-picker-options">
              <For each={props.mode === 'edit' ? FLOWER_PROVIDER_TYPES.filter((item) => item.value === store.draft?.type) : FLOWER_PROVIDER_TYPES}>
                {(item) => (
                  <button
                    type="button"
                    class="flower-provider-choice"
                    classList={{ 'flower-provider-choice--active': selectedProviderType() === item.value }}
                    onClick={() => selectProviderType(item.value)}
                    aria-current={selectedProviderType() === item.value ? 'true' : undefined}
                    aria-controls={`flower-provider-type-${item.value}`}
                    title={copy().providerTypeHints[item.value] ?? item.hint}
                  >
                    <span class="flower-provider-choice-icon"><FlowerProviderBrandIcon type={item.value} class="h-5 w-5" /></span>
                    <span class="flower-provider-choice-label">{providerTypeLabel(item.value)}</span>
                    <span class="flower-provider-choice-check" aria-hidden="true"><Show when={selectedProviderType() === item.value}><Check class="h-3.5 w-3.5" /></Show></span>
                  </button>
                )}
              </For>
            </div>
          </nav>
          <div class="flower-provider-detail">
            <Show when={selectedProviderType()} fallback={<div class="flower-provider-introduction"><p>{copy().providerTypeDescription}</p></div>}>
              <div id={`flower-provider-type-${store.draft!.type}`} class="flower-provider-editor">
                <div class="flower-provider-identity">
                  <FlowerProviderBrandIcon type={store.draft!.type} class="h-6 w-6 shrink-0" />
                  <h2>{providerTypeLabel(store.draft!.type)}</h2>
                </div>
                <section class="flower-provider-connection">
                  <div class="flower-provider-section-heading"><h3>{copy().connectionTitle}</h3></div>
                  <Show when={store.draft!.type === 'openai'}>
                    <div class="flower-provider-authentication">
                      <div role="group" aria-label={copy().chatGPT.authentication} class="flower-provider-auth-method">
                        <button type="button" disabled={!chatGPTEnabled()} aria-pressed={chatGPTSelected()} onClick={() => changeAuthentication('chatgpt')}>{copy().chatGPT.account}</button>
                        <button type="button" aria-pressed={!chatGPTSelected()} onClick={() => changeAuthentication('api_key')}>{copy().apiKey}</button>
                      </div>
                      <Show when={!chatGPTEnabled()}><p class="flower-body-copy text-muted-foreground">{copy().chatGPT.localOnly}</p></Show>
                    </div>
                  </Show>
                  <Show when={chatGPTSelected() && chatGPTEnabled()}>
                    <div class="flower-provider-account-group">
                      <div class="flower-provider-account" data-connected={connected() || undefined} data-state={authorizing() ? authProgress() : authError() ? 'failed' : account()?.state === 'ready' ? 'connected' : 'idle'}>
                        <div class="flower-provider-account-heading">
                          <div class="flower-provider-account-symbol" aria-hidden="true">
                            <Show when={!authorizing()} fallback={<span class="flower-provider-account-spinner" />}>
                              <FlowerProviderBrandIcon type="openai" class="h-6 w-6" />
                            </Show>
                          </div>
                          <div class="flower-provider-account-identity" aria-live="polite" aria-atomic="true">
                            <h4>{authorizing() ? copy().chatGPT[authProgress()] : account()?.email || copy().chatGPT.connectTitle}</h4>
                            <p class="flower-provider-account-description">{authorizing() ? authProgress() === 'waiting' ? copy().chatGPT.waitingDescription : copy().chatGPT.progressDescription : account()?.state === 'ready' ? copy().chatGPT.planSource : copy().chatGPT.planPermission}</p>
                          </div>
                          <Show when={!authorizing() && account()?.state === 'ready'}><span class="flower-provider-account-connected"><Check class="h-3 w-3" aria-hidden="true" />{copy().chatGPT.connected}</span></Show>
                        </div>
                        <Show when={authError()}><div role="alert" class="flower-provider-account-error">{authError()}</div></Show>
                        <div class="flower-provider-account-actions" ref={authActions}>
                          <Show when={connected()}><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer" class="flower-provider-account-usage">{copy().chatGPT.manageUsage}<ExternalLink class="h-3 w-3" aria-hidden="true" /></a></Show>
                          <Button ref={authPrimary} size="sm" variant={connected() ? 'ghost' : 'default'} class="flower-provider-account-primary" disabled={authorizing()} onClick={() => void startAuthorization()}>
                            <StableText reserve={connected() ? [copy().chatGPT.reauthorize] : [copy().chatGPT.preparing, copy().chatGPT.verifying, copy().chatGPT.waiting, copy().chatGPT.reauthorize, copy().chatGPT.continue]}>{authorizing() ? copy().chatGPT[authProgress()] : account() ? copy().chatGPT.reauthorize : copy().chatGPT.continue}</StableText>
                            <Show when={!authorizing() && account()?.state !== 'ready'}><ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></Show>
                          </Button>
                          <Show when={authorizing()}><Button ref={authCancel} size="sm" variant="ghost" onClick={cancelAuthorization}>{copy().chatGPT.cancel}</Button></Show>
                          <Show when={account() && !authorizing()}><div class="flower-provider-account-secondary">
                            <Button size="sm" variant="ghost" onClick={() => void startAuthorization(true)}>{copy().chatGPT.changeAccount}</Button>
                            <Show when={account() && !store.draft?.chatgpt_attempt}>
                              <Button size="sm" variant="ghost" class="whitespace-nowrap" onClick={async () => {
                                const sequence = authSequence;
                                try {
                                  const result = await props.chatGPTAuth?.('sign-out', { scope_id: crypto.randomUUID(), account_id: store.draft?.account_id });
                                  if (sequence !== authSequence || !props.open || !chatGPTEnabled()) return;
                                  updateProvider({ chatgpt_account: account() ? { ...account()!, state: 'authorization_required' } : undefined });
                                  if (result?.revocation_confirmed === false) setAuthError(copy().chatGPT.revocationUnconfirmed);
                                } catch { setAuthError(copy().chatGPT.signInFailed); }
                              }}>{copy().chatGPT.signOut}</Button>
                            </Show>
                          </div></Show>
                        </div>
                      </div>
                      <Show when={welcomeMotion.mounted()}>
                        <div class="flower-provider-account-notice" ref={welcomeMotion.bindViewport} data-state={welcomeMotion.state()}
                          aria-hidden={!showWelcome()} inert={!showWelcome()} style={{ height: welcomeMotion.height() }}>
                          <div class="flower-provider-account-notice-body" ref={welcomeMotion.bindContent}>
                            <div class="flower-provider-account-welcome" role="note" aria-label={copy().chatGPT.welcomeTitle}>
                              <Info class="flower-provider-account-welcome-icon" aria-hidden="true" />
                              <p>{copy().chatGPT.welcome}</p>
                              <Button size="sm" variant="outline" class="flower-provider-account-confirm" onClick={() => {
                                updateProvider({ chatgpt_account: { ...account()!, welcome_acknowledged: true } });
                                authPrimary?.focus({ preventScroll: true });
                              }}>{copy().chatGPT.welcomeConfirm}</Button>
                            </div>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>
                  <div class="flower-provider-connection-fields">
                    <Show when={flowerProviderUsesCustomName(store.draft!.type)}>
                      <div>
                        <FlowerFieldLabel>{copy().connectionName}</FlowerFieldLabel>
                        <Input
                          value={store.draft!.name ?? ''}
                          onInput={(event) => updateProvider({ name: event.currentTarget.value })}
                          placeholder={providerTypeLabel(store.draft!.type)}
                          size="sm"
                          class="w-full"
                        />
                      </div>
                    </Show>
                    <Show when={!chatGPTSelected()}>
                    <div>
                      <FlowerFieldLabel hint={keyHint()}>
                        {copy().apiKey}
                      </FlowerFieldLabel>
                      <Input
                        type="password"
                        value={store.draft!.provider_api_key ?? ''}
                        onInput={(event) => updateProvider({
                          provider_api_key: event.currentTarget.value,
                        })}
                        placeholder={props.keyConfigured ? FLOWER_STORED_SECRET_PLACEHOLDER : copy().pasteAPIKey}
                        aria-label={copy().apiKey}
                        aria-description={keyHint()}
                        autocomplete="new-password"
                        data-stored-secret={props.keyConfigured ? 'true' : undefined}
                        size="sm"
                        class="flower-provider-secret-input w-full"
                        disabled={!providerID()}
                      />
                    </div>
                    </Show>
                    <Show when={flowerProviderTypeRequiresBaseURL(store.draft!.type)}>
                      <div>
                        <FlowerFieldLabel hint={copy().required}>{copy().baseURL}</FlowerFieldLabel>
                        <Input
                          value={store.draft!.base_url ?? ''}
                          onInput={(event) => updateProvider({ base_url: event.currentTarget.value })}
                          placeholder={defaultBaseURLForFlowerProviderType(store.draft!.type)}
                          size="sm"
                          class="w-full"
                        />
                      </div>
                    </Show>
                    <Show when={flowerProviderNeedsWebSearchConfig(store.draft!.type)}>
                      <div>
                        <FlowerFieldLabel>{copy().webSearch}</FlowerFieldLabel>
                        <Select
                          value={store.draft!.web_search?.mode ?? 'disabled'}
                          onChange={(value) => updateProvider({
                            web_search: { mode: value as FlowerWebSearchMode },
                            ...(value === 'brave' ? {} : { web_search_api_key: null }),
                          })}
                          options={[
                            { value: 'disabled', label: copy().disabled },
                            { value: 'openai_builtin', label: copy().openAIBuiltIn },
                            { value: 'brave', label: copy().braveSearch },
                          ]}
                          class="w-full"
                        />
                      </div>
                    </Show>
                    <Show when={(store.draft!.web_search?.mode ?? 'disabled') === 'brave'}>
                      <div>
                        <FlowerFieldLabel hint={braveKeyHint()}>
                          {copy().braveAPIKey}
                        </FlowerFieldLabel>
                        <Input
                          type="password"
                          value={store.draft!.web_search_api_key ?? ''}
                          onInput={(event) => updateProvider({
                            web_search_api_key: event.currentTarget.value,
                          })}
                          placeholder={props.webSearchKeyConfigured ? FLOWER_STORED_SECRET_PLACEHOLDER : copy().pasteBraveAPIKey}
                          aria-label={copy().braveAPIKey}
                          aria-description={braveKeyHint()}
                          autocomplete="new-password"
                          data-stored-secret={props.webSearchKeyConfigured ? 'true' : undefined}
                          size="sm"
                          class="flower-provider-secret-input w-full"
                          disabled={!providerID()}
                        />
                      </div>
                    </Show>
                  </div>
                </section>

                <Show when={connectionReady()}><section class="flower-provider-models">
                  <div class="flower-provider-section-heading">
                    <h3>{copy().recommendedModelsTitle}</h3>
                  </div>
                  <Show when={store.draft?.model_selection && !store.draft.model_selection.selected_models}><p role="status" class="flower-body-copy text-muted-foreground">{copy().catalog.selectionReview}</p></Show>
                  <ModelCatalogControls hasContent={catalog().length > 0} copy={copy().catalog} query={query()} count={store.draft!.models.length} onQuery={setQuery} onSelectAll={addAllPresets} onClear={() => setEnabled(store.draft?.models ?? [], false)} loading={loading()} error={discoveryError()} onRefresh={props.onDiscoverModels ? discover : undefined} />
                  <Show
                    when={visibleModelNames().length > 0}
                    fallback={<div class="flower-provider-model-empty" role="status">{loading() ? copy().catalog.loading : !query() && chatGPTSelected() && account()?.state !== 'ready' ? copy().chatGPT.planPermission : copy().catalog.empty}</div>}
                  >
                    <div class="flower-provider-model-list">
                      <For each={visibleModelNames()}>
                        {(name) => <Show when={catalogByName().get(name)}>{(preset) => {
                          const modelName = () => cleanModelName(name);
                          const enabled = () => modelSelected(store.draft!, modelName());
                          const activeModel = () => store.draft!.models.find((m) => cleanModelName(m.model_name) === modelName());
                          const model = () => activeModel() ?? preset();
                          const modelNote = () => {
                            const value = preset();
                            return copy().modelNote('note_key' in value ? value.note_key as Parameters<FlowerProviderDialogCopy['modelNote']>[0] : undefined);
                          };
                          const editOpen = () => editingModelName() === modelName();
                          const modelIndex = () => store.draft!.models.findIndex((m) => cleanModelName(m.model_name) === modelName());
                          return (
                            <div class="flower-provider-model-row">
                              <div class="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                                <Checkbox
                                  class="mt-1"
                                  checked={enabled()}
                                  disabled={preset().unavailable && !enabled()}
                                  aria-label={preset().display_name || modelName()}
                                  onChange={(on) => { if (on) addPreset(preset()); else removePreset(modelName()); }}
                                  size="sm"
                                />
                                <div class="min-w-0 flex-1">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <span class={cn('break-all flower-body-copy font-medium', enabled() ? 'text-foreground' : 'text-muted-foreground')}>{preset().display_name || modelName()}</span>
                                    <WebSearchCapabilityBadge availability={model().web_search} copy={copy().catalog} />
                                    <Show when={preset().unavailable}><FlowerSettingsPill>{copy().catalog.unavailableModel}</FlowerSettingsPill></Show>
                                    <Show when={preset().quantization}><FlowerSettingsPill>{preset().quantization}</FlowerSettingsPill></Show>
                                    <Show when={model().status}><FlowerSettingsPill>{model().status === 'needs_configuration' ? copy().catalog.needsConfiguration : model().status === 'unsupported' ? copy().catalog.unavailableModel : model().status === 'experimental' ? copy().catalog.experimental : copy().catalog.preview}</FlowerSettingsPill></Show>
                                    <Show when={preset().wire_model_name}>
                                      <span class="font-mono text-[11px] text-muted-foreground">{preset().wire_model_name!}</span>
                                    </Show>
                                  </div>
                                  <Show when={preset().model_digest && catalog().some((other) => other.model_name !== preset().model_name && other.model_digest === preset().model_digest)}><p class="text-xs text-muted-foreground">{copy().catalog.aliases}: {catalog().filter((other) => other.model_name !== preset().model_name && other.model_digest === preset().model_digest).map((other) => other.wire_model_name || other.model_name).join(', ')}</p></Show>
                                  <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <Show when={model().context_window}>
                                      <span class="flower-provider-model-meta">{formatFlowerTokenCount(model().context_window)} {copy().contextSuffix}</span>
                                    </Show>
                                    <Show when={model().max_output_tokens}>
                                      <span class="flower-provider-model-meta">{formatFlowerTokenCount(model().max_output_tokens)} {copy().outputSuffix}</span>
                                    </Show>
                                    <Show when={flowerModelSupportsImage(model().input_modalities)}>
                                      <span class="flower-provider-model-meta">{copy().imageInput}</span>
                                    </Show>
                                    <Show when={!flowerModelSupportsImage(model().input_modalities)}>
                                      <span class="flower-provider-model-meta">{copy().text}</span>
                                    </Show>
                                  </div>
                                  <Show when={modelNote()}>
                                    {(note) => <div class="mt-0.5 text-[11px] text-muted-foreground">{note()}</div>}
                                  </Show>
                                </div>
                                <div class={cn('col-start-2 flex items-center justify-end gap-1 sm:col-start-3 sm:row-start-1', !enabled() && 'invisible')} aria-hidden={!enabled()}>
                                  <Button disabled={!enabled()} size="sm" variant="ghost" class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={() => setEditingModelName(editOpen() ? '' : modelName())} aria-label={copy().catalog.edit}>
                                    <Pencil class="h-3 w-3" />
                                  </Button>
                                  <Button disabled={!enabled()} size="sm" variant="ghost" class="h-6 px-2 text-muted-foreground hover:text-foreground" onClick={() => {
                                    if (modelIndex() >= 0) {
                                      resetModelToPreset(modelIndex(), preset());
                                    }
                                  }} aria-label={copy().catalog.reset}>
                                    <span class="text-[10px]">{copy().catalog.reset}</span>
                                  </Button>
                                </div>
                              </div>
                              <Show when={enabled() && editOpen()}>
                                <div class="border-t border-border/60 px-3 py-3">
                                  <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
                                    <div class="md:col-span-2">
                                      <FlowerFieldLabel>{copy().modelName}</FlowerFieldLabel>
                                      <Input value={model().model_name} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { model_name: event.currentTarget.value }); }} placeholder="model-name" size="sm" class="w-full font-mono" />
                                    </div>
                                    <div class="md:col-span-2">
                                      <FlowerFieldLabel>{copy().providerModelID}</FlowerFieldLabel>
                                      <Input disabled={chatGPTSelected() || store.draft?.type === 'ollama'} value={model().wire_model_name ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { wire_model_name: event.currentTarget.value || undefined }); }} placeholder={modelName()} size="sm" class="w-full font-mono" />
                                    </div>
                                    <div>
                                      <FlowerFieldLabel>{copy().contextWindow}</FlowerFieldLabel>
                                      <Input type="number" value={model().context_window ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { context_window: Number(event.currentTarget.value) || undefined }); }} placeholder="—" size="sm" class="w-full font-mono" />
                                    </div>
                                    <div>
                                      <FlowerFieldLabel>{copy().maxOutput}</FlowerFieldLabel>
                                      <Input type="number" value={model().max_output_tokens ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { max_output_tokens: Number(event.currentTarget.value) || undefined }); }} placeholder="—" size="sm" class="w-full font-mono" />
                                    </div>
                                    <div>
                                      <FlowerFieldLabel>{copy().effectiveContextPercent}</FlowerFieldLabel>
                                      <Input type="number" value={model().effective_context_window_percent ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { effective_context_window_percent: Number(event.currentTarget.value) || undefined }); }} placeholder="—" size="sm" class="w-full font-mono" />
                                    </div>
                                    <Show when={preset().status === 'needs_configuration' || model().status === 'needs_configuration' || model().supports_tools !== undefined || model().reasoning_capability?.fixture === 'manual_provider_capability'}>
                                      <ManualModelCapabilities model={model()} type={store.draft!.type} baseURL={store.draft!.base_url || defaultBaseURLForFlowerProviderType(store.draft!.type)} copy={copy().catalog} onChange={patch => { if (modelIndex() >= 0) updateModel(modelIndex(), patch); }} />
                                    </Show>
                                    <div class="md:col-span-3">
                                      <Checkbox checked={flowerModelSupportsImage(model().input_modalities)} onChange={(enabled) => { if (modelIndex() >= 0) updateModel(modelIndex(), { input_modalities: enabled ? ['text', 'image'] : ['text'] }); }} label={copy().imageInput} size="sm" />
                                    </div>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          );
                        }}</Show>}
                      </For>
                    </div>
                  </Show>

                  <Show when={!chatGPTSelected() && flowerProviderSupportsCustomModels(store.draft!.type)}><div class="flower-provider-custom-model">
                    <Input
                      value={customModelName()}
                      onInput={(event) => setCustomModelName(event.currentTarget.value)}
                      placeholder={flowerProviderSupportsCustomModels(store.draft!.type) ? copy().customModelPlaceholder : copy().curatedPresetsOnly}
                      size="sm"
                      class="w-full font-mono"
                      disabled={!flowerProviderSupportsCustomModels(store.draft!.type)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addCustomModel}
                      disabled={!flowerProviderSupportsCustomModels(store.draft!.type) || !customModelName().trim()}
                    >
                      {copy().addCustomModel}
                    </Button>
                  </div></Show>
                </section></Show>
                <Show when={props.error}>
                  {(error) => <div role="alert" class="rounded-md border border-destructive/30 bg-destructive/10 p-3 flower-body-copy text-destructive">{error()}</div>}
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </Dialog>
  );
}
