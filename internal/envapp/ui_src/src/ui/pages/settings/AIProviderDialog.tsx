import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Bot, Key, Settings, Sparkles } from '@floegence/floe-webapp-core/icons';
import { Button, Checkbox, Dialog, Input, Select } from '@floegence/floe-webapp-core/ui';
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
import { localizedProviderBuiltInWebSearchLabel } from './providerWebSearchI18n';
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
  open: boolean;
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
  const [customModelName, setCustomModelName] = createSignal('');
  const saving = createMemo(() => props.aiSaving || props.keySaving || props.webSearchKeySaving);
  const providerHasModels = createMemo(() => Array.isArray(props.provider?.models) && (props.provider?.models.length ?? 0) > 0);

  createEffect(() => {
    if (!props.open) {
      setActiveStep('type');
      setCustomModelName('');
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

  const modalitySummary = (raw: unknown): string => (
    modelSupportsImageInput(raw)
      ? i18n.t('flowerProviderDialog.textAndImageModalities')
      : i18n.t('flowerProviderDialog.textOnlyModality')
  );
  const providerTypeDescription = (providerType: AIProviderType): string => (
    providerUsesCustomConnectionName(providerType)
      ? i18n.t('flowerProviderDialog.customEndpointDescription')
      : i18n.t('flowerProviderDialog.nativeConnectionDescription')
  );
  const providerTypeDisplayLabel = (providerType: AIProviderType): string => localizedProviderTypeLabel(providerType, i18n.locale());
  const formatTokenCount = (tokenCount: number) => formatTokenCountForLocale(tokenCount, i18n.locale());

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      class="w-[min(74rem,96vw)] max-w-[96vw]"
      footer={
        <div class="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {i18n.t('flowerProviderDialog.discard')}
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={props.onConfirm}
            loading={saving()}
            disabled={!props.canInteract || saving() || !providerHasModels()}
          >
            {i18n.t('flowerProviderDialog.saveProvider')}
          </Button>
        </div>
      }
    >
      <Show when={props.provider} fallback={<div class="text-sm text-muted-foreground">{i18n.t('flowerProviderDialog.providerRemoved')}</div>}>
        {(providerAccessor) => {
          const provider = () => providerAccessor();
          const providerID = () => String(provider().id ?? '').trim();
          const models = () => (Array.isArray(provider().models) ? provider().models : []);
          const selectedModelNames = createMemo(() => new Set(models().map((model) => normalizeModelName(model.model_name)).filter(Boolean)));
          const recommendedModelSelected = (modelName: string) => selectedModelNames().has(normalizeModelName(modelName));
          const supportedCustomModelNames = () => providerSupportsCustomModelNames(provider().type);
          const hasSelectedModels = () => models().length > 0;
          const stepItems = createMemo<ReadonlyArray<{ id: ProviderDialogStep; label: string; description: string; icon: StepIconComponent }>>(() => [
            {
              id: 'type',
              label: i18n.t('flowerProviderDialog.providerTypeTitle'),
              description: providerTypeDisplayLabel(provider().type),
              icon: Bot,
            },
            {
              id: 'connection',
              label: i18n.t('flowerProviderDialog.connectionTitle'),
              description: props.keySet || String(props.keyDraft ?? '').trim()
                ? i18n.t('flowerProviderDialog.keyReady')
                : i18n.t('flowerSettings.needsKey'),
              icon: Key,
            },
            {
              id: 'models',
              label: i18n.t('flowerProviderDialog.recommendedModelsTitle'),
              description: hasSelectedModels()
                ? i18n.t('flowerProviderDialog.selectedModelsTitle')
                : i18n.t('flowerProviderDialog.noSelectedModels'),
              icon: Sparkles,
            },
            {
              id: 'advanced',
              label: i18n.t('flowerProviderDialog.advancedTitle'),
              description: modelID(providerID(), normalizeModelName(models()[0]?.model_name)) || i18n.t('flowerProviderDialog.providerIdPending'),
              icon: Settings,
            },
          ]);

          return (
            <div class="grid max-h-[72vh] min-h-[34rem] grid-cols-1 gap-5 overflow-hidden lg:grid-cols-[15rem_minmax(0,1fr)]">
              <aside class="rounded-lg border border-border bg-muted/20 p-2">
                <div class="mb-2 rounded-md border border-border bg-background p-3">
                  <div class="flex items-center gap-2">
                    <span class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted">
                      <ProviderBrandIcon type={provider().type} class="h-5 w-5" />
                    </span>
                    <div class="min-w-0">
                      <div class="truncate text-sm font-semibold text-foreground">{providerTypeDisplayLabel(provider().type)}</div>
                      <div class="truncate text-[11px] text-muted-foreground">{providerID() || i18n.t('flowerProviderDialog.providerIdPending')}</div>
                    </div>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-1.5">
                    <SettingsPill tone={props.keySet || String(props.keyDraft ?? '').trim() ? 'success' : 'default'}>
                      {props.keySet || String(props.keyDraft ?? '').trim() ? i18n.t('flowerProviderDialog.keyReady') : i18n.t('flowerSettings.needsKey')}
                    </SettingsPill>
                    <Show when={localizedProviderBuiltInWebSearchLabel(i18n, provider().type)}>
                      {(label) => <SettingsPill tone="success">{label()}</SettingsPill>}
                    </Show>
                  </div>
                </div>
                <nav class="space-y-1" aria-label={props.title}>
                  <For each={stepItems()}>
                    {(step) => {
                      const active = () => activeStep() === step.id;
                      const StepIcon = step.icon;
                      return (
                        <button
                          type="button"
                          class={cn(
                            'flex w-full cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                            active()
                              ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm'
                              : 'border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground',
                          )}
                          onClick={() => setActiveStep(step.id)}
                          disabled={!props.canInteract && step.id !== activeStep()}
                          data-provider-dialog-step={step.id}
                        >
                          <span class={cn('mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md', active() ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                            <StepIcon class="h-3.5 w-3.5" />
                          </span>
                          <span class="min-w-0">
                            <span class="block text-xs font-semibold">{step.label}</span>
                            <span class="mt-0.5 block truncate text-[11px] opacity-75">{step.description}</span>
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </nav>
              </aside>

              <div class="min-w-0 overflow-y-auto pr-1">
                <Show when={activeStep() === 'type'}>
                  <section class="space-y-3">
                    <SubSectionHeader
                      title={i18n.t('flowerProviderDialog.providerTypeTitle')}
                      description={i18n.t('flowerProviderDialog.providerTypeDescription')}
                    />
                    <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <For each={AI_PROVIDER_TYPE_OPTIONS}>
                        {(item) => {
                          const active = () => provider().type === item.value;
                          return (
                            <button
                              type="button"
                              class={cn(
                                'rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                                active() ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/15' : 'border-border bg-background hover:border-primary/30 hover:bg-primary/5',
                              )}
                              onClick={() => chooseProviderType(item.value)}
                              disabled={!props.canInteract}
                              data-provider-type={item.value}
                            >
                              <div class="flex items-start gap-3">
                                <span class={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg', active() ? 'bg-background' : 'bg-muted/60')}>
                                  <ProviderBrandIcon type={item.value} class="h-5 w-5" />
                                </span>
                                <span class="min-w-0">
                                  <span class="flex items-center gap-2">
                                    <span class="text-sm font-semibold text-foreground">{providerTypeDisplayLabel(item.value)}</span>
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
                    <div class={cn('grid grid-cols-1 gap-3', providerUsesCustomConnectionName(provider().type) ? 'md:grid-cols-2' : '')}>
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
                        <FieldLabel hint={props.keySet ? i18n.t('flowerProviderDialog.savedKeyHint') : i18n.t('flowerProviderDialog.requiredBeforeUseHint')}>
                          {i18n.t('flowerProviderDialog.apiKey')}
                        </FieldLabel>
                        <Input
                          type="password"
                          value={props.keyDraft}
                          onInput={(event) => props.onChangeKeyDraft(event.currentTarget.value)}
                          placeholder={props.keySet ? i18n.t('flowerProviderDialog.keepExistingKey') : i18n.t('flowerProviderDialog.pasteApiKey')}
                          size="sm"
                          class="w-full"
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
                          <FieldLabel hint={props.webSearchKeySet ? i18n.t('flowerProviderDialog.savedKeyHint') : i18n.t('flowerProviderDialog.requiredForBraveHint')}>
                            {i18n.t('flowerProviderDialog.braveApiKey')}
                          </FieldLabel>
                          <Input
                            type="password"
                            value={props.webSearchKeyDraft}
                            onInput={(event) => props.onChangeWebSearchKeyDraft(event.currentTarget.value)}
                            placeholder={props.webSearchKeySet ? i18n.t('flowerProviderDialog.keepExistingBraveKey') : i18n.t('flowerProviderDialog.pasteBraveApiKey')}
                            size="sm"
                            class="w-full"
                            disabled={!props.canInteract || !props.canAdmin || !providerID()}
                          />
                        </div>
                      </Show>
                    </div>
                    <div class="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/20 p-3">
                      <SettingsPill tone={props.keySet || String(props.keyDraft ?? '').trim() ? 'success' : 'default'}>
                        {props.keySet || String(props.keyDraft ?? '').trim() ? i18n.t('flowerProviderDialog.keyReady') : i18n.t('flowerSettings.needsKey')}
                      </SettingsPill>
                      <SettingsPill>{providerTypeDisplayLabel(provider().type)}</SettingsPill>
                      <Show when={localizedProviderBuiltInWebSearchLabel(i18n, provider().type)}>
                        {(label) => <SettingsPill tone="success">{label()}</SettingsPill>}
                      </Show>
                    </div>
                  </section>
                </Show>

                <Show when={activeStep() === 'models'}>
                  <div class="space-y-5">
                    <section class="space-y-3">
                      <SubSectionHeader
                        title={i18n.t('flowerProviderDialog.recommendedModelsTitle')}
                        description={i18n.t('flowerProviderDialog.recommendedModelsDescription')}
                        actions={
                          <Show when={props.recommendedModels.length > 0}>
                            <Button size="sm" variant="outline" onClick={props.onApplyAllPresets} disabled={!props.canInteract}>
                              {i18n.t('flowerProviderDialog.addAllPresets')}
                            </Button>
                          </Show>
                        }
                      />
                      <Show
                        when={props.recommendedModels.length > 0}
                        fallback={<div class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{i18n.t('flowerProviderDialog.noMaintainedPresets')}</div>}
                      >
                        <div class="grid grid-cols-1 gap-2 xl:grid-cols-2">
                          <For each={props.recommendedModels}>
                            {(preset) => {
                              const selected = () => recommendedModelSelected(preset.model_name);
                              return (
                                <div class={cn('rounded-lg border p-3 transition', selected() ? 'border-primary/50 bg-primary/5' : 'border-border bg-background')}>
                                  <div class="flex items-start justify-between gap-3">
                                    <div class="min-w-0">
                                      <div class="break-all font-mono text-sm font-semibold text-foreground">{preset.model_name}</div>
                                      <div class="mt-1 text-xs text-muted-foreground">
                                        {i18n.t('flowerProviderDialog.contextTokens', { count: formatTokenCount(preset.context_window) })}
                                        <Show when={preset.max_output_tokens}> · {i18n.t('flowerProviderDialog.outputTokens', { count: formatTokenCount(Number(preset.max_output_tokens ?? 0)) })}</Show>
                                      </div>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant={selected() ? 'ghost' : 'outline'}
                                      class={selected() ? 'text-muted-foreground hover:text-destructive' : ''}
                                      onClick={() => (selected() ? props.onRemoveRecommendedPreset(preset.model_name) : props.onAddSelectedPreset(preset.model_name))}
                                      disabled={!props.canInteract}
                                    >
                                      {selected() ? i18n.t('flowerProviderDialog.removeModel') : i18n.t('flowerProviderDialog.addPreset')}
                                    </Button>
                                  </div>
                                  <div class="mt-2 flex flex-wrap gap-1.5">
                                    <CapabilityTag active>{i18n.t('flowerSettings.textCapability')}</CapabilityTag>
                                    <CapabilityTag active={modelSupportsImageInput(preset.input_modalities)}>{i18n.t('flowerSettings.imageInputCapability')}</CapabilityTag>
                                    <Show when={selected()}>
                                      <CapabilityTag active>{i18n.t('flowerProviderDialog.selectedCapability')}</CapabilityTag>
                                    </Show>
                                  </div>
                                  <Show when={localizedFlowerProviderModelNote(i18n.locale(), preset.note_key)}>
                                    {(note) => <div class="mt-2 text-[11px] text-muted-foreground">{note()}</div>}
                                  </Show>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </Show>

                      <div class="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
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

                    <section class="space-y-3">
                      <SubSectionHeader
                        title={i18n.t('flowerProviderDialog.selectedModelsTitle')}
                        description={i18n.t('flowerProviderDialog.selectedModelsDescription')}
                      />
                      <Show
                        when={hasSelectedModels()}
                        fallback={<div class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{i18n.t('flowerProviderDialog.noSelectedModels')}</div>}
                      >
                        <div class="grid grid-cols-1 gap-2 xl:grid-cols-2">
                          <For each={models()}>
                            {(model, index) => (
                              <div class="rounded-lg border border-border bg-background p-3">
                                <div class="flex items-start justify-between gap-3">
                                  <div class="min-w-0">
                                    <div class="break-all font-mono text-sm font-semibold text-foreground">{normalizeModelName(model.model_name) || i18n.t('flowerProviderDialog.unnamedModel')}</div>
                                    <div class="mt-1 text-xs text-muted-foreground">
                                      {modalitySummary(model.input_modalities)} · {i18n.t('flowerProviderDialog.contextTokens', { count: formatTokenCount(Number(model.context_window ?? 0)) })}
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    class="text-muted-foreground hover:text-destructive"
                                    onClick={() => props.onRemoveModel(index())}
                                    disabled={!props.canInteract || models().length <= 1}
                                  >
                                    {i18n.t('flowerProviderDialog.removeModel')}
                                  </Button>
                                </div>
                                <div class="mt-2 flex flex-wrap gap-1.5">
                                  <CapabilityTag active>{i18n.t('flowerSettings.textCapability')}</CapabilityTag>
                                  <CapabilityTag active={modelSupportsImageInput(model.input_modalities)}>{i18n.t('flowerSettings.imageInputCapability')}</CapabilityTag>
                                </div>
                                <div class="mt-2 text-[11px] text-muted-foreground">
                                  {modelID(providerID(), normalizeModelName(model.model_name)) || i18n.t('flowerProviderDialog.noWireModelId')}
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
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
                      <div class="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                        {i18n.t('flowerProviderDialog.webSearchConfigDescription')}
                      </div>
                    </Show>
                    <Show
                      when={hasSelectedModels()}
                      fallback={<div class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{i18n.t('flowerProviderDialog.noSelectedModels')}</div>}
                    >
                      <div class="space-y-3">
                        <For each={models()}>
                          {(model, index) => (
                            <div class="rounded-lg border border-border bg-background p-3">
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
                                    placeholder="128000"
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
                                    placeholder="4096"
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
                                    placeholder="95"
                                    size="sm"
                                    class="w-full font-mono"
                                    disabled={!props.canInteract}
                                  />
                                </div>
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
