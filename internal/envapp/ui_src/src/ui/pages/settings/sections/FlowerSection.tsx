import { withFlowerRequestDeadline } from '../../../../../../../flower_ui/src/requestDeadline';
import { readDesktopSessionContextSnapshot } from '../../../services/desktopSessionContext';
import { readFlowerModelDirectory } from '../../../../../../../flower_ui/src/modelDirectory';
import { flowerProviderAPIKeyOptional } from '../../../../../../../flower_ui/src/providerCredentials';
import { secureRandomUUID } from '@floegence/floe-webapp-core';
import '../../../flower-feature.css';
import { FlowerModelSettings } from '../../../../../../../flower_ui/src/settings/FlowerModelSettings';
import { createLocalizedFlowerSurfaceCopy } from '../../../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { applyFlowerModelDiscovery, defaultFlowerProviderModels, resolveFlowerProviderModels, serializeFlowerProvider } from '../../../../../../../flower_ui/src/settings/modelSelection';
import type { FlowerChatGPTAccount, FlowerChatGPTAuth, FlowerModelCatalogDiscovery, FlowerModelDirectory, FlowerProvider, FlowerProviderDraft } from '../../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { Bot } from '@floegence/floe-webapp-core/icons';
import { FeedbackIndicator, Button, Tabs } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { fetchLocalApiJSON } from '../../../services/localApi';
import { SettingsSection, AutoSaveIndicator, SubSectionHeader } from '../SettingsPrimitives';
import { FlowerProviderDialog } from '../../../../../../../flower_ui/src/settings/FlowerProviderDialog';
import { formatUnknownError } from '../../../maintenance/shared';
import {
  cloneAIProviderRow, defaultBaseURLForProviderType, modelID, modelSupportsImageInput,
  localizedProviderDisplayName, normalizeAIProviderRowDraft,
  providerPresetForType,
  providerTypeRequiresBaseURL,
} from '../aiCatalog';
import type {
  AIConfig, AIModelProfile, AIProvider, AIProviderRow, AIProviderType,
  AIPermissionType, SettingsUpdateResponse,
} from '../types';
import { useI18n, type I18nHelpers } from '../../../i18n';
import { createAIReadinessController } from '../../../flower/aiReadiness';
import { createAIReadinessPresentation } from '../../../flower/aiReadinessPresentation';
import { AIReadinessSettingsSection } from '../AIReadinessSettingsSection';

const AUTO_SAVE_DELAY_MS = 700;
const PERMISSION_TYPES: readonly AIPermissionType[] = ['readonly', 'approval_required', 'full_access'];

function isJSONObject(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

function normalizePermissionType(raw: unknown): AIPermissionType {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'readonly' || value === 'full_access') return value;
  return 'approval_required';
}

function permissionTypeCopy(i18n: I18nHelpers, kind: AIPermissionType): Readonly<{ title: string; description: string }> {
  switch (kind) {
    case 'readonly':
      return {
        title: i18n.t('flowerSettings.permissionReadonlyTitle'),
        description: i18n.t('flowerSettings.permissionReadonlyDescription'),
      };
    case 'full_access':
      return {
        title: i18n.t('flowerSettings.permissionFullAccessTitle'),
        description: i18n.t('flowerSettings.permissionFullAccessDescription'),
      };
    case 'approval_required':
    default:
      return {
        title: i18n.t('flowerSettings.permissionApprovalRequiredTitle'),
        description: i18n.t('flowerSettings.permissionApprovalRequiredDescription'),
      };
  }
}

function newProviderID(): string {
  return `prov_${secureRandomUUID()}`;
}

function newAIProviderDraft(): AIProviderRow {
  const defaultType: AIProviderType = 'openai';

  return normalizeAIProviderRowDraft({
    id: newProviderID(), name: providerPresetForType(defaultType).name, type: defaultType, base_url: defaultBaseURLForProviderType(defaultType),
    models: defaultFlowerProviderModels(defaultType),
  });
}

function normalizeAIProviders(rows: AIProviderRow[]): AIProviderRow[] { return rows.map((r) => normalizeAIProviderRowDraft(r)); }

type AIModelOption = Readonly<{ id: string; label: string; supportsImageInput: boolean }>;

function collectAIModelOptions(rows: AIProviderRow[], locale?: string): AIModelOption[] {
  const options: AIModelOption[] = [];
  for (const p of Array.isArray(rows) ? rows : []) {
    const providerID = String(p?.id ?? '').trim(); if (!providerID || p.enabled === false) continue;
    const providerName = localizedProviderDisplayName(p, locale);
    for (const m of Array.isArray(p?.models) ? p.models : []) {
      const modelName = String(m?.model_name ?? '').trim(); if (!modelName || m.unavailable) continue;
      options.push({ id: modelID(providerID, modelName), label: `${providerName} / ${modelName}`, supportsImageInput: modelSupportsImageInput(m.input_modalities) });
    }
  }
  return options;
}

function validateAIValue(cfg: AIConfig, i18n: I18nHelpers) {
  const providers = Array.isArray((cfg as any).providers) ? (cfg as any).providers : [];
  if (providers.length === 0) throw new Error(i18n.t('flowerSettings.missingProviders'));
  const providerIDs = new Set<string>(); const modelIDs = new Set<string>();
  for (const p of providers) {
    const id = String((p as any).id ?? '').trim(); const typ = String((p as any).type ?? '').trim(); const baseURL = String((p as any).base_url ?? '').trim(); const models = Array.isArray((p as any).models) ? (p as any).models : [];
    if (!id) throw new Error(i18n.t('flowerSettings.providerIdRequired'));
    if (id.includes('/')) throw new Error(i18n.t('flowerSettings.providerIdMustNotContainSlash', { provider: id }));
    if (providerIDs.has(id)) throw new Error(i18n.t('flowerSettings.duplicateProviderId', { provider: id }));
    providerIDs.add(id);
    if (typ !== 'google' && typ !== 'openai' && typ !== 'anthropic' && typ !== 'moonshot' && typ !== 'kimi_code' && typ !== 'chatglm' && typ !== 'deepseek' && typ !== 'qwen' && typ !== 'openrouter' && typ !== 'xai' && typ !== 'groq' && typ !== 'ollama' && typ !== 'openai_compatible') throw new Error(i18n.t('flowerSettings.invalidProviderType', { providerType: typ || '(empty)' }));
    if (providerTypeRequiresBaseURL(typ as AIProviderType) && !baseURL) throw new Error(i18n.t('flowerSettings.providerRequiresBaseUrl', { provider: id }));
    if (baseURL) { let u: URL; try { u = new URL(baseURL); } catch { throw new Error(i18n.t('flowerSettings.providerInvalidBaseUrl', { provider: id })); } if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(i18n.t('flowerSettings.providerBaseUrlMustBeHttpHttps', { provider: id })); }

    const modelNames = new Set<string>();
    for (const m of models) { const mn = String((m as any).model_name ?? '').trim(); const wm = String((m as any).wire_model_name ?? '').trim(); const cw = Number((m as any).context_window); if (!mn) throw new Error(i18n.t('flowerSettings.providerModelNameMissing', { provider: id })); if (mn.includes('/')) throw new Error(i18n.t('flowerSettings.providerModelNameMustNotContainSlash', { provider: id })); if (wm.includes('\u0000')) throw new Error(i18n.t('flowerSettings.providerModelNameMissing', { provider: id })); if (modelNames.has(mn)) throw new Error(i18n.t('flowerSettings.providerDuplicateModelName', { provider: id, model: mn })); if (!(m as any).unavailable && (typ === 'openai_compatible' || typ === 'openrouter' || typ === 'xai' || typ === 'groq' || typ === 'ollama') && (!Number.isFinite(cw) || cw <= 0)) throw new Error(i18n.t('flowerSettings.providerModelRequiresContextWindow', { provider: id, model: mn })); modelNames.add(mn); modelIDs.add(modelID(id, mn)); }
  }
  const cid = String((cfg as any).current_model_id ?? '').trim(); if (cid && !modelIDs.has(cid) && !providers.some((p: AIProviderRow) => p.model_selection && cid.startsWith(`${p.id}/`))) throw new Error(i18n.t('flowerSettings.currentModelNotInProviders', { currentModelId: cid }));
}

export function FlowerSection() {
  const ctx = useEnvSettingsPage(); const i18n = useI18n();
  const remoteDesktop = readDesktopSessionContextSnapshot()?.target_route === 'remote_desktop';
  const canEdit = () => ctx.canInteract() && ctx.canAdmin();
  const chatGPTAvailable = () => !remoteDesktop && canEdit() && ctx.settings()?.auth_capabilities?.openai_chatgpt.available === true;
  const [activeTab, setActiveTab] = createSignal('models');
  const readinessController = ctx.env.aiReadinessController ?? createAIReadinessController();
  const readinessPresentation = createMemo(() => createAIReadinessPresentation(readinessController.snapshot(), i18n));

  const [permissionType, setPermissionType] = createSignal<AIPermissionType>('approval_required');
  const [confirmedPermissionType, setConfirmedPermissionType] = createSignal<AIPermissionType>('approval_required');
  const [permissionDirty, setPermissionDirty] = createSignal(false);
  const [permissionSaving, setPermissionSaving] = createSignal(false);
  const [permissionError, setPermissionError] = createSignal<string | null>(null);
  const [permissionSavedAt, setPermissionSavedAt] = createSignal<number | null>(null);
  const [currentModelID, setCurrentModelID] = createSignal('');
  const [providers, setProviders] = createSignal<AIProviderRow[]>([]);
  const [searchPolicies, setSearchPolicies] = createSignal<import('../../../../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerModelDirectory['search_policies']>();
  const [providerDefaults, setProviderDefaults] = createSignal<import('../../../../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerModelDirectory['provider_defaults']>();
  const providerKeySet = createMemo(() => ctx.settings()?.ai_secrets?.provider_api_key_set ?? {});
  const webSearchKeySet = createMemo(() => ctx.settings()?.ai_secrets?.web_search_provider_api_key_set ?? {});
  const [dirty, setDirty] = createSignal(false); const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<number | null>(null); const [failure, setFailure] = createSignal<{ message: string; blocking: boolean } | null>(null);
  const error = () => failure()?.message;
  const [providerDialogOpen, setProviderDialogOpen] = createSignal(false);
  const [providerDialogIndex, setProviderDialogIndex] = createSignal<number | null>(null);
  const permissionButtonRefs = new Map<AIPermissionType, HTMLButtonElement>();
  const [providerDialogProvider, setProviderDialogProvider] = createSignal<AIProviderRow | null>(null);
  const [providerDialogMode, setProviderDialogMode] = createSignal<'create' | 'edit'>('create');

  createEffect(() => {
    const s = ctx.settings();
    if (!s) return;
    const ai = s.ai;
    if (!dirty()) {
      setCurrentModelID(ai?.current_model_id ?? '');
      const configured = (ai?.providers ?? []).map(provider => normalizeAIProviderRowDraft({
        ...provider, chatgpt_account: s.chatgpt_accounts?.[provider.id],
      }));
      const projectProviders = (directory?: FlowerModelDirectory) => configured.map(provider => {
        const row = { ...provider, search_policy: directory?.provider_search_policies?.[provider.id], model_defaults: directory?.provider_defaults?.[provider.type], catalog_models: directory?.provider_catalogs?.[provider.id] };
        return normalizeAIProviderRowDraft({ ...row, models: resolveFlowerProviderModels(row as FlowerProvider, row.catalog_models) } as AIProviderRow);
      });
      setProviders(projectProviders());
      const resource = ctx.env.flowerModelReadResource;
      const load = resource ? resource.loadDirectory(true) : fetchLocalApiJSON('/_redeven_proxy/api/ai/models', { method: 'GET' }).then(readFlowerModelDirectory);
      void load.then(directory => {
        if (ctx.settings() !== s) return;
        setProviderDefaults(directory.provider_defaults); setSearchPolicies(directory.search_policies);
        if (ctx.settings() === s && !dirty()) {
          setProviders(projectProviders(directory));
        }
      }).catch(() => undefined);
    }
    const savedPermission = normalizePermissionType(ai?.permission_type);
    setConfirmedPermissionType(savedPermission);
    if (!permissionDirty() && !permissionSaving()) setPermissionType(savedPermission);
  });

  const chatGPTAuth: FlowerChatGPTAuth = async (action, input) => {
    if (!chatGPTAvailable()) throw new Error('Local account access is unavailable.');
    const result = await fetchLocalApiJSON<Awaited<ReturnType<FlowerChatGPTAuth>>>(`/_redeven_proxy/api/ai/auth/chatgpt/${action}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (action === 'sign-out' || action === 'retry') ctx.env.bumpSettingsSeq();
    return result;
  };
  const loadChatGPTAccounts = () => {
    if (!chatGPTAvailable()) return Promise.reject(new Error('Local account access is unavailable.'));
    return fetchLocalApiJSON<Readonly<{
      accounts: Readonly<Record<string, FlowerChatGPTAccount>>;
      saved_accounts: readonly FlowerChatGPTAccount[];
    }>>('/_redeven_proxy/api/ai/auth/chatgpt/accounts', { method: 'GET' });
  };

  createEffect(() => {
    const resource = ctx.env.flowerModelReadResource;
    if (!resource) return;
    const unsubscribe = resource.subscribe(directory => {
      setProviderDefaults(directory.provider_defaults); setSearchPolicies(directory.search_policies);
      setProviders(rows => rows.map(provider => applyFlowerModelDiscovery({ ...provider, search_policy: directory.provider_search_policies?.[provider.id], model_defaults: directory.provider_defaults?.[provider.type] } as FlowerProviderDraft, directory.provider_catalogs?.[provider.id] ?? provider.catalog_models ?? []) as AIProviderRow));
    });
    onCleanup(unsubscribe);
  });

  const aiModelOptions = createMemo(() => collectAIModelOptions(providers(), i18n.locale()));
  const settingsCopy = createMemo(() => createLocalizedFlowerSurfaceCopy({ locale: i18n.locale(), t: (key, params) => i18n.t(key as import('../../../i18n/locales').EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as import('../../../i18n/locales').EnvAppTranslationKey, count, params) }).settings);
  const focusPermissionType = (kind: AIPermissionType) => {
    queueMicrotask(() => permissionButtonRefs.get(kind)?.focus());
  };
  const choosePermissionType = (kind: AIPermissionType, focus = false) => {
    if (!canEdit()) return;
    setPermissionType(kind);
    setPermissionDirty(kind !== confirmedPermissionType());
    setPermissionError(null);
    if (focus) focusPermissionType(kind);
  };
  const movePermissionType = (delta: number) => {
    const currentIndex = Math.max(0, PERMISSION_TYPES.indexOf(permissionType()));
    const nextIndex = (currentIndex + delta + PERMISSION_TYPES.length) % PERMISSION_TYPES.length;
    choosePermissionType(PERMISSION_TYPES[nextIndex], true);
  };
  const onPermissionTypeKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        movePermissionType(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        movePermissionType(-1);
        break;
      default:
        break;
    }
  };

  let autoSaveTimer: number | undefined;
  const clearTimer = (t: number | undefined) => { if (t != null) { window.clearTimeout(t); return undefined; } return undefined; };
  createEffect(() => { if (!dirty() || saving() || providerDialogOpen() || error() || !canEdit()) { autoSaveTimer = clearTimer(autoSaveTimer); return; } autoSaveTimer = clearTimer(autoSaveTimer); autoSaveTimer = window.setTimeout(async () => { autoSaveTimer = undefined; if (!dirty() || saving() || providerDialogOpen() || error() || !canEdit()) return; setSaving(true); try { const pd = normalizeAIProviders(providers()).map((p) => serializeFlowerProvider(p as FlowerProviderDraft)); const sv = await fetchLocalApiJSON<SettingsUpdateResponse | unknown>('/_redeven_proxy/api/ai/provider_bundle', { method: 'PUT', body: JSON.stringify({ auth_schema_version: 1, model_profile: { current_model_id: String(currentModelID() ?? '').trim(), providers: pd } }) }); if (isJSONObject(sv) && isJSONObject((sv as SettingsUpdateResponse).settings)) ctx.mutateSettings((sv as SettingsUpdateResponse).settings); ctx.env.bumpSettingsSeq(); setSavedAt(Date.now()); setDirty(false); setFailure(null); } catch (e) { setFailure({ message: formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'), blocking: false }); } finally { setSaving(false); } }, AUTO_SAVE_DELAY_MS); });

  const saveAICurrentModelDirectly = async (next: string, previous: string) => {
    if (!canEdit() || saving()) return;
    setSaving(true);
    try {
      const saved = await fetchLocalApiJSON<SettingsUpdateResponse>('/_redeven_proxy/api/ai/current_model', { method: 'PUT', body: JSON.stringify({ model_id: next }) });
      if (saved.settings) ctx.mutateSettings(saved.settings);
      ctx.env.bumpSettingsSeq(); setSavedAt(Date.now()); setFailure(null);
    } catch (error) {
      setCurrentModelID(previous);
      setFailure({ message: formatUnknownError(error) || i18n.t('flowerSettings.saveFailedMessage'), blocking: false });
    } finally { setSaving(false); }
  };

  const buildAIValueFromRows = (rows: AIProviderRow[], curRaw: string): AIModelProfile => ({
    current_model_id: String(curRaw ?? '').trim(),
    providers: normalizeAIProviders(rows).map((provider) => serializeFlowerProvider(provider as FlowerProviderDraft) as AIProvider),
  });

  const [providerDialogError, setProviderDialogError] = createSignal('');
  const secretPatches = (id: string, key: string | null | undefined) => key === null
    ? [{ provider_id: id, api_key: null }]
    : key?.trim() ? [{ provider_id: id, api_key: key.trim() }] : [];
  const saveAIProviderBundle = async (rows: AIProviderRow[], current: string, draft: FlowerProviderDraft) => {
    if (!canEdit() || saving()) return false;
    setProviderDialogError('');
    setSaving(true);
    try {
      const profile = buildAIValueFromRows(rows, current);
      validateAIValue({ ...profile, providers: rows } as AIConfig, i18n);
      const saved = await withFlowerRequestDeadline(() => fetchLocalApiJSON<SettingsUpdateResponse>('/_redeven_proxy/api/ai/provider_bundle', {
        method: 'PUT', body: JSON.stringify({ auth_schema_version: 1, model_profile: profile,
          provider_api_key_patches: secretPatches(draft.id, draft.provider_api_key),
          web_search_provider_key_patches: secretPatches(draft.id, draft.web_search_api_key),
        }),
      }), settingsCopy().dialog.catalog.settingsSaveTimedOut);
      ctx.mutateSettings(saved.settings); ctx.env.bumpSettingsSeq();
      setProviders(rows); setCurrentModelID(current); setSavedAt(Date.now()); setDirty(false); setFailure(null);
      ctx.notify.success(i18n.t('flowerSettings.autosavedTitle'), i18n.t('flowerSettings.providerSaved'));
      return true;
    } catch (error) {
      setProviderDialogError(formatUnknownError(error) || i18n.t('flowerSettings.saveFailedMessage'));
      return false;
    } finally { setSaving(false); }
  };

  const toggleProvider = async (index: number, enabled: boolean) => {
    if (!canEdit() || saving()) return;
    const previous = providers();
    const previousDirty = dirty();
    const next = previous.map((provider, i) => i === index ? { ...provider, enabled } : provider);
    setSaving(true); setDirty(true); setProviders(next); setFailure(null);
    try {
      const profile = buildAIValueFromRows(next, currentModelID());
      validateAIValue({ ...profile, providers: next } as AIConfig, i18n);
      const saved = await fetchLocalApiJSON<SettingsUpdateResponse>('/_redeven_proxy/api/ai/provider_bundle', {
        method: 'PUT', body: JSON.stringify({ auth_schema_version: 1, model_profile: profile }),
      });
      ctx.mutateSettings(saved.settings);
      ctx.env.bumpSettingsSeq();
      setSavedAt(Date.now()); setDirty(false);
    } catch (error) {
      setProviders(previous); setDirty(previousDirty);
      setFailure({ message: formatUnknownError(error) || i18n.t('flowerSettings.saveFailedMessage'), blocking: false });
    } finally { setSaving(false); }
  };

  const addAIProviderAndOpenDialog = () => { if (!canEdit() || saving()) return; setProviderDialogError(''); const d = { ...newAIProviderDraft(), model_defaults: providerDefaults()?.openai }; setProviderDialogProvider(d); setProviderDialogIndex(null); setProviderDialogMode('create'); setProviderDialogOpen(true); };
  const openAIProviderDialog = (i: number) => { if (!canEdit() || saving()) return; const p = providers()[i]; if (!p) return; setProviderDialogError(''); setProviderDialogProvider(cloneAIProviderRow(p)); setProviderDialogIndex(i); setProviderDialogMode('edit'); setProviderDialogOpen(true); };
  let providerDialogIdentity = 0;
  const closeAIProviderDialog = () => { providerDialogIdentity++; setProviderDialogOpen(false); setProviderDialogProvider(null); setProviderDialogIndex(null); };
  const confirmAIProviderDialog = (draft: FlowerProviderDraft) => {
    const dialogIdentity = providerDialogIdentity;
    const d = normalizeAIProviderRowDraft(draft as AIProviderRow);
    const idx = providerDialogIndex();
    const nps = idx != null
      ? normalizeAIProviders(providers().map((p, i) => (i === idx ? d : p)))
      : normalizeAIProviders([...providers(), d]);
    const current = String(currentModelID() ?? '').trim();
    const nid = current || collectAIModelOptions(nps)[0]?.id || '';
    void saveAIProviderBundle(nps, nid, draft).then((s) => { if (s && dialogIdentity === providerDialogIdentity) closeAIProviderDialog(); });
  };
  const discoverDialogModels: FlowerModelCatalogDiscovery = input => {
    if (!canEdit()) return Promise.reject(new Error('Provider editing is unavailable.'));
    return fetchLocalApiJSON('/_redeven_proxy/api/ai/model_catalog', { method: 'POST', body: JSON.stringify(input) });
  };

  let permissionAutoSaveTimer: number | undefined;
  const clearPermissionTimer = () => {
    permissionAutoSaveTimer = clearTimer(permissionAutoSaveTimer);
  };
  const savePendingPermission = async () => {
    if (permissionSaving() || !canEdit()) return;
    const target = permissionType();
    if (target === confirmedPermissionType()) {
      setPermissionDirty(false);
      return;
    }
    setPermissionSaving(true);
    setPermissionError(null);
    try {
      const response = await ctx.saveDefaultAIPermission(target);
      const confirmed = normalizePermissionType(response.settings.ai?.permission_type);
      setConfirmedPermissionType(confirmed);
      setPermissionSavedAt(Date.now());
      if (permissionType() === target) {
        setPermissionType(confirmed);
        setPermissionDirty(false);
      } else {
        setPermissionDirty(permissionType() !== confirmed);
      }
    } catch (e) {
      const message = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage');
      setPermissionError(message);
      if (permissionType() === target) {
        setPermissionType(confirmedPermissionType());
        setPermissionDirty(false);
      }
    } finally {
      setPermissionSaving(false);
      if (permissionType() !== confirmedPermissionType()) {
        permissionAutoSaveTimer = window.setTimeout(() => {
          permissionAutoSaveTimer = undefined;
          void savePendingPermission();
        }, 0);
      }
    }
  };
  createEffect(() => {
    permissionType();
    clearPermissionTimer();
    if (!permissionDirty() || permissionSaving() || !canEdit()) return;
    permissionAutoSaveTimer = window.setTimeout(() => {
      permissionAutoSaveTimer = undefined;
      void savePendingPermission();
    }, AUTO_SAVE_DELAY_MS);
  });
  onCleanup(() => {
    autoSaveTimer = clearTimer(autoSaveTimer);
    clearPermissionTimer();
  });

  const renderDefaultPermissionSection = () => (
    <div>
      <SubSectionHeader
        title={i18n.t('flowerSettings.defaultPermissionTitle')}
        description={i18n.t('flowerSettings.defaultPermissionDescription')}
        actions={<div class="flex items-center gap-2"><FeedbackIndicator label={i18n.t('flowerSettings.defaultPermissionTitle')} closeLabel={i18n.t('common.actions.close')} restoreFocus={() => permissionButtonRefs.get(permissionType())} entries={permissionError() ? [{ id: 'permission', severity: 'error', summary: permissionError()! }] : []} /><AutoSaveIndicator dirty={permissionDirty()} saving={permissionSaving()} savedAt={permissionSavedAt()} enabled={canEdit()} /></div>}
      />
      <div class="settings-permission-options mt-3" role="radiogroup" aria-label={i18n.t('flowerSettings.defaultPermissionTitle')}>
        <For each={PERMISSION_TYPES}>
          {(kind) => {
            const copy = () => permissionTypeCopy(i18n, kind);
            return (
              <button ref={(el) => { permissionButtonRefs.set(kind, el); }} type="button"
                class="settings-permission-option" role="radio" aria-checked={permissionType() === kind}
                tabIndex={permissionType() === kind ? 0 : -1} onKeyDown={onPermissionTypeKeyDown}
                onClick={() => choosePermissionType(kind)} disabled={!canEdit()}>
                <span class="settings-permission-option-copy"><span>{copy().title}</span>
                  <span class="text-xs text-muted-foreground">{copy().description}</span></span>
                <span class="settings-permission-option-mark" aria-hidden="true" />
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
  return (
    <>
      <SettingsSection variant="page"
        icon={Bot} title={i18n.t('aiChrome.flowerTitle')} description={i18n.t('flowerSettings.description')}
        badge={aiModelOptions().length > 0 ? i18n.t('flowerSettings.activeBadge') : i18n.t('flowerSettings.noModelSelected')}
        badgeVariant={aiModelOptions().length > 0 ? 'success' : 'default'} error={failure()?.blocking ? error() : null}
        feedback={failure() && !failure()!.blocking ? [{ id: 'providers', severity: 'error', summary: error()!, actions: <Show when={dirty()}><Button size="sm" variant="outline" disabled={!canEdit() || saving()} onClick={() => setFailure(null)}>{i18n.t('common.actions.retry')}</Button></Show> }] : []}
        actions={<>
          <AutoSaveIndicator dirty={dirty()} saving={saving()} error={failure()?.blocking ? error() : null} savedAt={savedAt()} enabled={canEdit()} />
        </>}
      >
        <Show when={activeTab() !== 'health' && ['blocked', 'degraded'].includes(readinessController.snapshot().state)}>
          <div role="status" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
            <span class="text-[length:var(--floe-type-body)] text-foreground">{readinessPresentation().title}</span>
            <Button size="sm" variant="outline" onClick={() => setActiveTab('health')}>{i18n.t('settingsDesign.healthAndStorage')}</Button>
          </div>
        </Show>
        <Tabs activeId={activeTab()} onChange={setActiveTab} items={[
          { id: 'models', label: i18n.t('settingsDesign.modelsAndProviders') },
          { id: 'permissions', label: i18n.t('settingsDesign.flowerPermissions') },
          { id: 'health', label: i18n.t('settingsDesign.healthAndStorage') },
        ]} aria-label={i18n.t('aiChrome.flowerTitle')} />
        <div hidden={activeTab() !== 'models'} data-flower-settings-panel="models" class="flower-settings-model-sections">
          <FlowerModelSettings copy={settingsCopy()} providers={providers().map(provider => ({ ...provider, web_search: provider.web_search ? { ...provider.web_search } : undefined }))} currentModelID={currentModelID()} disabled={!canEdit() || saving()}
            providerReady={provider => provider.auth_method === 'chatgpt' ? ctx.settings()?.chatgpt_accounts?.[provider.id]?.state === 'ready' : (flowerProviderAPIKeyOptional(provider.type) || !!providerKeySet()[provider.id]) && (!provider.web_search?.enabled || provider.web_search.source !== 'brave' || !!webSearchKeySet()[provider.id])}
            onChooseModel={id => {
              if (!canEdit() || saving()) return;
              const previous = currentModelID();
              if (id === previous) return;
              setCurrentModelID(id);
              if (!dirty() && !saving()) { void saveAICurrentModelDirectly(id, previous); return; }
              setFailure(null); setDirty(true);
            }}
            onChangeReasoning={selection => {
              setProviders(rows => rows.map(provider => ({ ...provider, models: provider.models.map(model => `${provider.id}/${model.model_name}` === currentModelID() ? { ...model, default_reasoning_selection: selection } : model) })));
              setFailure(null); setDirty(true);
            }}
            onAddProvider={addAIProviderAndOpenDialog} onEditProvider={openAIProviderDialog}
            onRemoveProvider={index => { setProviders(rows => normalizeAIProviders(rows.filter((_, i) => i !== index))); setFailure(null); setDirty(true); }}
            onToggleProvider={toggleProvider} />
        </div>
        <div hidden={activeTab() !== 'permissions'} data-flower-settings-panel="permissions">{renderDefaultPermissionSection()}</div>
        <div hidden={activeTab() !== 'health'} data-flower-settings-panel="health">
      <AIReadinessSettingsSection
        controller={readinessController}
        canAdmin={ctx.canAdmin()}
        endpointID={ctx.env.env_id()}
        namespacePublicID={ctx.env.env()?.namespace_public_id ?? ''}
        modelID={currentModelID()}
        modelOptions={aiModelOptions().map((option) => ({ id: option.id, label: option.label }))}
        permissionType={confirmedPermissionType()}
        workingDir={ctx.settings()?.runtime?.agent_home_dir ?? ''}
      />
        </div>
      </SettingsSection>

      <FlowerProviderDialog
        providerDefaults={providerDefaults()}
        searchPolicies={searchPolicies()}
        catalogModels={providers().find(provider => provider.id === providerDialogProvider()?.id)?.catalog_models}
        onDiscoverModels={discoverDialogModels}
        chatGPTAuth={chatGPTAuth}
        loadChatGPTAccounts={loadChatGPTAccounts}
        chatGPTAvailable={chatGPTAvailable()}
        chatGPTBindingID={chatGPTAvailable() ? ctx.settings()?.auth_capabilities?.openai_chatgpt.binding_id : undefined}
        chatGPTAccount={ctx.settings()?.chatgpt_accounts?.[providerDialogProvider()?.id ?? ''] ?? providerDialogProvider()?.chatgpt_account}
        open={providerDialogOpen()}
        mode={providerDialogMode()}
        allowTypeChange
        provider={providerDialogProvider() as FlowerProviderDraft | null}
        copy={settingsCopy().dialog}
        keyConfigured={!!providerKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        webSearchKeyConfigured={!!webSearchKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        error={providerDialogError()}
        disabled={!canEdit()}
        saving={saving()}
        onOpenChange={(open) => { if (!open) closeAIProviderDialog(); }}
        onConfirm={confirmAIProviderDialog}
      />
    </>
  );
}
