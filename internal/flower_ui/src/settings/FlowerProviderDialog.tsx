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
import { Check, ChevronDown, ExternalLink, Info, Pencil, Save } from '@floegence/floe-webapp-core/icons';
import { Button, Checkbox, ConfirmDialog, Dialog, Dropdown, Input, Select, StableText, Tooltip } from '@floegence/floe-webapp-core/ui';

import { defaultFlowerProviderModels } from './modelSelection';
import type { FlowerProviderDialogCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import { createFlowerActivityDisclosureMotion } from '../activityDisclosure';
import type { FlowerProviderDraft, FlowerProviderModel, FlowerProviderType, FlowerWebSearchPolicy } from '../contracts/flowerSurfaceContracts';
import {
  FLOWER_PROVIDER_TYPES,
  defaultBaseURLForFlowerProviderType,
  flowerProviderSupportsCustomModels,
  flowerProviderTypeRequiresBaseURL,
  flowerProviderDisplayName,
} from './providerCatalog';
import {
  FLOWER_STORED_SECRET_PLACEHOLDER,
  FlowerFieldLabel,
  FlowerSettingsPill,
} from './FlowerSettingsPrimitives';

export type FlowerProviderDialogMode = 'create' | 'edit';

export type FlowerProviderDialogProps = Readonly<{
  chatGPTAuth?: FlowerChatGPTAuth;
  loadChatGPTAccounts?: import('../contracts/flowerSurfaceContracts').FlowerSurfaceAdapter['loadChatGPTAccounts'];
  chatGPTAvailable?: boolean;
  chatGPTBindingID?: string;
  chatGPTAccount?: FlowerChatGPTAccount;
  chatGPTAccounts?: readonly FlowerChatGPTAccount[];
  onDiscoverModels?: FlowerModelCatalogDiscovery;
  open: boolean;
  mode: FlowerProviderDialogMode;
  allowTypeChange?: boolean;
  provider: FlowerProviderDraft | null;
  catalogModels?: readonly FlowerProviderModel[];
  searchPolicies?: Readonly<Partial<Record<FlowerProviderType, FlowerWebSearchPolicy>>>;
  initialModelName?: string;
  providerDefaults?: Readonly<Partial<Record<FlowerProviderType, readonly FlowerProviderModel[]>>>;
  copy?: FlowerProviderDialogCopy;
  keyConfigured: boolean;
  webSearchKeyConfigured: boolean;
  error?: string;
  saving?: boolean;
  disabled?: boolean;
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
  const searchPolicy = () => store.draft?.type === props.provider?.type && store.draft?.search_policy
    ? store.draft.search_policy : props.searchPolicies?.[store.draft?.type ?? 'openai'];
  const providerSearch = () => store.draft?.web_search ?? (searchPolicy() ? { enabled: searchPolicy()!.enabled, source: searchPolicy()!.source } : undefined);
  const recommended = (enabled: boolean) => enabled ? copy().catalog.searchRecommendedOn : copy().catalog.searchRecommendedOff;
  const SearchInfo = (info: { text: string }) => <Tooltip content={info.text} placement="bottom" delay={0} class="!whitespace-normal w-64 max-w-[75vw]"><button type="button" class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-label={copy().webSearch} onClick={event => event.currentTarget.focus()} on:keydown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }}><Info class="h-3.5 w-3.5" aria-hidden="true" /></button></Tooltip>;
  const canChangeType = () => props.mode === 'create' || props.allowTypeChange === true;
  const [query, setQuery] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [discoveryError, setDiscoveryError] = createSignal('');
  const discoveryIdentity = (draft: FlowerProviderDraft) => JSON.stringify([draft.id, draft.type, draft.base_url, draft.provider_api_key, draft.auth_method, draft.account_id, draft.web_search, draft.web_search_api_key, props.webSearchKeyConfigured]);
  let discoverySequence = 0;
  let lastDiscoveryIdentity: string | undefined;
  const invalidateDiscovery = () => {
    discoverySequence++;
    setLoading(false); setDiscoveryError('');
  };
  onCleanup(invalidateDiscovery);
  const discover = async () => {
    const draft = store.draft;
    if (!props.open || props.disabled || !draft || !props.onDiscoverModels || loading()) return;
    const sequence = ++discoverySequence;
    const identity = discoveryIdentity(draft);
    lastDiscoveryIdentity = identity;
    const currentRequest = () => sequence === discoverySequence && props.open && store.draft && identity === discoveryIdentity(store.draft);
    setLoading(true); setDiscoveryError('');
    try {
      const result = await props.onDiscoverModels({ provider_id: draft.id, type: draft.type, base_url: draft.base_url, api_key: draft.auth_method === 'chatgpt' ? undefined : draft.provider_api_key ?? undefined, auth_method: draft.auth_method, account_id: draft.account_id });
      const current = store.draft;
      if (currentRequest() && current) setStore('draft', reconcile(applyFlowerModelDiscovery(current, result.models)));
    } catch (error) { if (currentRequest()) setDiscoveryError(error instanceof Error ? error.message : String(error)); }
    finally { if (sequence === discoverySequence) setLoading(false); }
  };
  const setupDiscovery = () => props.mode === 'create' && (selectedProviderType() === 'openrouter' || selectedProviderType() === 'ollama') && Boolean(props.onDiscoverModels);
  const discoverNewConnection = () => {
    const draft = store.draft;
    if (!setupDiscovery() || !draft || !providerID() || loading() || lastDiscoveryIdentity === discoveryIdentity(draft)) return;
    if (draft.type === 'openrouter' && !draft.provider_api_key?.trim() && !props.keyConfigured) return;
    try {
      const endpoint = new URL(draft.base_url?.trim() || defaultBaseURLForFlowerProviderType(draft.type));
      if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return;
    } catch { return; }
    void discover();
  };
  const finishConnectionInput = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-flower-skip-discovery], [data-floe-dialog-header]')) return;
    discoverNewConnection();
  };
  const [customModelName, setCustomModelName] = createSignal('');
  const [editingModelName, setEditingModelName] = createSignal('');
  const [editingProviderName, setEditingProviderName] = createSignal(false);
  let originalProviderName: string | undefined;
  let providerNameInput: HTMLInputElement | undefined;
  let providerNameButton: HTMLButtonElement | undefined;
  const beginProviderNameEdit = () => {
    if (!store.draft || props.disabled || props.saving) return;
    originalProviderName = store.draft.name;
    setEditingProviderName(true);
    queueMicrotask(() => {
      if (props.open && editingProviderName()) { providerNameInput?.focus(); providerNameInput?.select(); }
    });
  };
  const finishProviderNameEdit = (commit: boolean, restoreFocus = false) => {
    if (!editingProviderName()) return;
    updateProvider({ name: commit ? store.draft?.name?.trim() ?? '' : originalProviderName });
    setEditingProviderName(false);
    if (restoreFocus) queueMicrotask(() => { if (props.open) providerNameButton?.focus({ preventScroll: true }); });
  };
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
  const [authFailure, setAuthFailure] = createSignal<{ message: string; cleanupUnconfirmed: boolean }>();
  const authError = () => authFailure()?.message ?? '';
  const setAuthError = (message: string, cleanupUnconfirmed = false) => setAuthFailure(message ? { message, cleanupUnconfirmed } : undefined);
  let authPrimary: HTMLButtonElement | undefined;
  let authCancel: HTMLButtonElement | undefined;
  let authActions: HTMLDivElement | undefined;
  const finishAuthorization = () => {
    const restoreFocus = document.activeElement === authCancel;
    setAuthorizing(false);
    if (restoreFocus && props.open) authPrimary?.focus({ preventScroll: true });
  };
  let authSequence = 0;
  let pendingAttempt: { id: string; scope: string; auth: FlowerChatGPTAuth; newRegistration: boolean; accountID?: string; failed?: boolean } | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelAuthorization = () => {
    authSequence++; clearTimeout(pollTimer); finishAuthorization();
    const pending = pendingAttempt; pendingAttempt = null;
    if (pending) void pending.auth('cancel', { scope_id: pending.scope, attempt_id: pending.id }).catch(() => undefined);
  };
  onCleanup(cancelAuthorization);
  const chatGPTEnabled = () => props.chatGPTAvailable === true && Boolean(props.chatGPTAuth);
  const chatGPTSelected = () => store.draft?.auth_method === 'chatgpt';
  const [savedAccounts, setSavedAccounts] = createSignal<readonly FlowerChatGPTAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = createSignal(false);
  const [accountsError, setAccountsError] = createSignal('');
  const [accountsKnown, setAccountsKnown] = createSignal(false);
  const needsSignIn = (item: FlowerChatGPTAccount) => item.state === 'signed_out' || item.state === 'authorization_required';
  const signedInAccounts = createMemo(() => savedAccounts().filter(item => !needsSignIn(item) && item.state !== 'signing_out'));
  const signedOutAccounts = createMemo(() => savedAccounts().filter(needsSignIn));
  let accountsSequence = 0;
  const performSavedAccountsRefresh = async () => {
    const load = props.loadChatGPTAccounts;
    if (!props.open || !chatGPTEnabled()) return;
    if (!load) { setAccountsError(copy().chatGPT.accountsUnavailable); return; }
    const sequence = ++accountsSequence;
    const binding = props.chatGPTBindingID;
    setAccountsLoading(true); setAccountsError('');
    try {
      const result = await load();
      if (sequence !== accountsSequence || !props.open || binding !== props.chatGPTBindingID) return;
      setSavedAccounts(result.saved_accounts);
      setAccountsKnown(true);
      const selected = result.saved_accounts.find(item => item.account_id === store.draft?.account_id);
      if (selected) updateProvider({ chatgpt_account: selected });
    } catch {
      if (sequence === accountsSequence && props.open) setAccountsError(copy().chatGPT.accountsUnavailable);
    } finally { if (sequence === accountsSequence) setAccountsLoading(false); }
  };
  let accountsRequest: Promise<void> | undefined;
  const refreshSavedAccounts = (): Promise<void> => {
    if (accountsRequest) return accountsRequest;
    const request = performSavedAccountsRefresh().finally(() => { if (accountsRequest === request) accountsRequest = undefined; });
    accountsRequest = request;
    return request;
  };
  createEffect(on(() => [props.open, props.chatGPTBindingID, chatGPTEnabled()] as const, () => {
    accountsSequence++; accountsRequest = undefined; setSavedAccounts([]); setAccountsError(''); setAccountsLoading(false); setAccountsKnown(false);
    if (props.open && chatGPTEnabled()) void refreshSavedAccounts();
  }));
  createEffect(on(() => props.chatGPTAccounts, next => {
    if (!props.open || !next || !chatGPTEnabled()) return;
    setSavedAccounts(next);
    const selected = next.find(item => item.account_id === store.draft?.account_id);
    if (selected) updateProvider({ chatgpt_account: selected });
  }));
  const selectAccount = (id: string) => {
    const selected = savedAccounts().find(item => item.account_id === id);
    if (!selected || accountBusy() || authorizing()) return;
    cancelAuthorization(); setAuthError('');
    invalidateDiscovery();
    updateProvider({ account_id: selected.account_id, chatgpt_account: selected });
    if (selected.state === 'ready') void discover();
  };
  const savedAccountLabel = (item: FlowerChatGPTAccount, entries: readonly FlowerChatGPTAccount[]) => {
    const identity = item.email || copy().chatGPT.account;
    const peers = entries.filter(other => other.email === item.email);
    const shortID = item.account_id.slice(-8);
    const registration = peers.some(other => other.account_id !== item.account_id && other.account_id.endsWith(shortID)) ? item.account_id : shortID;
    const label = peers.length > 1 ? `${identity} · ${copy().chatGPT.registrationLabel(registration)}` : identity;
    return label;
  };
  const selectedSavedAccountLabel = createMemo(() => {
    const selected = signedInAccounts().find(item => item.account_id === store.draft?.account_id);
    return selected ? savedAccountLabel(selected, signedInAccounts()) : copy().chatGPT.chooseAccount;
  });
  const [signingOut, setSigningOut] = createSignal(false);
  const [confirmSignOut, setConfirmSignOut] = createSignal(false);
  const [confirmNewRegistration, setConfirmNewRegistration] = createSignal(false);
  const [confirmReauthorization, setConfirmReauthorization] = createSignal(false);
  const [reauthorizationAccountID, setReauthorizationAccountID] = createSignal('');
  const reauthorizationAccount = createMemo(() => signedOutAccounts().find(item => item.account_id === reauthorizationAccountID()));
  const [retrying, setRetrying] = createSignal(false);
  const account = () => store.draft?.chatgpt_account;
  const accountBusy = () => signingOut() || account()?.state === 'signing_out';
  const accountListReady = () => accountsKnown() && !accountsLoading() && !accountsError();
  const needsAccountSelection = () => savedAccounts().length > 0 && !store.draft?.account_id;
  const canStartAuthorization = () => accountListReady() && (!needsAccountSelection() || pendingAttempt?.failed);
  const canContinueAuthorization = () => canStartAuthorization() || accountListReady() && !store.draft?.account_id && signedInAccounts().length === 0 && signedOutAccounts().length > 0;
  createEffect(on(() => [props.open, selectedProviderType(), chatGPTSelected(), accountListReady(), signedInAccounts()] as const, () => {
    untrack(() => {
      if (props.open && props.mode === 'create' && selectedProviderType() === 'openai' && chatGPTSelected()
        && !store.draft?.account_id && !authorizing() && accountListReady() && signedInAccounts().length === 1) selectAccount(signedInAccounts()[0].account_id);
    });
  }));
  const accountDescription = () => {
    const current = account();
    if (!current && accountsLoading()) return copy().chatGPT.loadingAccounts;
    if (!current && needsAccountSelection()) return signedInAccounts().length ? copy().chatGPT.chooseAccountHint : signedOutAccounts().length ? copy().chatGPT.signInAgainHint : copy().chatGPT.signingOut;
    if (accountBusy()) return copy().chatGPT.signingOut;
    if (current?.error_code === 'logout_cleanup_failed') return copy().chatGPT.cleanupFailed;
    if (current?.error_code === 'subscription_sharing_usage_limit_exceeded') return copy().chatGPT.usageUnavailable;
    if (current?.error_code === 'subscription_sharing_user_not_eligible') return copy().chatGPT.eligibilityRequired;
    if (current?.error_code === 'unsupported_country_region_territory') return copy().chatGPT.regionUnavailable;
    switch (current?.state) {
      case 'ready': return copy().chatGPT.planSource;
      case 'renewing': return copy().chatGPT.renewing;
      case 'temporarily_unavailable': return copy().chatGPT.temporarilyUnavailable;
      case 'review_required': return copy().chatGPT.reviewRequired;
      case 'storage_unavailable': return copy().chatGPT.storageUnavailable;
      case 'signed_out': return current.revocation_confirmed === false ? copy().chatGPT.revocationUnconfirmed : copy().chatGPT.signedOut;
      case 'authorization_required': return copy().chatGPT.authorizationRequired;
      default: return copy().chatGPT.planPermission;
    }
  };
  const signOut = async () => {
    const id = store.draft?.account_id;
    const auth = props.chatGPTAuth;
    if (!id || !auth || props.disabled || accountBusy()) return;
    cancelAuthorization(); setSigningOut(true); setAuthError(''); setConfirmSignOut(false);
    try {
      const result = await auth('sign-out', { scope_id: crypto.randomUUID(), account_id: id });
      if (props.open && store.draft?.account_id === id) {
        const updated = account() ? { ...account()!, state: result.local_cleanup_complete === false ? 'storage_unavailable' as const : 'signed_out' as const, error_code: result.error_code, revocation_confirmed: result.revocation_confirmed } : undefined;
        updateProvider({ chatgpt_account: updated });
        if (updated) setSavedAccounts(entries => entries.map(item => item.account_id === id ? updated : item));
        if (result.local_cleanup_complete === false) setAuthError(copy().chatGPT.cleanupFailed);
        else if (result.revocation_confirmed === false) setAuthError(copy().chatGPT.revocationUnconfirmed);
        queueMicrotask(() => authPrimary?.focus({ preventScroll: true }));
      }
    } catch { if (props.open && store.draft?.account_id === id) setAuthError(copy().chatGPT.signOutStatusUnavailable); }
    finally { setSigningOut(false); void refreshSavedAccounts(); }
  };
  const retryAccount = async () => {
    if (account()?.error_code === 'logout_cleanup_failed') { await signOut(); return; }
    const id = store.draft?.account_id;
    if (!id || retrying() || !props.chatGPTAuth) return;
    setRetrying(true); setAuthError('');
    try { await props.chatGPTAuth('retry', { scope_id: crypto.randomUUID(), account_id: id }); }
    catch { if (props.open && store.draft?.account_id === id) setAuthError(accountDescription()); }
    finally { setRetrying(false); }
  };
  const connected = () => !authorizing() && account()?.state === 'ready';
  const showWelcome = () => props.open && chatGPTSelected() && chatGPTEnabled() && connected() && !account()!.welcome_acknowledged;
  const welcomeMotion = createFlowerActivityDisclosureMotion(showWelcome);
  const startAuthorization = async (newAccount = false, returningAccountID?: string) => {
    const auth = props.chatGPTAuth;
    const returningAccount = signedOutAccounts().find(item => item.account_id === returningAccountID);
    if (!auth || !chatGPTEnabled() || props.disabled || !props.open || accountBusy() || authorizing() || !accountListReady()
      || returningAccountID && !returningAccount || !newAccount && !returningAccount && !canStartAuthorization()) return;
    const prior = pendingAttempt;
    const retry = !newAccount && !returningAccount && prior?.failed ? prior : undefined;
    const accountID = newAccount || retry?.newRegistration ? undefined : returningAccount?.account_id ?? retry?.accountID ?? store.draft?.account_id;
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
      const initial = await auth('start', { scope_id: scope, previous_attempt_id: retry?.id, new_registration: newAccount || undefined, account_id: accountID, reconsent: !newAccount && !retry?.newRegistration && !returningAccount && account()?.state === 'plan_permission_required' });
      if (!initial.id) throw new Error('missing attempt');
      if (sequence !== authSequence || !props.open || !chatGPTEnabled()) {
        void auth('cancel', { scope_id: scope, attempt_id: initial.id }).catch(() => undefined); return;
      }
      pendingAttempt = { id: initial.id, scope, auth, newRegistration: newAccount || Boolean(retry?.newRegistration), accountID };
      if (initial.state === 'waiting' || initial.state === 'verifying') setAuthProgress(initial.state);
      const id = initial.id;
      const poll = async () => {
        try {
          const result = await auth('status', { scope_id: scope, attempt_id: id });
          if (sequence !== authSequence || !props.open || !chatGPTEnabled()) return;
          if (result.state === 'ready' && result.account) {
            finishAuthorization();
            void refreshSavedAccounts();
            updateProvider({ account_id: result.account.account_id, chatgpt_account: result.account });
            if (result.account.state !== 'ready') setAuthError(copy().chatGPT.planPermission);
            else void discover();
            return;
          }
          if (result.state === 'failed') { if (pendingAttempt?.id === id) pendingAttempt.failed = true; finishAuthorization(); setAuthError(result.error_code === 'revocation_unconfirmed' ? copy().chatGPT.signInCleanupUnconfirmed : copy().chatGPT.signInFailed, result.error_code === 'revocation_unconfirmed'); return; }
          if (result.state === 'preparing' || result.state === 'waiting' || result.state === 'verifying') setAuthProgress(result.state);
          pollTimer = setTimeout(() => { void poll(); }, 800);
        } catch {
          if (sequence === authSequence) { finishAuthorization(); setAuthError(copy().chatGPT.signInFailed); }
        }
      };
      void poll();
    } catch {
      if (sequence === authSequence) { cancelAuthorization(); setAuthError(copy().chatGPT.signInFailed); void refreshSavedAccounts(); }
    }
  };
  const openReauthorization = () => {
    setReauthorizationAccountID(signedOutAccounts().length === 1 ? signedOutAccounts()[0].account_id : '');
    setConfirmReauthorization(true);
  };
  const continueAuthorization = () => {
    if (canStartAuthorization()) { void startAuthorization(); return; }
    if (!canContinueAuthorization()) return;
    if (signedOutAccounts().length === 1) void startAuthorization(false, signedOutAccounts()[0].account_id);
    else openReauthorization();
  };
  const changeAuthentication = (method: 'api_key' | 'chatgpt') => {
    if ((store.draft?.auth_method ?? 'api_key') === method) return;
    if (method === 'chatgpt' && !chatGPTEnabled()) return;
    cancelAuthorization(); setAuthError('');
    invalidateDiscovery();
    updateProvider({ auth_method: method, account_id: undefined, chatgpt_account: undefined, catalog_models: undefined, responses_continuation: undefined });
  };
  let currentAuth: FlowerChatGPTAuth | undefined;
  let currentBinding: string | undefined;
  let bindingObserved = false;
  createEffect(() => {
    const auth = props.chatGPTAuth, binding = props.chatGPTBindingID;
    const open = props.open, enabled = chatGPTEnabled();
    if (auth !== currentAuth || binding !== currentBinding || !open || !enabled || props.disabled) {
      cancelAuthorization(); setConfirmNewRegistration(false); setConfirmSignOut(false); setConfirmReauthorization(false);
    }
    if (!open || bindingObserved && binding !== currentBinding) {
      invalidateDiscovery();
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
    && (chatGPTSelected() && Boolean(store.draft.account_id) && (store.draft.models.length > 0 || (store.draft.catalog_models?.length ?? 0) > 0)
      || !missingFlowerProviderCredential({ ...store.draft, enabled: true }, props.keyConfigured, props.webSearchKeyConfigured))
    && (!flowerProviderTypeRequiresBaseURL(store.draft.type) || store.draft.base_url?.trim() || defaultBaseURLForFlowerProviderType(store.draft.type)));
  const incompleteModel = () => store.draft?.models.find(flowerModelNeedsConfiguration);
  let providerForm: HTMLFieldSetElement | undefined;
  const configureModel = (name: string) => {
    setQuery('');
    setEditingModelName(name);
    queueMicrotask(() => {
      if (!props.open || props.disabled || props.saving || editingModelName() !== name) return;
      const editor = providerForm?.querySelector<HTMLElement>('[data-flower-model-editor]');
      const input = editor?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? editor?.querySelector<HTMLElement>('input');
      input?.scrollIntoView({ block: 'center' });
      input?.focus({ preventScroll: true });
    });
  };
  const providerTypeLabel = (type: FlowerProviderType): string => copy().providerTypeLabels[type] ?? type;

  createEffect(on(() => [props.open, props.provider?.id] as const, () => {
    if (props.open) {
      cancelAuthorization();
      invalidateDiscovery(); lastDiscoveryIdentity = undefined;
      const initial = untrack(() => props.provider ? { ...props.provider, model_defaults: props.providerDefaults?.[props.provider.type] ?? props.provider.model_defaults, chatgpt_account: props.chatGPTAccount ?? props.provider.chatgpt_account } : null);
      if (initial?.chatgpt_account) initial.chatgpt_account = { ...initial.chatgpt_account };
      if (initial && props.mode === 'create' && initial.type === 'openai' && !initial.auth_method) initial.auth_method = untrack(chatGPTEnabled) ? 'chatgpt' : 'api_key';
      setStore('draft', reconcile(initial));
      setAuthError('');
      setCustomModelName(''); setQuery(''); setDiscoveryError('');
      setEditingModelName(props.initialModelName ?? '');
      setEditingProviderName(false);
      setSelectedProviderType(initial && (props.mode === 'edit' || initial.auth_method === 'chatgpt' && initial.account_id) ? initial.type : null);
      if (props.mode === 'create' && initial?.auth_method === 'chatgpt' && initial.chatgpt_account?.state === 'ready') {
        queueMicrotask(() => { if (props.open && store.draft?.id === initial.id) void discover(); });
      }
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
  createEffect(() => {
    const next = props.chatGPTAccount;
    if (!props.open || !next) return;
    untrack(() => {
      if (store.draft?.account_id === next.account_id) {
        updateProvider({ chatgpt_account: next });
      }
    });
  });

  const updateProvider = (patch: Partial<FlowerProviderDraft>) => {
    setStore('draft', (draft) => {
      if (!draft) return draft;
      const next = { ...draft, ...patch };
      // Draft reconciliation must never mutate the canonical account-list snapshot.
      if (patch.chatgpt_account) next.chatgpt_account = { ...patch.chatgpt_account };
      if ('base_url' in patch) {
        next.catalog_models = undefined;
      }
      if (discoveryIdentity(next) !== discoveryIdentity(draft)) invalidateDiscovery();
      return next;
    });
  };

  const changeProviderType = (type: FlowerProviderType) => {
    if (!store.draft) return;
    cancelAuthorization();
    invalidateDiscovery(); setAuthError('');
    setQuery(''); setCustomModelName(''); setEditingModelName('');
    setEditingProviderName(false);
    const nextModels = defaultFlowerProviderModels(type);
    updateProvider({
      type,
      auth_method: type === 'openai' ? chatGPTEnabled() ? 'chatgpt' : 'api_key' : undefined,
      responses_continuation: undefined,
      account_id: undefined, chatgpt_account: undefined,
      name: providerTypeLabel(type),
      base_url: defaultBaseURLForFlowerProviderType(type),
      web_search: props.searchPolicies?.[type] ? { enabled: props.searchPolicies[type]!.default_enabled, source: props.searchPolicies[type]!.source } : undefined,
      web_search_api_key: undefined,
      provider_api_key: undefined,
      models: nextModels,
      model_selection: undefined,
      catalog_models: undefined,
      model_defaults: props.providerDefaults?.[type],
    });
  };

  const selectProviderType = (type: FlowerProviderType) => {
    if (props.disabled || !canChangeType()) return;
    setSelectedProviderType(type);
    if (store.draft?.type !== type) changeProviderType(type);
    discoverNewConnection();
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
    setModels(store.draft.models.map((model, modelIndex) => modelIndex === index ? cloneModel({ ...raw, web_search_enabled: undefined, model_name: selected.model_name, wire_model_name: selected.wire_model_name || raw.wire_model_name }) : model));
  };

  return (
    <>
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      escapeKeyPhase="bubble"
      title={props.mode === 'create' ? copy().addTitle : copy().editTitle}
      class="flower-provider-dialog w-[min(72rem,96vw)] max-w-[96vw]"
      contentClass="flower-provider-dialog-body"
      footer={(
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Show when={props.saving}><span role="status" class="mr-auto text-sm text-muted-foreground">{copy().catalog.settingsSavePending}</span></Show>
          <Show when={selectedProviderType() && missingCredential() && !chatGPTSelected()}>
            <span role="status" class="mr-auto text-sm text-muted-foreground">
              {missingCredential() === 'provider' ? copy().needsKey : copy().needsBraveKey}
            </span>
          </Show>
          <Show when={incompleteModel()}>{model => <div class="mr-auto flex min-w-0 flex-wrap items-center gap-2">
            <span role="status" class="max-w-48 truncate text-sm text-muted-foreground" title={model().display_name || model().model_name}>{model().display_name || model().model_name}</span>
            <Button size="sm" variant="outline" disabled={props.disabled || props.saving} onClick={() => configureModel(model().model_name)}>{copy().catalog.configure}</Button>
          </div>}</Show>
          <Button size="sm" variant="outline" data-flower-skip-discovery onClick={() => props.onOpenChange(false)}>
            {props.saving ? copy().catalog.settingsCloseSaving : copy().discard}
          </Button>
          <Button
            size="sm"
            variant="default"
            icon={Save}
            loading={props.saving}
            disabled={props.disabled || !selectedProviderType() || props.saving || Boolean(missingCredential()) || Boolean(store.draft?.model_selection && !store.draft.model_selection.selected_models)}
            onClick={() => {
              if (props.disabled || props.saving || !selectedProviderType() || !store.draft || missingCredential()) return;
              const model = incompleteModel();
              if (model) configureModel(model.model_name);
              else void props.onConfirm(store.draft);
            }}
          >
            {copy().saveProvider}
          </Button>
        </div>
      )}
    >
      <Show when={store.draft} fallback={<div class="flower-body-copy text-muted-foreground">{copy().providerRemoved}</div>}>
        <fieldset ref={providerForm} class="flower-provider-workspace" disabled={props.disabled || props.saving}>
          <nav class="flower-provider-picker" aria-label={copy().providerTypeTitle} data-flower-skip-discovery>
            <h3 class="flower-provider-picker-title">{copy().providerTypeTitle}</h3>
            <div class="flower-provider-picker-options">
              <For each={canChangeType() ? FLOWER_PROVIDER_TYPES : FLOWER_PROVIDER_TYPES.filter((item) => item.value === store.draft?.type)}>
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
                  <span class="flower-provider-identity-mark" title={providerTypeLabel(store.draft!.type)}>
                    <FlowerProviderBrandIcon type={store.draft!.type} class="h-6 w-6" />
                  </span>
                  <div class="flower-provider-identity-name" classList={{ 'flower-provider-identity-name--editing': editingProviderName() }}>
                    <Show when={editingProviderName()} fallback={<h2 title={flowerProviderDisplayName(store.draft!, providerTypeLabel(store.draft!.type))}>{flowerProviderDisplayName(store.draft!, providerTypeLabel(store.draft!.type))}</h2>}>
                      <Input ref={providerNameInput} value={store.draft!.name ?? ''}
                        onInput={event => updateProvider({ name: event.currentTarget.value })}
                        onBlur={() => finishProviderNameEdit(true)}
                        onKeyDown={event => {
                          if (event.isComposing) return;
                          if (event.key === 'Enter' || event.key === 'Escape') {
                            event.preventDefault(); event.stopPropagation();
                            finishProviderNameEdit(event.key === 'Enter', true);
                          }
                        }}
                        aria-label={copy().connectionName} placeholder={providerTypeLabel(store.draft!.type)} maxLength={80} size="md" class="flower-provider-name-input w-full" disabled={props.disabled || props.saving} />
                    </Show>
                  </div>
                  <Show when={!editingProviderName()}>
                    <Button ref={providerNameButton} size="icon" variant="ghost" class="flower-provider-name-edit h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={copy().connectionName} title={copy().connectionName} onClick={beginProviderNameEdit} disabled={props.disabled || props.saving}>
                      <Pencil class="h-3.5 w-3.5" />
                    </Button>
                  </Show>
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
                      <Show when={signedInAccounts().length > 0 || accountsLoading()}>
                        <div class="mb-3 min-w-0">
                          <FlowerFieldLabel>{copy().chatGPT.savedAccounts}</FlowerFieldLabel>
                          <Dropdown triggerAriaLabel={copy().chatGPT.savedAccounts} triggerInputSurface
                            trigger={<><span class="truncate" title={selectedSavedAccountLabel()}>{accountsLoading() && !accountsKnown() ? copy().chatGPT.loadingAccounts : selectedSavedAccountLabel()}</span><ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></>}
                            triggerClass="flex h-8 w-full items-center justify-between gap-2 rounded border border-input bg-background px-2.5 text-sm shadow-sm" class="w-full"
                            value={store.draft?.account_id ?? ''} items={signedInAccounts().map(item => ({ id: item.account_id, label: savedAccountLabel(item, signedInAccounts()) }))}
                            disabled={authorizing() || accountBusy() || accountsLoading()} onSelect={selectAccount} />
                        </div>
                      </Show>
                      <Show when={accountsError()}><div role="alert" class="flower-provider-account-error flex flex-wrap items-center gap-3"><p>{accountsError()}</p><Button size="sm" variant="ghost" onClick={() => void refreshSavedAccounts()}>{copy().chatGPT.retry}</Button></div></Show>
                      <div class="flower-provider-account" data-connected={connected() || undefined} data-state={authorizing() ? authProgress() : authError() ? 'failed' : account()?.state === 'ready' ? 'connected' : 'idle'}>
                        <div class="flower-provider-account-heading">
                          <div class="flower-provider-account-symbol" aria-hidden="true">
                            <Show when={!authorizing()} fallback={<span class="flower-provider-account-spinner" />}>
                              <FlowerProviderBrandIcon type="openai" class="h-6 w-6" />
                            </Show>
                          </div>
                          <div class="flower-provider-account-identity" aria-live="polite" aria-atomic="true">
                            <Show when={authorizing()} fallback={<><h4>{account()?.email || copy().chatGPT.connectTitle}</h4><p class="flower-provider-account-description">{accountDescription()}</p></>}>
                              <div class="flower-provider-auth-progress">
                                <For each={['preparing', 'waiting', 'verifying'] as const}>{phase => <div aria-hidden={authProgress() !== phase} style={{ visibility: authProgress() === phase ? 'visible' : 'hidden' }}>
                                  <h4>{copy().chatGPT[phase]}</h4>
                                  <p class="flower-provider-account-description">{phase === 'waiting' ? copy().chatGPT.waitingDescription : copy().chatGPT.progressDescription}</p>
                                </div>}</For>
                              </div>
                            </Show>
                          </div>
                          <Show when={!authorizing() && account()?.state === 'ready'}><span class="flower-provider-account-connected"><Check class="h-3 w-3" aria-hidden="true" />{copy().chatGPT.connected}</span></Show>
                        </div>
                        <Show when={account()?.state === 'ready' || account()?.state === 'plan_permission_required'}><p class="text-xs text-muted-foreground">{copy().chatGPT.savedSignIn}</p></Show>
                        <Show when={authError()}><div role="alert" class="flower-provider-account-error">{authError()}</div></Show>
                        <Show when={account()?.state === 'temporarily_unavailable' || account()?.state === 'storage_unavailable'}>
                          <Button size="sm" variant="outline" disabled={retrying() || accountBusy()} onClick={() => void retryAccount()}>{copy().chatGPT.retry}</Button>
                        </Show>
                        <Show when={account()?.revocation_confirmed === false || authFailure()?.cleanupUnconfirmed}>
                          <a class="cursor-pointer text-sm text-primary hover:underline" href="https://chatgpt.com/#settings" target="_blank" rel="noopener noreferrer">{copy().chatGPT.disconnectApps}<ExternalLink class="inline h-3 w-3" aria-hidden="true" /></a>
                        </Show>
                        <div class="flower-provider-account-actions" ref={authActions}>
                          <Show when={connected()}><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer" class="flower-provider-account-usage">{copy().chatGPT.manageUsage}<ExternalLink class="h-3 w-3" aria-hidden="true" /></a></Show>
                          <Button ref={authPrimary} size="sm" variant={connected() ? 'ghost' : 'default'} class="flower-provider-account-primary" disabled={authorizing() || accountBusy() || !canContinueAuthorization()} onClick={continueAuthorization}>
                            <StableText reserve={connected() ? [copy().chatGPT.continue] : [copy().chatGPT.preparing, copy().chatGPT.verifying, copy().chatGPT.waiting, copy().chatGPT.continue]}>{authorizing() ? copy().chatGPT[authProgress()] : copy().chatGPT.continue}</StableText>
                            <Show when={!authorizing() && account()?.state !== 'ready'}><ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></Show>
                          </Button>
                          <Show when={authorizing()}><Button ref={authCancel} size="sm" variant="ghost" onClick={cancelAuthorization}>{copy().chatGPT.cancel}</Button></Show>
                          <Show when={!authorizing() && (savedAccounts().length > 0 || account())}><div class="flower-provider-account-secondary">
                            <Show when={signedOutAccounts().length > 0}><Button size="sm" variant="ghost" disabled={accountBusy() || !accountListReady()} onClick={openReauthorization}>{copy().chatGPT.signInAgain}</Button></Show>
                            <Button size="sm" variant="ghost" disabled={accountBusy() || !accountListReady()} onClick={() => setConfirmNewRegistration(true)}>{copy().chatGPT.changeAccount}</Button>
                            <Show when={account() && !needsSignIn(account()!)}>
                              <Button size="sm" variant="ghost" class="whitespace-nowrap" disabled={accountBusy()} onClick={() => {
                                if ((account()?.binding_count ?? 1) > 1 || (account()?.active_task_count ?? 0) > 0) setConfirmSignOut(true);
                                else void signOut();
                              }}><StableText reserve={[copy().chatGPT.signOut, copy().chatGPT.signingOut]}>{accountBusy() ? copy().chatGPT.signingOut : copy().chatGPT.signOut}</StableText></Button>
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
                                const id = account()!.account_id;
                                void props.chatGPTAuth?.('acknowledge', { scope_id: crypto.randomUUID(), account_id: id }).then(() => {
                                  if (props.open && account()?.account_id === id) updateProvider({ chatgpt_account: { ...account()!, welcome_acknowledged: true } });
                                }).catch(() => { if (props.open) setAuthError(copy().chatGPT.storageUnavailable); });
                                authPrimary?.focus({ preventScroll: true });
                              }}>{copy().chatGPT.welcomeConfirm}</Button>
                            </div>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>
                  <div class="flower-provider-connection-fields">
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
                          onBlur={finishConnectionInput}
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
                      <div>
                        <FlowerFieldLabel hint={flowerProviderTypeRequiresBaseURL(store.draft!.type) ? copy().required : undefined}>{copy().baseURL}</FlowerFieldLabel>
                        <Input
                          value={store.draft!.base_url ?? ''}
                          onInput={(event) => updateProvider({ base_url: event.currentTarget.value })}
                          onBlur={finishConnectionInput}
                          placeholder={defaultBaseURLForFlowerProviderType(store.draft!.type)}
                          aria-label={copy().baseURL}
                          size="sm"
                          class="w-full"
                        />
                      </div>
                      <Show when={store.draft!.type === 'openai'}>
                        <div class="space-y-1.5">
                          <Checkbox
                            checked={store.draft!.responses_continuation === true}
                            onChange={(enabled) => updateProvider({ responses_continuation: enabled ? true : undefined })}
                            label={copy().responsesContinuation}
                            aria-description={copy().responsesContinuationDescription}
                            size="sm"
                          />
                          <p class="flower-body-copy text-xs text-muted-foreground">{copy().responsesContinuationDescription}</p>
                        </div>
                      </Show>
                    </Show>
                    <div data-flower-provider-search>
                      <div class="flex items-center gap-1">
                        <Checkbox checked={providerSearch()?.enabled ?? false} disabled={!searchPolicy()?.editable} label={copy().webSearch} size="sm" onChange={enabled => updateProvider({ web_search: { enabled, source: providerSearch()?.source ?? 'native' } })} />
                        <SearchInfo text={copy().catalog.searchProviderHint + ' ' + recommended(searchPolicy()?.default_enabled ?? false)} />
                      </div>
                      <Show when={!searchPolicy()?.editable}><p class="flower-body-copy text-muted-foreground">{copy().catalog.searchNotIntegrated}</p></Show>
                      <Show when={searchPolicy()?.supported_sources?.length && searchPolicy()!.supported_sources.length > 1}>
                        <Select value={providerSearch()?.source ?? 'native'} onChange={value => updateProvider({ web_search: { enabled: providerSearch()?.enabled ?? false, source: value as 'native' | 'brave' } })}
                          options={[{ value: 'native', label: copy().openAIBuiltIn }, { value: 'brave', label: copy().braveSearch }]} class="mt-2 w-full" />
                      </Show>
                    </div>
                    <Show when={providerSearch()?.source === 'brave'}>
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
                  <Show when={setupDiscovery()}>
                    <p role="note" class="flower-body-copy text-muted-foreground">{store.draft!.type === 'openrouter' ? copy().openRouterDiscovery : copy().ollamaDiscovery}</p>
                  </Show>
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
                                    <WebSearchCapabilityBadge availability={JSON.stringify([store.draft?.web_search, model().web_search_enabled]) === JSON.stringify([props.provider?.web_search, props.provider?.models.find(saved => saved.model_name === modelName())?.web_search_enabled]) ? model().web_search : undefined} copy={copy().catalog} />
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
                                  <Button disabled={!enabled()} size="sm" variant="ghost" class={cn('h-6 text-muted-foreground hover:text-foreground', enabled() && flowerModelNeedsConfiguration(model()) ? 'px-2' : 'w-6 p-0')} onClick={() => setEditingModelName(editOpen() ? '' : modelName())} aria-label={flowerModelNeedsConfiguration(model()) ? copy().catalog.configure : copy().catalog.edit}>
                                    <Show when={enabled() && flowerModelNeedsConfiguration(model())} fallback={<Pencil class="h-3 w-3" />}><span class="text-xs">{copy().catalog.configure}</span></Show>
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
                                <div data-flower-model-editor class="border-t border-border/60 px-3 py-3">
                                  <Show when={flowerModelNeedsConfiguration(model())}><p role="status" class="mb-3 flower-body-copy text-muted-foreground">{copy().catalog.configurationHint}</p></Show>
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
                                      <FlowerFieldLabel hint={flowerModelNeedsConfiguration(model()) ? copy().required : undefined}>{copy().contextWindow}</FlowerFieldLabel>
                                      <Input type="number" aria-label={copy().contextWindow} aria-invalid={flowerModelNeedsConfiguration(model()) && !((model().context_window ?? 0) > 0)} min="1" value={model().context_window ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { context_window: Number(event.currentTarget.value) || undefined }); }} placeholder="—" size="sm" class="w-full font-mono" />
                                    </div>
                                    <div>
                                      <FlowerFieldLabel hint={flowerModelNeedsConfiguration(model()) ? copy().required : undefined}>{copy().maxOutput}</FlowerFieldLabel>
                                      <Input type="number" aria-label={copy().maxOutput} aria-invalid={flowerModelNeedsConfiguration(model()) && !((model().max_output_tokens ?? 0) > 0)} min="1" value={model().max_output_tokens ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { max_output_tokens: Number(event.currentTarget.value) || undefined }); }} placeholder="—" size="sm" class="w-full font-mono" />
                                    </div>
                                    <div>
                                      <FlowerFieldLabel>{copy().effectiveContextPercent}</FlowerFieldLabel>
                                      <Input type="number" value={model().effective_context_window_percent ?? ''} onInput={(event) => { if (modelIndex() >= 0) updateModel(modelIndex(), { effective_context_window_percent: Number(event.currentTarget.value) || undefined }); }} placeholder="—" size="sm" class="w-full font-mono" />
                                    </div>
                                    <Show when={preset().status === 'needs_configuration' || model().status === 'needs_configuration' || model().supports_tools !== undefined || model().reasoning_capability?.fixture === 'manual_provider_capability'}>
                                      <ManualModelCapabilities model={model()} type={store.draft!.type} baseURL={store.draft!.base_url || defaultBaseURLForFlowerProviderType(store.draft!.type)} copy={copy().catalog} onChange={patch => { if (modelIndex() >= 0) updateModel(modelIndex(), patch); }} />
                                    </Show>
                                    <div class="md:col-span-4" data-flower-model-search>
                                      <div class="flex items-center gap-1">
                                        <Checkbox label={copy().webSearch} size="sm" disabled={!searchPolicy()?.editable}
                                          checked={model().web_search_enabled ?? model().web_search?.recommended_enabled ?? searchPolicy()?.default_model_enabled ?? false}
                                          onChange={web_search_enabled => { if (modelIndex() >= 0) updateModel(modelIndex(), { web_search_enabled }); }} />
                                        <SearchInfo text={copy().catalog.searchModelHint + ' ' + recommended(model().web_search?.recommended_enabled ?? searchPolicy()?.default_model_enabled ?? false)} />
                                      </div>
                                      <Show when={!searchPolicy()?.editable} fallback={<Show when={!providerSearch()?.enabled}><p class="flower-body-copy text-muted-foreground">{copy().catalog.searchProviderOff}</p></Show>}><p class="flower-body-copy text-muted-foreground">{copy().catalog.searchNotIntegrated}</p></Show>
                                    </div>
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
        </fieldset>
      </Show>
    </Dialog>
    <Dialog open={confirmReauthorization() && props.open && chatGPTEnabled()} onOpenChange={setConfirmReauthorization} title={copy().chatGPT.signInAgain}
      bodyDescription={copy().chatGPT.signInAgainDescription} class="w-[min(28rem,96vw)] max-w-[96vw]"
      footer={<div class="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setConfirmReauthorization(false)}>{copy().chatGPT.cancel}</Button>
        <Button size="sm" disabled={!reauthorizationAccount() || !accountListReady() || accountBusy() || authorizing()} onClick={() => {
          const id = reauthorizationAccount()?.account_id;
          if (!id) return;
          setConfirmReauthorization(false); authPrimary?.focus({ preventScroll: true }); void startAuthorization(false, id);
        }}>{copy().chatGPT.continue}</Button>
      </div>}>
      <Dropdown triggerAriaLabel={copy().chatGPT.chooseAccount} triggerInputSurface
        trigger={<><span class="truncate">{reauthorizationAccount() ? savedAccountLabel(reauthorizationAccount()!, signedOutAccounts()) : copy().chatGPT.chooseAccount}</span><ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></>}
        triggerClass="flex h-8 w-full items-center justify-between gap-2 rounded border border-input bg-background px-2.5 text-sm shadow-sm" class="w-full"
        value={reauthorizationAccountID()} items={signedOutAccounts().map(item => ({ id: item.account_id, label: savedAccountLabel(item, signedOutAccounts()) }))}
        disabled={!accountListReady() || accountBusy() || authorizing()} onSelect={setReauthorizationAccountID} />
      <Show when={reauthorizationAccount()?.revocation_confirmed === false}><p class="mt-3 text-sm text-muted-foreground">{copy().chatGPT.revocationUnconfirmed}</p>
        <a class="text-sm text-primary hover:underline" href="https://chatgpt.com/#settings" target="_blank" rel="noopener noreferrer">{copy().chatGPT.disconnectApps}<ExternalLink class="inline h-3 w-3" aria-hidden="true" /></a>
      </Show>
    </Dialog>
    <ConfirmDialog open={confirmNewRegistration() && props.open && chatGPTEnabled()} onOpenChange={setConfirmNewRegistration} title={copy().chatGPT.changeAccount}
      confirmText={copy().chatGPT.continue} cancelText={copy().chatGPT.useSavedAccounts} onConfirm={() => { setConfirmNewRegistration(false); void startAuthorization(true); }}>
      <p>{copy().chatGPT.newRegistrationDescription}</p>
    </ConfirmDialog>
    <ConfirmDialog open={confirmSignOut() && props.open} onOpenChange={setConfirmSignOut} title={copy().chatGPT.signOut}
      confirmText={copy().chatGPT.signOut} cancelText={copy().chatGPT.cancelSignOut} variant="destructive" onConfirm={() => void signOut()}>
      <p>{copy().chatGPT.signOutImpact(account()?.binding_count ?? 1, account()?.active_task_count ?? 0)}</p>
    </ConfirmDialog>
    </>
  );
}
