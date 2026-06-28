import type { Component } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Bot, ChevronDown, ChevronLeft, Pencil, Plus, Shield, Trash, Zap } from '@floegence/floe-webapp-core/icons';
import { Button, Select } from '@floegence/floe-webapp-core/ui';

import type { FlowerSettingsCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type {
  FlowerProviderDraft,
  FlowerPermissionType,
  FlowerReasoningSelection,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerWebSearchMode,
} from '../contracts/flowerSurfaceContracts';
import {
  FlowerProviderBrandIcon,
  defaultBaseURLForFlowerProviderType,
  defaultFlowerContextWindowForProviderType,
  flowerModelID,
  flowerModelSupportsImage,
  flowerProviderNeedsWebSearchConfig,
  flowerProviderPresetForType,
  flowerProviderTypeLabel,
  flowerProviderTypeRequiresBaseURL,
  flowerProviderUsesCustomName,
  formatFlowerTokenCount,
  normalizeFlowerEffectiveContextPercent,
  normalizeFlowerInputModalities,
  normalizeFlowerPositiveInteger,
  recommendedModelsForFlowerProviderType,
} from './providerCatalog';
import { FlowerProviderDialog, type FlowerProviderDialogMode } from './FlowerProviderDialog';
import { FlowerAutoSaveIndicator, FlowerSubSectionHeader } from './FlowerSettingsPrimitives';
import type { FlowerProviderTypeLabels } from './providerTypeLabels';
import { FlowerReasoningControl } from '../ReasoningControl';
import { reasoningCapabilitySupportsControl } from '../reasoning';

type FlowerModelOption = Readonly<{
  id: string;
  label: string;
  supportsImageInput: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  provider_type: FlowerProviderDraft['type'];
}>;

type FlowerSettingsDraftBuildResult =
  | Readonly<{ ok: true; draft: FlowerSettingsDraft; current_model_id: string; providers: readonly FlowerProviderDraft[] }>
  | Readonly<{ ok: false; error: string }>;

const AUTO_SAVE_DELAY_MS = 700;
const PERMISSION_TYPE_ORDER: readonly FlowerPermissionType[] = ['readonly', 'approval_required', 'full_access'];

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

let flowerProviderIDSequence = 0;

function newProviderID(): string {
  const cryptoUUID = globalThis.crypto?.randomUUID?.();
  if (cryptoUUID) return `prov_${cryptoUUID}`;
  flowerProviderIDSequence += 1;
  return `prov_local_${flowerProviderIDSequence}`;
}

function cloneProviderForForm(provider: FlowerSettingsSnapshot['config']['providers'][number]): FlowerProviderDraft {
  return {
    ...provider,
    models: provider.models.map((model) => ({
      ...model,
      input_modalities: model.input_modalities ? [...model.input_modalities] : undefined,
    })),
  };
}

function newProviderDraft(): FlowerProviderDraft {
  const type: FlowerProviderDraft['type'] = 'openai';
  const preset = flowerProviderPresetForType(type);
  const firstModel = recommendedModelsForFlowerProviderType(type)[0];
  return {
    id: newProviderID(),
    name: flowerProviderUsesCustomName(type) ? preset.name : flowerProviderTypeLabel(type),
    type,
    base_url: defaultBaseURLForFlowerProviderType(type),
    models: firstModel ? [{ ...firstModel }] : [],
  };
}

function providerDisplayName(
  provider: Pick<FlowerProviderDraft, 'id' | 'name' | 'type'>,
  labels?: FlowerProviderTypeLabels,
): string {
  const name = trim(provider.name);
  if (flowerProviderUsesCustomName(provider.type)) return name || provider.id || labels?.[provider.type] || flowerProviderTypeLabel(provider.type);
  return labels?.[provider.type] || flowerProviderTypeLabel(provider.type);
}

function collectModelOptions(providers: readonly FlowerProviderDraft[], labels?: FlowerProviderTypeLabels): readonly FlowerModelOption[] {
  return providers.flatMap((provider) => provider.models
    .map((model) => {
      const modelName = trim(model.model_name);
      const providerID = trim(provider.id);
      if (!providerID || !modelName) return null;
      return {
        id: flowerModelID(providerID, modelName),
        label: `${providerDisplayName(provider, labels)} / ${modelName}`,
        supportsImageInput: flowerModelSupportsImage(model.input_modalities),
        ...(model.context_window != null ? { contextWindow: model.context_window } : {}),
        ...(model.max_output_tokens != null ? { maxOutputTokens: model.max_output_tokens } : {}),
        provider_type: provider.type,
      };
    })
    .filter((item): item is FlowerModelOption => Boolean(item)));
}

function providerSecretConfigured(snapshot: FlowerSettingsSnapshot | null, providerID: string): boolean {
  return snapshot?.provider_secrets.some((secret) => secret.provider_id === providerID && secret.provider_api_key_configured) ?? false;
}

function providerWebSearchSecretConfigured(snapshot: FlowerSettingsSnapshot | null, providerID: string): boolean {
  return snapshot?.provider_secrets.some((secret) => secret.provider_id === providerID && secret.web_search_api_key_configured) ?? false;
}

function currentModelExists(currentModelID: string, providers: readonly FlowerProviderDraft[]): boolean {
  const options = collectModelOptions(providers);
  return options.some((option) => option.id === currentModelID);
}

function normalizeSecretPatch(value: string | null | undefined): string | null | undefined {
  if (value === null) return null;
  const text = trim(value);
  return text ? text : undefined;
}

function providerWebSearchLabel(
  provider: FlowerProviderDraft,
  snapshot: FlowerSettingsSnapshot | null,
  copy: FlowerSettingsCopy,
): Readonly<{ supported: boolean; enabled: boolean; label: string }> {
  const type = provider.type;
  const builtIn = copy.builtInWebSearch[type] ?? '';
  if (builtIn) return { supported: true, enabled: true, label: builtIn };
  if (!flowerProviderNeedsWebSearchConfig(provider.type)) return { supported: false, enabled: false, label: copy.webSearchNotSupported };
  switch (provider.web_search?.mode ?? 'disabled') {
    case 'openai_builtin':
      return { supported: true, enabled: true, label: copy.openAIBuiltIn };
    case 'brave':
      return providerWebSearchSecretConfigured(snapshot, provider.id) || Boolean(trim(provider.web_search_api_key))
        ? { supported: true, enabled: true, label: copy.braveSearch }
        : { supported: true, enabled: false, label: copy.needsBraveKey };
    default:
      return { supported: true, enabled: false, label: copy.webSearchDisabled };
  }
}

function normalizeProviderForSave(provider: FlowerProviderDraft): FlowerProviderDraft {
  const webSearchMode = (provider.web_search?.mode ?? 'disabled') as FlowerWebSearchMode;
  const providerKey = normalizeSecretPatch(provider.provider_api_key);
  const webSearchKey = webSearchMode === 'brave'
    ? normalizeSecretPatch(provider.web_search_api_key)
    : null;
  return {
    id: trim(provider.id),
    name: flowerProviderUsesCustomName(provider.type) ? trim(provider.name) : flowerProviderTypeLabel(provider.type),
    type: provider.type,
    base_url: trim(provider.base_url),
    web_search: flowerProviderNeedsWebSearchConfig(provider.type) ? { mode: webSearchMode } : undefined,
    ...(providerKey !== undefined ? { provider_api_key: providerKey } : {}),
    ...(webSearchKey !== undefined ? { web_search_api_key: webSearchKey } : {}),
    models: provider.models.map((model) => ({
      model_name: trim(model.model_name),
      ...(normalizeFlowerPositiveInteger(model.context_window) ?? defaultFlowerContextWindowForProviderType(provider.type) ? { context_window: normalizeFlowerPositiveInteger(model.context_window) ?? defaultFlowerContextWindowForProviderType(provider.type) } : {}),
      ...(normalizeFlowerPositiveInteger(model.max_output_tokens) ? { max_output_tokens: normalizeFlowerPositiveInteger(model.max_output_tokens) } : {}),
      ...(normalizeFlowerEffectiveContextPercent(model.effective_context_window_percent) ? { effective_context_window_percent: normalizeFlowerEffectiveContextPercent(model.effective_context_window_percent) } : {}),
      input_modalities: normalizeFlowerInputModalities(model.input_modalities),
      ...(model.reasoning_capability ? { reasoning_capability: model.reasoning_capability } : {}),
      ...(model.default_reasoning_selection ? { default_reasoning_selection: model.default_reasoning_selection } : {}),
    })),
  };
}

export type FlowerSettingsSurfaceProps = Readonly<{
  snapshot: FlowerSettingsSnapshot | null;
  onSaveDraft: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
  saveError?: string;
  savedAt?: number | null;
  saving?: boolean;
  copy?: FlowerSettingsCopy;
  onBackToChat?: () => void;
}>;

export const FlowerSettingsSurface: Component<FlowerSettingsSurfaceProps> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.settings;
  const [providers, setProviders] = createSignal<readonly FlowerProviderDraft[]>([]);
  const [currentModelID, setCurrentModelID] = createSignal('');
  const [permissionType, setPermissionType] = createSignal<FlowerPermissionType>('approval_required');
  const [defaultTimeoutMS, setDefaultTimeoutMS] = createSignal('120000');
  const [maxTimeoutMS, setMaxTimeoutMS] = createSignal('600000');
  const [localError, setLocalError] = createSignal('');
  const [dirty, setDirty] = createSignal(false);
  const [providerDialogOpen, setProviderDialogOpen] = createSignal(false);
  const [providerDialogIndex, setProviderDialogIndex] = createSignal<number | null>(null);
  const [providerDialogMode, setProviderDialogMode] = createSignal<FlowerProviderDialogMode>('create');
  const [providerDialogProvider, setProviderDialogProvider] = createSignal<FlowerProviderDraft | null>(null);
  const [providerDialogError, setProviderDialogError] = createSignal('');
  const permissionButtonRefs = new Map<FlowerPermissionType, HTMLButtonElement>();

  createEffect(() => {
    const snapshot = props.snapshot;
    if (!snapshot) return;
    const rows = snapshot.config.providers.map(cloneProviderForForm);
    setProviders(rows);
    setCurrentModelID(trim(snapshot.config.current_model_id));
    setPermissionType(snapshot.config.permission_type ?? 'approval_required');
    setDefaultTimeoutMS(String(snapshot.config.terminal_exec_policy.default_timeout_ms));
    setMaxTimeoutMS(String(snapshot.config.terminal_exec_policy.max_timeout_ms));
    setLocalError('');
    setDirty(false);
  });

  const modelOptions = createMemo(() => collectModelOptions(providers(), copy().providerTypeLabels));
  const activeModelOption = createMemo(() => modelOptions().find((option) => option.id === currentModelID()) ?? null);
  const modelSelectOptions = createMemo(() => modelOptions().map((o) => ({ value: o.id, label: o.label })));
  const activeProviderModel = createMemo(() => {
    const current = trim(currentModelID());
    const [providerID, ...modelParts] = current.split('/');
    const modelName = modelParts.join('/');
    if (!providerID || !modelName) return null;
    const provider = providers().find((item) => trim(item.id) === providerID);
    return provider?.models.find((model) => trim(model.model_name) === modelName) ?? null;
  });
  const normalizedProviders = createMemo(() => providers().map(normalizeProviderForSave));
  const externalModelSource = createMemo(() => {
    const source = props.snapshot?.model_source ?? null;
    return source?.kind === 'desktop_model_source' ? source : null;
  });
  const managedByLocalAIProfile = createMemo(() => externalModelSource() !== null);
  const markDirty = () => setDirty(true);
  const focusPermissionType = (kind: FlowerPermissionType) => {
    queueMicrotask(() => permissionButtonRefs.get(kind)?.focus());
  };
  const choosePermissionType = (kind: FlowerPermissionType, focus = false) => {
    setPermissionType(kind);
    markDirty();
    if (focus) focusPermissionType(kind);
  };
  const movePermissionType = (delta: number) => {
    const currentIndex = Math.max(0, PERMISSION_TYPE_ORDER.indexOf(permissionType()));
    const nextIndex = (currentIndex + delta + PERMISSION_TYPE_ORDER.length) % PERMISSION_TYPE_ORDER.length;
    choosePermissionType(PERMISSION_TYPE_ORDER[nextIndex], true);
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

  const updateProviders = (next: readonly FlowerProviderDraft[]) => {
    setProviders(next);
    setDirty(true);
  };

  const updateCurrentModelReasoning = (selection: FlowerReasoningSelection | undefined) => {
    const current = trim(currentModelID());
    const [providerID, ...modelParts] = current.split('/');
    const modelName = modelParts.join('/');
    if (!providerID || !modelName) return;
    updateProviders(providers().map((provider) => {
      if (trim(provider.id) !== providerID) return provider;
      return {
        ...provider,
        models: provider.models.map((model) => (
          trim(model.model_name) === modelName
            ? { ...model, default_reasoning_selection: selection }
            : model
        )),
      };
    }));
  };

  const openAddProviderDialog = () => {
    setProviderDialogMode('create');
    setProviderDialogIndex(null);
    setProviderDialogProvider(newProviderDraft());
    setProviderDialogError('');
    setProviderDialogOpen(true);
  };

  const openEditProviderDialog = (index: number) => {
    const provider = providers()[index];
    if (!provider) return;
    setProviderDialogMode('edit');
    setProviderDialogIndex(index);
    setProviderDialogProvider({
      ...provider,
      models: provider.models.map((model) => ({ ...model, input_modalities: model.input_modalities ? [...model.input_modalities] : undefined })),
    });
    setProviderDialogError('');
    setProviderDialogOpen(true);
  };

  const buildSettingsDraft = (
    sourceProviders: readonly FlowerProviderDraft[] = providers(),
    sourceCurrentModelID = currentModelID(),
  ): FlowerSettingsDraftBuildResult => {
    const cleanProviders = sourceProviders.map(normalizeProviderForSave);
    const providerIDs = new Set<string>();
    const availableModelIDs = new Set<string>();
    for (const provider of cleanProviders) {
      if (!provider.id) {
        return { ok: false, error: copy().validation.providerIDRequired };
      }
      if (provider.id.includes('/')) {
        return { ok: false, error: copy().validation.providerIDNoSlash };
      }
      if (providerIDs.has(provider.id)) {
        return { ok: false, error: copy().validation.duplicateProviderID(provider.id) };
      }
      providerIDs.add(provider.id);
      if (flowerProviderTypeRequiresBaseURL(provider.type) && !trim(provider.base_url)) {
        return { ok: false, error: copy().validation.providerRequiresBaseURL(providerDisplayName(provider, copy().providerTypeLabels)) };
      }
      if (trim(provider.base_url)) {
        let parsedURL: URL;
        try {
          parsedURL = new URL(trim(provider.base_url));
        } catch {
          return { ok: false, error: copy().validation.providerInvalidBaseURL(providerDisplayName(provider, copy().providerTypeLabels)) };
        }
        if (parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:') {
          return { ok: false, error: copy().validation.providerBaseURLProtocol(providerDisplayName(provider, copy().providerTypeLabels)) };
        }
      }
      if (provider.models.length === 0) {
        return { ok: false, error: copy().validation.providerNeedsModel(providerDisplayName(provider, copy().providerTypeLabels)) };
      }
      const modelNames = new Set<string>();
      for (const model of provider.models) {
        const modelName = trim(model.model_name);
        if (!modelName) {
          return { ok: false, error: copy().validation.providerUnnamedModel(providerDisplayName(provider, copy().providerTypeLabels)) };
        }
        if (modelName.includes('/')) {
          return { ok: false, error: copy().validation.modelNameNoSlash };
        }
        if (modelNames.has(modelName)) {
          return { ok: false, error: copy().validation.duplicateModel(providerDisplayName(provider, copy().providerTypeLabels), modelName) };
        }
        if ((provider.type === 'openai_compatible' || provider.type === 'openrouter' || provider.type === 'xai' || provider.type === 'groq' || provider.type === 'ollama') && !model.context_window && !defaultFlowerContextWindowForProviderType(provider.type)) {
          return { ok: false, error: copy().validation.modelNeedsContextWindow(model.model_name) };
        }
        modelNames.add(modelName);
        availableModelIDs.add(flowerModelID(provider.id, modelName));
      }
    }
    const current = trim(sourceCurrentModelID);
    if (cleanProviders.length > 0 && !current) {
      return { ok: false, error: copy().validation.selectCurrentModel };
    }
    if (current && !availableModelIDs.has(current)) {
      return { ok: false, error: copy().validation.currentModelUnavailable(current) };
    }
    const defaultTimeout = normalizeFlowerPositiveInteger(defaultTimeoutMS());
    const maxTimeout = normalizeFlowerPositiveInteger(maxTimeoutMS());
    if (!defaultTimeout || !maxTimeout) {
      return { ok: false, error: copy().validation.terminalTimeoutPositive };
    }
    if (defaultTimeout > maxTimeout) {
      return { ok: false, error: copy().validation.terminalTimeoutOrder };
    }

    return {
      ok: true,
      current_model_id: current,
      providers: cleanProviders,
      draft: {
        config: {
          schema_version: 1,
          current_model_id: current,
          permission_type: permissionType(),
          terminal_exec_policy: {
            default_timeout_ms: defaultTimeout,
            max_timeout_ms: maxTimeout,
          },
          providers: cleanProviders,
        },
      },
    };
  };

  const saveBuiltDraft = async (result: FlowerSettingsDraftBuildResult): Promise<FlowerSettingsSnapshot | null> => {
    if (!result.ok) {
      setLocalError(result.error);
      return null;
    }
    setLocalError('');
    const saved = await props.onSaveDraft(result.draft);
    setDirty(false);
    return saved;
  };

  const confirmProviderDialog = async (draft: FlowerProviderDraft) => {
    setProviderDialogError('');
    const normalized = normalizeProviderForSave(draft);
    const index = providerDialogIndex();
    const next = index == null
      ? [...providers(), normalized]
      : providers().map((provider, itemIndex) => (itemIndex === index ? normalized : provider));
    const current = trim(currentModelID());
    const nextCurrent = currentModelExists(current, next)
      ? current
      : (!current && index == null ? flowerModelID(normalized.id, normalized.models[0]?.model_name ?? '') : current);
    const result = buildSettingsDraft(next, nextCurrent);
    if (!result.ok) {
      setLocalError(result.error);
      setProviderDialogError(result.error);
      return;
    }
    try {
      const saved = await saveBuiltDraft(result);
      if (!saved) return;
      const savedProviders = saved.config.providers.map(cloneProviderForForm);
      setProviders(savedProviders);
      setCurrentModelID(trim(saved.config.current_model_id));
      setProviderDialogOpen(false);
      setProviderDialogProvider(null);
      setProviderDialogIndex(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProviderDialogError(message);
    }
  };

  const removeProvider = (index: number) => {
    const next = providers().filter((_, itemIndex) => itemIndex !== index);
    updateProviders(next);
  };

  const autosaveFingerprint = createMemo(() => JSON.stringify({
    current_model_id: currentModelID(),
    permission_type: permissionType(),
    default_timeout_ms: defaultTimeoutMS(),
    max_timeout_ms: maxTimeoutMS(),
    providers: normalizedProviders(),
  }));
  let autosaveTimer: number | undefined;
  const clearAutosaveTimer = () => {
    if (autosaveTimer == null) return;
    window.clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
  };
  createEffect(() => {
    autosaveFingerprint();
    if (managedByLocalAIProfile() || !dirty() || props.saving || providerDialogOpen()) {
      clearAutosaveTimer();
      return;
    }
    clearAutosaveTimer();
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = undefined;
      void saveBuiltDraft(buildSettingsDraft(normalizedProviders())).catch((error: unknown) => {
        setLocalError(error instanceof Error ? error.message : String(error));
      });
    }, AUTO_SAVE_DELAY_MS);
  });
  onCleanup(clearAutosaveTimer);

  return (
    <>
      <div class="flower-panel flower-scroll flower-settings-surface">
        <div class="flower-settings-frame">
          <header class="flower-settings-title-row">
            <div class="flex min-w-0 items-start gap-2.5">
              <Show when={props.onBackToChat}>
                <button
                  type="button"
                  class="flower-header-icon-button flower-settings-back-button mt-0.5"
                  aria-label={copy().backToChat}
                  title={copy().backToChat}
                  onClick={() => props.onBackToChat?.()}
                >
                  <ChevronLeft class="h-4 w-4" />
                </button>
              </Show>
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <Zap class="h-4 w-4 text-primary" />
                  <h2 class="truncate text-base font-semibold text-foreground">{copy().title}</h2>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {managedByLocalAIProfile() ? copy().managedByLocalAIProfileOpenLocal : copy().description}
                </p>
              </div>
            </div>
            <div class="flower-settings-title-feedback" aria-live="polite">
              <FlowerAutoSaveIndicator dirty={dirty()} copy={copy().autoSave} saving={props.saving} error={localError() || props.saveError} savedAt={props.savedAt} />
            </div>
          </header>

          <Show when={managedByLocalAIProfile()}>
            <section class="flower-settings-section flower-settings-managed-source">
              <div class="flower-settings-managed-source-header">
                <div>
                  <div class="text-sm font-semibold text-foreground">{copy().managedByLocalAIProfileTitle}</div>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{copy().managedByLocalAIProfileDescription}</p>
                </div>
                <span class={cn('flower-settings-dot-pill', externalModelSource()?.ready && 'flower-settings-dot-pill-active')}>
                  {externalModelSource()?.ready ? copy().managedByLocalAIProfileReady : copy().managedByLocalAIProfileNeedsKey}
                </span>
              </div>
              <div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Show when={externalModelSource()?.model_count != null}>
                  <span class="flower-settings-dot-pill flower-settings-dot-pill-active">
                    {copy().managedByLocalAIProfileModelCount(externalModelSource()?.model_count ?? 0)}
                  </span>
                </Show>
                <Show when={(externalModelSource()?.missing_key_provider_ids ?? []).length > 0}>
                  <span class="flower-settings-dot-pill">
                    {copy().managedByLocalAIProfileMissingKeys((externalModelSource()?.missing_key_provider_ids ?? []).join(', '))}
                  </span>
                </Show>
              </div>
              <p class="mt-3 text-xs leading-relaxed text-muted-foreground">{copy().managedByLocalAIProfileOpenLocal}</p>
            </section>
          </Show>

          <Show when={!managedByLocalAIProfile()}>
            <section class="flower-settings-current-model">
              <div class="flower-settings-current-model-icon">
                <Show when={activeModelOption()} fallback={<Bot class="h-6 w-6 text-muted-foreground" />}>
                  {(option) => <FlowerProviderBrandIcon type={option().provider_type} class="h-6 w-6" />}
                </Show>
              </div>
              <div class="flower-settings-current-model-body">
                <div class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{copy().currentModel}</div>
                <Show when={modelOptions().length > 0} fallback={<div class="mt-1 text-base font-semibold text-muted-foreground">{copy().noModelSelected}</div>}>
                  <div>
                      <Select
                        value={currentModelID()}
                        options={modelSelectOptions()}
                        onChange={(value) => { setCurrentModelID(trim(value)); markDirty(); }}
                        placeholder={copy().selectModelPlaceholder}
                        disabled={modelOptions().length === 0 || props.saving}
                        class="mt-0.5 w-full max-w-[24rem]"
                      />
                      <div class="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span class="flower-settings-dot-pill flower-settings-dot-pill-active">{copy().text}</span>
                        <Show when={activeModelOption()?.supportsImageInput}>
                          <span class="flower-settings-dot-pill flower-settings-dot-pill-active">{copy().imageInput}</span>
                        </Show>
                        <Show when={activeModelOption()?.contextWindow}>
                          <span class="flower-settings-dot-pill">{formatFlowerTokenCount(activeModelOption()?.contextWindow)} context</span>
                        </Show>
                        <Show when={activeModelOption()?.maxOutputTokens}>
                          <span class="flower-settings-dot-pill">{formatFlowerTokenCount(activeModelOption()?.maxOutputTokens)} output</span>
                        </Show>
                      </div>
                      <Show when={activeProviderModel()?.reasoning_capability && reasoningCapabilitySupportsControl(activeProviderModel()?.reasoning_capability)}>
                        <div class="mt-3">
                          <FlowerReasoningControl
                            capability={activeProviderModel()?.reasoning_capability}
                            selection={activeProviderModel()?.default_reasoning_selection}
                            label="Default reasoning"
                            onChange={updateCurrentModelReasoning}
                          />
                        </div>
                      </Show>
                  </div>
                </Show>
              </div>
            </section>

            <section class="flower-settings-section flower-settings-policy-section">
              <FlowerSubSectionHeader
                title={copy().defaultPermissionTitle}
                description={copy().defaultPermissionDescription}
              />
              <div class="flower-settings-permission-grid" role="radiogroup" aria-label={copy().defaultPermissionTitle}>
                <For each={PERMISSION_TYPE_ORDER}>
                  {(kind) => {
                    const item = () => copy().permissionTypes[kind];
                    const active = () => permissionType() === kind;
                    return (
                      <button
                        ref={(el) => { permissionButtonRefs.set(kind, el); }}
                        type="button"
                        class={cn('flower-settings-policy-card', active() && 'flower-settings-policy-card-active')}
                        role="radio"
                        aria-checked={active()}
                        tabIndex={active() ? 0 : -1}
                        onKeyDown={onPermissionTypeKeyDown}
                        onClick={() => choosePermissionType(kind)}
                      >
                        <span class="flower-settings-policy-card-row">
                          <span class="flower-settings-policy-card-icon"><Shield class="h-3.5 w-3.5" /></span>
                          <span class="flower-settings-policy-card-label">{item().label}</span>
                          <Show when={active()}>
                            <span class="flower-settings-policy-card-badge">{copy().defaultPermissionBadge ?? 'Default'}</span>
                          </Show>
                        </span>
                        <span class="flower-settings-policy-card-desc">{item().description}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </section>

            <section class="flower-settings-section flower-settings-providers-section">
              <FlowerSubSectionHeader
                title={copy().providersTitle}
                description={copy().providersDescription}
                actions={(
                  <Button size="sm" variant="default" icon={Plus} onClick={openAddProviderDialog}>
                    {copy().addProvider}
                  </Button>
                )}
              />
              <div class="flower-settings-provider-gallery">
                <For each={providers()} fallback={<div class="flower-settings-provider-empty">{copy().noProviders}</div>}>
                  {(provider, index) => {
                    const providerID = () => trim(provider.id);
                    const modelNames = () => provider.models.map((model) => trim(model.model_name)).filter(Boolean);
                    const hasImageInput = () => provider.models.some((model) => flowerModelSupportsImage(model.input_modalities));
                    const isDefault = () => currentModelID().startsWith(`${providerID()}/`);
                    const webSearch = () => providerWebSearchLabel(provider, props.snapshot, copy());
                    return (
                      <div
                        class={cn('flower-settings-provider-card', isDefault() && 'flower-settings-provider-card-active')}
                      >
                        <div class="flower-settings-provider-brand">
                          <FlowerProviderBrandIcon type={provider.type} class="h-5 w-5" />
                        </div>
                        <div class="flower-settings-provider-body">
                          <div class="flower-settings-provider-topline">
                            <div class="flower-settings-provider-title">
                              <span class="truncate text-sm font-semibold text-foreground">{providerDisplayName(provider, copy().providerTypeLabels)}</span>
                              <span class="text-[11px] text-muted-foreground">{copy().providerTypeLabels[provider.type]}</span>
                              <Show when={isDefault()}><span class="flex-shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">{copy().defaultProvider}</span></Show>
                            </div>
                            <div class="flower-settings-provider-actions">
                              <Button size="icon" variant="ghost" class="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={(event) => { event.stopPropagation(); openEditProviderDialog(index()); }} aria-label={copy().editProvider}>
                                <Pencil class="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" class="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={(event) => { event.stopPropagation(); removeProvider(index()); }} disabled={providers().length <= 1} aria-label={copy().removeProvider}>
                                <Trash class="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          <div class="mt-2 space-y-1.5">
                            <div class="flex items-center gap-2 text-xs">
                              <span class="w-16 flex-shrink-0 text-muted-foreground">{copy().apiKey}</span>
                              <span class={cn('flower-settings-dot-pill', (providerSecretConfigured(props.snapshot, provider.id) || trim(provider.provider_api_key)) && 'flower-settings-dot-pill-active')}>
                                {providerSecretConfigured(props.snapshot, provider.id) || trim(provider.provider_api_key) ? copy().ready : copy().needsKey}
                              </span>
                            </div>
                            <div class="flex items-start gap-2 text-xs">
                              <span class="w-16 flex-shrink-0 pt-0.5 text-muted-foreground">{copy().models}</span>
                              <div class="flex min-w-0 flex-wrap gap-1">
                                <For each={modelNames().slice(0, 3)}>
                                  {(name) => <code class={cn('flower-settings-model-code', currentModelID() === `${providerID()}/${name}` && 'flower-settings-model-code-active')}>{name}</code>}
                                </For>
                                <Show when={modelNames().length > 3}><span class="text-[11px] text-muted-foreground">+{modelNames().length - 3}</span></Show>
                              </div>
                            </div>
                            <Show when={webSearch().supported}>
                              <div class="flex items-center gap-2 text-xs">
                                <span class="w-16 flex-shrink-0 text-muted-foreground">{copy().web}</span>
                                <span class={cn('flower-settings-dot-pill', webSearch().enabled && 'flower-settings-dot-pill-active')}>{webSearch().label}</span>
                              </div>
                            </Show>
                            <Show when={hasImageInput()}>
                              <div class="flex items-center gap-2 text-xs">
                                <span class="w-16 flex-shrink-0 text-muted-foreground">{copy().vision}</span>
                                <span class="flower-settings-dot-pill flower-settings-dot-pill-active">{copy().imageInput}</span>
                              </div>
                            </Show>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </section>

            <section class="flower-settings-section flower-settings-terminal-section">
              <FlowerSubSectionHeader title={copy().terminalLimitsTitle} description={copy().terminalLimitsDescription} />
              <div class="flower-settings-terminal-grid">
                <label class="flower-settings-terminal-row">
                  <span class="flower-settings-terminal-label">{copy().defaultTimeout}</span>
                  <input class="flower-settings-input" inputMode="numeric" value={defaultTimeoutMS()} onInput={(event) => { setDefaultTimeoutMS(event.currentTarget.value); markDirty(); }} />
                </label>
                <label class="flower-settings-terminal-row">
                  <span class="flower-settings-terminal-label">{copy().maximumTimeout}</span>
                  <input class="flower-settings-input" inputMode="numeric" value={maxTimeoutMS()} onInput={(event) => { setMaxTimeoutMS(event.currentTarget.value); markDirty(); }} />
                </label>
              </div>
            </section>

          </Show>
          <Show when={localError() || props.saveError}>
            <div role="alert" class="flower-settings-error-strip">{localError() || props.saveError}</div>
          </Show>
        </div>
      </div>

      <FlowerProviderDialog
        open={providerDialogOpen()}
        mode={providerDialogMode()}
        provider={providerDialogProvider()}
        copy={copy().dialog}
        keyConfigured={providerSecretConfigured(props.snapshot, providerDialogProvider()?.id ?? '')}
        webSearchKeyConfigured={providerWebSearchSecretConfigured(props.snapshot, providerDialogProvider()?.id ?? '')}
        error={providerDialogError()}
        saving={props.saving}
        onOpenChange={(open) => setProviderDialogOpen(open)}
        onConfirm={(draft) => void confirmProviderDialog(draft)}
      />
    </>
  );
};
