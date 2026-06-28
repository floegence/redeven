import { For, Show, createEffect, createSignal } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronDown } from '@floegence/floe-webapp-core/icons';
import { Button, Checkbox, Dialog, Input, Select } from '@floegence/floe-webapp-core/ui';

import type { FlowerProviderDialogCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import type { FlowerProviderDraft, FlowerProviderModel, FlowerProviderType, FlowerWebSearchMode } from '../contracts/flowerSurfaceContracts';
import {
  FLOWER_PROVIDER_TYPES,
  FlowerProviderBrandIcon,
  defaultBaseURLForFlowerProviderType,
  defaultFlowerContextWindowForProviderType,
  flowerModelID,
  flowerModelSupportsImage,
  flowerProviderNeedsWebSearchConfig,
  flowerProviderSupportsCustomModels,
  flowerProviderTypeRequiresBaseURL,
  flowerProviderUsesCustomName,
  formatFlowerTokenCount,
  recommendedModelsForFlowerProviderType,
} from './providerCatalog';
import {
  FlowerCapabilityTag,
  FlowerCodeBadge,
  FlowerFieldLabel,
  FlowerSettingsPill,
  FlowerSubSectionHeader,
} from './FlowerSettingsPrimitives';

export type FlowerProviderDialogMode = 'create' | 'edit';

export type FlowerProviderDialogProps = Readonly<{
  open: boolean;
  mode: FlowerProviderDialogMode;
  provider: FlowerProviderDraft | null;
  copy?: FlowerProviderDialogCopy;
  keyConfigured: boolean;
  webSearchKeyConfigured: boolean;
  error?: string;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (draft: FlowerProviderDraft) => void | Promise<void>;
}>;

function cleanModelName(value: unknown): string {
  return String(value ?? '').trim();
}

function cloneModel(model: FlowerProviderModel): FlowerProviderModel {
  return {
    model_name: model.model_name,
    ...(model.wire_model_name ? { wire_model_name: model.wire_model_name } : {}),
    ...(model.context_window ? { context_window: model.context_window } : {}),
    ...(model.max_output_tokens ? { max_output_tokens: model.max_output_tokens } : {}),
    ...(model.effective_context_window_percent ? { effective_context_window_percent: model.effective_context_window_percent } : {}),
    ...(model.input_modalities ? { input_modalities: [...model.input_modalities] } : {}),
    ...(model.reasoning_capability ? { reasoning_capability: model.reasoning_capability } : {}),
    ...(model.default_reasoning_selection ? { default_reasoning_selection: model.default_reasoning_selection } : {}),
  };
}

function modelSelected(provider: FlowerProviderDraft, modelName: string): boolean {
  return provider.models.some((model) => cleanModelName(model.model_name) === cleanModelName(modelName));
}

export function FlowerProviderDialog(props: FlowerProviderDialogProps) {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const [customModelName, setCustomModelName] = createSignal('');
  const [expandedProviderType, setExpandedProviderType] = createSignal<FlowerProviderType | null>(null);
  const [store, setStore] = createStore<{ draft: FlowerProviderDraft | null }>({ draft: null });
  const providerHasModels = () => (store.draft?.models.length ?? 0) > 0;
  const providerTypeLabel = (type: FlowerProviderType): string => copy().providerTypeLabels[type] ?? type;

  createEffect(() => {
    if (props.open) {
      setStore('draft', reconcile(props.provider));
      setAdvancedOpen(false);
      setCustomModelName('');
      setExpandedProviderType(null);
    }
  });

  const updateProvider = (patch: Partial<FlowerProviderDraft>) => {
    setStore('draft', produce((d) => { if (d) Object.assign(d, patch); }));
  };

  const changeProviderType = (type: FlowerProviderType) => {
    if (!store.draft) return;
    const preset = recommendedModelsForFlowerProviderType(type);
    const nextModels = preset.length > 0 ? [cloneModel(preset[0])] : [];
    updateProvider({
      type,
      name: providerTypeLabel(type),
      base_url: defaultBaseURLForFlowerProviderType(type),
      web_search: flowerProviderNeedsWebSearchConfig(type) ? { mode: 'disabled' } : undefined,
      web_search_api_key: null,
      models: nextModels,
    });
  };

  const toggleProviderType = (type: FlowerProviderType) => {
    setExpandedProviderType((current) => (current === type ? null : type));
    if (store.draft?.type !== type) changeProviderType(type);
  };

  const setModels = (models: readonly FlowerProviderModel[]) => {
    setStore('draft', (draft) => (draft ? { ...draft, models: models.map(cloneModel) } : draft));
  };

  const addPreset = (model: FlowerProviderModel) => {
    if (!store.draft || modelSelected(store.draft, model.model_name)) return;
    setModels([...store.draft.models, cloneModel(model)]);
  };

  const removePreset = (modelName: string) => {
    if (!store.draft) return;
    const next = store.draft.models.filter((model) => cleanModelName(model.model_name) !== cleanModelName(modelName));
    setModels(next.length > 0 ? next : store.draft.models);
  };

  const addAllPresets = () => {
    if (!store.draft) return;
    const existing = new Set(store.draft.models.map((model) => cleanModelName(model.model_name)));
    const additions = recommendedModelsForFlowerProviderType(store.draft.type)
      .filter((model) => !existing.has(cleanModelName(model.model_name)))
      .map(cloneModel);
    setModels([...store.draft.models, ...additions]);
  };

  const addCustomModel = () => {
    const name = cleanModelName(customModelName());
    if (!store.draft || !name || modelSelected(store.draft, name)) return;
    setModels([
      ...store.draft.models,
      {
        model_name: name,
        context_window: defaultFlowerContextWindowForProviderType(store.draft.type),
        input_modalities: ['text'],
      },
    ]);
    setCustomModelName('');
  };

  const updateModel = (index: number, patch: Partial<FlowerProviderModel>) => {
    if (!store.draft) return;
    setModels(store.draft.models.map((model, modelIndex) => (modelIndex === index ? { ...model, ...patch } : model)));
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.mode === 'create' ? copy().addTitle : copy().editTitle}
      class="w-[min(72rem,96vw)] max-w-[96vw]"
      footer={(
        <div class="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {copy().discard}
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={props.saving}
            disabled={props.saving || !providerHasModels()}
            onClick={() => { if (store.draft) void props.onConfirm(store.draft); }}
          >
            {copy().saveProvider}
          </Button>
        </div>
      )}
    >
      <Show when={store.draft} fallback={<div class="text-sm text-muted-foreground">{copy().providerRemoved}</div>}>
        <div class="space-y-5">
          <section class="space-y-3">
            <FlowerSubSectionHeader
              title={copy().providerTypeTitle}
              description={copy().providerTypeDescription}
            />
            <div class="space-y-2">
              <For each={FLOWER_PROVIDER_TYPES}>
                {(item) => {
                  const active = () => store.draft!.type === item.value;
                  const expanded = () => expandedProviderType() === item.value;
                  const panelID = `flower-provider-type-${item.value}`;
                  const providerID = () => String(store.draft!.id ?? '').trim();
                  const builtInSearch = () => copy().builtInWebSearch[store.draft!.type] ?? '';
                  return (
                    <div class={cn('rounded-lg border bg-background transition', expanded() ? 'border-primary/50 ring-1 ring-primary/15' : 'border-border')}>
                      <button
                        type="button"
                        class={cn(
                          'flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60',
                          active() ? 'bg-primary/5' : '',
                        )}
                        onClick={() => toggleProviderType(item.value)}
                        aria-expanded={expanded()}
                        aria-controls={panelID}
                      >
                        <div class={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', active() ? 'bg-background' : 'bg-muted/60')}>
                          <FlowerProviderBrandIcon type={item.value} class="h-5 w-5" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center justify-between gap-2">
                          <div class="text-sm font-semibold text-foreground">{providerTypeLabel(item.value)}</div>
                            <div class="flex items-center gap-2 text-xs text-muted-foreground">
                              <Show when={active()}><span>{copy().current}</span></Show>
                              <span>{expanded() ? copy().collapse : copy().configure}</span>
                              <ChevronDown class={cn('h-3.5 w-3.5 transition-transform', expanded() ? 'rotate-180' : '')} />
                            </div>
                          </div>
                          <div class="mt-1 text-[11px] text-muted-foreground">{copy().providerTypeHints[item.value] ?? item.hint}</div>
                        </div>
                      </button>

                      <Show when={expanded()}>
                        <div id={panelID} class="max-h-[50vh] overflow-y-auto border-t border-border/80 p-4">
                          <div class="space-y-5">
                            <section class="space-y-3">
                              <FlowerSubSectionHeader title={copy().connectionTitle} description={copy().connectionDescription} />
                              <div class={cn('grid grid-cols-1 gap-3', flowerProviderUsesCustomName(store.draft!.type) ? 'sm:grid-cols-2' : '')}>
                                <Show when={flowerProviderUsesCustomName(store.draft!.type)}>
                                  <div>
                                    <FlowerFieldLabel>{copy().connectionName}</FlowerFieldLabel>
                                    <Input
                                      value={store.draft!.name ?? ''}
                                      onInput={(event) => updateProvider({ name: event.currentTarget.value })}
                                      placeholder={providerTypeLabel(store.draft!.type)}
                                      size="sm"
                                      class="w-full"
                                    />
                                  </div>
                                </Show>
                                <div>
                                  <FlowerFieldLabel hint={props.keyConfigured ? copy().storedKeyKept : copy().requiredBeforeUse}>
                                    {copy().apiKey}
                                  </FlowerFieldLabel>
                                  <Input
                                    type="password"
                                    value={store.draft!.provider_api_key ?? ''}
                                    onInput={(event) => updateProvider({
                                      provider_api_key: event.currentTarget.value,
                                    })}
                                    placeholder={props.keyConfigured ? copy().storedKeyKept : copy().pasteAPIKey}
                                    size="sm"
                                    class="w-full"
                                    disabled={!providerID()}
                                  />
                                </div>
                                <Show when={flowerProviderTypeRequiresBaseURL(store.draft!.type)}>
                                  <div>
                                    <FlowerFieldLabel hint={copy().required}>{copy().baseURL}</FlowerFieldLabel>
                                    <Input
                                      value={store.draft!.base_url ?? ''}
                                      onInput={(event) => updateProvider({ base_url: event.currentTarget.value })}
                                      placeholder={defaultBaseURLForFlowerProviderType(store.draft!.type)}
                                      size="sm"
                                      class="w-full"
                                    />
                                  </div>
                                </Show>
                                <Show when={flowerProviderNeedsWebSearchConfig(store.draft!.type)}>
                                  <div>
                                    <FlowerFieldLabel>{copy().webSearch}</FlowerFieldLabel>
                                    <Select
                                      value={store.draft!.web_search?.mode ?? 'disabled'}
                                      onChange={(value) => updateProvider({
                                        web_search: { mode: value as FlowerWebSearchMode },
                                        ...(value === 'brave' ? {} : { web_search_api_key: null }),
                                      })}
                                      options={[
                                        { value: 'disabled', label: copy().disabled },
                                        { value: 'openai_builtin', label: copy().openAIBuiltIn },
                                        { value: 'brave', label: copy().braveSearch },
                                      ]}
                                      class="w-full"
                                    />
                                  </div>
                                </Show>
                                <Show when={(store.draft!.web_search?.mode ?? 'disabled') === 'brave'}>
                                  <div>
                                    <FlowerFieldLabel hint={props.webSearchKeyConfigured ? copy().storedKeyKept : copy().requiredForBraveSearch}>
                                      {copy().braveAPIKey}
                                    </FlowerFieldLabel>
                                    <Input
                                      type="password"
                                      value={store.draft!.web_search_api_key ?? ''}
                                      onInput={(event) => updateProvider({
                                        web_search_api_key: event.currentTarget.value,
                                      })}
                                      placeholder={props.webSearchKeyConfigured ? copy().storedBraveKeyKept : copy().pasteBraveAPIKey}
                                      size="sm"
                                      class="w-full"
                                      disabled={!providerID()}
                                    />
                                  </div>
                                </Show>
                              </div>
                              <div class="flex flex-wrap gap-2">
                                <FlowerSettingsPill tone={props.keyConfigured || String(store.draft!.provider_api_key ?? '').trim() ? 'success' : 'default'}>
                                  {props.keyConfigured || String(store.draft!.provider_api_key ?? '').trim() ? copy().keyReady : copy().needsKey}
                                </FlowerSettingsPill>
                                <FlowerSettingsPill>{providerTypeLabel(store.draft!.type)}</FlowerSettingsPill>
                                <Show when={(store.draft!.web_search?.mode ?? 'disabled') === 'brave'}>
                                  <FlowerSettingsPill tone={props.webSearchKeyConfigured || String(store.draft!.web_search_api_key ?? '').trim() ? 'success' : 'default'}>
                                    {props.webSearchKeyConfigured || String(store.draft!.web_search_api_key ?? '').trim() ? copy().braveKeyReady : copy().needsBraveKey}
                                  </FlowerSettingsPill>
                                </Show>
                                <Show when={builtInSearch()}>
                                  {(label) => <FlowerSettingsPill tone="success">{label()}</FlowerSettingsPill>}
                                </Show>
                              </div>
                            </section>

                            <section class="space-y-3">
                              <FlowerSubSectionHeader
                                title={copy().recommendedModelsTitle}
                                description={copy().recommendedModelsDescription}
                                actions={(
                                  <Show when={recommendedModelsForFlowerProviderType(store.draft!.type).length > 0}>
                                    <Button size="sm" variant="outline" onClick={addAllPresets}>{copy().addAllPresets}</Button>
                                  </Show>
                                )}
                              />
                              <Show
                                when={recommendedModelsForFlowerProviderType(store.draft!.type).length > 0}
                                fallback={<div class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{copy().customModelProvider}</div>}
                              >
                                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                                  <For each={recommendedModelsForFlowerProviderType(store.draft!.type)}>
                                    {(model) => {
                                      const selected = () => modelSelected(store.draft!, model.model_name);
                                      return (
                                        <div class={cn('rounded-lg border p-3 transition', selected() ? 'border-primary/50 bg-primary/5' : 'border-border bg-background')}>
                                          <div class="flex items-start justify-between gap-3">
                                          <div class="min-w-0">
                                            <div class="break-all font-mono text-sm font-semibold text-foreground">{model.model_name}</div>
                                            <Show when={model.wire_model_name}>
                                              {(wireModelName) => <div class="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{wireModelName()}</div>}
                                            </Show>
                                            <div class="mt-1 text-xs text-muted-foreground">
                                                {formatFlowerTokenCount(model.context_window)} {copy().contextSuffix}
                                                <Show when={model.max_output_tokens}> · {formatFlowerTokenCount(model.max_output_tokens)} {copy().outputSuffix}</Show>
                                              </div>
                                            </div>
                                            <Button
                                              size="sm"
                                              variant={selected() ? 'ghost' : 'outline'}
                                              class={selected() ? 'text-muted-foreground hover:text-destructive' : ''}
                                              onClick={() => (selected() ? removePreset(model.model_name) : addPreset(model))}
                                            >
                                              {selected() ? copy().remove : copy().add}
                                            </Button>
                                          </div>
                                          <div class="mt-2 flex flex-wrap gap-1.5">
                                            <FlowerCapabilityTag active>{copy().text}</FlowerCapabilityTag>
                                            <FlowerCapabilityTag active={flowerModelSupportsImage(model.input_modalities)}>{copy().imageInput}</FlowerCapabilityTag>
                                            <Show when={selected()}><FlowerCapabilityTag active>{copy().selected}</FlowerCapabilityTag></Show>
                                          </div>
                                          <Show when={copy().modelNote(model.note_key)}>
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
                              </div>
                            </section>

                            <section class="space-y-3">
                              <FlowerSubSectionHeader title={copy().selectedModelsTitle} description={copy().selectedModelsDescription} />
                              <Show
                                when={store.draft!.models.length > 0}
                                fallback={<div class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{copy().noSelectedModels}</div>}
                              >
                                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                                  <For each={store.draft!.models}>
                                    {(model, index) => (
                                      <div class="rounded-lg border border-border bg-background p-3">
                                        <div class="flex items-start justify-between gap-3">
                                          <div class="min-w-0">
                                            <div class="break-all font-mono text-sm font-semibold text-foreground">{cleanModelName(model.model_name) || copy().unnamedModel}</div>
                                            <Show when={model.wire_model_name}>
                                              {(wireModelName) => <div class="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{wireModelName()}</div>}
                                            </Show>
                                            <div class="mt-1 text-xs text-muted-foreground">
                                              {flowerModelSupportsImage(model.input_modalities) ? copy().textAndImage : copy().textOnly} · {formatFlowerTokenCount(model.context_window)} {copy().contextSuffix}
                                            </div>
                                          </div>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            class="text-muted-foreground hover:text-destructive"
                                            onClick={() => setModels(store.draft!.models.filter((_, itemIndex) => itemIndex !== index()))}
                                            disabled={store.draft!.models.length <= 1}
                                          >
                                            {copy().remove}
                                          </Button>
                                        </div>
                                        <div class="mt-2 flex flex-wrap gap-1.5">
                                          <FlowerCapabilityTag active>{copy().text}</FlowerCapabilityTag>
                                          <FlowerCapabilityTag active={flowerModelSupportsImage(model.input_modalities)}>{copy().imageInput}</FlowerCapabilityTag>
                                        </div>
                                        <div class="mt-2 text-[11px] text-muted-foreground">
                                          {flowerModelID(providerID(), cleanModelName(model.model_name)) || copy().modelIDPending}
                                        </div>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </section>

                            <section class="space-y-3">
                              <button
                                type="button"
                                class="flex w-full cursor-pointer items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3 text-left transition hover:bg-muted/35"
                                onClick={() => setAdvancedOpen(!advancedOpen())}
                              >
                                <span class="min-w-0">
                                  <span class="block text-sm font-semibold text-foreground">{copy().advancedTitle}</span>
                                  <span class="mt-1 block text-xs leading-5 text-muted-foreground">{copy().advancedDescription}</span>
                                </span>
                                <span class="text-xs text-muted-foreground">{advancedOpen() ? copy().hide : copy().show}</span>
                              </button>
                              <Show when={advancedOpen()}>
                                <div class="space-y-3">
                                  <For each={store.draft!.models}>
                                    {(model, index) => (
                                      <div class="rounded-lg border border-border bg-background p-3">
                                        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                                          <div class="font-mono text-xs text-muted-foreground">{flowerModelID(providerID(), cleanModelName(model.model_name)) || copy().modelIDPending}</div>
                                          <FlowerCodeBadge>{providerID() || copy().providerIDPending}</FlowerCodeBadge>
                                        </div>
                                        <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
                                          <div class="md:col-span-2">
                                            <FlowerFieldLabel>{copy().modelName}</FlowerFieldLabel>
                                            <Input
                                              value={model.model_name}
                                              onInput={(event) => updateModel(index(), { model_name: event.currentTarget.value })}
                                              placeholder="model-name"
                                              size="sm"
                                              class="w-full font-mono"
                                            />
                                          </div>
                                          <div class="md:col-span-2">
                                            <FlowerFieldLabel>{copy().providerModelID}</FlowerFieldLabel>
                                            <Input
                                              value={model.wire_model_name ?? ''}
                                              onInput={(event) => updateModel(index(), { wire_model_name: event.currentTarget.value || undefined })}
                                              placeholder={model.model_name}
                                              size="sm"
                                              class="w-full font-mono"
                                            />
                                          </div>
                                          <div>
                                            <FlowerFieldLabel>{copy().contextWindow}</FlowerFieldLabel>
                                            <Input
                                              type="number"
                                              value={model.context_window ?? ''}
                                              onInput={(event) => updateModel(index(), { context_window: Number(event.currentTarget.value) || undefined })}
                                              placeholder="128000"
                                              size="sm"
                                              class="w-full font-mono"
                                            />
                                          </div>
                                          <div>
                                            <FlowerFieldLabel>{copy().maxOutput}</FlowerFieldLabel>
                                            <Input
                                              type="number"
                                              value={model.max_output_tokens ?? ''}
                                              onInput={(event) => updateModel(index(), { max_output_tokens: Number(event.currentTarget.value) || undefined })}
                                              placeholder="4096"
                                              size="sm"
                                              class="w-full font-mono"
                                            />
                                          </div>
                                          <div>
                                            <FlowerFieldLabel>{copy().effectiveContextPercent}</FlowerFieldLabel>
                                            <Input
                                              type="number"
                                              value={model.effective_context_window_percent ?? ''}
                                              onInput={(event) => updateModel(index(), { effective_context_window_percent: Number(event.currentTarget.value) || undefined })}
                                              placeholder="95"
                                              size="sm"
                                              class="w-full font-mono"
                                            />
                                          </div>
                                          <div class="md:col-span-3">
                                            <Checkbox
                                              checked={flowerModelSupportsImage(model.input_modalities)}
                                              onChange={(enabled) => updateModel(index(), { input_modalities: enabled ? ['text', 'image'] : ['text'] })}
                                              label={copy().imageInput}
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
                            <Show when={props.error}>
                              {(error) => (
                                <div role="alert" class="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                                  {error()}
                                </div>
                              )}
                            </Show>
                          </div>
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </section>
        </div>
      </Show>
    </Dialog>
  );
}
