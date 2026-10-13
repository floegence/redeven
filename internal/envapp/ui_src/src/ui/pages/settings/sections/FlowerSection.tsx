import { readFlowerModelDirectory } from '../../../../../../../flower_ui/src/modelDirectory';
import { flowerProviderAPIKeyOptional } from '../../../../../../../flower_ui/src/providerCredentials';
import { secureRandomUUID } from '@floegence/floe-webapp-core';
import '../../../flower-feature.css';
import { FlowerModelSettings } from '../../../../../../../flower_ui/src/settings/FlowerModelSettings';
import { createLocalizedFlowerSurfaceCopy } from '../../../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { applyFlowerModelDiscovery, flowerProviderModelChoices, setFlowerModelsEnabled, defaultFlowerProviderModels, resolveFlowerProviderModels, serializeFlowerProvider } from '../../../../../../../flower_ui/src/settings/modelSelection';
import type { FlowerModelDirectory, FlowerProvider, FlowerProviderDraft } from '../../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { For, Show, createMemo, createSignal, on, createEffect, onCleanup, untrack } from 'solid-js';
import { Bot } from '@floegence/floe-webapp-core/icons';
import { FeedbackIndicator, Button, Tabs } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { fetchLocalApiJSON } from '../../../services/localApi';
import { SettingsSection, AutoSaveIndicator, SubSectionHeader } from '../SettingsPrimitives';
import { AIProviderDialog } from '../AIProviderDialog';
import { formatUnknownError } from '../../../maintenance/shared';
import { normalizeFlowerReasoningCapability, serializeFlowerReasoningSelection } from '../../../../../../../flower_ui/src/reasoning';
import {
  cloneAIProviderRow, defaultBaseURLForProviderType, modelID, modelSupportsImageInput,
  localizedProviderDisplayName, normalizeAIProviderRowDraft,
  providerNeedsWebSearchConfig, providerPresetForType, providerTypeLabel,
  providerTypeRequiresBaseURL, providerUsesCustomConnectionName,
  normalizeEffectiveContextPercent, normalizeInputModalities, normalizePositiveInteger,
} from '../aiCatalog';
import type {
  AIConfig, AIModelProfile, AIProvider, AIProviderModel, AIProviderRow, AIProviderType, AIProviderModelRow, AIProviderWebSearchMode,
  AIProviderDialogMode, AIPermissionType, SettingsUpdateResponse,
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
    models: defaultFlowerProviderModels(defaultType).map((model) => modelRowFromPreset(model as AIProviderModel)),
  });
}

function normalizeAIProviders(rows: AIProviderRow[]): AIProviderRow[] { return rows.map((r) => normalizeAIProviderRowDraft(r)); }

type AIModelOption = Readonly<{ id: string; label: string; supportsImageInput: boolean }>;

function collectAIModelOptions(rows: AIProviderRow[], locale?: string): AIModelOption[] {
  const options: AIModelOption[] = [];
  for (const p of Array.isArray(rows) ? rows : []) {
    const providerID = String(p?.id ?? '').trim(); if (!providerID || p.enabled === false) continue;
    const providerName = localizedProviderDisplayName(p, locale, providerID);
    for (const m of Array.isArray(p?.models) ? p.models : []) {
      const modelName = String(m?.model_name ?? '').trim(); if (!modelName || m.unavailable) continue;
      options.push({ id: modelID(providerID, modelName), label: `${providerName} / ${modelName}`, supportsImageInput: modelSupportsImageInput(m.input_modalities) });
    }
  }
  return options;
}

function normalizeAIProviderWebSearchMode(raw: unknown): AIProviderWebSearchMode {
  const mode = String(raw ?? '').trim().toLowerCase(); if (mode === 'openai_builtin' || mode === 'brave') return mode; return 'disabled';
}

function normalizeAIProviderWebSearchForType(providerType: AIProviderType, raw: unknown) {
  if (!providerNeedsWebSearchConfig(providerType)) return undefined;
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as any).mode : raw;
  return { mode: normalizeAIProviderWebSearchMode(source) };
}

function normalizeProviderModelRows(_type: AIProviderType, models: AIProviderModelRow[]): AIProviderModelRow[] {
  return models.map((m) => ({
    ...m,
    context_window: normalizePositiveInteger(m.context_window),
    effective_context_window_percent: normalizeEffectiveContextPercent(m.effective_context_window_percent),
    reasoning_capability: normalizeFlowerReasoningCapability(m.reasoning_capability),
    default_reasoning_selection: serializeFlowerReasoningSelection(m.default_reasoning_selection),
  }));
}

function modelRowFromPreset(model: AIProviderModel): AIProviderModelRow {
  return {
    web_search: model.web_search,
    model_name: String(model.model_name ?? '').trim(),
    wire_model_name: String(model.wire_model_name ?? '').trim() || undefined,
    supports_tools: model.supports_tools,
    context_window: normalizePositiveInteger(model.context_window),
    max_output_tokens: normalizePositiveInteger(model.max_output_tokens),
    effective_context_window_percent: normalizeEffectiveContextPercent(model.effective_context_window_percent),
    input_modalities: normalizeInputModalities(model.input_modalities),
    reasoning_capability: normalizeFlowerReasoningCapability(model.reasoning_capability),
    default_reasoning_selection: serializeFlowerReasoningSelection(model.default_reasoning_selection),
  };
}

function modelNameKey(value: unknown): string {
  return String(value ?? '').trim();
}

function providerHasModel(provider: AIProviderRow, modelName: string): boolean {
  const wanted = modelNameKey(modelName);
  return Boolean(wanted) && provider.models.some((model) => modelNameKey(model.model_name) === wanted);
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
    if (typ !== 'google' && typ !== 'openai' && typ !== 'anthropic' && typ !== 'moonshot' && typ !== 'chatglm' && typ !== 'deepseek' && typ !== 'qwen' && typ !== 'openrouter' && typ !== 'xai' && typ !== 'groq' && typ !== 'ollama' && typ !== 'openai_compatible') throw new Error(i18n.t('flowerSettings.invalidProviderType', { providerType: typ || '(empty)' }));
    if (providerTypeRequiresBaseURL(typ as AIProviderType) && !baseURL) throw new Error(i18n.t('flowerSettings.providerRequiresBaseUrl', { provider: id }));
    if (baseURL) { let u: URL; try { u = new URL(baseURL); } catch { throw new Error(i18n.t('flowerSettings.providerInvalidBaseUrl', { provider: id })); } if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(i18n.t('flowerSettings.providerBaseUrlMustBeHttpHttps', { provider: id })); }

    const modelNames = new Set<string>();
    for (const m of models) { const mn = String((m as any).model_name ?? '').trim(); const wm = String((m as any).wire_model_name ?? '').trim(); const cw = Number((m as any).context_window); if (!mn) throw new Error(i18n.t('flowerSettings.providerModelNameMissing', { provider: id })); if (mn.includes('/')) throw new Error(i18n.t('flowerSettings.providerModelNameMustNotContainSlash', { provider: id })); if (wm.includes('\u0000')) throw new Error(i18n.t('flowerSettings.providerModelNameMissing', { provider: id })); if (modelNames.has(mn)) throw new Error(i18n.t('flowerSettings.providerDuplicateModelName', { provider: id, model: mn })); if (!(m as any).unavailable && (typ === 'openai_compatible' || typ === 'openrouter' || typ === 'xai' || typ === 'groq' || typ === 'ollama') && (!Number.isFinite(cw) || cw <= 0)) throw new Error(i18n.t('flowerSettings.providerModelRequiresContextWindow', { provider: id, model: mn })); modelNames.add(mn); modelIDs.add(modelID(id, mn)); }
  }
  const cid = String((cfg as any).current_model_id ?? '').trim(); if (cid && !modelIDs.has(cid) && !providers.some((p: AIProviderRow) => p.model_selection && cid.startsWith(`${p.id}/`))) throw new Error(i18n.t('flowerSettings.currentModelNotInProviders', { currentModelId: cid }));
}

export function FlowerSection() {
  const ctx = useEnvSettingsPage(); const i18n = useI18n();
  const canEdit = () => ctx.canInteract() && ctx.canAdmin();
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
  const [providerDefaults, setProviderDefaults] = createSignal<import('../../../../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerModelDirectory['provider_defaults']>();
  const providerKeySet = createMemo(() => ctx.settings()?.ai_secrets?.provider_api_key_set ?? {});
  const [providerKeyDraft, setProviderKeyDraft] = createSignal<Record<string, string>>({});
  const [providerKeySaving] = createSignal<Record<string, boolean>>({});
  const webSearchKeySet = createMemo(() => ctx.settings()?.ai_secrets?.web_search_provider_api_key_set ?? {});
  const [webSearchKeyDraft, setWebSearchKeyDraft] = createSignal<Record<string, string>>({});
  const [webSearchKeySaving] = createSignal<Record<string, boolean>>({});
  const [dirty, setDirty] = createSignal(false); const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<number | null>(null); const [failure, setFailure] = createSignal<{ message: string; blocking: boolean } | null>(null);
  const error = () => failure()?.message;
  const [discoveringModels, setDiscoveringModels] = createSignal(false);
  const [discoveryError, setDiscoveryError] = createSignal('');
  const [providerDialogOpen, setProviderDialogOpen] = createSignal(false);
  const [providerDialogIndex, setProviderDialogIndex] = createSignal<number | null>(null);
  const permissionButtonRefs = new Map<AIPermissionType, HTMLButtonElement>();
  const [providerDialogProvider, setProviderDialogProvider] = createSignal<AIProviderRow | null>(null);
  const [providerDialogMode, setProviderDialogMode] = createSignal<AIProviderDialogMode>('create');

  const providerDialogType = createMemo(() => providerDialogProvider()?.type);
  createEffect(on(() => [providerDefaults(), providerDialogOpen(), providerDialogType()] as const, () => {
    untrack(() => {
      const draft = providerDialogProvider();
      if (providerDialogOpen() && draft) setProviderDialogProvider({ ...draft, model_defaults: providerDefaults()?.[draft.type] });
    });
  }));

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
        const row = { ...provider, model_defaults: directory?.provider_defaults?.[provider.type], catalog_models: directory?.provider_catalogs?.[provider.id] };
        return normalizeAIProviderRowDraft({ ...row, models: resolveFlowerProviderModels(row as FlowerProvider, row.catalog_models) } as AIProviderRow);
      });
      setProviders(projectProviders());
      const resource = ctx.env.flowerModelReadResource;
      const load = resource ? resource.loadDirectory(true) : fetchLocalApiJSON('/_redeven_proxy/api/ai/models', { method: 'GET' }).then(readFlowerModelDirectory);
      void load.then(directory => {
        if (ctx.settings() !== s) return;
        setProviderDefaults(directory.provider_defaults);
        if (ctx.settings() === s && !dirty()) {
          setProviders(projectProviders(directory));
        }
      }).catch(() => undefined);
    }
    const savedPermission = normalizePermissionType(ai?.permission_type);
    setConfirmedPermissionType(savedPermission);
    if (!permissionDirty() && !permissionSaving()) setPermissionType(savedPermission);
  });

  createEffect(() => {
    const resource = ctx.env.flowerModelReadResource;
    if (!resource) return;
    const unsubscribe = resource.subscribe(directory => {
      setProviderDefaults(directory.provider_defaults);
      setProviders(rows => rows.map(provider => applyFlowerModelDiscovery({ ...provider, model_defaults: directory.provider_defaults?.[provider.type] } as FlowerProviderDraft, directory.provider_catalogs?.[provider.id] ?? provider.catalog_models ?? []) as AIProviderRow));
      const draft = untrack(providerDialogProvider);
      const saved = untrack(providers).find(provider => provider.id === draft?.id);
      if (draft && saved && draft.type === saved.type && draft.base_url === saved.base_url
        && draft.auth_method === saved.auth_method && draft.account_id === saved.account_id
        && !providerKeyDraft()[draft.id] && directory.provider_catalogs?.[draft.id]) {
        setProviderDialogProvider(applyFlowerModelDiscovery(draft as FlowerProviderDraft, directory.provider_catalogs[draft.id]) as AIProviderRow);
      }
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
  createEffect(() => { if (!dirty() || saving() || error() || !canEdit()) { autoSaveTimer = clearTimer(autoSaveTimer); return; } autoSaveTimer = clearTimer(autoSaveTimer); autoSaveTimer = window.setTimeout(async () => { autoSaveTimer = undefined; if (!dirty() || saving() || error() || !canEdit()) return; setSaving(true); try { const pd = normalizeAIProviders(providers()).map((p) => serializeFlowerProvider(p as FlowerProviderDraft)); const sv = await fetchLocalApiJSON<SettingsUpdateResponse | unknown>('/_redeven_proxy/api/ai/provider_bundle', { method: 'PUT', body: JSON.stringify({ auth_schema_version: 1, model_profile: { current_model_id: String(currentModelID() ?? '').trim(), providers: pd } }) }); if (isJSONObject(sv) && isJSONObject((sv as SettingsUpdateResponse).settings)) ctx.mutateSettings((sv as SettingsUpdateResponse).settings); ctx.env.bumpSettingsSeq(); setSavedAt(Date.now()); setDirty(false); setFailure(null); } catch (e) { setFailure({ message: formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'), blocking: false }); } finally { setSaving(false); } }, AUTO_SAVE_DELAY_MS); });

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

  const saveAIProviderBundle = async (nps: AIProviderRow[], nid: string, pid: string) => { const id = String(pid ?? '').trim(); if (!id) { ctx.notify.error(i18n.t('flowerSettings.invalidProviderTitle'), i18n.t('flowerSettings.providerIdRequired')); return false; } if (!ctx.canAdmin()) { ctx.notify.error(i18n.t('flowerSettings.permissionDeniedTitle'), i18n.t('flowerSettings.adminRequired')); return false; } let av: AIModelProfile; try { av = buildAIValueFromRows(nps, nid); validateAIValue({ ...av, providers: nps } as AIConfig, i18n); setFailure(null); } catch (e) { const m = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'); setFailure({ message: m, blocking: true }); ctx.notify.error(i18n.t('flowerSettings.saveFailedTitle'), m); return false; } const pk = String(providerKeyDraft()?.[id] ?? '').trim(); const wk = String(webSearchKeyDraft()?.[id] ?? '').trim(); setSaving(true); try { const sv = await fetchLocalApiJSON<SettingsUpdateResponse | unknown>('/_redeven_proxy/api/ai/provider_bundle', { method: 'PUT', body: JSON.stringify({ auth_schema_version: 1, model_profile: av, provider_api_key_patches: pk ? [{ provider_id: id, api_key: pk }] : [], web_search_provider_key_patches: wk ? [{ provider_id: id, api_key: wk }] : [] }) }); if (isJSONObject(sv) && isJSONObject((sv as SettingsUpdateResponse).settings)) ctx.mutateSettings((sv as SettingsUpdateResponse).settings); ctx.env.bumpSettingsSeq(); setProviders(nps); setCurrentModelID(nid); setProviderKeyDraft((p) => ({ ...p, [id]: '' })); setWebSearchKeyDraft((p) => ({ ...p, [id]: '' })); setSavedAt(Date.now()); setDirty(false); setFailure(null); ctx.notify.success(i18n.t('flowerSettings.autosavedTitle'), i18n.t('flowerSettings.providerSaved')); return true; } catch (e) { const m = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'); setFailure(null); setDirty(true); ctx.notify.error(i18n.t('flowerSettings.autosaveFailedTitle'), i18n.t('flowerSettings.providerSaveFailed', { message: m })); return false; } finally { setSaving(false); } };

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

  const addAIProviderAndOpenDialog = () => { const d = { ...newAIProviderDraft(), model_defaults: providerDefaults()?.openai }; setProviderDialogProvider(d); setProviderDialogIndex(null); setProviderDialogMode('create'); setProviderDialogOpen(true); };
  const openAIProviderDialog = (i: number) => { const p = providers()[i]; if (!p) return; setDiscoveryError(''); setProviderDialogProvider(cloneAIProviderRow(p)); setProviderDialogIndex(i); setProviderDialogMode('edit'); setProviderDialogOpen(true); };
  const closeAIProviderDialog = () => { setProviderDialogOpen(false); setProviderDialogProvider(null); setProviderDialogIndex(null); };
  const confirmAIProviderDialog = () => { const d = providerDialogProvider(); if (!d) return; const idx = providerDialogIndex(); let nps: AIProviderRow[]; if (idx != null) nps = normalizeAIProviders(providers().map((p, i) => (i === idx ? normalizeAIProviderRowDraft(d) : p))); else nps = normalizeAIProviders([...providers(), normalizeAIProviderRowDraft(d)]); const current = String(currentModelID() ?? '').trim(); const nid = current || collectAIModelOptions(nps)[0]?.id || ''; void saveAIProviderBundle(nps, nid, d.id).then((s) => { if (s) closeAIProviderDialog(); }); };
  const updateAIProviderDialogDraft = (fn: (c: AIProviderRow) => AIProviderRow) => { setProviderDialogProvider((p) => p ? fn(p) : null); };
  const providerDialogRecommendedModels = createMemo(() => {
    const provider = providerDialogProvider();
    return provider ? flowerProviderModelChoices(provider as FlowerProviderDraft) as readonly AIProviderModel[] : [];
  });
  const addRecommendedModelToDialog = (modelName?: string) => updateAIProviderDialogDraft((current) => {
    const presets = providerDialogRecommendedModels();
    const preset = modelName
      ? presets.find((model) => modelNameKey(model.model_name) === modelNameKey(modelName))
      : presets.find((model) => !providerHasModel(current, model.model_name));
    if (!preset || providerHasModel(current, preset.model_name)) return current;
    return setFlowerModelsEnabled(current as FlowerProviderDraft, [preset], true) as AIProviderRow;
  });
  const addAllRecommendedModelsToDialog = () => updateAIProviderDialogDraft((current) =>
    setFlowerModelsEnabled(current as FlowerProviderDraft, providerDialogRecommendedModels(), true) as AIProviderRow);
  const removeRecommendedModelFromDialog = (modelName: string) => updateAIProviderDialogDraft((current) =>
    setFlowerModelsEnabled(current as FlowerProviderDraft, current.models.filter((model) => model.model_name === modelName), false) as AIProviderRow);
  let discoverySequence = 0;
  const discoveryIdentity = (draft: AIProviderRow) => JSON.stringify([draft.id, draft.type, draft.base_url, providerKeyDraft()[draft.id]]);
  const discoverDialogModels = async () => {
    const draft = providerDialogProvider();
    if (!draft) return;
    const sequence = ++discoverySequence;
    const identity = discoveryIdentity(draft);
    const apiKey = providerKeyDraft()[draft.id];
    setDiscoveringModels(true); setDiscoveryError('');
    try {
      const result = await fetchLocalApiJSON<{ models: AIProviderModel[] }>('/_redeven_proxy/api/ai/model_catalog', { method: 'POST', body: JSON.stringify({ provider_id: draft.id, type: draft.type, base_url: draft.base_url, api_key: apiKey || undefined }) });
      const current = providerDialogProvider();
      if (sequence === discoverySequence && providerDialogOpen() && current && discoveryIdentity(current) === identity) {
        setProviderDialogProvider(normalizeAIProviderRowDraft(applyFlowerModelDiscovery(current as FlowerProviderDraft, result.models) as AIProviderRow));
      }
    } catch (error) { if (sequence === discoverySequence) setDiscoveryError(formatUnknownError(error)); }
    finally { if (sequence === discoverySequence) setDiscoveringModels(false); }
  };
  const updateDialogModelNumber = (
    index: number,
    key: 'context_window' | 'max_output_tokens' | 'effective_context_window_percent',
    rawValue: string,
  ) => updateAIProviderDialogDraft((current) => ({
    ...current,
    models: current.models.map((model, modelIndex) => {
      if (modelIndex !== index) return model;
      const parsed = key === 'effective_context_window_percent'
        ? normalizeEffectiveContextPercent(rawValue)
        : normalizePositiveInteger(rawValue);
      return { ...model, [key]: parsed };
    }),
  }));

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
          <FlowerModelSettings copy={settingsCopy()} providers={providers().map(provider => ({ ...provider, web_search: provider.web_search ? { mode: provider.web_search.mode ?? 'disabled' } : undefined }))} currentModelID={currentModelID()} disabled={!canEdit() || saving()}
            providerReady={provider => provider.auth_method === 'chatgpt' ? ctx.settings()?.chatgpt_accounts?.[provider.id]?.state === 'ready' : (flowerProviderAPIKeyOptional(provider.type) || !!providerKeySet()[provider.id]) && (provider.web_search?.mode !== 'brave' || !!webSearchKeySet()[provider.id])}
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

      <AIProviderDialog mode={providerDialogMode()} open={providerDialogOpen()} onOpenChange={(o) => { if (!o) closeAIProviderDialog(); }}
        title={providerDialogMode() === 'create' ? i18n.t('flowerSettings.addProviderDialogTitle') : i18n.t('flowerSettings.editProviderDialogTitle')}
        provider={providerDialogProvider()} canInteract={ctx.canInteract()} canAdmin={ctx.canAdmin()} aiSaving={saving()}
        keySet={!!providerKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]} keyDraft={providerKeyDraft()?.[String(providerDialogProvider()?.id ?? '').trim()] ?? ''} keySaving={!!providerKeySaving()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        webSearchKeySet={!!webSearchKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]} webSearchKeyDraft={webSearchKeyDraft()?.[String(providerDialogProvider()?.id ?? '').trim()] ?? ''} webSearchKeySaving={!!webSearchKeySaving()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        recommendedModels={providerDialogRecommendedModels() as readonly import('../types').AIProviderModelPreset[]} onClearModels={() => updateAIProviderDialogDraft((current) => setFlowerModelsEnabled(current as FlowerProviderDraft, current.models, false) as AIProviderRow)} onDiscoverModels={discoverDialogModels} discoveringModels={discoveringModels()} discoveryError={discoveryError()} onConfirm={confirmAIProviderDialog}
        onChangeName={(v) => updateAIProviderDialogDraft((c) => ({ ...c, name: v }))}
        onChangeType={(nt) => { const np = providerPresetForType(nt); const npm = defaultFlowerProviderModels(nt).map((model) => modelRowFromPreset(model as AIProviderModel)); updateAIProviderDialogDraft((c) => c.type === nt ? c : { ...c, auth_method: undefined, account_id: undefined, chatgpt_account: undefined, name: providerUsesCustomConnectionName(nt) ? np.name : providerTypeLabel(nt), type: nt, base_url: defaultBaseURLForProviderType(nt), web_search: normalizeAIProviderWebSearchForType(nt, np.web_search), models: npm, model_selection: undefined, catalog_models: undefined, model_defaults: providerDefaults()?.[nt] }); }}
        onChangeBaseURL={(v) => updateAIProviderDialogDraft((c) => ({ ...c, base_url: v, models: c.models.map((model) => ({ ...model, web_search: undefined })), catalog_models: undefined }))}
        onChangeKeyDraft={(v) => { const id = String(providerDialogProvider()?.id ?? '').trim(); if (id) setProviderKeyDraft((p) => ({ ...p, [id]: v })); }}
        onChangeWebSearchMode={(m) => { updateAIProviderDialogDraft((c) => ({ ...c, web_search: normalizeAIProviderWebSearchForType(c.type, m), models: c.models.map((model) => ({ ...model, web_search: undefined })), catalog_models: undefined })); }}
        onChangeWebSearchKeyDraft={(v) => { const id = String(providerDialogProvider()?.id ?? '').trim(); if (id) { setWebSearchKeyDraft((p) => ({ ...p, [id]: v })); updateAIProviderDialogDraft((c) => ({ ...c, models: c.models.map((model) => ({ ...model, web_search: undefined })) })); } }}
        onApplyAllPresets={addAllRecommendedModelsToDialog} onAddSelectedPreset={addRecommendedModelToDialog} onRemoveRecommendedPreset={removeRecommendedModelFromDialog}
        onAddCustomModel={(mn) => { const n = String(mn ?? '').trim(); if (!n) return; updateAIProviderDialogDraft((c) => ({ ...c, models: normalizeProviderModelRows(c.type, [...(Array.isArray(c.models) ? c.models : []), { model_name: n, status: 'needs_configuration', input_modalities: ['text'] }]) })); }}
        onChangeModelName={(i, v) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).map((m, mi) => mi === i ? { ...m, model_name: v } : m) }))}
        onChangeModelNumber={updateDialogModelNumber} onChangeModelCapabilities={(index, patch) => updateAIProviderDialogDraft(current => ({ ...current, models: current.models.map((model, i) => i === index ? { ...model, ...patch, input_modalities: normalizeInputModalities(patch.input_modalities ?? model.input_modalities) } : model) }))}
        onChangeModelImageInput={(i, en) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).map((m, mi) => mi === i ? { ...m, input_modalities: en ? ['text', 'image'] : ['text'] } : m) }))}
        onRemoveModel={(i) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).filter((_, mi) => mi !== i) }))}
      />
    </>
  );
}
