import { computerUseEnUS, type FlowerComputerCopy } from '../computerUseCopy';
import { secureRandomUUID } from '@floegence/floe-webapp-core';
import { flowerProviderSearchSummary } from '../webSearchCapability';
import { FlowerIcon } from '../icons/FlowerIcon';
import { FlowerProviderBrandIcon } from './FlowerProviderBrandIcon';
import { flowerModelSupportsImage, formatFlowerTokenCount } from '../flowerModelLabel';
import type { FlowerModelCatalogDiscovery } from '../contracts/flowerSurfaceContracts';
import type { Component } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Check, ChevronDown, ChevronLeft, Pencil, Plus, Trash } from '@floegence/floe-webapp-core/icons';
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
  defaultBaseURLForFlowerProviderType,
  defaultFlowerContextWindowForProviderType,
  flowerModelID,
  flowerProviderNeedsWebSearchConfig,
  flowerProviderPresetForType,
  flowerProviderTypeLabel,
  flowerProviderTypeRequiresBaseURL,
  flowerProviderUsesCustomName,
  normalizeFlowerEffectiveContextPercent,
  normalizeFlowerInputModalities,
  normalizeFlowerPositiveInteger,
} from './providerCatalog';
import { defaultFlowerProviderModels } from './modelSelection';
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


function newProviderID(): string {
  return `prov_${secureRandomUUID()}`;
}

function cloneProviderForForm(provider: NonNullable<FlowerSettingsSnapshot['model_profile']>['providers'][number]): FlowerProviderDraft {
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

  return {
    id: newProviderID(),
    name: flowerProviderUsesCustomName(type) ? preset.name : flowerProviderTypeLabel(type),
    type,
    base_url: defaultBaseURLForFlowerProviderType(type),
    models: defaultFlowerProviderModels(type),
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
        label: `${providerDisplayName(provider, labels)} / ${model.display_name || model.wire_model_name || modelName}`,
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


function normalizeSecretPatch(value: string | null | undefined): string | null | undefined {
  if (value === null) return null;
  const text = trim(value);
  return text ? text : undefined;
}

function normalizeProviderForSave(provider: FlowerProviderDraft): FlowerProviderDraft {
  const webSearchMode = (provider.web_search?.mode ?? 'disabled') as FlowerWebSearchMode;
  const providerKey = normalizeSecretPatch(provider.provider_api_key);
  const webSearchKey = webSearchMode === 'brave'
    ? normalizeSecretPatch(provider.web_search_api_key)
    : null;
  return {
    model_selection: provider.model_selection,
    catalog_models: provider.catalog_models,
    id: trim(provider.id),
    name: flowerProviderUsesCustomName(provider.type) ? trim(provider.name) : flowerProviderTypeLabel(provider.type),
    type: provider.type,
    base_url: trim(provider.base_url),
    web_search: flowerProviderNeedsWebSearchConfig(provider.type) ? { mode: webSearchMode } : undefined,
    ...(providerKey !== undefined ? { provider_api_key: providerKey } : {}),
    ...(webSearchKey !== undefined ? { web_search_api_key: webSearchKey } : {}),
    models: provider.models.map((model) => ({
      model_name: trim(model.model_name),
      wire_model_name: model.wire_model_name, display_name: model.display_name, status: model.status,
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
  onDiscoverModels?: FlowerModelCatalogDiscovery;
  snapshot: FlowerSettingsSnapshot | null;
  onSaveDefaultPermission: (permissionType: FlowerPermissionType) => Promise<FlowerSettingsSnapshot>;
  onSaveComputerUseEnabled?: (enabled: boolean) => Promise<FlowerSettingsSnapshot>;
  onOpenComputerSettings?: () => void;
  computerCopy?: FlowerComputerCopy;
  onSaveModelProfile: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
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
  const [confirmedPermissionType, setConfirmedPermissionType] = createSignal<FlowerPermissionType>('approval_required');
  const [permissionDirty, setPermissionDirty] = createSignal(false);
  const [permissionSaving, setPermissionSaving] = createSignal(false);
  const [permissionError, setPermissionError] = createSignal('');
  const [permissionSavedAt, setPermissionSavedAt] = createSignal<number | null>(null);
  const [computerUseEnabled, setComputerUseEnabled] = createSignal(true);
  const [computerUseSaving, setComputerUseSaving] = createSignal(false);
  const [computerUseError, setComputerUseError] = createSignal('');
  const [computerUseSavedAt, setComputerUseSavedAt] = createSignal<number | null>(null);
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
    const rows = (snapshot.model_profile?.providers ?? []).map(cloneProviderForForm);
    setProviders(rows);
    setCurrentModelID(trim(snapshot.model_profile?.current_model_id));
    const savedPermission = snapshot.defaults.permission_type ?? 'approval_required';
    setConfirmedPermissionType(savedPermission);
    if (!permissionDirty() && !permissionSaving()) setPermissionType(savedPermission);
    if (!computerUseSaving()) setComputerUseEnabled(snapshot.defaults.computer_use_enabled !== false);
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
  const markDirty = () => setDirty(true);
  const focusPermissionType = (kind: FlowerPermissionType) => {
    queueMicrotask(() => permissionButtonRefs.get(kind)?.focus());
  };
  const choosePermissionType = (kind: FlowerPermissionType, focus = false) => {
    setPermissionType(kind);
    setPermissionDirty(kind !== confirmedPermissionType());
    setPermissionError('');
    if (focus) focusPermissionType(kind);
  };
  const saveComputerUseEnabled = async (enabled: boolean) => {
    if (!props.onSaveComputerUseEnabled || computerUseSaving()) return;
    const previous = computerUseEnabled();
    setComputerUseEnabled(enabled);
    setComputerUseSaving(true);
    setComputerUseError('');
    try {
      await props.onSaveComputerUseEnabled(enabled);
      setComputerUseSavedAt(Date.now());
    } catch (error) {
      setComputerUseEnabled(previous);
      setComputerUseError(error instanceof Error ? error.message : String(error));
    } finally {
      setComputerUseSaving(false);
    }
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
      if (provider.models.length === 0 && !provider.model_selection) {
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
    if (current && !availableModelIDs.has(current) && !cleanProviders.some((provider) => provider.model_selection && current.startsWith(`${provider.id}/`))) {
      return { ok: false, error: copy().validation.currentModelUnavailable(current) };
    }
    return {
      ok: true,
      current_model_id: current,
      providers: cleanProviders,
      draft: {
        model_profile: {
          schema_version: 1,
          current_model_id: current,
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
    const saved = await props.onSaveModelProfile(result.draft);
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
    const nextCurrent = current || (index == null && normalized.models.length > 0 ? flowerModelID(normalized.id, normalized.models[0].model_name) : '');
    const result = buildSettingsDraft(next, nextCurrent);
    if (!result.ok) {
      setProviderDialogError(result.error);
      return;
    }
    try {
      const saved = await saveBuiltDraft(result);
      if (!saved) return;
      const savedProviders = (saved.model_profile?.providers ?? []).map(cloneProviderForForm);
      setProviders(savedProviders);
      setCurrentModelID(trim(saved.model_profile?.current_model_id));
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
    if (!dirty() || props.saving || providerDialogOpen()) {
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

  let permissionAutosaveTimer: number | undefined;
  const clearPermissionAutosaveTimer = () => {
    if (permissionAutosaveTimer == null) return;
    window.clearTimeout(permissionAutosaveTimer);
    permissionAutosaveTimer = undefined;
  };
  const savePendingPermission = async () => {
    if (permissionSaving()) return;
    const target = permissionType();
    if (target === confirmedPermissionType()) {
      setPermissionDirty(false);
      return;
    }
    setPermissionSaving(true);
    setPermissionError('');
    try {
      const saved = await props.onSaveDefaultPermission(target);
      const confirmed = saved.defaults.permission_type;
      setConfirmedPermissionType(confirmed);
      setPermissionSavedAt(Date.now());
      if (permissionType() === target) {
        setPermissionType(confirmed);
        setPermissionDirty(false);
      } else {
        setPermissionDirty(permissionType() !== confirmed);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPermissionError(message);
      if (permissionType() === target) {
        setPermissionType(confirmedPermissionType());
        setPermissionDirty(false);
      }
    } finally {
      setPermissionSaving(false);
      if (permissionType() !== confirmedPermissionType()) {
        permissionAutosaveTimer = window.setTimeout(() => {
          permissionAutosaveTimer = undefined;
          void savePendingPermission();
        }, 0);
      }
    }
  };
  createEffect(() => {
    permissionType();
    clearPermissionAutosaveTimer();
    if (!permissionDirty() || permissionSaving()) return;
    permissionAutosaveTimer = window.setTimeout(() => {
      permissionAutosaveTimer = undefined;
      void savePendingPermission();
    }, AUTO_SAVE_DELAY_MS);
  });
  onCleanup(() => {
    clearAutosaveTimer();
    clearPermissionAutosaveTimer();
  });

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
                  <FlowerIcon class="h-5 w-5" />
                  <h2 class="flower-settings-title">{copy().title}</h2>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {copy().description}
                </p>
              </div>
            </div>
            <div class="flower-settings-title-feedback" aria-live="polite">
              <FlowerAutoSaveIndicator
                dirty={dirty() || permissionDirty()}
                copy={copy().autoSave}
                saving={props.saving || permissionSaving()}
                error={localError() || permissionError() || props.saveError}
                savedAt={Math.max(props.savedAt ?? 0, permissionSavedAt() ?? 0) || null}
              />
            </div>
          </header>

          <section class="flower-settings-section flower-settings-current-model" aria-label={copy().currentModel}>
            <FlowerSubSectionHeader title={copy().currentModel} />
            <div class="flower-settings-section-content">
              <Show when={currentModelID() && !activeModelOption()}>
                <p role="alert" class="mb-3 flower-body-copy text-destructive">{copy().dialog.catalog.unavailable}</p>
              </Show>
              <Show when={modelOptions().length > 0} fallback={<p class="flower-body-copy text-muted-foreground">{copy().noModelSelected}</p>}>
                <div class="flower-settings-model-field">
                  <Select
                    value={currentModelID()}
                    options={modelSelectOptions()}
                    onChange={(value) => { setCurrentModelID(trim(value)); markDirty(); }}
                    placeholder={copy().selectModelPlaceholder}
                    disabled={props.saving}
                    class="flower-settings-model-select w-full"
                  />
                </div>
                <div class="flower-settings-model-capabilities">
                  <span>{copy().text}</span>
                  <Show when={activeModelOption()?.supportsImageInput}><span>{copy().imageInput}</span></Show>
                </div>
                <dl class="flower-settings-model-limits">
                  <Show when={activeModelOption()?.contextWindow}>
                    <div><dt>{copy().dialog.contextWindow}</dt><dd>{formatFlowerTokenCount(activeModelOption()?.contextWindow)}</dd></div>
                  </Show>
                  <Show when={activeModelOption()?.maxOutputTokens}>
                    <div><dt>{copy().dialog.maxOutput}</dt><dd>{formatFlowerTokenCount(activeModelOption()?.maxOutputTokens)}</dd></div>
                  </Show>
                </dl>
                <Show when={activeProviderModel()?.reasoning_capability && reasoningCapabilitySupportsControl(activeProviderModel()?.reasoning_capability)}>
                  <div class="flower-settings-reasoning">
                    <FlowerReasoningControl
                      copy={copy().reasoningControl}
                      capability={activeProviderModel()?.reasoning_capability}
                      selection={activeProviderModel()?.default_reasoning_selection}
                      label={copy().reasoningControl.defaultLabel}
                      onChange={updateCurrentModelReasoning}
                    />
                  </div>
                </Show>
              </Show>
            </div>
          </section>

          <section class="flower-settings-section flower-settings-providers-section" aria-label={copy().providersTitle}>
            <FlowerSubSectionHeader title={copy().providersTitle} description={copy().providersDescription} />
            <div class="flower-settings-section-content">
              <div class="flower-settings-provider-gallery">
                <For each={providers()} fallback={<div class="flower-settings-provider-empty">{copy().noProviders}</div>}>
                  {(provider, index) => {
                    const providerID = () => trim(provider.id);
                    const modelNames = () => provider.models.map((model) => trim(model.model_name)).filter(Boolean);
                    const hasImageInput = () => provider.models.some((model) => flowerModelSupportsImage(model.input_modalities));
                    const isDefault = () => currentModelID().startsWith(`${providerID()}/`);
                    const keyReady = () => providerSecretConfigured(props.snapshot, provider.id) || !!trim(provider.provider_api_key);
                    const webSearch = () => flowerProviderSearchSummary(provider.models, copy().dialog.catalog);
                    return (
                      <div class="flower-settings-provider-card">
                        <div class="flower-settings-provider-brand"><FlowerProviderBrandIcon type={provider.type} class="h-6 w-6" /></div>
                        <div class="flower-settings-provider-body">
                          <div class="flower-settings-provider-topline">
                            <div class="flower-settings-provider-title">
                              <span class="truncate flower-body-copy font-semibold text-foreground">{providerDisplayName(provider, copy().providerTypeLabels)}</span>
                              <Show when={providerDisplayName(provider, copy().providerTypeLabels) !== copy().providerTypeLabels[provider.type]}>
                                <span class="text-xs text-muted-foreground">{copy().providerTypeLabels[provider.type]}</span>
                              </Show>
                              <Show when={isDefault()}><span class="flower-settings-provider-default">{copy().defaultProvider}</span></Show>
                            </div>
                            <div class="flower-settings-provider-actions">
                              <Button size="icon" variant="ghost" class="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={event => { event.stopPropagation(); openEditProviderDialog(index()); }} aria-label={copy().editProvider}>
                                <Pencil class="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" class="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={event => { event.stopPropagation(); removeProvider(index()); }} disabled={providers().length <= 1} aria-label={copy().removeProvider}>
                                <Trash class="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          <div class="flower-settings-provider-status">
                            <span>{copy().apiKey}</span>
                            <span class={cn('flower-settings-dot-pill', keyReady() && 'flower-settings-dot-pill-active')}>
                              {provider.type === 'ollama' ? copy().dialog.catalog.optionalKey : keyReady() ? copy().ready : copy().needsKey}
                            </span>
                          </div>
                          <details class="flower-settings-provider-details">
                            <summary><span>{copy().models}</span><span class="flower-settings-provider-count">{modelNames().length}</span><ChevronDown class="h-3.5 w-3.5" aria-hidden="true" /></summary>
                            <div class="flower-settings-provider-detail-body">
                              <ul class="flower-settings-provider-models">
                                <For each={modelNames()}>{name => <li><code>{name}</code></li>}</For>
                              </ul>
                              <div class="flower-settings-provider-fact">
                                <span class="flower-settings-provider-fact-label">{copy().web}</span>
                                <span>{webSearch().label}</span>
                              </div>
                              <Show when={hasImageInput()}>
                                <div class="flower-settings-provider-fact">
                                  <span class="flower-settings-provider-fact-label">{copy().vision}</span><span>{copy().imageInput}</span>
                                </div>
                              </Show>
                            </div>
                          </details>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
              <Button size="sm" variant="outline" icon={Plus} class="flower-settings-provider-add" onClick={openAddProviderDialog}>
                {copy().addProvider}
              </Button>
            </div>
          </section>

          <section class="flower-settings-section flower-settings-policy-section" aria-label={copy().defaultPermissionTitle}>
            <FlowerSubSectionHeader
              title={copy().defaultPermissionTitle}
              description={copy().defaultPermissionDescription}
              actions={<FlowerAutoSaveIndicator dirty={permissionDirty()} copy={copy().autoSave} saving={permissionSaving()} error={permissionError()} savedAt={permissionSavedAt()} />}
            />
            <div class="flower-settings-section-content">
              <div class="flower-settings-permission-grid" role="radiogroup" aria-label={copy().defaultPermissionTitle} aria-orientation="vertical">
                <For each={PERMISSION_TYPE_ORDER}>
                  {kind => {
                    const item = () => copy().permissionTypes[kind];
                    const active = () => permissionType() === kind;
                    return (
                      <button
                        ref={el => { permissionButtonRefs.set(kind, el); }}
                        type="button"
                        class={cn('flower-settings-policy-card', active() && 'flower-settings-policy-card-active')}
                        role="radio"
                        aria-checked={active()}
                        tabIndex={active() ? 0 : -1}
                        onKeyDown={onPermissionTypeKeyDown}
                        onClick={() => choosePermissionType(kind)}
                      >
                        <span class="flower-settings-policy-radio" aria-hidden="true"><Show when={active()}><Check class="h-3 w-3" /></Show></span>
                        <span class="flower-settings-policy-copy">
                          <span class="flower-settings-policy-card-label">{item().label}</span>
                          <span class="flower-settings-policy-card-desc">{item().description}</span>
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
              <Show when={permissionError()}><p role="alert" class="mt-3 text-xs text-destructive">{permissionError()}</p></Show>
            </div>
          </section>

          <Show when={props.onSaveComputerUseEnabled || props.onOpenComputerSettings}>
            <section class="flower-settings-section flower-settings-computer-use-section" aria-label={copy().computerUseTitle}>
              <FlowerSubSectionHeader
                title={copy().computerUseTitle}
                actions={<FlowerAutoSaveIndicator dirty={computerUseSaving()} copy={copy().autoSave} saving={computerUseSaving()} error={computerUseError()} savedAt={computerUseSavedAt()} />}
              />
              <div class="flower-settings-section-content">
                <Show when={props.onSaveComputerUseEnabled}>
                  <button type="button" class="flower-settings-toggle-card" role="switch" aria-checked={computerUseEnabled()}
                    disabled={computerUseSaving()} onClick={() => void saveComputerUseEnabled(!computerUseEnabled())}>
                    <span class="flower-settings-toggle-label">{copy().computerUseLabel}</span>
                    <span class={cn('flower-settings-toggle-track', computerUseEnabled() && 'flower-settings-toggle-track-on')} aria-hidden="true">
                      <span class="flower-settings-toggle-thumb" />
                    </span>
                  </button>
                  <Show when={computerUseError()}><p role="alert" class="mt-3 text-xs text-destructive">{computerUseError()}</p></Show>
                </Show>
                <Show when={props.onOpenComputerSettings}>
                  <Button size="sm" variant="outline" onClick={() => props.onOpenComputerSettings?.()}>{(props.computerCopy ?? computerUseEnUS).title}</Button>
                </Show>
              </div>
            </section>
          </Show>

        </div>
      </div>

      <FlowerProviderDialog
        onDiscoverModels={props.onDiscoverModels}
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
