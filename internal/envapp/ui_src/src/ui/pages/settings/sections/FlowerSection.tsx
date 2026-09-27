import { secureRandomUUID } from '@floegence/floe-webapp-core';
import { ProviderBrandIcon } from '../ProviderBrandIcon';
import { modelCatalogCopy } from '../../../../../../../flower_ui/src/settings/modelCatalogCopy';
import { hydrateFlowerProviderCatalog, applyFlowerModelDiscovery, flowerProviderModelChoices, setFlowerModelsEnabled, defaultFlowerProviderModels, resolveFlowerProviderModels, serializeFlowerProvider } from '../../../../../../../flower_ui/src/settings/modelSelection';
import type { FlowerProvider, FlowerProviderDraft } from '../../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { For, Show, createMemo, createSignal, createEffect, onCleanup, untrack } from 'solid-js';
import { Bot, Pencil, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { FeedbackIndicator, Button, Select, Tabs } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { fetchLocalApiJSON } from '../../../services/localApi';
import { SettingsSection, AutoSaveIndicator, SubSectionHeader, DotIndicator, SettingsList, SettingRow } from '../SettingsPrimitives';
import { AIProviderDialog } from '../AIProviderDialog';
import { flowerProviderSearchSummary, withFlowerProviderSearchAvailability } from '../../../../../../../flower_ui/src/webSearchCapability';
import type { FlowerWebSearchAvailability } from '../../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { formatUnknownError } from '../../../maintenance/shared';
import { normalizeFlowerReasoningCapability, serializeFlowerReasoningSelection } from '../../../../../../../flower_ui/src/reasoning';
import {
  cloneAIProviderRow, defaultBaseURLForProviderType, modelID, modelSupportsImageInput,
  localizedProviderDisplayName, localizedProviderTypeLabel, normalizeAIProviderRowDraft,
  providerNeedsWebSearchConfig, providerPresetForType, providerTypeLabel,
  providerTypeRequiresBaseURL, providerUsesCustomConnectionName,
  normalizeContextWindowByProvider,
  normalizeEffectiveContextPercent, normalizeInputModalities, normalizePositiveInteger,
  defaultContextWindowForProviderType,
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
    const providerID = String(p?.id ?? '').trim(); if (!providerID) continue;
    const providerName = localizedProviderDisplayName(p, locale, providerID);
    for (const m of Array.isArray(p?.models) ? p.models : []) {
      const modelName = String(m?.model_name ?? '').trim(); if (!modelName) continue;
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

function normalizeProviderModelRows(type: AIProviderType, models: AIProviderModelRow[]): AIProviderModelRow[] {
  return models.map((m) => ({
    ...m,
    context_window: normalizeContextWindowByProvider(type, m.context_window),
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
    if (models.length === 0 && !p.model_selection) throw new Error(i18n.t('flowerSettings.providerMissingModels', { provider: id }));
    const modelNames = new Set<string>();
    for (const m of models) { const mn = String((m as any).model_name ?? '').trim(); const wm = String((m as any).wire_model_name ?? '').trim(); const cw = Number((m as any).context_window); if (!mn) throw new Error(i18n.t('flowerSettings.providerModelNameMissing', { provider: id })); if (mn.includes('/')) throw new Error(i18n.t('flowerSettings.providerModelNameMustNotContainSlash', { provider: id })); if (wm.includes('\u0000')) throw new Error(i18n.t('flowerSettings.providerModelNameMissing', { provider: id })); if (modelNames.has(mn)) throw new Error(i18n.t('flowerSettings.providerDuplicateModelName', { provider: id, model: mn })); if ((typ === 'openai_compatible' || typ === 'openrouter' || typ === 'xai' || typ === 'groq' || typ === 'ollama') && (!Number.isFinite(cw) || cw <= 0)) throw new Error(i18n.t('flowerSettings.providerModelRequiresContextWindow', { provider: id, model: mn })); modelNames.add(mn); modelIDs.add(modelID(id, mn)); }
  }
  const cid = String((cfg as any).current_model_id ?? '').trim(); if (!cid) throw new Error(i18n.t('flowerSettings.missingCurrentModelId')); if (!modelIDs.has(cid) && !providers.some((p: AIProviderRow) => p.model_selection && cid.startsWith(`${p.id}/`))) throw new Error(i18n.t('flowerSettings.currentModelNotInProviders', { currentModelId: cid }));
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

  createEffect(() => {
    const s = ctx.settings();
    if (!s) return;
    const ai = s.ai;
    if (!dirty()) {
      setCurrentModelID(ai?.current_model_id ?? '');
      const configured = ai?.providers ?? [];
      setProviders(configured.map((provider) => normalizeAIProviderRowDraft({ ...provider, models: resolveFlowerProviderModels(provider as FlowerProvider) } as AIProviderRow)));
      void Promise.all([
        Promise.all(configured.map((provider) => hydrateFlowerProviderCatalog(provider as FlowerProvider,
          (input) => fetchLocalApiJSON('/_redeven_proxy/api/ai/model_catalog', { method: 'POST', body: JSON.stringify(input) })))),
        fetchLocalApiJSON<{ models: { id: string; web_search: FlowerWebSearchAvailability }[] }>('/_redeven_proxy/api/ai/models', { method: 'GET' }),
      ]).then(([hydrated, catalog]) => {
        if (ctx.settings() === s && !dirty()) setProviders(hydrated.map((provider) => normalizeAIProviderRowDraft(withFlowerProviderSearchAvailability(provider, catalog.models) as AIProviderRow)));
      }).catch((error) => { if (ctx.settings() === s) setFailure({ message: formatUnknownError(error), blocking: providers().length === 0 }); });
    }
    const savedPermission = normalizePermissionType(ai?.permission_type);
    setConfirmedPermissionType(savedPermission);
    if (!permissionDirty() && !permissionSaving()) setPermissionType(savedPermission);
  });

  const aiModelOptions = createMemo(() => collectAIModelOptions(providers(), i18n.locale()));
  const aiCurrentModelOption = createMemo(() => aiModelOptions().find((o) => o.id === currentModelID()));
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
  createEffect(() => { if (!dirty() || saving() || error() || !canEdit()) { autoSaveTimer = clearTimer(autoSaveTimer); return; } autoSaveTimer = clearTimer(autoSaveTimer); autoSaveTimer = window.setTimeout(async () => { autoSaveTimer = undefined; if (!dirty() || saving() || error() || !canEdit()) return; setSaving(true); try { const pd = normalizeAIProviders(providers()).map((p) => serializeFlowerProvider(p as FlowerProviderDraft)); const sv = await fetchLocalApiJSON<SettingsUpdateResponse | unknown>('/_redeven_proxy/api/ai/provider_bundle', { method: 'PUT', body: JSON.stringify({ model_profile: { current_model_id: String(currentModelID() ?? '').trim(), providers: pd } }) }); if (isJSONObject(sv) && isJSONObject((sv as SettingsUpdateResponse).settings)) ctx.mutateSettings((sv as SettingsUpdateResponse).settings); ctx.env.bumpSettingsSeq(); setSavedAt(Date.now()); setDirty(false); setFailure(null); } catch (e) { setFailure({ message: formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'), blocking: false }); } finally { setSaving(false); } }, AUTO_SAVE_DELAY_MS); });

  const saveAICurrentModelDirectly = async (next: string, previous: string) => { try { await fetchLocalApiJSON('/_redeven_proxy/api/ai/current_model', { method: 'PUT', body: JSON.stringify({ model_id: next }) }); ctx.env.bumpSettingsSeq(); setSavedAt(Date.now()); setFailure(null); } catch (e) { const message = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'); setCurrentModelID(previous); setFailure({ message, blocking: false }); } };

  const buildAIValueFromRows = (rows: AIProviderRow[], curRaw: string): AIModelProfile => ({
    current_model_id: String(curRaw ?? '').trim(),
    providers: normalizeAIProviders(rows).map((provider) => serializeFlowerProvider(provider as FlowerProviderDraft) as AIProvider),
  });

  const saveAIProviderBundle = async (nps: AIProviderRow[], nid: string, pid: string) => { const id = String(pid ?? '').trim(); if (!id) { ctx.notify.error(i18n.t('flowerSettings.invalidProviderTitle'), i18n.t('flowerSettings.providerIdRequired')); return false; } if (!ctx.canAdmin()) { ctx.notify.error(i18n.t('flowerSettings.permissionDeniedTitle'), i18n.t('flowerSettings.adminRequired')); return false; } let av: AIModelProfile; try { av = buildAIValueFromRows(nps, nid); validateAIValue({ ...av, providers: nps } as AIConfig, i18n); setFailure(null); } catch (e) { const m = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'); setFailure({ message: m, blocking: true }); ctx.notify.error(i18n.t('flowerSettings.saveFailedTitle'), m); return false; } const pk = String(providerKeyDraft()?.[id] ?? '').trim(); const wk = String(webSearchKeyDraft()?.[id] ?? '').trim(); setSaving(true); try { const sv = await fetchLocalApiJSON<SettingsUpdateResponse | unknown>('/_redeven_proxy/api/ai/provider_bundle', { method: 'PUT', body: JSON.stringify({ model_profile: av, provider_api_key_patches: pk ? [{ provider_id: id, api_key: pk }] : [], web_search_provider_key_patches: wk ? [{ provider_id: id, api_key: wk }] : [] }) }); if (isJSONObject(sv) && isJSONObject((sv as SettingsUpdateResponse).settings)) ctx.mutateSettings((sv as SettingsUpdateResponse).settings); ctx.env.bumpSettingsSeq(); setProviders(nps); setCurrentModelID(nid); setProviderKeyDraft((p) => ({ ...p, [id]: '' })); setWebSearchKeyDraft((p) => ({ ...p, [id]: '' })); setSavedAt(Date.now()); setDirty(false); setFailure(null); ctx.notify.success(i18n.t('flowerSettings.autosavedTitle'), i18n.t('flowerSettings.providerSaved')); return true; } catch (e) { const m = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'); setFailure(null); setDirty(true); ctx.notify.error(i18n.t('flowerSettings.autosaveFailedTitle'), i18n.t('flowerSettings.providerSaveFailed', { message: m })); return false; } finally { setSaving(false); } };

  const addAIProviderAndOpenDialog = () => { const d = newAIProviderDraft(); setProviderDialogProvider(d); setProviderDialogIndex(null); setProviderDialogMode('create'); setProviderDialogOpen(true); };
  const openAIProviderDialog = (i: number) => { const p = providers()[i]; if (!p) return; setDiscoveryError(p.catalog_error ?? ''); setProviderDialogProvider(cloneAIProviderRow(p)); setProviderDialogIndex(i); setProviderDialogMode('edit'); setProviderDialogOpen(true); };
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
  const automaticDiscoveryIdentity = createMemo(() => {
    const draft = providerDialogProvider();
    if (!providerDialogOpen() || !draft) return '';
    if (draft.type === 'openai_compatible' || draft.type === 'ollama' || draft.type === 'openrouter') return '';
    return discoveryIdentity(draft);
  });
  createEffect(() => {
    if (!automaticDiscoveryIdentity()) return;
    const timer = setTimeout(() => { void untrack(discoverDialogModels); }, 200);
    onCleanup(() => clearTimeout(timer));
  });
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
        <div hidden={activeTab() !== 'models'} data-flower-settings-panel="models" class="space-y-6">
        <Show when={currentModelID() && !aiCurrentModelOption()}><p role="alert" class="text-xs text-destructive">{modelCatalogCopy(i18n.locale()).unavailable}</p></Show>
        <SettingsList>
          <SettingRow title={i18n.t('flowerSettings.currentModelTitle')}
            description={aiCurrentModelOption() ? [i18n.t('flowerSettings.textCapability'), aiCurrentModelOption()?.supportsImageInput ? i18n.t('flowerSettings.imageInputCapability') : ''].filter(Boolean).join(' · ') : i18n.t('flowerSettings.noModelSelected')}
            control={
            <Select value={currentModelID()} options={aiModelOptions().map((it) => ({ value: it.id, label: it.label }))}
              onChange={(v) => { const nid = String(v ?? '').trim(); if (!aiModelOptions().some((option) => option.id === nid)) return; const pid = String(currentModelID() ?? '').trim(); if (nid === pid) return; setCurrentModelID(nid); if (!dirty() && !saving()) { void saveAICurrentModelDirectly(nid, pid); return; } setFailure(null); setDirty(true); }}
              placeholder={i18n.t('flowerSettings.selectModelPlaceholder')} class="w-full sm:w-56" disabled={!canEdit() || aiModelOptions().length === 0 || saving()} />
            } />
        </SettingsList>

        {/* Providers gallery */}
        <div class="space-y-3">
          <SubSectionHeader title={i18n.t('flowerSettings.providersTitle')} description={i18n.t('flowerSettings.providersDescription')}
            actions={<Button size="sm" variant="ghost" icon={Plus} onClick={addAIProviderAndOpenDialog} disabled={!canEdit()}>{i18n.t('flowerSettings.addProvider')}</Button>} />
          <SettingsList>
            <For each={providers()}>{(provider, index) => {
              const pid = () => String(provider.id ?? '').trim(); const dn = () => localizedProviderDisplayName(provider, i18n.locale(), i18n.t('flowerSettings.providerFallbackName', { count: index() + 1 }));
              const mns = () => (Array.isArray(provider.models) ? provider.models : []).map((m) => String(m.model_name ?? '').trim()).filter(Boolean);
              const hasImg = () => (Array.isArray(provider.models) ? provider.models : []).some((m) => modelSupportsImageInput(m.input_modalities));
              const isDef = () => currentModelID().startsWith(`${pid()}/`); const keyOk = () => providerKeySet()?.[pid()];
              const wss = () => flowerProviderSearchSummary(provider.models, modelCatalogCopy(i18n.locale()));
              return (
                <div class="settings-provider-row">
                  <SettingRow icon={iconProps => <ProviderBrandIcon type={provider.type} class={iconProps.class} />} title={dn()} description={provider.type === 'ollama' ? modelCatalogCopy(i18n.locale()).optionalKey : keyOk() ? i18n.t('flowerSettings.keyVerified') : i18n.t('flowerSettings.needsKey')}
                    control={<div class="settings-row-actions">
                      <Show when={isDef()}><span class="text-xs text-muted-foreground">{i18n.t('flowerSettings.activeProviderBadge')}</span></Show>
                      <Button size="icon" variant="ghost" icon={Pencil} onClick={() => openAIProviderDialog(index())} disabled={!canEdit()} aria-label={i18n.t('flowerSettings.editProvider')} />
                      <Show when={providers().length > 1}><Button size="icon" variant="ghost" icon={Trash}
                        onClick={() => { setProviders((p) => normalizeAIProviders(p.filter((_, i) => i !== index()))); setFailure(null); setDirty(true); }}
                        disabled={!canEdit()} aria-label={i18n.t('flowerSettings.removeProvider')} /></Show>
                    </div>} />
                  <details class="settings-provider-details settings-technical-details">
                    <summary>{i18n.t('flowerChat.model.label')} · {mns().length}</summary>
                    <div class="space-y-3 pt-3">
                      <p class="text-xs text-muted-foreground">{localizedProviderTypeLabel(provider.type, i18n.locale())}</p>
                      <div class="flex flex-wrap gap-2"><For each={mns()}>{name => <code class="break-all text-xs">{name}</code>}</For></div>
                      <div class="flex flex-wrap gap-4"><DotIndicator active={wss().enabled} label={wss().label} />
                        <Show when={hasImg()}><DotIndicator active label={i18n.t('flowerSettings.imageInput')} /></Show>
                      </div>
                    </div>
                  </details>
                </div>
              );
            }}</For>
          </SettingsList>
        </div>
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

      <AIProviderDialog open={providerDialogOpen()} onOpenChange={(o) => { if (!o) closeAIProviderDialog(); }}
        title={providerDialogMode() === 'create' ? i18n.t('flowerSettings.addProviderDialogTitle') : i18n.t('flowerSettings.editProviderDialogTitle')}
        provider={providerDialogProvider()} canInteract={ctx.canInteract()} canAdmin={ctx.canAdmin()} aiSaving={saving()}
        keySet={!!providerKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]} keyDraft={providerKeyDraft()?.[String(providerDialogProvider()?.id ?? '').trim()] ?? ''} keySaving={!!providerKeySaving()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        webSearchKeySet={!!webSearchKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]} webSearchKeyDraft={webSearchKeyDraft()?.[String(providerDialogProvider()?.id ?? '').trim()] ?? ''} webSearchKeySaving={!!webSearchKeySaving()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        recommendedModels={providerDialogRecommendedModels() as readonly import('../types').AIProviderModelPreset[]} onClearModels={() => updateAIProviderDialogDraft((current) => setFlowerModelsEnabled(current as FlowerProviderDraft, current.models, false) as AIProviderRow)} onDiscoverModels={providerDialogProvider()?.type === 'openai_compatible' ? undefined : discoverDialogModels} discoveringModels={discoveringModels()} discoveryError={discoveryError()} onConfirm={confirmAIProviderDialog}
        onChangeName={(v) => updateAIProviderDialogDraft((c) => ({ ...c, name: v }))}
        onChangeType={(nt) => { const np = providerPresetForType(nt); const npm = defaultFlowerProviderModels(nt).map((model) => modelRowFromPreset(model as AIProviderModel)); updateAIProviderDialogDraft((c) => c.type === nt ? c : { ...c, name: providerUsesCustomConnectionName(nt) ? np.name : providerTypeLabel(nt), type: nt, base_url: defaultBaseURLForProviderType(nt), web_search: normalizeAIProviderWebSearchForType(nt, np.web_search), models: npm, model_selection: undefined, catalog_models: undefined }); }}
        onChangeBaseURL={(v) => updateAIProviderDialogDraft((c) => ({ ...c, base_url: v, models: c.models.map((model) => ({ ...model, web_search: undefined })), catalog_models: undefined }))}
        onChangeKeyDraft={(v) => { const id = String(providerDialogProvider()?.id ?? '').trim(); if (id) setProviderKeyDraft((p) => ({ ...p, [id]: v })); }}
        onChangeWebSearchMode={(m) => { updateAIProviderDialogDraft((c) => ({ ...c, web_search: normalizeAIProviderWebSearchForType(c.type, m), models: c.models.map((model) => ({ ...model, web_search: undefined })), catalog_models: undefined })); }}
        onChangeWebSearchKeyDraft={(v) => { const id = String(providerDialogProvider()?.id ?? '').trim(); if (id) { setWebSearchKeyDraft((p) => ({ ...p, [id]: v })); updateAIProviderDialogDraft((c) => ({ ...c, models: c.models.map((model) => ({ ...model, web_search: undefined })) })); } }}
        onApplyAllPresets={addAllRecommendedModelsToDialog} onAddSelectedPreset={addRecommendedModelToDialog} onRemoveRecommendedPreset={removeRecommendedModelFromDialog}
        onAddCustomModel={(mn) => { const n = String(mn ?? '').trim(); if (!n) return; updateAIProviderDialogDraft((c) => ({ ...c, models: normalizeProviderModelRows(c.type, [...(Array.isArray(c.models) ? c.models : []), { model_name: n, context_window: defaultContextWindowForProviderType(c.type) ?? 128000, input_modalities: ['text'] }]) })); }}
        onChangeModelName={(i, v) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).map((m, mi) => mi === i ? { ...m, model_name: v } : m) }))}
        onChangeModelNumber={updateDialogModelNumber} onChangeModelImageInput={(i, en) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).map((m, mi) => mi === i ? { ...m, input_modalities: en ? ['text', 'image'] : ['text'] } : m) }))}
        onRemoveModel={(i) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).filter((_, mi) => mi !== i) }))}
      />
    </>
  );
}
