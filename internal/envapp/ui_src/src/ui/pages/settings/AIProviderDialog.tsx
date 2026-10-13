import { ManualModelCapabilities } from '../../../../../../flower_ui/src/settings/ManualModelCapabilities';
import { FLOWER_STORED_SECRET_PLACEHOLDER } from '../../../../../../flower_ui/src/settings/FlowerSettingsPrimitives';
import { flowerModelNeedsConfiguration } from '../../../../../../flower_ui/src/providerModelProjection';
import { ModelCatalogControls } from '../../../../../../flower_ui/src/settings/ModelCatalogControls';
import { flowerProviderAPIKeyOptional, missingFlowerProviderCredential } from '../../../../../../flower_ui/src/providerCredentials';
import { filterFlowerModels } from '../../../../../../flower_ui/src/settings/modelSelection';
import { modelCatalogCopy } from '../../../../../../flower_ui/src/settings/modelCatalogCopy';
import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Bot, Key, Settings, Sparkles } from '@floegence/floe-webapp-core/icons';
import { Button, Checkbox, Input, Select, StableText } from '@floegence/floe-webapp-core/ui';
import { Dialog } from '../../primitives/EnvAppModal';
import { localizedFlowerProviderModelNote } from '../../../../../../flower_ui/src/settings/providerModelNotes';
import {
  AI_PROVIDER_TYPE_OPTIONS,
  defaultBaseURLForProviderType,
  formatTokenCountForLocale,
  modelID,
  modelSupportsImageInput,
  localizedProviderTypeLabel,
  providerNeedsWebSearchConfig,
  providerSupportsCustomModelNames,
  providerUsesCustomConnectionName,
  providerTypeRequiresBaseURL,
} from './aiCatalog';
import { useI18n } from '../../i18n';
import { WebSearchCapabilityBadge } from '../../../../../../flower_ui/src/WebSearchCapabilityBadge';
import { ProviderBrandIcon } from './ProviderBrandIcon';
import {
  CapabilityTag,
  CodeBadge,
  FieldLabel,
  SettingsPill,
  SubSectionHeader,
} from './SettingsPrimitives';
import type { AIProviderModelPreset, AIProviderRow, AIProviderType, AIProviderWebSearchMode } from './types';

export type AIProviderDialogProps = {
  onDiscoverModels?: () => void;
  onClearModels: () => void;
  discoveringModels?: boolean;
  discoveryError?: string;
  open: boolean;
  mode?: 'create' | 'edit';
  title: string;
  provider: AIProviderRow | null;
  canInteract: boolean;
  canAdmin: boolean;
  aiSaving: boolean;
  keySet: boolean;
  keyDraft: string;
  keySaving: boolean;
  webSearchKeySet: boolean;
  webSearchKeyDraft: string;
  webSearchKeySaving: boolean;
  recommendedModels: readonly AIProviderModelPreset[];
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onChangeName: (value: string) => void;
  onChangeType: (value: AIProviderType) => void;
  onChangeBaseURL: (value: string) => void;
  onChangeKeyDraft: (value: string) => void;
  onChangeWebSearchMode: (mode: AIProviderWebSearchMode) => void;
  onChangeWebSearchKeyDraft: (value: string) => void;
  onApplyAllPresets: () => void;
  onAddSelectedPreset: (modelName?: string) => void;
  onAddCustomModel: (modelName: string) => void;
  onRemoveRecommendedPreset: (modelName: string) => void;
  onChangeModelCapabilities?: (index: number, patch: Partial<import('../../../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerProviderModel>) => void;
  onChangeModelName: (index: number, value: string) => void;
  onChangeModelNumber: (index: number, key: 'context_window' | 'max_output_tokens' | 'effective_context_window_percent', rawValue: string) => void;
  onChangeModelImageInput: (index: number, enabled: boolean) => void;
  onRemoveModel: (index: number) => void;
};

type ProviderDialogStep = 'type' | 'connection' | 'models' | 'advanced';
type StepIconComponent = (props?: { class?: string }) => JSX.Element;

function normalizeModelName(value: unknown): string {
  return String(value ?? '').trim();
}

export function AIProviderDialog(props: AIProviderDialogProps) {
  const i18n = useI18n();
  const [activeStep, setActiveStep] = createSignal<ProviderDialogStep>('type');
  const [query, setQuery] = createSignal('');
  const catalogByName = createMemo(() => new Map(props.recommendedModels.map((model) => [model.model_name, model])));
  // Parent draft updates replace metadata objects without changing model identities.
  const visibleModelNames = createMemo(() => filterFlowerModels(props.recommendedModels, query()).map((model) => model.model_name));
  const catalogCopy = () => modelCatalogCopy(i18n.locale());
  const [customModelName, setCustomModelName] = createSignal('');
  const saving = createMemo(() => props.aiSaving || props.keySaving || props.webSearchKeySaving);
  const incompleteModel = () => props.provider?.models.some(flowerModelNeedsConfiguration) ?? false;
  const keyHint = () => {
    if (props.keySet) return props.keyDraft.trim() ? i18n.t('flowerSurface.settings.dialogReplaceStoredKeyHint') : i18n.t('flowerProviderDialog.savedKeyHint');
    return props.provider && flowerProviderAPIKeyOptional(props.provider.type) ? catalogCopy().optionalKey : i18n.t('flowerProviderDialog.requiredBeforeUseHint');
  };
  const braveKeyHint = () => {
    if (props.webSearchKeySet) return props.webSearchKeyDraft.trim() ? i18n.t('flowerSurface.settings.dialogReplaceStoredKeyHint') : i18n.t('flowerProviderDialog.savedKeyHint');
    return i18n.t('flowerProviderDialog.requiredForBraveHint');
  };

  createEffect(() => {
    if (!props.open) {
      setActiveStep('type');
      setCustomModelName(''); setQuery('');
    }
  });

  const useCustomModel = () => {
    const name = String(customModelName() ?? '').trim();
    if (!name) return;
    props.onAddCustomModel(name);
    setCustomModelName('');
  };

  const chooseProviderType = (providerType: AIProviderType) => {
    if (!props.canInteract) return;
    if (props.provider?.type !== providerType) {
      props.onChangeType(providerType);
      setCustomModelName('');
    }
    setActiveStep('connection');
  };

  const providerTypeDescription = (providerType: AIProviderType): string => (
    providerUsesCustomConnectionName(providerType)
      ? i18n.t('flowerProviderDialog.customEndpointDescription')
      : i18n.t('flowerProviderDialog.nativeConnectionDescription')
  );
  const providerTypeDisplayLabel = (providerType: AIProviderType): string => localizedProviderTypeLabel(providerType, i18n.locale());
  const formatTokenCount = (tokenCount: number) => formatTokenCountForLocale(tokenCount, i18n.locale());
  const missingCredential = () => props.provider
    ? missingFlowerProviderCredential({ ...props.provider, provider_api_key: props.keyDraft, web_search_api_key: props.webSearchKeyDraft }, props.keySet, props.webSearchKeySet)
    : null;
  const connectionReady = () => Boolean(props.provider
    && !missingFlowerProviderCredential({ ...props.provider, enabled: true, provider_api_key: props.keyDraft, web_search_api_key: props.webSearchKeyDraft }, props.keySet, props.webSearchKeySet)
    && (!providerTypeRequiresBaseURL(props.provider.type) || props.provider.base_url?.trim() || defaultBaseURLForProviderType(props.provider.type)));

  createEffect(() => { if (!connectionReady() && activeStep() === 'models') setActiveStep('connection'); });

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      class="redeven-provider-dialog flower-provider-dialog w-[min(68rem,96vw)] max-w-[96vw]"
      contentClass="flower-provider-dialog-body"
      footer={
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Show when={missingCredential()}>
            <span role="status" class="mr-auto text-sm text-muted-foreground">
              {missingCredential() === 'provider' ? i18n.t('flowerSettings.needsKey') : i18n.t('flowerSurface.settings.needsBraveKey')}
            </span>
          </Show>
          <Show when={incompleteModel()}><span role="status" class="mr-auto text-sm text-muted-foreground">{catalogCopy().needsConfiguration}</span></Show>
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {i18n.t('flowerProviderDialog.discard')}
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => { if (!missingCredential() && !incompleteModel()) props.onConfirm(); }}
            loading={saving()}
            disabled={!props.canInteract || saving() || Boolean(missingCredential()) || incompleteModel() || Boolean(props.provider?.model_selection && !props.provider.model_selection.selected_models)}
          >
            {i18n.t('flowerProviderDialog.saveProvider')}
          </Button>
        </div>
      }
    >
      <Show when={props.provider} fallback={<div class="text-[length:var(--floe-type-body)] text-muted-foreground">{i18n.t('flowerProviderDialog.providerRemoved')}</div>}>
        {(providerAccessor) => {
          const provider = () => providerAccessor();
          const providerID = () => String(provider().id ?? '').trim();
          const models = () => (Array.isArray(provider().models) ? provider().models : []);
          const selectedModelNames = createMemo(() => new Set(models().map((model) => normalizeModelName(model.model_name)).filter(Boolean)));
          const recommendedModelSelected = (modelName: string) => selectedModelNames().has(normalizeModelName(modelName));
          const supportedCustomModelNames = () => providerSupportsCustomModelNames(provider().type);
          const hasSelectedModels = () => models().length > 0;
          const stepItems: ReadonlyArray<{ id: ProviderDialogStep; label: () => string; icon: StepIconComponent }> = [
            { id: 'type', label: () => i18n.t('flowerProviderDialog.providerTypeTitle'), icon: Bot },
            { id: 'connection', label: () => i18n.t('flowerProviderDialog.connectionTitle'), icon: Key },
            { id: 'models', label: () => i18n.t('flowerProviderDialog.recommendedModelsTitle'), icon: Sparkles },
            { id: 'advanced', label: () => i18n.t('flowerProviderDialog.advancedTitle'), icon: Settings },
          ];

          return (
            <div class="redeven-settings-dialog flower-provider-workspace">
              <aside class="flower-provider-picker">
                <div class="mb-4 px-2">
                  <div class="flex items-center gap-2">
                    <span class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted">
                      <ProviderBrandIcon type={provider().type} class="h-5 w-5" />
                    </span>
                    <div class="min-w-0">
                      <div class="truncate text-[length:var(--floe-type-body)] font-semibold text-foreground">{providerTypeDisplayLabel(provider().type)}</div>
                    </div>
                  </div>
                </div>
                <nav class="flower-provider-step-options" aria-label={props.title}>
                  <For each={stepItems}>
                    {(step) => {
                      const active = () => activeStep() === step.id;
                      const StepIcon = step.icon;
                      return (
                        <button
                          type="button"
                          class="flower-provider-choice"
                          classList={{ 'flower-provider-choice--active': active() }}
                          onClick={() => setActiveStep(step.id)}
                          disabled={(!props.canInteract && step.id !== activeStep()) || (step.id === 'models' && !connectionReady())}
                          aria-current={active() ? 'step' : undefined}
                          data-provider-dialog-step={step.id}
                        >
                          <span class="flower-provider-choice-icon">
                            <StepIcon class="h-3.5 w-3.5" />
                          </span>
                          <span class="flower-provider-choice-label">
                            <span class="block text-xs font-semibold">{step.label()}</span>
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </nav>
              </aside>

              <div class="flower-provider-editor">
                <Show when={activeStep() === 'type'}>
                  <section class="space-y-3">
                    <SubSectionHeader
                      title={i18n.t('flowerProviderDialog.providerTypeTitle')}
                      description={i18n.t('flowerSurface.settings.dialogProviderTypeDescription')}
                    />
                    <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <For each={AI_PROVIDER_TYPE_OPTIONS}>
                        {(item) => {
                          const active = () => provider().type === item.value;
                          return (
                            <button
                              type="button"
                              class={cn(
                                'flower-provider-choice text-left disabled:cursor-not-allowed disabled:opacity-60',
                                active() && 'flower-provider-choice--active',
                              )}
                              onClick={() => chooseProviderType(item.value)}
                              disabled={!props.canInteract}
                              data-provider-type={item.value}
                            >
                              <div class="flex items-start gap-3">
                                <span class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--redeven-settings-panel-bg)]">
                                  <ProviderBrandIcon type={item.value} class="h-5 w-5" />
                                </span>
                                <span class="min-w-0">
                                  <span class="flex items-center gap-2">
                                    <span class="text-[length:var(--floe-type-body)] font-semibold text-foreground">{providerTypeDisplayLabel(item.value)}</span>
                                    <Show when={active()}>
                                      <SettingsPill tone="success">{i18n.t('flowerProviderDialog.currentProviderType')}</SettingsPill>
                                    </Show>
                                  </span>
                                  <span class="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{providerTypeDescription(item.value)}</span>
                                </span>
                              </div>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </section>
                </Show>

                <Show when={activeStep() === 'connection'}>
                  <section class="space-y-4">
                    <SubSectionHeader
                      title={i18n.t('flowerProviderDialog.connectionTitle')}
                      description={i18n.t('flowerProviderDialog.connectionDescription')}
                    />
                    <div class="flower-provider-connection-fields">
                      <Show when={providerUsesCustomConnectionName(provider().type)}>
                        <div>
                          <FieldLabel>{i18n.t('flowerProviderDialog.connectionName')}</FieldLabel>
                          <Input
                            value={provider().name}
                            onInput={(event) => props.onChangeName(event.currentTarget.value)}
                            placeholder={providerTypeDisplayLabel(provider().type)}
                            size="sm"
                            class="w-full"
                            disabled={!props.canInteract}
                          />
                        </div>
                      </Show>
                      <div>
                        <FieldLabel hint={keyHint()}>
                          {i18n.t('flowerProviderDialog.apiKey')}
                        </FieldLabel>
                        <Input
                          type="password"
                          value={props.keyDraft}
                          onInput={(event) => props.onChangeKeyDraft(event.currentTarget.value)}
                          placeholder={props.keySet ? FLOWER_STORED_SECRET_PLACEHOLDER : i18n.t('flowerProviderDialog.pasteApiKey')}
                          aria-label={i18n.t('flowerProviderDialog.apiKey')}
                          aria-description={keyHint()}
                          autocomplete="new-password"
                          data-stored-secret={props.keySet ? 'true' : undefined}
                          size="sm"
                          class="flower-provider-secret-input w-full"
                          disabled={!props.canInteract || !props.canAdmin || !providerID()}
                        />
                      </div>
                      <Show when={providerTypeRequiresBaseURL(provider().type)}>
                        <div>
                          <FieldLabel hint={i18n.t('flowerProviderDialog.requiredHint')}>{i18n.t('flowerProviderDialog.baseUrl')}</FieldLabel>
                          <Input
                            value={provider().base_url}
                            onInput={(event) => props.onChangeBaseURL(event.currentTarget.value)}
                            placeholder={defaultBaseURLForProviderType(provider().type)}
                            size="sm"
                            class="w-full"
                            disabled={!props.canInteract}
                          />
                        </div>
                      </Show>
                      <Show when={providerNeedsWebSearchConfig(provider().type)}>
                        <div>
                          <FieldLabel>{i18n.t('flowerProviderDialog.webSearch')}</FieldLabel>
                          <Select
                            value={provider().web_search?.mode ?? 'disabled'}
                            onChange={(value) => props.onChangeWebSearchMode(value as AIProviderWebSearchMode)}
                            disabled={!props.canInteract}
                            options={[
                              { value: 'disabled', label: i18n.t('flowerSettings.webSearchDisabled') },
                              { value: 'openai_builtin', label: i18n.t('flowerProviderDialog.openAIBuiltIn') },
                              { value: 'brave', label: i18n.t('flowerSettings.webSearchBrave') },
                            ]}
                            class="w-full"
                          />
                        </div>
                      </Show>
                      <Show when={(provider().web_search?.mode ?? 'disabled') === 'brave'}>
                        <div>
                          <FieldLabel hint={braveKeyHint()}>
                            {i18n.t('flowerProviderDialog.braveApiKey')}
                          </FieldLabel>
                          <Input
                            type="password"
                            value={props.webSearchKeyDraft}
                            onInput={(event) => props.onChangeWebSearchKeyDraft(event.currentTarget.value)}
                            placeholder={props.webSearchKeySet ? FLOWER_STORED_SECRET_PLACEHOLDER : i18n.t('flowerProviderDialog.pasteBraveApiKey')}
                            aria-label={i18n.t('flowerProviderDialog.braveApiKey')}
                            aria-description={braveKeyHint()}
                            autocomplete="new-password"
                            data-stored-secret={props.webSearchKeySet ? 'true' : undefined}
                            size="sm"
                            class="flower-provider-secret-input w-full"
                            disabled={!props.canInteract || !props.canAdmin || !providerID()}
                          />
                        </div>
                      </Show>
                    </div>
                  </section>
                </Show>

                <Show when={activeStep() === 'models' && connectionReady()}>
                  <div class="space-y-5">
                    <section class="space-y-3">
                      <SubSectionHeader
                        title={i18n.t('flowerProviderDialog.recommendedModelsTitle')}
                      />
                      <Show when={provider().model_selection && !provider().model_selection?.selected_models}><p role="status" class="text-xs text-muted-foreground">{catalogCopy().selectionReview}</p></Show>
                      <ModelCatalogControls hasContent={props.recommendedModels.length > 0} copy={catalogCopy()} query={query()} count={props.provider?.models.length ?? 0} onQuery={setQuery} onSelectAll={props.onApplyAllPresets} onClear={props.onClearModels} onRefresh={props.onDiscoverModels} loading={props.discoveringModels} error={props.discoveryError} disabled={!props.canInteract} />
                      <Show
                        when={visibleModelNames().length > 0}
                        fallback={<div class="flower-provider-model-empty" role="status">{props.discoveringModels ? catalogCopy().loading : catalogCopy().empty}</div>}
                      >
                        <div class="flower-provider-model-list">
                          <For each={visibleModelNames()}>
                            {(name) => {
                              const preset = () => catalogByName().get(name)!;
                              const selected = () => recommendedModelSelected(preset().model_name);
                              return (
                                <div class="flower-provider-model-row px-3 py-3">
                                  <div class="flex items-start justify-between gap-3">
                                    <div class="min-w-0">
                                      <div class="break-all font-mono text-[length:var(--floe-type-body)] font-semibold text-foreground">{preset().display_name || preset().model_name} <Show when={preset().unavailable}><SettingsPill>{catalogCopy().unavailableModel}</SettingsPill></Show><Show when={preset().quantization}><SettingsPill>{preset().quantization}</SettingsPill></Show> <Show when={preset().status}><SettingsPill>{preset().status === 'needs_configuration' ? catalogCopy().needsConfiguration : preset().status === 'unsupported' ? catalogCopy().unavailableModel : preset().status === 'experimental' ? catalogCopy().experimental : catalogCopy().preview}</SettingsPill></Show></div>
                                      <Show when={preset().model_digest && props.recommendedModels.some((other) => other.model_name !== preset().model_name && other.model_digest === preset().model_digest)}><p class="text-xs text-muted-foreground">{catalogCopy().aliases}: {props.recommendedModels.filter((other) => other.model_name !== preset().model_name && other.model_digest === preset().model_digest).map((other) => other.wire_model_name || other.model_name).join(', ')}</p></Show>
                                      <div class="mt-1 text-xs text-muted-foreground">
                                        {i18n.t('flowerProviderDialog.contextTokens', { count: formatTokenCount(preset().context_window) })}
                                        <Show when={preset().max_output_tokens}> · {i18n.t('flowerProviderDialog.outputTokens', { count: formatTokenCount(Number(preset().max_output_tokens ?? 0)) })}</Show>
                                      </div>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant={selected() ? 'ghost' : 'outline'}
                                      class={cn('shrink-0', selected() && 'border border-transparent text-muted-foreground hover:text-destructive')}
                                      onClick={() => (selected() ? props.onRemoveRecommendedPreset(preset().model_name) : props.onAddSelectedPreset(preset().model_name))}
                                      disabled={!props.canInteract || (preset().unavailable && !selected())}
                                    >
                                      <StableText reserve={[i18n.t('flowerProviderDialog.removeModel'), i18n.t('flowerProviderDialog.addPreset')]}>
                                        {selected() ? i18n.t('flowerProviderDialog.removeModel') : i18n.t('flowerProviderDialog.addPreset')}
                                      </StableText>
                                    </Button>
                                  </div>
                                  <div class="mt-2 flex flex-wrap gap-1.5">
                                    <WebSearchCapabilityBadge availability={preset().web_search} copy={catalogCopy()} />
                                    <CapabilityTag active>{i18n.t('flowerSettings.textCapability')}</CapabilityTag>
                                    <CapabilityTag active={modelSupportsImageInput(preset().input_modalities)}>{i18n.t('flowerSettings.imageInputCapability')}</CapabilityTag>
                                    <span class={cn('inline-flex', !selected() && 'invisible')} aria-hidden={!selected()}>
                                      <CapabilityTag active>{i18n.t('flowerProviderDialog.selectedCapability')}</CapabilityTag>
                                    </span>
                                  </div>
                                  <Show when={localizedFlowerProviderModelNote(i18n.locale(), preset().note_key)}>
                                    {(note) => <div class="mt-2 text-[11px] text-muted-foreground">{note()}</div>}
                                  </Show>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </Show>

                      <div class="flower-provider-custom-model">
                        <Input
                          value={customModelName()}
                          onInput={(event) => setCustomModelName(event.currentTarget.value)}
                          placeholder={supportedCustomModelNames() ? i18n.t('flowerProviderDialog.customModelNamePlaceholder') : i18n.t('flowerProviderDialog.curatedPresetsOnlyPlaceholder')}
                          size="sm"
                          class="w-full font-mono"
                          disabled={!props.canInteract || !supportedCustomModelNames()}
                        />
                        <Button size="sm" variant="outline" onClick={useCustomModel} disabled={!props.canInteract || !supportedCustomModelNames() || !String(customModelName() ?? '').trim()}>
                          {i18n.t('flowerProviderDialog.addCustomModel')}
                        </Button>
                      </div>
                    </section>

                  </div>
                </Show>

                <Show when={activeStep() === 'advanced'}>
                  <section class="space-y-4">
                    <SubSectionHeader
                      title={i18n.t('flowerProviderDialog.advancedTitle')}
                      description={i18n.t('flowerProviderDialog.advancedDescription')}
                    />
                    <Show when={providerNeedsWebSearchConfig(provider().type)}>
                      <div class="redeven-settings-inset rounded-lg border p-3 text-xs text-muted-foreground">
                        {i18n.t('flowerProviderDialog.webSearchConfigDescription')}
                      </div>
                    </Show>
                    <Show
                      when={hasSelectedModels()}
                      fallback={<div class="rounded-lg border border-dashed p-4 text-[length:var(--floe-type-body)] text-muted-foreground">{i18n.t('flowerProviderDialog.noSelectedModels')}</div>}
                    >
                      <div class="space-y-3">
                        <For each={models()}>
                          {(model, index) => (
                            <div class="redeven-settings-inset rounded-lg border p-3">
                              <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <div class="font-mono text-xs text-muted-foreground">{modelID(providerID(), normalizeModelName(model.model_name)) || i18n.t('flowerProviderDialog.noWireModelId')}</div>
                                <CodeBadge>{providerID() || i18n.t('flowerProviderDialog.providerIdPending')}</CodeBadge>
                              </div>
                              <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
                                <div class="md:col-span-2">
                                  <FieldLabel>{i18n.t('flowerProviderDialog.modelName')}</FieldLabel>
                                  <Input
                                    value={model.model_name}
                                    onInput={(event) => props.onChangeModelName(index(), event.currentTarget.value)}
                                    placeholder="model-name"
                                    size="sm"
                                    class="w-full font-mono"
                                    disabled={!props.canInteract}
                                  />
                                </div>
                                <div>
                                  <FieldLabel>{i18n.t('flowerProviderDialog.contextWindow')}</FieldLabel>
                                  <Input
                                    type="number"
                                    value={model.context_window ?? ''}
                                    onInput={(event) => props.onChangeModelNumber(index(), 'context_window', event.currentTarget.value)}
                                    placeholder="—"
                                    size="sm"
                                    class="w-full font-mono"
                                    disabled={!props.canInteract}
                                  />
                                </div>
                                <div>
                                  <FieldLabel>{i18n.t('flowerProviderDialog.maxOutput')}</FieldLabel>
                                  <Input
                                    type="number"
                                    value={model.max_output_tokens ?? ''}
                                    onInput={(event) => props.onChangeModelNumber(index(), 'max_output_tokens', event.currentTarget.value)}
                                    placeholder="—"
                                    size="sm"
                                    class="w-full font-mono"
                                    disabled={!props.canInteract}
                                  />
                                </div>
                                <div>
                                  <FieldLabel>{i18n.t('flowerProviderDialog.effectiveContextPercent')}</FieldLabel>
                                  <Input
                                    type="number"
                                    value={model.effective_context_window_percent ?? ''}
                                    onInput={(event) => props.onChangeModelNumber(index(), 'effective_context_window_percent', event.currentTarget.value)}
                                    placeholder="—"
                                    size="sm"
                                    class="w-full font-mono"
                                    disabled={!props.canInteract}
                                  />
                                </div>
                                <Show when={model.status === 'needs_configuration' || model.reasoning_capability?.fixture === 'manual_provider_capability'}>
                                  <ManualModelCapabilities model={model} type={provider().type} baseURL={provider().base_url || defaultBaseURLForProviderType(provider().type)} copy={catalogCopy()} disabled={!props.canInteract} onChange={patch => props.onChangeModelCapabilities?.(index(), patch)} />
                                </Show>
                                <div class="md:col-span-3">
                                  <Checkbox
                                    checked={modelSupportsImageInput(model.input_modalities)}
                                    onChange={(value) => props.onChangeModelImageInput(index(), value)}
                                    disabled={!props.canInteract}
                                    label={i18n.t('flowerSettings.imageInputCapability')}
                                    size="sm"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </section>
                </Show>
              </div>
            </div>
          );
        }}
      </Show>
    </Dialog>
  );
}
