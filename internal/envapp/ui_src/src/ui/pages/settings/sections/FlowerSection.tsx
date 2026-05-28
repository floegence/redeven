import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { AlertTriangle, Bot, Pencil, Shield, Trash, Zap } from '@floegence/floe-webapp-core/icons';
import { Button, Checkbox, ConfirmDialog, Select } from '@floegence/floe-webapp-core/ui';
import { cn } from '@floegence/floe-webapp-core';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { fetchGatewayJSON } from '../../../services/gatewayApi';
import {
  SettingsCard, ViewToggle, AutoSaveIndicator, JSONEditor, SubSectionHeader,
  type ViewMode,
} from '../SettingsPrimitives';
import { AIProviderDialog } from '../AIProviderDialog';
import { ProviderBrandIcon } from '../ProviderBrandIcon';
import { localizedProviderBuiltInWebSearchLabel } from '../providerWebSearchI18n';
import { redevenSurfaceRoleClass } from '../../../utils/redevenSurfaceRoles';
import { formatUnknownError } from '../../../maintenance/shared';
import {
  cloneAIProviderRow, defaultBaseURLForProviderType, modelID, modelSupportsImageInput,
  normalizeAIProviderRowDraft, providerDisplayName,
  providerNeedsWebSearchConfig, providerPresetForType, providerTypeLabel,
  providerTypeRequiresBaseURL, providerUsesCustomConnectionName,
  recommendedModelsForProviderType, normalizeContextWindowByProvider,
  normalizeEffectiveContextPercent, normalizeInputModalities, normalizePositiveInteger,
  defaultContextWindowForProviderType,
} from '../aiCatalog';
import type {
  AIConfig, AIProvider, AIProviderModel, AIProviderRow, AIProviderType, AIProviderModelRow, AIProviderWebSearchMode,
  AIProviderDialogMode,
  SettingsUpdateResponse,
} from '../types';
import { useI18n, type I18nHelpers } from '../../../i18n';

const AUTO_SAVE_DELAY_MS = 700;

function isJSONObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function formatDesktopModelSourceNotice(
  i18n: I18nHelpers,
  bindingState: unknown,
  status: { connected?: boolean; available?: boolean; last_error?: string } | null,
): string {
  switch (String(bindingState ?? '').trim()) {
    case 'bound':
      if (status?.available) return i18n.t('flowerSettings.desktopModelSourceAvailable');
      return i18n.t('flowerSettings.desktopModelNoUsableModel');
    case 'unsupported':
      return i18n.t('flowerSettings.desktopModelUnsupported');
    case 'expired':
      return i18n.t('flowerSettings.desktopModelExpired');
    case 'error':
      return status?.last_error
        ? i18n.t('flowerSettings.desktopModelBindingFailedWithError', { message: status.last_error })
        : i18n.t('flowerSettings.desktopModelBindingFailed');
    default:
      if (status?.available) return i18n.t('flowerSettings.desktopModelSourceAvailable');
      if (status?.connected) return i18n.t('flowerSettings.desktopModelNoUsableModel');
      return i18n.t('flowerSettings.flowerDisabledNotice');
  }
}

function newProviderID(): string {
  try { const uuid = (globalThis.crypto as any)?.randomUUID?.(); if (uuid && typeof uuid === 'string') return `prov_${uuid}`; } catch {}
  return `prov_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

function newAIProviderDraft(): AIProviderRow {
  const defaultType: AIProviderType = 'openai';
  const defaultPresetModels = recommendedModelsForProviderType(defaultType);
  const firstPreset = defaultPresetModels[0];
  const firstModelName = String(firstPreset?.model_name ?? '').trim();
  return normalizeAIProviderRowDraft({
    id: newProviderID(), name: providerPresetForType(defaultType).name,
    type: defaultType, base_url: defaultBaseURLForProviderType(defaultType),
    models: [{
      model_name: firstModelName,
      context_window: normalizePositiveInteger(firstPreset?.context_window),
      max_output_tokens: normalizePositiveInteger(firstPreset?.max_output_tokens),
      effective_context_window_percent: normalizeEffectiveContextPercent(firstPreset?.effective_context_window_percent),
      input_modalities: normalizeInputModalities(firstPreset?.input_modalities),
    }],
  });
}

function normalizeAIProviders(rows: AIProviderRow[]): AIProviderRow[] {
  return rows.map((r) => normalizeAIProviderRowDraft(r));
}

type AIModelOption = Readonly<{ id: string; label: string; supportsImageInput: boolean }>;

function collectAIModelOptions(rows: AIProviderRow[]): AIModelOption[] {
  const options: AIModelOption[] = [];
  for (const p of Array.isArray(rows) ? rows : []) {
    const providerID = String(p?.id ?? '').trim();
    if (!providerID) continue;
    const providerName = providerDisplayName(p, providerID);
    for (const m of Array.isArray(p?.models) ? p.models : []) {
      const modelName = String(m?.model_name ?? '').trim();
      if (!modelName) continue;
      options.push({ id: modelID(providerID, modelName), label: `${providerName} / ${modelName}`, supportsImageInput: modelSupportsImageInput(m.input_modalities) });
    }
  }
  return options;
}

function normalizeAICurrentModelID(raw: string, rows: AIProviderRow[]): string {
  const current = String(raw ?? '').trim();
  const options = collectAIModelOptions(rows);
  if (options.some((it) => it.id === current)) return current;
  return '';
}

function normalizeAIProviderWebSearchMode(raw: unknown): AIProviderWebSearchMode {
  const mode = String(raw ?? '').trim().toLowerCase();
  if (mode === 'openai_builtin' || mode === 'brave') return mode;
  return 'disabled';
}

function normalizeAIProviderWebSearchForType(providerType: AIProviderType, raw: unknown) {
  if (!providerNeedsWebSearchConfig(providerType)) return undefined;
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as any).mode : raw;
  return { mode: normalizeAIProviderWebSearchMode(source) };
}

type ProviderWebSearchSummary = Readonly<{
  label: string;
  supported: boolean;
  enabled: boolean;
}>;

function providerWebSearchSummary(provider: AIProviderRow, i18n: I18nHelpers): ProviderWebSearchSummary {
  const builtInLabel = localizedProviderBuiltInWebSearchLabel(i18n, provider.type);
  if (builtInLabel) return { label: builtInLabel, supported: true, enabled: true };
  if (!providerNeedsWebSearchConfig(provider.type)) {
    return { label: i18n.t('flowerSettings.webSearchNotSupported'), supported: false, enabled: false };
  }
  switch (normalizeAIProviderWebSearchMode(provider.web_search?.mode)) {
    case 'openai_builtin':
      return { label: i18n.t('flowerSettings.webSearchOpenAIResponsesBuiltIn'), supported: true, enabled: true };
    case 'brave':
      return { label: i18n.t('flowerSettings.webSearchBrave'), supported: true, enabled: true };
    default:
      return { label: i18n.t('flowerSettings.webSearchDisabled'), supported: true, enabled: false };
  }
}

function normalizeProviderModelRows(type: AIProviderType, models: AIProviderModelRow[]): AIProviderModelRow[] {
  return models.map((m) => ({ ...m, context_window: normalizeContextWindowByProvider(type, m.context_window), effective_context_window_percent: normalizeEffectiveContextPercent(m.effective_context_window_percent) }));
}

function validateAIValue(cfg: AIConfig, i18n: I18nHelpers) {
  const providers = Array.isArray((cfg as any).providers) ? (cfg as any).providers : [];
  if (providers.length === 0) throw new Error(i18n.t('flowerSettings.missingProviders'));

  const providerIDs = new Set<string>();
  const modelIDs = new Set<string>();
  for (const p of providers) {
    const id = String((p as any).id ?? '').trim();
    const typ = String((p as any).type ?? '').trim();
    const baseURL = String((p as any).base_url ?? '').trim();
    const models = Array.isArray((p as any).models) ? (p as any).models : [];

    if (!id) throw new Error(i18n.t('flowerSettings.providerIdRequired'));
    if (id.includes('/')) throw new Error(i18n.t('flowerSettings.providerIdMustNotContainSlash', { provider: id }));
    if (providerIDs.has(id)) throw new Error(i18n.t('flowerSettings.duplicateProviderId', { provider: id }));
    providerIDs.add(id);

    if (
      typ !== 'openai' &&
      typ !== 'anthropic' &&
      typ !== 'moonshot' &&
      typ !== 'chatglm' &&
      typ !== 'deepseek' &&
      typ !== 'qwen' &&
      typ !== 'openai_compatible'
    ) {
      throw new Error(i18n.t('flowerSettings.invalidProviderType', { providerType: typ || '(empty)' }));
    }
    if (providerTypeRequiresBaseURL(typ as AIProviderType) && !baseURL) throw new Error(i18n.t('flowerSettings.providerRequiresBaseUrl', { provider: id }));
    if (baseURL) {
      let u: URL;
      try {
        u = new URL(baseURL);
      } catch {
        throw new Error(i18n.t('flowerSettings.providerInvalidBaseUrl', { provider: id }));
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(i18n.t('flowerSettings.providerBaseUrlMustBeHttpHttps', { provider: id }));
    }

    if (models.length === 0) throw new Error(i18n.t('flowerSettings.providerMissingModels', { provider: id }));
    const modelNames = new Set<string>();
    for (const m of models) {
      const mn = String((m as any).model_name ?? '').trim();
      const contextWindow = Number((m as any).context_window);
      if (!mn) throw new Error(i18n.t('flowerSettings.providerModelNameMissing', { provider: id }));
      if (mn.includes('/')) throw new Error(i18n.t('flowerSettings.providerModelNameMustNotContainSlash', { provider: id }));
      if (modelNames.has(mn)) throw new Error(i18n.t('flowerSettings.providerDuplicateModelName', { provider: id, model: mn }));
      if (typ === 'openai_compatible' && (!Number.isFinite(contextWindow) || contextWindow <= 0)) {
        throw new Error(i18n.t('flowerSettings.providerModelRequiresContextWindow', { provider: id, model: mn }));
      }
      modelNames.add(mn);
      modelIDs.add(modelID(id, mn));
    }
  }

  const currentModelID = String((cfg as any).current_model_id ?? '').trim();
  if (!currentModelID) throw new Error(i18n.t('flowerSettings.missingCurrentModelId'));
  if (!modelIDs.has(currentModelID)) throw new Error(i18n.t('flowerSettings.currentModelNotInProviders', { currentModelId: currentModelID }));
}

export function FlowerSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const [viewMode, setViewMode] = createSignal<ViewMode>('ui');
  const [aiEnabled, setAiEnabled] = createSignal(true);
  const [requireUserApproval, setRequireUserApproval] = createSignal(false);
  const [blockDangerousCommands, setBlockDangerousCommands] = createSignal(false);
  const [currentModelID, setCurrentModelID] = createSignal('');
  const [providers, setProviders] = createSignal<AIProviderRow[]>([]);
  const [providerKeySet] = createSignal<Record<string, boolean>>({});
  const [providerKeyDraft, setProviderKeyDraft] = createSignal<Record<string, string>>({});
  const [providerKeySaving] = createSignal<Record<string, boolean>>({});
  const [webSearchKeySet] = createSignal<Record<string, boolean>>({});
  const [webSearchKeyDraft, setWebSearchKeyDraft] = createSignal<Record<string, string>>({});
  const [webSearchKeySaving] = createSignal<Record<string, boolean>>({});
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [disableAISaving, setDisableAISaving] = createSignal(false);
  const [disableAIOpen, setDisableAIOpen] = createSignal(false);

  // Provider dialog state
  const [providerDialogOpen, setProviderDialogOpen] = createSignal(false);
  const [providerDialogIndex, setProviderDialogIndex] = createSignal<number | null>(null);
  const [providerDialogProvider, setProviderDialogProvider] = createSignal<AIProviderRow | null>(null);
  const [providerDialogMode, setProviderDialogMode] = createSignal<AIProviderDialogMode>('create');
  const aiRuntimeDesktopModelSource = createMemo(() => ctx.settings()?.ai_runtime?.desktop_model_source ?? null);
  const desktopModelBindingState = createMemo(() => (
    ctx.runtimeDesktopModelSourceBinding()?.state
      ?? aiRuntimeDesktopModelSource()?.binding_state
      ?? ''
  ));
  const desktopModelSourceNotice = createMemo(() => (
    formatDesktopModelSourceNotice(i18n, desktopModelBindingState(), aiRuntimeDesktopModelSource())
  ));

  createEffect(() => {
    const s = ctx.settings();
    if (!s) return;
    if (!dirty()) {
      const ai = s?.ai;
      setAiEnabled(!!ai);
      setRequireUserApproval(ai?.execution_policy?.require_user_approval ?? false);
      setBlockDangerousCommands(ai?.execution_policy?.block_dangerous_commands ?? false);
      setCurrentModelID(ai?.current_model_id ?? '');
      setProviders((Array.isArray(ai?.providers) ? ai!.providers : []).map((p: any) => normalizeAIProviderRowDraft(p)));
    }
  });

  const aiModelOptions = createMemo(() => collectAIModelOptions(providers()));
  const aiCurrentModelOption = createMemo(() => aiModelOptions().find((o) => o.id === currentModelID()));
  const jsonText = createMemo(() => JSON.stringify({
    current_model_id: currentModelID() || null,
    execution_policy: { require_user_approval: requireUserApproval(), block_dangerous_commands: blockDangerousCommands() },
    providers: providers(),
  }, null, 2));

  let autoSaveTimer: number | undefined;
  const clearTimer = (t: number | undefined) => { if (t != null) { window.clearTimeout(t); return undefined; } return undefined; };

  createEffect(() => {
    if (!dirty() || saving() || !ctx.canInteract() || disableAISaving()) { autoSaveTimer = clearTimer(autoSaveTimer); return; }
    autoSaveTimer = clearTimer(autoSaveTimer);
    autoSaveTimer = window.setTimeout(async () => {
      autoSaveTimer = undefined;
      if (!dirty() || saving() || !ctx.canInteract() || disableAISaving()) return;
      setSaving(true);
      try {
        const providersDraft = normalizeAIProviders(providers()).map((p) => ({
          id: p.id, name: p.name, type: p.type, base_url: p.base_url,
          models: p.models, web_search: p.web_search,
        }));
        await ctx.saveSettings({
          ai: {
            current_model_id: normalizeAICurrentModelID(currentModelID(), normalizeAIProviders(providers())) || null,
            execution_policy: { require_user_approval: requireUserApproval(), block_dangerous_commands: blockDangerousCommands() },
            terminal_exec_policy: { default_timeout_ms: 120000, max_timeout_ms: 600000 },
            providers: providersDraft,
          },
        });
        setSaving(false); setSavedAt(Date.now()); setDirty(false); setError(null);
      } catch (e) {
        setSaving(false); setError(formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage'));
      }
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => { autoSaveTimer = clearTimer(autoSaveTimer); });

  const switchView = (next: ViewMode) => setViewMode(next);

  // Direct model save
  const saveAICurrentModelDirectly = async (nextModelID: string, _prev: string) => {
    try {
      const providersDraft = normalizeAIProviders(providers()).map((p) => ({
        id: p.id, name: p.name, type: p.type, base_url: p.base_url, models: p.models, web_search: p.web_search,
      }));
      await ctx.saveSettings({
        ai: {
          current_model_id: nextModelID,
          execution_policy: { require_user_approval: requireUserApproval(), block_dangerous_commands: blockDangerousCommands() },
          terminal_exec_policy: { default_timeout_ms: 120000, max_timeout_ms: 600000 },
          providers: providersDraft,
        },
      });
      setSavedAt(Date.now());
    } catch { /* ignore */ }
  };
  const buildAIValueFromRows = (rows: AIProviderRow[], currentModelRaw: string): AIConfig => {
    const providerRows = normalizeAIProviders(rows);
    const providerModels = collectAIModelOptions(providerRows);
    const current = normalizeAICurrentModelID(currentModelRaw, providerRows)
      || providerModels[0]?.id
      || '';
    const nextProviders = providerRows.map((p) => {
      const out: any = {
        id: String(p.id ?? '').trim(),
        type: p.type,
        models: [] as AIProviderModel[],
      };
      const name = providerUsesCustomConnectionName(p.type) ? String(p.name ?? '').trim() : providerTypeLabel(p.type);
      if (name) out.name = name;
      const baseURL = String(p.base_url ?? '').trim();
      if (baseURL) out.base_url = baseURL;
      const webSearch = normalizeAIProviderWebSearchForType(p.type, p.web_search);
      if (webSearch) out.web_search = webSearch;
      out.models = (p.models ?? []).map((m) => {
        const modelOut: any = { model_name: String(m.model_name ?? '').trim() };
        const contextWindow = normalizePositiveInteger(m.context_window);
        if (contextWindow != null) modelOut.context_window = contextWindow;
        const maxOutputTokens = normalizePositiveInteger(m.max_output_tokens);
        if (maxOutputTokens != null) modelOut.max_output_tokens = maxOutputTokens;
        const effectiveContextPercent = normalizeEffectiveContextPercent(m.effective_context_window_percent);
        if (effectiveContextPercent != null) modelOut.effective_context_window_percent = effectiveContextPercent;
        modelOut.input_modalities = normalizeInputModalities(m.input_modalities);
        return modelOut as AIProviderModel;
      });
      return out as AIProvider;
    });

    return {
      current_model_id: current,
      execution_policy: {
        require_user_approval: requireUserApproval(),
        block_dangerous_commands: blockDangerousCommands(),
      },
      terminal_exec_policy: { default_timeout_ms: 120000, max_timeout_ms: 600000 },
      providers: nextProviders,
    };
  };
  const saveAIProviderBundle = async (nextProviders: AIProviderRow[], nextCurrentModelID: string, providerID: string) => {
    const id = String(providerID ?? '').trim();
    if (!id) {
      ctx.notify.error(i18n.t('flowerSettings.invalidProviderTitle'), i18n.t('flowerSettings.providerIdRequired'));
      return false;
    }
    if (!ctx.canAdmin()) {
      ctx.notify.error(i18n.t('flowerSettings.permissionDeniedTitle'), i18n.t('flowerSettings.adminRequired'));
      return false;
    }

    let aiValue: AIConfig;
    try {
      aiValue = buildAIValueFromRows(nextProviders, nextCurrentModelID);
      validateAIValue(aiValue, i18n);
      setError(null);
    } catch (e) {
      const msg = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage');
      setError(msg);
      ctx.notify.error(i18n.t('flowerSettings.saveFailedTitle'), msg);
      return false;
    }

    const providerKey = String(providerKeyDraft()?.[id] ?? '').trim();
    const webSearchKey = String(webSearchKeyDraft()?.[id] ?? '').trim();
    setSaving(true);
    try {
      const saved = await fetchGatewayJSON<SettingsUpdateResponse | unknown>('/_redeven_proxy/api/ai/provider_bundle', {
        method: 'PUT',
        body: JSON.stringify({
          ai: aiValue,
          provider_api_key_patches: providerKey ? [{ provider_id: id, api_key: providerKey }] : [],
          web_search_provider_key_patches: webSearchKey ? [{ provider_id: id, api_key: webSearchKey }] : [],
        }),
      });
      if (isJSONObject(saved) && isJSONObject((saved as SettingsUpdateResponse).settings)) {
        ctx.mutateSettings((saved as SettingsUpdateResponse).settings);
      }
      ctx.env.bumpSettingsSeq();
      setProviders(nextProviders);
      setCurrentModelID(nextCurrentModelID);
      setProviderKeyDraft((prev) => ({ ...prev, [id]: '' }));
      setWebSearchKeyDraft((prev) => ({ ...prev, [id]: '' }));
      setSavedAt(Date.now());
      setDirty(false);
      setError(null);
      ctx.notify.success(i18n.t('flowerSettings.autosavedTitle'), i18n.t('flowerSettings.providerSaved'));
      return true;
    } catch (e) {
      const msg = formatUnknownError(e) || i18n.t('flowerSettings.saveFailedMessage');
      setError(msg);
      setDirty(true);
      ctx.notify.error(
        i18n.t('flowerSettings.autosaveFailedTitle'),
        i18n.t('flowerSettings.providerSaveFailed', { message: msg }),
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Provider dialog
  const addAIProviderAndOpenDialog = () => {
    const draft = newAIProviderDraft();
    setProviderDialogProvider(draft);
    setProviderDialogIndex(null);
    setProviderDialogMode('create');
    setProviderDialogOpen(true);
  };
  const openAIProviderDialog = (index: number) => {
    const p = providers()[index];
    if (!p) return;
    setProviderDialogProvider(cloneAIProviderRow(p));
    setProviderDialogIndex(index);
    setProviderDialogMode('edit');
    setProviderDialogOpen(true);
  };
  const closeAIProviderDialog = () => { setProviderDialogOpen(false); setProviderDialogProvider(null); setProviderDialogIndex(null); };
  const confirmAIProviderDialog = () => {
    const draft = providerDialogProvider();
    if (!draft) return;
    const idx = providerDialogIndex();
    let nextProviders: AIProviderRow[];
    if (idx != null) {
      nextProviders = normalizeAIProviders(providers().map((p, i) => (i === idx ? normalizeAIProviderRowDraft(draft) : p)));
    } else {
      nextProviders = normalizeAIProviders([...providers(), normalizeAIProviderRowDraft(draft)]);
    }
    const nextCurrentModelID = normalizeAICurrentModelID(currentModelID(), nextProviders)
      || collectAIModelOptions(nextProviders)[0]?.id
      || '';
    void saveAIProviderBundle(nextProviders, nextCurrentModelID, draft.id).then((saved) => {
      if (saved) closeAIProviderDialog();
    });
  };
  const updateAIProviderDialogDraft = (fn: (current: AIProviderRow) => AIProviderRow) => {
    setProviderDialogProvider((prev) => prev ? fn(prev) : null);
  };

  // Disable AI
  const disableAI = async () => {
    setDisableAISaving(true);
    try {
      await ctx.saveSettings({ ai: null });
      setAiEnabled(false); setDisableAIOpen(false); setDirty(false);
    } catch { /* ignore */ }
    setDisableAISaving(false);
  };

  return (
    <>
      <SettingsCard
        icon={Zap}
        title={i18n.t('aiChrome.flowerTitle')}
        description={i18n.t('flowerSettings.description')}
        badge={aiEnabled() ? i18n.t('flowerSettings.activeBadge') : i18n.t('flowerSettings.disabledBadge')}
        badgeVariant={aiEnabled() ? 'success' : 'default'}
        error={error()}
        actions={
          <>
            <ViewToggle value={viewMode} disabled={!ctx.canInteract()} onChange={switchView} />
            <AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={ctx.canInteract()} />
            <Show when={aiEnabled()}>
              <Button size="sm" variant="destructive" onClick={() => setDisableAIOpen(true)} disabled={!ctx.canInteract() || saving()}>
                {i18n.t('flowerSettings.disableAction')}
              </Button>
            </Show>
          </>
        }
      >
        <Show when={!aiEnabled() && !ctx.settings.loading && !ctx.settings.error}>
          <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <Zap class="h-5 w-5 text-muted-foreground" />
            <div class="text-sm text-muted-foreground">{desktopModelSourceNotice()}</div>
          </div>
        </Show>

        <Show
          when={viewMode() === 'ui'}
          fallback={<JSONEditor value={jsonText()} onChange={(v) => { try { const p = JSON.parse(v); if (p.current_model_id) setCurrentModelID(p.current_model_id); if (p.execution_policy) { setRequireUserApproval(p.execution_policy.require_user_approval ?? false); setBlockDangerousCommands(p.execution_policy.block_dangerous_commands ?? false); } setDirty(true); } catch {} }} disabled={!ctx.canInteract()} rows={14} />}
        >
          <div class="space-y-6">
            <div class="space-y-3">
              <SubSectionHeader
                title={i18n.t('flowerSettings.executionPolicyTitle')}
                description={i18n.t('flowerSettings.executionPolicyDescription')}
              />
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class={cn('group flex cursor-pointer flex-col gap-2.5 rounded-xl border px-4 py-3.5 transition-all duration-150', redevenSurfaceRoleClass('panel'), ctx.canInteract() && 'hover:border-primary/40 hover:shadow-sm', !ctx.canInteract() && 'cursor-not-allowed opacity-50')}>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                      <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10"><Shield class="h-4 w-4 text-blue-500" /></div>
                      <span class="text-sm font-semibold text-foreground">{i18n.t('flowerSettings.userApprovalTitle')}</span>
                    </div>
                    <Checkbox checked={requireUserApproval()} onChange={(v) => { setRequireUserApproval(v); setDirty(true); }} disabled={!ctx.canInteract()} label="" size="sm" />
                  </div>
                  <p class="text-xs leading-relaxed text-muted-foreground">{i18n.t('flowerSettings.userApprovalDescription')}</p>
                </label>
                <label class={cn('group flex cursor-pointer flex-col gap-2.5 rounded-xl border px-4 py-3.5 transition-all duration-150', redevenSurfaceRoleClass('panel'), ctx.canInteract() && 'hover:border-primary/40 hover:shadow-sm', !ctx.canInteract() && 'cursor-not-allowed opacity-50')}>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                      <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10"><AlertTriangle class="h-4 w-4 text-amber-500" /></div>
                      <span class="text-sm font-semibold text-foreground">{i18n.t('flowerSettings.blockDangerousCommandsTitle')}</span>
                    </div>
                    <Checkbox checked={blockDangerousCommands()} onChange={(v) => { setBlockDangerousCommands(v); setDirty(true); }} disabled={!ctx.canInteract()} label="" size="sm" />
                  </div>
                  <p class="text-xs leading-relaxed text-muted-foreground">{i18n.t('flowerSettings.blockDangerousCommandsDescription')}</p>
                </label>
              </div>
              <Show when={!blockDangerousCommands()}>
                <div class="flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning/10 p-3">
                  <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div class="text-xs font-medium text-foreground">{i18n.t('flowerSettings.dangerousCommandsDisabled')}</div>
                </div>
              </Show>
            </div>

            <div class="space-y-3">
              <SubSectionHeader
                title={i18n.t('flowerSettings.currentModelTitle')}
                description={i18n.t('flowerSettings.currentModelDescription')}
              />
              <div class={cn('flex items-center gap-4 rounded-xl border bg-background p-4', redevenSurfaceRoleClass('panel'))}>
                <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Show when={aiCurrentModelOption()} fallback={<Bot class="h-5 w-5 text-muted-foreground" />}>
                    <ProviderBrandIcon type={providers().find((p) => currentModelID().startsWith(String(p.id ?? '').trim() + '/'))?.type ?? 'openai'} class="h-5 w-5" />
                  </Show>
                </div>
                <div class="min-w-0 flex-1">
                  <Show when={aiCurrentModelOption()} fallback={<div class="text-sm font-medium text-muted-foreground">{i18n.t('flowerSettings.noModelSelected')}</div>}>
                    <div class="truncate text-sm font-semibold text-foreground">{aiCurrentModelOption()!.label}</div>
                    <div class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-success/70"></span>{i18n.t('flowerSettings.textCapability')}</span>
                      <Show when={aiCurrentModelOption()?.supportsImageInput}>
                        <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-success/70"></span>{i18n.t('flowerSettings.imageInputCapability')}</span>
                      </Show>
                    </div>
                  </Show>
                </div>
                <div class="relative flex-shrink-0">
                  <Select value={currentModelID()} options={aiModelOptions().map((item) => ({ value: item.id, label: item.label }))}
                    onChange={(value) => {
                      const nextModelID = normalizeAICurrentModelID(String(value ?? '').trim(), providers());
                      if (!nextModelID) return;
                      const prevModelID = normalizeAICurrentModelID(currentModelID(), providers());
                      if (nextModelID === prevModelID) return;
                      setCurrentModelID(nextModelID);
                      const canDirectSave = viewMode() === 'ui' && !dirty() && !saving() && !disableAISaving();
                      if (canDirectSave) { void saveAICurrentModelDirectly(nextModelID, prevModelID || ''); return; }
                      setDirty(true);
                    }}
                    placeholder={i18n.t('flowerSettings.selectModelPlaceholder')} class="w-52" disabled={!ctx.canInteract() || aiModelOptions().length === 0 || saving() || disableAISaving()} />
                </div>
              </div>
            </div>

            <div class="space-y-3">
              <SubSectionHeader
                title={i18n.t('flowerSettings.providersTitle')}
                description={i18n.t('flowerSettings.providersDescription')}
                actions={<Button size="sm" variant="default" onClick={addAIProviderAndOpenDialog} disabled={!ctx.canInteract()}>{i18n.t('flowerSettings.addProvider')}</Button>}
              />
              <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <For each={providers()}>
                  {(provider, index) => {
                    const providerID = () => String(provider.id ?? '').trim();
                    const displayName = () => providerDisplayName(provider, i18n.t('flowerSettings.providerFallbackName', { count: index() + 1 }));
                    const modelNames = () => (Array.isArray(provider.models) ? provider.models : []).map((m) => String(m.model_name ?? '').trim()).filter(Boolean);
                    const hasImageModel = () => (Array.isArray(provider.models) ? provider.models : []).some((m) => modelSupportsImageInput(m.input_modalities));
                    const isDefault = () => currentModelID().startsWith(`${providerID()}/`);
                    const keyOk = () => providerKeySet()?.[providerID()];
                    const webSearchSummary = () => providerWebSearchSummary(provider, i18n);
                    return (
                      <div class={cn('flex gap-3 rounded-xl border bg-background p-4 transition-all', redevenSurfaceRoleClass('panel'), isDefault() && 'border-l-[3px] border-l-primary pl-[13px]')}>
                        <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                          <ProviderBrandIcon type={provider.type} class="h-5 w-5" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center justify-between gap-2">
                            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span class="truncate text-sm font-semibold text-foreground">{displayName()}</span>
                              <span class="flex-shrink-0 text-xs text-muted-foreground">{providerTypeLabel(provider.type)}</span>
                              <Show when={isDefault()}><span class="flex-shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">{i18n.t('flowerSettings.activeProviderBadge')}</span></Show>
                            </div>
                            <div class="flex flex-shrink-0 items-center">
                              <Button size="icon" variant="ghost" class="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openAIProviderDialog(index())} disabled={!ctx.canInteract()} aria-label={i18n.t('flowerSettings.editProvider')}><Pencil class="h-3.5 w-3.5" /></Button>
                              <Button size="icon" variant="ghost" class="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => { setProviders((prev) => { const n = normalizeAIProviders(prev.filter((_, i) => i !== index())); setCurrentModelID(normalizeAICurrentModelID(currentModelID(), n)); return n; }); setDirty(true); }}
                                disabled={!ctx.canInteract() || providers().length <= 1} aria-label={i18n.t('flowerSettings.removeProvider')}><Trash class="h-3.5 w-3.5" /></Button>
                            </div>
                          </div>
                          <div class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{i18n.tn('flowerSettings.modelCount', modelNames().length)}</span>
                            <span class={keyOk() ? 'text-success' : ''}>{keyOk() ? i18n.t('flowerSettings.keyVerified') : i18n.t('flowerSettings.needsKey')}</span>
                            <Show when={webSearchSummary().supported}><span class={webSearchSummary().enabled ? 'text-success' : ''}>{webSearchSummary().label}</span></Show>
                            <Show when={hasImageModel()}><span>{i18n.t('flowerSettings.imageInput')}</span></Show>
                          </div>
                          <Show when={modelNames().length > 0}>
                            <div class="mt-2.5 flex flex-wrap gap-1">
                              <For each={modelNames().slice(0, 5)}>
                                {(name) => (
                                  <code class={cn('rounded px-1.5 py-0.5 text-[11px] font-mono', isDefault() && currentModelID() === `${providerID()}/${name}` ? 'bg-primary/10 text-primary font-semibold' : 'bg-muted text-muted-foreground')}>{name}</code>
                                )}
                              </For>
                              <Show when={modelNames().length > 5}><span class="self-center text-[11px] text-muted-foreground">{i18n.t('flowerSettings.moreModels', { count: modelNames().length - 5 })}</span></Show>
                            </div>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Show>
      </SettingsCard>

      <AIProviderDialog
        open={providerDialogOpen()} onOpenChange={(open) => { if (!open) closeAIProviderDialog(); }}
        title={providerDialogMode() === 'create' ? i18n.t('flowerSettings.addProviderDialogTitle') : i18n.t('flowerSettings.editProviderDialogTitle')}
        provider={providerDialogProvider()}
        canInteract={ctx.canInteract()} canAdmin={ctx.canAdmin()}
        aiSaving={saving()} disableAISaving={disableAISaving()}
        keySet={!!providerKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        keyDraft={providerKeyDraft()?.[String(providerDialogProvider()?.id ?? '').trim()] ?? ''}
        keySaving={!!providerKeySaving()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        webSearchKeySet={!!webSearchKeySet()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        webSearchKeyDraft={webSearchKeyDraft()?.[String(providerDialogProvider()?.id ?? '').trim()] ?? ''}
        webSearchKeySaving={!!webSearchKeySaving()?.[String(providerDialogProvider()?.id ?? '').trim()]}
        recommendedModels={[]}
        onConfirm={confirmAIProviderDialog}
        onChangeName={(v) => updateAIProviderDialogDraft((c) => ({ ...c, name: v }))}
        onChangeType={(nextType) => {
          const nextPreset = providerPresetForType(nextType);
          const nextPresetModels = recommendedModelsForProviderType(nextType).map((m) => ({
            model_name: m.model_name, context_window: normalizePositiveInteger(m.context_window),
            max_output_tokens: normalizePositiveInteger(m.max_output_tokens),
            effective_context_window_percent: normalizeEffectiveContextPercent(m.effective_context_window_percent),
            input_modalities: normalizeInputModalities(m.input_modalities),
          }));
          updateAIProviderDialogDraft((c) => c.type === nextType ? c : {
            ...c, name: providerUsesCustomConnectionName(nextType) ? nextPreset.name : providerTypeLabel(nextType),
            type: nextType, base_url: defaultBaseURLForProviderType(nextType),
            web_search: normalizeAIProviderWebSearchForType(nextType, nextPreset.web_search),
            models: nextPresetModels.length > 0 ? [nextPresetModels[0]] : [],
          });
        }}
        onChangeBaseURL={(v) => updateAIProviderDialogDraft((c) => ({ ...c, base_url: v }))}
        onChangeKeyDraft={(v) => { const id = String(providerDialogProvider()?.id ?? '').trim(); if (id) setProviderKeyDraft((prev) => ({ ...prev, [id]: v })); }}
        onChangeWebSearchMode={(mode) => { updateAIProviderDialogDraft((c) => ({ ...c, web_search: normalizeAIProviderWebSearchForType(c.type, mode) })); }}
        onChangeWebSearchKeyDraft={(v) => { const id = String(providerDialogProvider()?.id ?? '').trim(); if (id) setWebSearchKeyDraft((prev) => ({ ...prev, [id]: v })); }}
        onApplyAllPresets={() => {}}
        onAddSelectedPreset={(_) => {}}
        onRemoveRecommendedPreset={(_) => {}}
        onAddCustomModel={(modelName) => {
          const name = String(modelName ?? '').trim();
          if (!name) return;
          updateAIProviderDialogDraft((c) => ({ ...c, models: normalizeProviderModelRows(c.type, [...(Array.isArray(c.models) ? c.models : []), { model_name: name, context_window: defaultContextWindowForProviderType(c.type), input_modalities: ['text'] }]) }));
        }}
        onChangeModelName={(i, v) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).map((m, mi) => mi === i ? { ...m, model_name: v } : m) }))}
        onChangeModelNumber={() => { /* simplified */ }}
        onChangeModelImageInput={(i, enabled) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).map((m, mi) => mi === i ? { ...m, input_modalities: enabled ? ['text', 'image'] : ['text'] } : m) }))}
        onRemoveModel={(i) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).filter((_, mi) => mi !== i) }))}
      />

      <ConfirmDialog open={disableAIOpen()} onOpenChange={(open) => setDisableAIOpen(open)}
        title={i18n.t('flowerSettings.disableDialogTitle')} confirmText={i18n.t('flowerSettings.disableConfirm')} variant="destructive" loading={disableAISaving()} onConfirm={() => void disableAI()}>
        <div class="space-y-3">
          <p class="text-sm">{i18n.t('flowerSettings.disableQuestion')}</p>
          <p class="text-xs text-muted-foreground">
            {i18n.t('flowerSettings.disableConfigNote', { section: 'ai' })}
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}
