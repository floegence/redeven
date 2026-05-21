import { For, Show, createMemo, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button, Checkbox, Dialog, Input, Select } from '@floegence/floe-webapp-core/ui';
import {
  AI_PROVIDER_TYPE_OPTIONS,
  defaultBaseURLForProviderType,
  formatTokenCount,
  modalitySummary,
  modelID,
  modelSupportsImageInput,
  providerBuiltInWebSearchLabel,
  providerNeedsWebSearchConfig,
  providerTypeLabel,
  providerUsesCustomConnectionName,
  providerTypeRequiresBaseURL,
} from './aiCatalog';
import { ProviderBrandIcon } from './ProviderBrandIcon';
import {
  AdvancedCollapse,
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
  disableAISaving: boolean;
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
  onChangeModelName: (index: number, value: string) => void;
  onChangeModelNumber: (index: number, key: 'context_window' | 'max_output_tokens' | 'effective_context_window_percent', rawValue: string) => void;
  onChangeModelImageInput: (index: number, enabled: boolean) => void;
  onRemoveModel: (index: number) => void;
};

export function AIProviderDialog(props: AIProviderDialogProps) {
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const [customModelName, setCustomModelName] = createSignal('');
  const saving = createMemo(() => props.aiSaving || props.keySaving || props.webSearchKeySaving);

  const useCustomModel = () => {
    const name = String(customModelName() ?? '').trim();
    if (!name) return;
    props.onAddCustomModel(name);
    setCustomModelName('');
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      class="w-[min(68rem,96vw)] max-w-[96vw]"
      footer={
        <div class="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            Discard
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={props.onConfirm}
            loading={saving()}
            disabled={!props.canInteract || saving() || props.disableAISaving}
          >
            Save Provider
          </Button>
        </div>
      }
    >
      <Show when={props.provider} fallback={<div class="text-sm text-muted-foreground">Provider was removed.</div>}>
        {(providerAccessor) => {
          const provider = () => providerAccessor();
          const providerID = () => String(provider().id ?? '').trim();
          const models = () => (Array.isArray(provider().models) ? provider().models : []);
          const enabledModelNames = createMemo(
            () => new Set(models().map((model) => String(model.model_name ?? '').trim()).filter(Boolean)),
          );
          const recommendedModelEnabled = (modelName: string) => enabledModelNames().has(String(modelName ?? '').trim());
          return (
            <div class="space-y-5">
              <section class="space-y-3">
                <SubSectionHeader title="Provider Type" description="Choose the connection family first; the template owns defaults and presets." />
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <For each={AI_PROVIDER_TYPE_OPTIONS}>
                    {(item) => {
                      const active = () => provider().type === item.value;
                      return (
                        <button
                          type="button"
                          class={cn(
                            'cursor-pointer rounded-lg border px-3 py-3 text-left transition hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60',
                            active() ? 'border-primary bg-primary/10 ring-1 ring-primary/20' : 'border-border bg-background',
                          )}
                          onClick={() => props.onChangeType(item.value)}
                          disabled={!props.canInteract}
                        >
                          <div class="flex items-start gap-3">
                            <div class={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted/60 ring-1 ring-border', active() ? 'bg-background ring-primary/30' : '')}>
                              <ProviderBrandIcon type={item.value} class="h-5 w-5" />
                            </div>
                            <div class="min-w-0">
                              <div class="text-sm font-semibold text-foreground">{item.label}</div>
                              <div class="mt-1 text-[11px] text-muted-foreground">{item.description}</div>
                            </div>
                          </div>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </section>

              <section class="space-y-3 rounded-lg border border-border bg-background p-3">
                <SubSectionHeader title="Connection" description="Secrets are saved with the provider; existing keys are never shown again." />
                <div class={cn('grid grid-cols-1 gap-3', providerUsesCustomConnectionName(provider().type) ? 'sm:grid-cols-2' : '')}>
                  <Show when={providerUsesCustomConnectionName(provider().type)}>
                    <div>
                      <FieldLabel>Connection Name</FieldLabel>
                      <Input
                        value={provider().name}
                        onInput={(event) => props.onChangeName(event.currentTarget.value)}
                        placeholder={providerTypeLabel(provider().type)}
                        size="sm"
                        class="w-full"
                        disabled={!props.canInteract}
                      />
                    </div>
                  </Show>
                  <div>
                    <FieldLabel hint={props.keySet ? 'saved key will remain if left blank' : 'required before use'}>API Key</FieldLabel>
                    <Input
                      type="password"
                      value={props.keyDraft}
                      onInput={(event) => props.onChangeKeyDraft(event.currentTarget.value)}
                      placeholder={props.keySet ? 'Keep existing key' : 'Paste API key'}
                      size="sm"
                      class="w-full"
                      disabled={!props.canInteract || !props.canAdmin || !providerID()}
                    />
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <SettingsPill tone={props.keySet || String(props.keyDraft ?? '').trim() ? 'success' : 'default'}>
                    {props.keySet || String(props.keyDraft ?? '').trim() ? 'Key ready' : 'Needs key'}
                  </SettingsPill>
                  <SettingsPill>{providerTypeLabel(provider().type)}</SettingsPill>
                  <Show when={providerBuiltInWebSearchLabel(provider().type)}>
                    {(label) => <SettingsPill tone="success">{label()}</SettingsPill>}
                  </Show>
                </div>
              </section>

              <section class="space-y-3">
                <SubSectionHeader
                  title="Recommended Models"
                  description="Use curated presets or add a custom model when the provider does not expose discovery."
                  actions={
                    <Show when={props.recommendedModels.length > 0}>
                      <Button size="sm" variant="outline" onClick={props.onApplyAllPresets} disabled={!props.canInteract}>
                        Use All
                      </Button>
                    </Show>
                  }
                />
                <Show
                  when={props.recommendedModels.length > 0}
                  fallback={<div class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No maintained presets for this provider type. Add a custom model below.</div>}
                >
                  <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <For each={props.recommendedModels}>
                      {(preset) => {
                        const enabled = () => recommendedModelEnabled(preset.model_name);
                        return (
                          <div class="rounded-lg border border-border bg-background p-3">
                            <div class="flex items-start justify-between gap-3">
                              <div class="min-w-0">
                                <div class="break-all font-mono text-sm font-semibold text-foreground">{preset.model_name}</div>
                                <div class="mt-1 text-xs text-muted-foreground">
                                  Context {formatTokenCount(preset.context_window)}
                                  <Show when={preset.max_output_tokens}> · Output {formatTokenCount(Number(preset.max_output_tokens ?? 0))}</Show>
                                </div>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => props.onAddSelectedPreset(preset.model_name)} disabled={!props.canInteract || enabled()}>
                                {enabled() ? 'Added' : 'Use'}
                              </Button>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-1.5">
                              <CapabilityTag active>Text</CapabilityTag>
                              <CapabilityTag active={modelSupportsImageInput(preset.input_modalities)}>Image Input</CapabilityTag>
                            </div>
                            <Show when={preset.note}>
                              <div class="mt-2 text-[11px] text-muted-foreground">{preset.note}</div>
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
                    placeholder="Custom model name"
                    size="sm"
                    class="w-full font-mono"
                    disabled={!props.canInteract}
                  />
                  <Button size="sm" variant="outline" onClick={useCustomModel} disabled={!props.canInteract || !String(customModelName() ?? '').trim()}>
                    Add Custom Model
                  </Button>
                </div>
              </section>

              <section class="space-y-3">
                <SubSectionHeader title="Enabled Models" description="These models appear in Flower Chat and can be selected as the current model." />
                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <For each={models()}>
                    {(model, index) => (
                      <div class="rounded-lg border border-border bg-background p-3">
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <div class="break-all font-mono text-sm font-semibold text-foreground">{String(model.model_name ?? '').trim() || 'Unnamed model'}</div>
                            <div class="mt-1 text-xs text-muted-foreground">
                              {modalitySummary(model.input_modalities)} · Context {formatTokenCount(Number(model.context_window ?? 0))}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            class="text-muted-foreground hover:text-destructive"
                            onClick={() => props.onRemoveModel(index())}
                            disabled={!props.canInteract || models().length <= 1}
                          >
                            Remove
                          </Button>
                        </div>
                        <div class="mt-2 flex flex-wrap gap-1.5">
                          <CapabilityTag active>Text</CapabilityTag>
                          <CapabilityTag active={modelSupportsImageInput(model.input_modalities)}>Image Input</CapabilityTag>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </section>

              <AdvancedCollapse
                title="Advanced"
                description="Endpoint, search mode, context windows, output limits, and model wire IDs."
                open={advancedOpen()}
                onOpenChange={setAdvancedOpen}
              >
                <div class="space-y-4">
                  <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <FieldLabel hint={providerTypeRequiresBaseURL(provider().type) ? 'required' : 'optional'}>Base URL</FieldLabel>
                      <Input
                        value={provider().base_url}
                        onInput={(event) => props.onChangeBaseURL(event.currentTarget.value)}
                        placeholder={defaultBaseURLForProviderType(provider().type)}
                        size="sm"
                        class="w-full"
                        disabled={!props.canInteract}
                      />
                    </div>
                    <Show when={providerNeedsWebSearchConfig(provider().type)}>
                      <div>
                        <FieldLabel>Web Search</FieldLabel>
                        <Select
                          value={provider().web_search?.mode ?? 'disabled'}
                          onChange={(value) => props.onChangeWebSearchMode(value as AIProviderWebSearchMode)}
                          disabled={!props.canInteract}
                          options={[
                            { value: 'disabled', label: 'Disabled' },
                            { value: 'openai_builtin', label: 'OpenAI Built-in' },
                            { value: 'brave', label: 'Brave web.search' },
                          ]}
                          class="w-full"
                        />
                      </div>
                    </Show>
                    <Show when={(provider().web_search?.mode ?? 'disabled') === 'brave'}>
                      <div>
                        <FieldLabel hint={props.webSearchKeySet ? 'saved key will remain if left blank' : 'required for Brave mode'}>Brave API Key</FieldLabel>
                        <Input
                          type="password"
                          value={props.webSearchKeyDraft}
                          onInput={(event) => props.onChangeWebSearchKeyDraft(event.currentTarget.value)}
                          placeholder={props.webSearchKeySet ? 'Keep existing Brave key' : 'Paste Brave API key'}
                          size="sm"
                          class="w-full"
                          disabled={!props.canInteract || !props.canAdmin || !providerID()}
                        />
                      </div>
                    </Show>
                  </div>

                  <div class="space-y-3">
                    <For each={models()}>
                      {(model, index) => (
                        <div class="rounded-lg border border-border bg-background p-3">
                          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div class="font-mono text-xs text-muted-foreground">{modelID(providerID(), model.model_name) || 'No wire model id yet'}</div>
                            <CodeBadge>{providerID() || 'provider id pending'}</CodeBadge>
                          </div>
                          <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
                            <div class="md:col-span-2">
                              <FieldLabel>Model Name</FieldLabel>
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
                              <FieldLabel>Context Window</FieldLabel>
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
                              <FieldLabel>Max Output</FieldLabel>
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
                              <FieldLabel>Effective Context %</FieldLabel>
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
                                label="Image Input"
                                size="sm"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </AdvancedCollapse>
            </div>
          );
        }}
      </Show>
    </Dialog>
  );
}
