import { WebSearchCapabilityBadge } from '../WebSearchCapabilityBadge';
import { flowerProviderAPIKeyOptional, missingFlowerProviderCredential } from '../providerCredentials';
import { flowerProviderSearchSummary } from '../webSearchCapability';
import { FlowerProviderBrandIcon } from './FlowerProviderBrandIcon';
import { ModelCatalogControls } from './ModelCatalogControls';
import { applyFlowerModelDiscovery, cloneFlowerModel, filterFlowerModels, flowerProviderModelChoices, setFlowerModelsEnabled } from './modelSelection';
import { flowerModelSupportsImage, formatFlowerTokenCount } from '../flowerModelLabel';
import type { FlowerChatGPTAuth, FlowerChatGPTAccount, FlowerModelCatalogDiscovery } from '../contracts/flowerSurfaceContracts';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronDown, Pencil } from '@floegence/floe-webapp-core/icons';
import { Button, Checkbox, Dialog, Input, Select, StableText } from '@floegence/floe-webapp-core/ui';

import { defaultFlowerProviderModels } from './modelSelection';
import type { FlowerProviderDialogCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type { FlowerProviderDraft, FlowerProviderModel, FlowerProviderType, FlowerWebSearchMode } from '../contracts/flowerSurfaceContracts';
import {
  FLOWER_PROVIDER_TYPES,
  defaultBaseURLForFlowerProviderType,
  defaultFlowerContextWindowForProviderType,
  flowerProviderNeedsWebSearchConfig,
  flowerProviderSupportsCustomModels,
  flowerProviderTypeRequiresBaseURL,
  flowerProviderUsesCustomName,
} from './providerCatalog';
import {
  FlowerFieldLabel,
  FlowerSettingsPill,
  FlowerSubSectionHeader,
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
  const [expandedProviderType, setExpandedProviderType] = createSignal<FlowerProviderType | null>(null);
  const [store, setStore] = createStore<{ draft: FlowerProviderDraft | null }>({ draft: null });
  const catalog = createMemo(() => store.draft ? flowerProviderModelChoices(store.draft) : []);
  const catalogByName = createMemo(() => new Map(catalog().map((model) => [model.model_name, model])));
  // Selection and discovery replace metadata objects; model names keep rows and focus stable.
  const visibleModelNames = createMemo(() => filterFlowerModels(catalog(), query()).map((model) => model.model_name));
  const [authorizing, setAuthorizing] = createSignal(false);
  const [authError, setAuthError] = createSignal('');
  let authSequence = 0;
  let pendingAttempt: { id: string; scope: string; auth: FlowerChatGPTAuth } | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelAuthorization = () => {
    authSequence++; clearTimeout(pollTimer); setAuthorizing(false);
    const pending = pendingAttempt; pendingAttempt = null;
    if (pending) void pending.auth('cancel', { scope_id: pending.scope, attempt_id: pending.id }).catch(() => undefined);
  };
  onCleanup(cancelAuthorization);
  const chatGPTEnabled = () => props.chatGPTAvailable === true && Boolean(props.chatGPTAuth);
  const chatGPTSelected = () => store.draft?.auth_method === 'chatgpt';
  const account = () => store.draft?.chatgpt_account;
  const startAuthorization = async (newAccount = false) => {
    const auth = props.chatGPTAuth;
    if (!auth || !chatGPTEnabled() || !props.open) return;
    const prior = pendingAttempt;
    authSequence++; clearTimeout(pollTimer); setAuthError('');
    const sequence = authSequence;
    const scope = prior?.scope ?? crypto.randomUUID();
    setAuthorizing(true);
    try {
      const initial = await auth('start', { scope_id: scope, previous_attempt_id: !newAccount ? store.draft?.chatgpt_attempt?.attempt_id : undefined, account_id: newAccount ? undefined : store.draft?.account_id, reconsent: account()?.state === 'plan_permission_required' });
      if (!initial.id) throw new Error('missing attempt');
      if (sequence !== authSequence || !props.open || !chatGPTEnabled()) {
        void auth('cancel', { scope_id: scope, attempt_id: initial.id }).catch(() => undefined); return;
      }
      pendingAttempt = { id: initial.id, scope, auth };
      const id = initial.id;
      const poll = async () => {
        try {
          const result = await auth('status', { scope_id: scope, attempt_id: id });
          if (sequence !== authSequence || !props.open || !chatGPTEnabled()) return;
          if (result.state === 'ready' && result.account) {
            setAuthorizing(false);
            updateProvider({ account_id: result.account.account_id, chatgpt_account: result.account, chatgpt_attempt: { attempt_id: id, scope_id: scope } });
            if (result.account.state !== 'ready') setAuthError(copy().chatGPT.planPermission);
            return;
          }
          if (result.state === 'failed') { setAuthorizing(false); setAuthError(copy().chatGPT.signInFailed); return; }
          pollTimer = setTimeout(() => { void poll(); }, 800);
        } catch {
          if (sequence === authSequence) { setAuthorizing(false); setAuthError(copy().chatGPT.signInFailed); }
        }
      };
      void poll();
    } catch {
      if (sequence === authSequence) { setAuthorizing(false); setAuthError(copy().chatGPT.signInFailed); }
    }
  };
  const changeAuthentication = (method: 'api_key' | 'chatgpt') => {
    if ((store.draft?.auth_method ?? 'api_key') === method) return;
    if (method === 'chatgpt' && !chatGPTEnabled()) return;
    cancelAuthorization(); setAuthError('');
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
  const providerHasModels = () => (store.draft?.models.length ?? 0) > 0;
  const missingCredential = () => store.draft
    ? missingFlowerProviderCredential(store.draft, props.keyConfigured, props.webSearchKeyConfigured)
    : null;
  const providerTypeLabel = (type: FlowerProviderType): string => copy().providerTypeLabels[type] ?? type;

  createEffect(() => {
    if (props.open) {
      cancelAuthorization();
      const initial = untrack(() => props.provider ? { ...props.provider, chatgpt_account: props.chatGPTAccount } : null);
      if (initial && props.mode === 'create' && initial.type === 'openai' && !initial.auth_method) initial.auth_method = untrack(chatGPTEnabled) ? 'chatgpt' : 'api_key';
      setStore('draft', reconcile(initial));
      setAuthError('');
      setCustomModelName(''); setQuery(''); setDiscoveryError(props.provider?.catalog_error ?? '');
      setEditingModelName('');
      setExpandedProviderType(props.mode === 'edit' && props.provider ? props.provider.type : null);
    }
  });

  const automaticDiscoveryIdentity = createMemo(() => {
    if (!props.open || !store.draft || !props.onDiscoverModels) return '';
    const draft = store.draft;
    if (draft.auth_method === 'chatgpt' && (!chatGPTEnabled() || draft.chatgpt_account?.state !== 'ready')) return '';
    if (draft.type === 'openrouter' || draft.type === 'ollama' || draft.type === 'openai_compatible') return '';
    return discoveryIdentity(draft);
  });
  createEffect(() => {
    if (!automaticDiscoveryIdentity()) return;
    const timer = setTimeout(() => { void untrack(discover); }, 200);
    onCleanup(() => clearTimeout(timer));
  });

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
    const nextModels = defaultFlowerProviderModels(type);
    updateProvider({
      type,
      auth_method: type === 'openai' ? chatGPTEnabled() ? 'chatgpt' : 'api_key' : undefined,
      account_id: undefined, chatgpt_account: undefined, chatgpt_attempt: undefined,
      name: providerTypeLabel(type),
      base_url: defaultBaseURLForFlowerProviderType(type),
      web_search: flowerProviderNeedsWebSearchConfig(type) ? { mode: 'disabled' } : undefined,
      web_search_api_key: null,
      models: nextModels,
      model_selection: undefined,
      catalog_models: undefined,
    });
  };

  const toggleProviderType = (type: FlowerProviderType) => {
    if (props.mode === 'edit') return;
    setExpandedProviderType((current) => (current === type ? null : type));
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
        context_window: defaultFlowerContextWindowForProviderType(store.draft.type) ?? 128000,
        input_modalities: ['text'],
      },
    ]);
    setCustomModelName('');
  };

  const updateModel = (index: number, patch: Partial<FlowerProviderModel>) => {
    if (!store.draft) return;
    setModels(store.draft.models.map((model, modelIndex) => (modelIndex === index ? { ...model, ...patch } : model)));
  };

  const resetModelToPreset = (index: number, preset: FlowerProviderModel) => {
    updateModel(index, cloneModel(preset));
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.mode === 'create' ? copy().addTitle : copy().editTitle}
      class="flower-provider-dialog w-[min(72rem,96vw)] max-w-[96vw]"
      footer={(
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Show when={missingCredential()}>
            <span role="status" class="mr-auto text-sm text-muted-foreground">
              {missingCredential() === 'provider' ? chatGPTSelected() ? copy().chatGPT.planPermission : copy().needsKey : copy().needsBraveKey}
            </span>
          </Show>
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {copy().discard}
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={props.saving}
            disabled={props.saving || Boolean(missingCredential()) || Boolean(store.draft?.model_selection && !store.draft.model_selection.selected_models) || !providerHasModels() && (props.mode === 'create' || !store.draft?.model_selection)}
            onClick={() => { if (store.draft && !missingCredential()) void props.onConfirm(store.draft); }}
          >
            {copy().saveProvider}
          </Button>
        </div>
      )}
    >
      <Show when={store.draft} fallback={<div class="flower-body-copy text-muted-foreground">{copy().providerRemoved}</div>}>
        <div class="space-y-5">
          <section class="space-y-3">
            <FlowerSubSectionHeader
              title={copy().providerTypeTitle}
              description={copy().providerTypeDescription}
            />
            <div class="space-y-2">
              <For each={props.mode === 'edit' ? FLOWER_PROVIDER_TYPES.filter((t) => t.value === store.draft?.type) : FLOWER_PROVIDER_TYPES}>
                {(item) => {
                  const editMode = props.mode === 'edit';
                  const active = () => store.draft!.type === item.value;
                  const expanded = () => editMode || expandedProviderType() === item.value;
                  const panelID = `flower-provider-type-${item.value}`;
                  const providerID = () => String(store.draft!.id ?? '').trim();
                  const searchSummary = () => flowerProviderSearchSummary(store.draft!.models, copy().catalog);
                  return (
                    <div class={cn('rounded-lg border bg-background transition', expanded() ? 'border-primary/50 ring-1 ring-primary/15' : 'border-border')}>
                      <button
                        type="button"
                        class={cn(
                          'flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60',
                          active() ? 'bg-primary/5' : '',
                        )}
                        onClick={() => toggleProviderType(item.value)}
                        aria-expanded={expanded()}
                        aria-controls={panelID}
                      >
                        <div class={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', active() ? 'bg-background' : 'bg-muted/60')}>
                          <FlowerProviderBrandIcon type={item.value} class="h-5 w-5" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center justify-between gap-2">
                            <div class="flower-body-copy font-semibold text-foreground">{providerTypeLabel(item.value)}</div>
                            <div class="flex items-center gap-2 text-xs text-muted-foreground">
                              <Show when={active()}><span>{copy().current}</span></Show>
                              <span>{expanded() ? copy().collapse : copy().configure}</span>
                              <ChevronDown class={cn('h-3.5 w-3.5 transition-transform', expanded() ? 'rotate-180' : '')} />
                            </div>
                          </div>
                          <div class="mt-1 text-[11px] text-muted-foreground">{copy().providerTypeHints[item.value] ?? item.hint}</div>
                        </div>
                      </button>

                      <Show when={expanded()}>
                        <div id={panelID} class="max-h-[50vh] overflow-y-auto border-t border-border/80 p-4">
                          <div class="space-y-5">
                            <section class="space-y-3">
                              <FlowerSubSectionHeader title={copy().connectionTitle} description={copy().connectionDescription} />
                              <Show when={store.draft!.type === 'openai'}>
                                <div class="space-y-2">
                                  <div role="group" aria-label={copy().chatGPT.authentication} class="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
                                    <Button size="sm" variant={chatGPTSelected() ? 'secondary' : 'ghost'} class="whitespace-nowrap" disabled={!chatGPTEnabled()} aria-pressed={chatGPTSelected()} onClick={() => changeAuthentication('chatgpt')}>{copy().chatGPT.account}</Button>
                                    <Button size="sm" variant={!chatGPTSelected() ? 'secondary' : 'ghost'} class="whitespace-nowrap" aria-pressed={!chatGPTSelected()} onClick={() => changeAuthentication('api_key')}>{copy().apiKey}</Button>
                                  </div>
                                  <Show when={!chatGPTEnabled()}><p class="flower-body-copy text-muted-foreground">{copy().chatGPT.localOnly}</p></Show>
                                </div>
                              </Show>
                              <Show when={chatGPTSelected() && chatGPTEnabled()}>
                                <div class="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                                  <Show when={account()}>{(current) => <div class="min-w-0"><p class="break-words text-sm font-medium">{current().email}</p><p class="mt-1 text-xs text-muted-foreground">{current().state === 'ready' ? copy().chatGPT.planSource : copy().chatGPT.planPermission}</p></div>}</Show>
                                  <Show when={account()?.state === 'ready' && !account()!.welcome_acknowledged}>
                                    <div class="space-y-2 rounded-md border border-border bg-background/60 p-3">
                                      <p class="text-sm font-medium">{copy().chatGPT.welcomeTitle}</p>
                                      <p class="flower-body-copy text-muted-foreground">{copy().chatGPT.welcome}</p>
                                      <Button size="sm" variant="secondary" class="whitespace-nowrap" onClick={() => updateProvider({ chatgpt_account: { ...account()!, welcome_acknowledged: true } })}>{copy().chatGPT.welcomeConfirm}</Button>
                                    </div>
                                  </Show>
                                  <div class="flex flex-wrap items-center gap-2">
                                    <Button size="sm" class="whitespace-nowrap" disabled={authorizing()} onClick={() => void startAuthorization()}><StableText reserve={[copy().chatGPT.waiting, copy().chatGPT.reauthorize, copy().chatGPT.continue]}>{authorizing() ? copy().chatGPT.waiting : account() ? copy().chatGPT.reauthorize : copy().chatGPT.continue}</StableText></Button>
                                    <Show when={authorizing()}><Button size="sm" variant="ghost" class="whitespace-nowrap" onClick={cancelAuthorization}>{copy().chatGPT.cancel}</Button></Show>
                                    <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer" class="cursor-pointer text-xs font-medium text-primary underline-offset-4 hover:underline">{copy().chatGPT.manageUsage}</a>
                                    <Show when={account() && !authorizing()}><Button size="sm" variant="ghost" class="whitespace-nowrap" onClick={() => void startAuthorization(true)}>{copy().chatGPT.changeAccount}</Button></Show>
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
                                  </div>
                                  <Show when={authError()}><p role="alert" class="flower-body-copy text-destructive">{authError()}</p></Show>
                                </div>
                              </Show>
                              <div class={cn('grid grid-cols-1 gap-3', flowerProviderUsesCustomName(store.draft!.type) ? 'sm:grid-cols-2' : '')}>
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
                                  <FlowerFieldLabel hint={flowerProviderAPIKeyOptional(store.draft!.type) ? copy().catalog.optionalKey : props.keyConfigured ? copy().storedKeyKept : copy().requiredBeforeUse}>
                                    {copy().apiKey}
                                  </FlowerFieldLabel>
                                  <Input
                                    type="password"
                                    value={store.draft!.provider_api_key ?? ''}
                                    onInput={(event) => updateProvider({
                                      provider_api_key: event.currentTarget.value,
                                    })}
                                    placeholder={props.keyConfigured ? copy().storedKeyKept : copy().pasteAPIKey}
                                    size="sm"
                                    class="w-full"
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
                                    <FlowerFieldLabel hint={props.webSearchKeyConfigured ? copy().storedKeyKept : copy().requiredForBraveSearch}>
                                      {copy().braveAPIKey}
                                    </FlowerFieldLabel>
                                    <Input
                                      type="password"
                                      value={store.draft!.web_search_api_key ?? ''}
                                      onInput={(event) => updateProvider({
                                        web_search_api_key: event.currentTarget.value,
                                      })}
                                      placeholder={props.webSearchKeyConfigured ? copy().storedBraveKeyKept : copy().pasteBraveAPIKey}
                                      size="sm"
                                      class="w-full"
                                      disabled={!providerID()}
                                    />
                                  </div>
                                </Show>
                              </div>
                              <div class="flex flex-wrap gap-2">
                                <Show when={!chatGPTSelected()}><FlowerSettingsPill tone={props.keyConfigured || String(store.draft!.provider_api_key ?? '').trim() ? 'success' : 'default'}>
                                  {flowerProviderAPIKeyOptional(store.draft!.type) ? copy().catalog.optionalKey : props.keyConfigured || String(store.draft!.provider_api_key ?? '').trim() ? copy().keyReady : copy().needsKey}
                                </FlowerSettingsPill></Show>
                                <FlowerSettingsPill>{providerTypeLabel(store.draft!.type)}</FlowerSettingsPill>
                                <Show when={(store.draft!.web_search?.mode ?? 'disabled') === 'brave'}>
                                  <FlowerSettingsPill tone={props.webSearchKeyConfigured || String(store.draft!.web_search_api_key ?? '').trim() ? 'success' : 'default'}>
                                    {props.webSearchKeyConfigured || String(store.draft!.web_search_api_key ?? '').trim() ? copy().braveKeyReady : copy().needsBraveKey}
                                  </FlowerSettingsPill>
                                </Show>
                                <FlowerSettingsPill tone={searchSummary().enabled ? 'success' : 'default'}>{searchSummary().label}</FlowerSettingsPill>
                              </div>
                            </section>

                            <section class="space-y-3">
                              <FlowerSubSectionHeader
                                title={copy().recommendedModelsTitle}
                                description={copy().recommendedModelsDescription}
                              />
                              <Show when={store.draft?.model_selection && !store.draft.model_selection.selected_models}><p role="status" class="flower-body-copy text-muted-foreground">{copy().catalog.selectionReview}</p></Show>
                              <ModelCatalogControls hasContent={catalog().length > 0} copy={copy().catalog} query={query()} count={store.draft!.models.length} onQuery={setQuery} onSelectAll={addAllPresets} onClear={() => setEnabled(store.draft?.models ?? [], false)} loading={loading()} error={discoveryError()} onRefresh={props.onDiscoverModels && store.draft?.type !== 'openai_compatible' ? discover : undefined} />
                              <Show
                                when={visibleModelNames().length > 0}
                                fallback={<div class="rounded-lg border border-dashed p-4 flower-body-copy text-muted-foreground">{copy().catalog.empty}</div>}
                              >
                                <div class="rounded-lg border border-border">
                                  <For each={visibleModelNames()}>
                                    {(name) => {
                                      const preset = () => catalogByName().get(name)!;
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
                                        <div class={cn('border-b border-border last:border-b-0', enabled() && 'bg-primary/5')}>
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
                                                <span class={cn('break-all font-mono flower-body-copy font-semibold', enabled() ? 'text-foreground' : 'text-muted-foreground')}>{preset().display_name || modelName()}</span>
                                                <WebSearchCapabilityBadge availability={model().web_search} copy={copy().catalog} />
                                                <Show when={preset().unavailable}><FlowerSettingsPill>{copy().catalog.unavailableModel}</FlowerSettingsPill></Show>
                                                <Show when={preset().quantization}><FlowerSettingsPill>{preset().quantization}</FlowerSettingsPill></Show>
                                                <Show when={preset().status}><FlowerSettingsPill>{preset().status === 'experimental' ? copy().catalog.experimental : copy().catalog.preview}</FlowerSettingsPill></Show>
                                                <Show when={preset().wire_model_name}>
                                                  <span class="font-mono text-[11px] text-muted-foreground">{preset().wire_model_name!}</span>
                                                </Show>
                                              </div>
                                              <Show when={preset().model_digest && catalog().some((other) => other.model_name !== preset().model_name && other.model_digest === preset().model_digest)}><p class="text-xs text-muted-foreground">{copy().catalog.aliases}: {catalog().filter((other) => other.model_name !== preset().model_name && other.model_digest === preset().model_digest).map((other) => other.wire_model_name || other.model_name).join(', ')}</p></Show>
                                              <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                                <Show when={model().context_window}>
                                                  <span class={cn('rounded-full px-1.5 py-px text-[10px] font-medium', enabled() ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{formatFlowerTokenCount(model().context_window)} {copy().contextSuffix}</span>
                                                </Show>
                                                <Show when={model().max_output_tokens}>
                                                  <span class={cn('rounded-full px-1.5 py-px text-[10px] font-medium', enabled() ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{formatFlowerTokenCount(model().max_output_tokens)} {copy().outputSuffix}</span>
                                                </Show>
                                                <Show when={flowerModelSupportsImage(model().input_modalities)}>
                                                  <span class={cn('rounded-full px-1.5 py-px text-[10px] font-medium', enabled() ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{copy().imageInput}</span>
                                                </Show>
                                                <Show when={!flowerModelSupportsImage(model().input_modalities)}>
                                                  <span class="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{copy().text}</span>
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
                                                  <Input value={model().wire_model_name ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { wire_model_name: event.currentTarget.value || undefined }); }} placeholder={modelName()} size="sm" class="w-full font-mono" />
                                                </div>
                                                <div>
                                                  <FlowerFieldLabel>{copy().contextWindow}</FlowerFieldLabel>
                                                  <Input type="number" value={model().context_window ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { context_window: Number(event.currentTarget.value) || undefined }); }} placeholder="128000" size="sm" class="w-full font-mono" />
                                                </div>
                                                <div>
                                                  <FlowerFieldLabel>{copy().maxOutput}</FlowerFieldLabel>
                                                  <Input type="number" value={model().max_output_tokens ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { max_output_tokens: Number(event.currentTarget.value) || undefined }); }} placeholder="4096" size="sm" class="w-full font-mono" />
                                                </div>
                                                <div>
                                                  <FlowerFieldLabel>{copy().effectiveContextPercent}</FlowerFieldLabel>
                                                  <Input type="number" value={model().effective_context_window_percent ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { effective_context_window_percent: Number(event.currentTarget.value) || undefined }); }} placeholder="95" size="sm" class="w-full font-mono" />
                                                </div>
                                                <div class="md:col-span-3">
                                                  <Checkbox checked={flowerModelSupportsImage(model().input_modalities)} onChange={(enabled) => { if (modelIndex() >= 0) updateModel(modelIndex(), { input_modalities: enabled ? ['text', 'image'] : ['text'] }); }} label={copy().imageInput} size="sm" />
                                                </div>
                                              </div>
                                            </div>
                                          </Show>
                                        </div>
                                      );
                                    }}
                                  </For>
                                </div>
                              </Show>

                              <Show when={!chatGPTSelected()}><div class="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
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
                            </section>

                            <Show when={props.error}>
                              {(error) => (
                                <div role="alert" class="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flower-body-copy text-destructive">
                                  {error()}
                                </div>
                              )}
                            </Show>
                          </div>
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </section>
        </div>
      </Show>
    </Dialog>
  );
}
