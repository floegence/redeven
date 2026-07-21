import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { Bot, Eye, Globe, Image, Key, Pencil, Plus, ShieldCheck, Sparkles, Trash, Zap } from '@floegence/floe-webapp-core/icons';
import { Button, Select } from '@floegence/floe-webapp-core/ui';
import { cn } from '@floegence/floe-webapp-core';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { fetchLocalApiJSON } from '../../../services/localApi';
import { SettingsSection, AutoSaveIndicator, SubSectionHeader, DotIndicator } from '../SettingsPrimitives';
import { AIProviderDialog } from '../AIProviderDialog';
import { ProviderBrandIcon } from '../ProviderBrandIcon';
import { localizedProviderBuiltInWebSearchLabel } from '../providerWebSearchI18n';
import { formatUnknownError } from '../../../maintenance/shared';
import { normalizeFlowerReasoningCapability, serializeFlowerReasoningSelection } from '../../../../../../../flower_ui/src/reasoning';
import {
  cloneAIProviderRow, defaultBaseURLForProviderType, modelID, modelSupportsImageInput,
  localizedProviderDisplayName, localizedProviderTypeLabel, normalizeAIProviderRowDraft,
  providerNeedsWebSearchConfig, providerPresetForType, providerTypeLabel,
  providerTypeRequiresBaseURL, providerUsesCustomConnectionName,
  recommendedModelsForProviderType, normalizeContextWindowByProvider,
  normalizeEffectiveContextPercent, normalizeInputModalities, normalizePositiveInteger,
  defaultContextWindowForProviderType,
} from '../aiCatalog';
import type {
  AIConfig, AIModelProfile, AIProvider, AIProviderModel, AIProviderRow, AIProviderType, AIProviderModelRow, AIProviderWebSearchMode,
  AIProviderDialogMode, AIPermissionType, SettingsUpdateResponse,
} from '../types';
import { useI18n, type I18nHelpers } from '../../../i18n';

const AUTO_SAVE_DELAY_MS = 700;
const PERMISSION_TYPES: readonly AIPermissionType[] = ['readonly', 'approval_required', 'full_access'];
let envProviderIDSequence = 0;

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

function PermissionTypeIcon(props: Readonly<{ kind: AIPermissionType; class?: string }>) {
  const Icon = props.kind === 'readonly' ? Eye : props.kind === 'full_access' ? Zap : ShieldCheck;
  return <Icon class={props.class} />;
}

function newProviderID(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid && typeof uuid === 'string') return `prov_${uuid}`;
  envProviderIDSequence += 1;
  return `prov_local_${envProviderIDSequence}`;
}

function newAIProviderDraft(): AIProviderRow {
  const defaultType: AIProviderType = 'openai';
  const defaultPresetModels = recommendedModelsForProviderType(defaultType);
  const firstPreset = defaultPresetModels[0];
  return normalizeAIProviderRowDraft({
    id: newProviderID(), name: providerPresetForType(defaultType).name, type: defaultType, base_url: defaultBaseURLForProviderType(defaultType),
    models: [{ model_name: String(firstPreset?.model_name ?? '').trim(), context_window: normalizePositiveInteger(firstPreset?.context_window), max_output_tokens: normalizePositiveInteger(firstPreset?.max_output_tokens), effective_context_window_percent: normalizeEffectiveContextPercent(firstPreset?.effective_context_window_percent), input_modalities: normalizeInputModalities(firstPreset?.input_modalities) }],
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

type ProviderWebSearchSummary = Readonly<{ label: string; supported: boolean; enabled: boolean }>;

function providerWebSearchSummary(provider: AIProviderRow, i18n: I18nHelpers): ProviderWebSearchSummary {
  const builtInLabel = localizedProviderBuiltInWebSearchLabel(i18n, provider.type);
  if (builtInLabel) return { label: builtInLabel, supported: true, enabled: true };
  if (!providerNeedsWebSearchConfig(provider.type)) return { label: i18n.t('flowerSettings.webSearchNotSupported'), supported: false, enabled: false };
  switch (normalizeAIProviderWebSearchMode(provider.web_search?.mode)) {
    case 'openai_builtin': return { label: i18n.t('flowerSettings.webSearchOpenAIResponsesBuiltIn'), supported: true, enabled: true };
    case 'brave': return { label: i18n.t('flowerSettings.webSearchBrave'), supported: true, enabled: true };
    default: return { label: i18n.t('flowerSettings.webSearchDisabled'), supported: true, enabled: false };
  }
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
    if (typ !== 'openai' && typ !== 'anthropic' && typ !== 'moonshot' && typ !== 'chatglm' && typ !== 'deepseek' && typ !== 'qwen' && typ !== 'openrouter' && typ !== 'xai' && typ !== 'groq' && typ !== 'ollama' && typ !== 'openai_compatible') throw new Error(i18n.t('flowerSettings.invalidProviderType', { providerType: typ || '(empty)' }));
    if (providerTypeRequiresBaseURL(typ as AIProviderType) && !baseURL) throw new Error(i18n.t('flowerSettings.providerRequiresBaseUrl', { provider: id }));
    if (baseURL) { let u: URL; try { u = new URL(baseURL); } catch { throw new Error(i18n.t('flowerSettings.providerInvalidBaseUrl', { provider: id })); } if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(i18n.t('flowerSettings.providerBaseUrlMustBeHttpHttps', { provider: id })); }
    if (models.length === 0) throw new Error(i18n.t('flowerSettings.providerMissingModels', { provider: id }));
    const modelNames = new Set<string>();
    for (const m of models) { const mn = String((m as any).model_name ?? '').trim(); const wm = String((m as any).wire_model_name ?? '').trim(); const cw = Number((m as any).context_window); if (!mn) throw new Error(i18n.t('flowerSettings.providerModelNameMissing', { provider: id })); if (mn.includes('/')) throw new Error(i18n.t('flowerSettings.providerModelNameMustNotContainSlash', { provider: id })); if (wm.includes('\u0000')) throw new Error(i18n.t('flowerSettings.providerModelNameMissing', { provider: id })); if (modelNames.has(mn)) throw new Error(i18n.t('flowerSettings.providerDuplicateModelName', { provider: id, model: mn })); if ((typ === 'openai_compatible' || typ === 'openrouter' || typ === 'xai' || typ === 'groq' || typ === 'ollama') && (!Number.isFinite(cw) || cw <= 0)) throw new Error(i18n.t('flowerSettings.providerModelRequiresContextWindow', { provider: id, model: mn })); modelNames.add(mn); modelIDs.add(modelID(id, mn)); }
  }
  const cid = String((cfg as any).current_model_id ?? '').trim(); if (!cid) throw new Error(i18n.t('flowerSettings.missingCurrentModelId')); if (!modelIDs.has(cid)) throw new Error(i18n.t('flowerSettings.currentModelNotInProviders', { currentModelId: cid }));
}

export function FlowerSection() {
  const ctx = useEnvSettingsPage(); const i18n = useI18n();

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
  const [savedAt, setSavedAt] = createSignal<number | null>(null); const [error, setError] = createSignal<string | null>(null);
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
      setProviders((Array.isArray(ai?.providers) ? ai.providers : []).map((p: any) => normalizeAIProviderRowDraft(p)));
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
    if (!ctx.canInteract()) return;
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
  createEffect(() => { if (!dirty() || saving() || !ctx.canInteract()) { autoSaveTimer = clearTimer(autoSaveTimer); return; } autoSaveTimer = clearTimer(autoSaveTimer); autoSaveTimer = window.setTimeout(async () => { autoSaveTimer = undefined; if (!dirty() || saving() || !ctx.canInteract()) return; setSaving(true); try { const pd = normalizeAIProviders(providers()).map((p) => ({ id: p.id, name: p.name, type: p.type, base_url: p.base_url, models: p.models, web_search: p.web_search })); const sv = await fetchLocalApiJSON<SettingsUpdateResponse | unknown>('/_redeven_proxy/api/ai/provider_bundle', { method: 'PUT', body: JSON.stringify({ model_profile: { current_model_id: String(currentModelID() ?? '').trim(), providers: pd } }) }); if (isJSONObject(sv) && isJSONObject((sv as SettingsUpdateResponse).settings)) ctx.mutateSettings((sv as SettingsUpdateResponse).settings); ctx.env.bumpSettingsSeq(); setSavedAt(Date.now()); setDirty(false); setError(null); } catch (e) { setError(formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage')); } finally { setSaving(false); } }, AUTO_SAVE_DELAY_MS); });

  const saveAICurrentModelDirectly = async (next: string, previous: string) => { try { await fetchLocalApiJSON('/_redeven_proxy/api/ai/current_model', { method: 'PUT', body: JSON.stringify({ model_id: next }) }); ctx.env.bumpSettingsSeq(); setSavedAt(Date.now()); setError(null); } catch (e) { const message = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'); setCurrentModelID(previous); setError(message); ctx.notify.error(i18n.t('flowerSettings.saveFailedTitle'), message); } };

  const buildAIValueFromRows = (rows: AIProviderRow[], curRaw: string): AIModelProfile => { const pr = normalizeAIProviders(rows); const cur = String(curRaw ?? '').trim(); const nps = pr.map((p) => { const o: any = { id: String(p.id ?? '').trim(), type: p.type, models: [] as AIProviderModel[] }; const nm = providerUsesCustomConnectionName(p.type) ? String(p.name ?? '').trim() : providerTypeLabel(p.type); if (nm) o.name = nm; const bu = String(p.base_url ?? '').trim(); if (bu) o.base_url = bu; const ws = normalizeAIProviderWebSearchForType(p.type, p.web_search); if (ws) o.web_search = ws; o.models = (p.models ?? []).map((m) => { const mo: any = { model_name: String(m.model_name ?? '').trim() }; const wm = String(m.wire_model_name ?? '').trim(); if (wm) mo.wire_model_name = wm; const cw = normalizePositiveInteger(m.context_window); if (cw != null) mo.context_window = cw; const mt = normalizePositiveInteger(m.max_output_tokens); if (mt != null) mo.max_output_tokens = mt; const ec = normalizeEffectiveContextPercent(m.effective_context_window_percent); if (ec != null) mo.effective_context_window_percent = ec; mo.input_modalities = normalizeInputModalities(m.input_modalities); const rc = normalizeFlowerReasoningCapability(m.reasoning_capability); if (rc) mo.reasoning_capability = rc; const rs = serializeFlowerReasoningSelection(m.default_reasoning_selection); if (rs) mo.default_reasoning_selection = rs; return mo as AIProviderModel; }); return o as AIProvider; }); return { current_model_id: cur, providers: nps }; };

  const saveAIProviderBundle = async (nps: AIProviderRow[], nid: string, pid: string) => { const id = String(pid ?? '').trim(); if (!id) { ctx.notify.error(i18n.t('flowerSettings.invalidProviderTitle'), i18n.t('flowerSettings.providerIdRequired')); return false; } if (!ctx.canAdmin()) { ctx.notify.error(i18n.t('flowerSettings.permissionDeniedTitle'), i18n.t('flowerSettings.adminRequired')); return false; } let av: AIModelProfile; try { av = buildAIValueFromRows(nps, nid); validateAIValue({ ...av } as AIConfig, i18n); setError(null); } catch (e) { const m = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'); setError(m); ctx.notify.error(i18n.t('flowerSettings.saveFailedTitle'), m); return false; } const pk = String(providerKeyDraft()?.[id] ?? '').trim(); const wk = String(webSearchKeyDraft()?.[id] ?? '').trim(); setSaving(true); try { const sv = await fetchLocalApiJSON<SettingsUpdateResponse | unknown>('/_redeven_proxy/api/ai/provider_bundle', { method: 'PUT', body: JSON.stringify({ model_profile: av, provider_api_key_patches: pk ? [{ provider_id: id, api_key: pk }] : [], web_search_provider_key_patches: wk ? [{ provider_id: id, api_key: wk }] : [] }) }); if (isJSONObject(sv) && isJSONObject((sv as SettingsUpdateResponse).settings)) ctx.mutateSettings((sv as SettingsUpdateResponse).settings); ctx.env.bumpSettingsSeq(); setProviders(nps); setCurrentModelID(nid); setProviderKeyDraft((p) => ({ ...p, [id]: '' })); setWebSearchKeyDraft((p) => ({ ...p, [id]: '' })); setSavedAt(Date.now()); setDirty(false); setError(null); ctx.notify.success(i18n.t('flowerSettings.autosavedTitle'), i18n.t('flowerSettings.providerSaved')); return true; } catch (e) { const m = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'); setError(m); setDirty(true); ctx.notify.error(i18n.t('flowerSettings.autosaveFailedTitle'), i18n.t('flowerSettings.providerSaveFailed', { message: m })); return false; } finally { setSaving(false); } };

  const addAIProviderAndOpenDialog = () => { const d = newAIProviderDraft(); setProviderDialogProvider(d); setProviderDialogIndex(null); setProviderDialogMode('create'); setProviderDialogOpen(true); };
  const openAIProviderDialog = (i: number) => { const p = providers()[i]; if (!p) return; setProviderDialogProvider(cloneAIProviderRow(p)); setProviderDialogIndex(i); setProviderDialogMode('edit'); setProviderDialogOpen(true); };
  const closeAIProviderDialog = () => { setProviderDialogOpen(false); setProviderDialogProvider(null); setProviderDialogIndex(null); };
  const confirmAIProviderDialog = () => { const d = providerDialogProvider(); if (!d) return; const idx = providerDialogIndex(); let nps: AIProviderRow[]; if (idx != null) nps = normalizeAIProviders(providers().map((p, i) => (i === idx ? normalizeAIProviderRowDraft(d) : p))); else nps = normalizeAIProviders([...providers(), normalizeAIProviderRowDraft(d)]); const current = String(currentModelID() ?? '').trim(); const nid = current || collectAIModelOptions(nps)[0]?.id || ''; void saveAIProviderBundle(nps, nid, d.id).then((s) => { if (s) closeAIProviderDialog(); }); };
  const updateAIProviderDialogDraft = (fn: (c: AIProviderRow) => AIProviderRow) => { setProviderDialogProvider((p) => p ? fn(p) : null); };
  const providerDialogRecommendedModels = createMemo(() => recommendedModelsForProviderType(providerDialogProvider()?.type ?? 'openai'));
  const addRecommendedModelToDialog = (modelName?: string) => updateAIProviderDialogDraft((current) => {
    const presets = recommendedModelsForProviderType(current.type);
    const preset = modelName
      ? presets.find((model) => modelNameKey(model.model_name) === modelNameKey(modelName))
      : presets.find((model) => !providerHasModel(current, model.model_name));
    if (!preset || providerHasModel(current, preset.model_name)) return current;
    return { ...current, models: normalizeProviderModelRows(current.type, [...current.models, modelRowFromPreset(preset)]) };
  });
  const addAllRecommendedModelsToDialog = () => updateAIProviderDialogDraft((current) => {
    const additions = recommendedModelsForProviderType(current.type)
      .filter((preset) => !providerHasModel(current, preset.model_name))
      .map(modelRowFromPreset);
    if (additions.length === 0) return current;
    return { ...current, models: normalizeProviderModelRows(current.type, [...current.models, ...additions]) };
  });
  const removeRecommendedModelFromDialog = (modelName: string) => updateAIProviderDialogDraft((current) => ({
    ...current,
    models: current.models.filter((model) => modelNameKey(model.model_name) !== modelNameKey(modelName)),
  }));
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
    if (permissionSaving() || !ctx.canInteract()) return;
    const target = permissionType();
    if (target === confirmedPermissionType()) {
      setPermissionDirty(false);
      return;
    }
    setPermissionSaving(true);
    setPermissionError(null);
    try {
      const response = await fetchLocalApiJSON<SettingsUpdateResponse>('/_redeven_proxy/api/ai/default_permission', {
        method: 'PUT',
        body: JSON.stringify({ permission_type: target }),
      });
      if (response.settings) ctx.mutateSettings(response.settings);
      ctx.env.bumpSettingsSeq();
      const confirmed = normalizePermissionType(response.settings?.ai?.permission_type ?? target);
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
      ctx.notify.error(i18n.t('flowerSettings.saveFailedTitle'), message);
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
    if (!permissionDirty() || permissionSaving() || !ctx.canInteract()) return;
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
    <div class="mt-5">
      <SubSectionHeader
        title={i18n.t('flowerSettings.defaultPermissionTitle')}
        description={i18n.t('flowerSettings.defaultPermissionDescription')}
        actions={<AutoSaveIndicator dirty={permissionDirty()} saving={permissionSaving()} error={permissionError()} savedAt={permissionSavedAt()} enabled={ctx.canInteract()} />}
      />
      <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3" role="radiogroup" aria-label={i18n.t('flowerSettings.defaultPermissionTitle')}>
        <For each={PERMISSION_TYPES}>
          {(kind) => {
            const copy = () => permissionTypeCopy(i18n, kind);
            return (
              <button ref={(el) => { permissionButtonRefs.set(kind, el); }} type="button" class={cn('redeven-settings-choice group flex cursor-pointer flex-col gap-2 rounded-xl border px-4 py-3.5 text-left', permissionType() === kind && 'redeven-settings-choice--selected-neutral', !ctx.canInteract() && 'cursor-not-allowed opacity-50')}
                role="radio" aria-checked={permissionType() === kind}
                tabIndex={permissionType() === kind ? 0 : -1}
                onKeyDown={onPermissionTypeKeyDown}
                onClick={() => choosePermissionType(kind)} disabled={!ctx.canInteract()}>
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2.5">
                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--redeven-status-info-soft)]">
                      <PermissionTypeIcon kind={kind} class="h-4 w-4 text-[var(--redeven-status-info)]" />
                    </div>
                    <span class="text-sm font-semibold text-foreground">{copy().title}</span>
                  </div>
                  <span class={cn('text-[11px] font-medium', permissionType() === kind ? 'text-success' : 'text-muted-foreground')}>
                    {permissionType() === kind ? i18n.t('flowerSettings.defaultPermissionBadge') : ''}
                  </span>
                </div>
                <p class="text-xs leading-relaxed text-muted-foreground">{copy().description}</p>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={permissionError()}>
        <p role="alert" class="mt-2 text-xs text-destructive">{permissionError()}</p>
      </Show>
    </div>
  );
  return (
    <>
      <SettingsSection
        icon={Bot} title={i18n.t('aiChrome.flowerTitle')} description={i18n.t('flowerSettings.description')}
        badge={aiModelOptions().length > 0 ? i18n.t('flowerSettings.activeBadge') : i18n.t('flowerSettings.noModelSelected')}
        badgeVariant={aiModelOptions().length > 0 ? 'success' : 'default'} error={error()}
        actions={<>
          <AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={ctx.canInteract()} />
        </>}
      >
        {/* Hero: Current model */}
        <div class="redeven-settings-choice redeven-settings-choice--selected-neutral rounded-xl border p-5">
          <div class="text-[11px] font-medium text-muted-foreground mb-3 uppercase tracking-wider">{i18n.t('flowerSettings.currentModelTitle')}</div>
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div class="flex min-w-0 flex-1 items-center gap-4">
              <div class="redeven-settings-inset flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border">
                <Show when={aiCurrentModelOption()} fallback={<Bot class="h-6 w-6 text-muted-foreground" />}>
                  <ProviderBrandIcon type={providers().find((p) => currentModelID().startsWith(String(p.id ?? '').trim() + '/'))?.type ?? 'openai'} class="h-6 w-6" />
                </Show>
              </div>
              <div class="min-w-0 flex-1">
                <Show when={aiCurrentModelOption()} fallback={<div class="text-base font-semibold text-muted-foreground">{i18n.t('flowerSettings.noModelSelected')}</div>}>
                  <div class="break-words text-base font-semibold text-foreground">{aiCurrentModelOption()!.label}</div>
                  <div class="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <DotIndicator active label={i18n.t('flowerSettings.textCapability')} />
                    <Show when={aiCurrentModelOption()?.supportsImageInput}><DotIndicator active label={i18n.t('flowerSettings.imageInputCapability')} /></Show>
                  </div>
                </Show>
              </div>
            </div>
            <Select value={currentModelID()} options={aiModelOptions().map((it) => ({ value: it.id, label: it.label }))}
              onChange={(v) => { const nid = String(v ?? '').trim(); if (!aiModelOptions().some((option) => option.id === nid)) return; const pid = String(currentModelID() ?? '').trim(); if (nid === pid) return; setCurrentModelID(nid); if (!dirty() && !saving()) { void saveAICurrentModelDirectly(nid, pid); return; } setDirty(true); }}
              placeholder={i18n.t('flowerSettings.selectModelPlaceholder')} class="w-full sm:w-56" disabled={!ctx.canInteract() || aiModelOptions().length === 0 || saving()} />
          </div>
        </div>

        {renderDefaultPermissionSection()}

        {/* Providers gallery */}
        <div class="mt-5">
          <SubSectionHeader title={i18n.t('flowerSettings.providersTitle')} description={i18n.t('flowerSettings.providersDescription')}
            actions={<Button size="sm" variant="default" icon={Plus} onClick={addAIProviderAndOpenDialog} disabled={!ctx.canInteract()}>{i18n.t('flowerSettings.addProvider')}</Button>} />
          <div class="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
            <For each={providers()}>{(provider, index) => {
              const pid = () => String(provider.id ?? '').trim(); const dn = () => localizedProviderDisplayName(provider, i18n.locale(), i18n.t('flowerSettings.providerFallbackName', { count: index() + 1 }));
              const mns = () => (Array.isArray(provider.models) ? provider.models : []).map((m) => String(m.model_name ?? '').trim()).filter(Boolean);
              const hasImg = () => (Array.isArray(provider.models) ? provider.models : []).some((m) => modelSupportsImageInput(m.input_modalities));
              const isDef = () => currentModelID().startsWith(`${pid()}/`); const keyOk = () => providerKeySet()?.[pid()];
              const wss = () => providerWebSearchSummary(provider, i18n);
              return (
                <div class={cn('redeven-settings-choice rounded-xl border p-4', isDef() && 'redeven-settings-choice--selected-neutral')}>
                  <div class="flex items-start gap-3">
                    <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted"><ProviderBrandIcon type={provider.type} class="h-5 w-5" /></div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="text-sm font-semibold text-foreground truncate">{dn()}</span>
                          <span class="text-[11px] text-muted-foreground">{localizedProviderTypeLabel(provider.type, i18n.locale())}</span>
                          <Show when={isDef()}><span class="flex-shrink-0 rounded-full bg-[var(--redeven-settings-selection-bg)] px-1.5 py-px text-[10px] font-medium text-[var(--redeven-settings-selection-fg)]">{i18n.t('flowerSettings.activeProviderBadge')}</span></Show>
                        </div>
                        <div class="flex items-center flex-shrink-0">
                          <Button size="icon" variant="ghost" class="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openAIProviderDialog(index())} disabled={!ctx.canInteract()} aria-label={i18n.t('flowerSettings.editProvider')}><Pencil class="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" class="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => { setProviders((p) => normalizeAIProviders(p.filter((_, i) => i !== index()))); setDirty(true); }} disabled={!ctx.canInteract() || providers().length <= 1} aria-label={i18n.t('flowerSettings.removeProvider')}><Trash class="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                      <div class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-2 text-xs">
                          <span class="flex w-20 flex-shrink-0 items-center gap-1.5 text-muted-foreground">
                            <Key class="h-3.5 w-3.5" />
                            <span>{i18n.t('flowerProviderDialog.apiKey')}</span>
                          </span>
                          <DotIndicator active={Boolean(keyOk())} label={keyOk() ? i18n.t('flowerSettings.keyVerified') : i18n.t('flowerSettings.needsKey')} />
                        </div>
                        <div class="flex items-start gap-2 text-xs">
                          <span class="flex w-20 flex-shrink-0 items-center gap-1.5 pt-0.5 text-muted-foreground">
                            <Sparkles class="h-3.5 w-3.5" />
                            <span>{i18n.t('flowerChat.model.label')}</span>
                          </span>
                          <div class="flex flex-wrap gap-1">
                            <For each={mns().slice(0, 3)}>{(name) => (
                              <code class={cn('rounded px-1.5 py-0.5 text-[11px] font-mono', isDef() && currentModelID() === `${pid()}/${name}` ? 'bg-primary/10 text-primary font-semibold' : 'bg-muted text-muted-foreground')}>{name}</code>
                            )}</For>
                            <Show when={mns().length > 3}><span class="text-[11px] text-muted-foreground">+{mns().length - 3}</span></Show>
                          </div>
                        </div>
                        <Show when={wss().supported}>
                          <div class="flex items-center gap-2 text-xs">
                            <span class="flex w-20 flex-shrink-0 items-center gap-1.5 text-muted-foreground">
                              <Globe class="h-3.5 w-3.5" />
                              <span>{i18n.t('flowerProviderDialog.webSearch')}</span>
                            </span>
                            <DotIndicator active={wss().enabled} label={wss().label} />
                          </div>
                        </Show>
                        <Show when={hasImg()}>
                          <div class="flex items-center gap-2 text-xs">
                            <span class="flex w-20 flex-shrink-0 items-center gap-1.5 text-muted-foreground">
                              <Image class="h-3.5 w-3.5" />
                              <span>{i18n.t('flowerSettings.imageInput')}</span>
                            </span>
                            <DotIndicator active label={i18n.t('flowerSettings.imageInput')} />
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }}</For>
          </div>
        </div>
      </SettingsSection>

      <AIProviderDialog open={providerDialogOpen()} onOpenChange={(o) => { if (!o) closeAIProviderDialog(); }}
        title={providerDialogMode() === 'create' ? i18n.t('flowerSettings.addProviderDialogTitle') : i18n.t('flowerSettings.editProviderDialogTitle')}
        provider={providerDialogProvider()} canInteract={ctx.canInteract()} canAdmin={ctx.canAdmin()} aiSaving={saving()}
        keySet={!!providerKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]} keyDraft={providerKeyDraft()?.[String(providerDialogProvider()?.id ?? '').trim()] ?? ''} keySaving={!!providerKeySaving()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        webSearchKeySet={!!webSearchKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]} webSearchKeyDraft={webSearchKeyDraft()?.[String(providerDialogProvider()?.id ?? '').trim()] ?? ''} webSearchKeySaving={!!webSearchKeySaving()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        recommendedModels={providerDialogRecommendedModels()} onConfirm={confirmAIProviderDialog}
        onChangeName={(v) => updateAIProviderDialogDraft((c) => ({ ...c, name: v }))}
        onChangeType={(nt) => { const np = providerPresetForType(nt); const npm = recommendedModelsForProviderType(nt).map(modelRowFromPreset); updateAIProviderDialogDraft((c) => c.type === nt ? c : { ...c, name: providerUsesCustomConnectionName(nt) ? np.name : providerTypeLabel(nt), type: nt, base_url: defaultBaseURLForProviderType(nt), web_search: normalizeAIProviderWebSearchForType(nt, np.web_search), models: npm.length > 0 ? [npm[0]] : [] }); }}
        onChangeBaseURL={(v) => updateAIProviderDialogDraft((c) => ({ ...c, base_url: v }))}
        onChangeKeyDraft={(v) => { const id = String(providerDialogProvider()?.id ?? '').trim(); if (id) setProviderKeyDraft((p) => ({ ...p, [id]: v })); }}
        onChangeWebSearchMode={(m) => { updateAIProviderDialogDraft((c) => ({ ...c, web_search: normalizeAIProviderWebSearchForType(c.type, m) })); }}
        onChangeWebSearchKeyDraft={(v) => { const id = String(providerDialogProvider()?.id ?? '').trim(); if (id) setWebSearchKeyDraft((p) => ({ ...p, [id]: v })); }}
        onApplyAllPresets={addAllRecommendedModelsToDialog} onAddSelectedPreset={addRecommendedModelToDialog} onRemoveRecommendedPreset={removeRecommendedModelFromDialog}
        onAddCustomModel={(mn) => { const n = String(mn ?? '').trim(); if (!n) return; updateAIProviderDialogDraft((c) => ({ ...c, models: normalizeProviderModelRows(c.type, [...(Array.isArray(c.models) ? c.models : []), { model_name: n, context_window: defaultContextWindowForProviderType(c.type), input_modalities: ['text'] }]) })); }}
        onChangeModelName={(i, v) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).map((m, mi) => mi === i ? { ...m, model_name: v } : m) }))}
        onChangeModelNumber={updateDialogModelNumber} onChangeModelImageInput={(i, en) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).map((m, mi) => mi === i ? { ...m, input_modalities: en ? ['text', 'image'] : ['text'] } : m) }))}
        onRemoveModel={(i) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).filter((_, mi) => mi !== i) }))}
      />
    </>
  );
}
