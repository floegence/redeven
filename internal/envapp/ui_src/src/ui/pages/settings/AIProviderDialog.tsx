import { For, Index, Show } from 'solid-js';
import { Button, Dialog, Input, Select } from '@floegence/floe-webapp-core/ui';
import {
  AI_PROVIDER_TYPE_OPTIONS,
  defaultBaseURLForProviderType,
  formatTokenCount,
  modelID,
  providerTypeRequiresBaseURL,
} from './aiCatalog';
import {
  CodeBadge,
  FieldLabel,
  SettingsPill,
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeaderCell,
  SettingsTableHeaderRow,
  SettingsTableRow,
  SubSectionHeader,
} from './SettingsPrimitives';
import type { AIProviderModelPreset, AIProviderRow, AIProviderType } from './types';

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
  presetModel: string;
  recommendedModels: readonly AIProviderModelPreset[];
  recommendedModelOptions: ReadonlyArray<{ value: string; label: string }>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onChangeName: (value: string) => void;
  onChangeType: (value: AIProviderType) => void;
  onChangeBaseURL: (value: string) => void;
  onChangeKeyDraft: (value: string) => void;
  onSaveKey: () => void;
  onClearKey: () => void;
  onSetPresetModel: (value: string) => void;
  onApplyAllPresets: () => void;
  onAddSelectedPreset: () => void;
  onAddModel: () => void;
  onChangeModelName: (index: number, value: string) => void;
  onChangeModelNumber: (
    index: number,
    key: 'context_window' | 'max_output_tokens' | 'effective_context_window_percent',
    rawValue: string,
  ) => void;
  onRemoveModel: (index: number) => void;
};

export function AIProviderDialog(props: AIProviderDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      footer={
        <div class="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            Discard
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={props.onConfirm}
            disabled={!props.canInteract || props.aiSaving || props.disableAISaving}
          >
            Confirm
          </Button>
        </div>
      }
    >
      <Show when={props.provider} fallback={<div class="text-sm text-muted-foreground">Provider was removed.</div>}>
        {(providerAccessor) => {
          const provider = () => providerAccessor();
          const providerID = () => String(provider().id ?? '').trim();
          return (
            <div class="space-y-4">
              <SettingsTable minWidthClass="min-w-[44rem]">
                <SettingsTableHead>
                  <SettingsTableHeaderRow>
                    <SettingsTableHeaderCell class="w-44">Setting</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell class="w-64">Notes</SettingsTableHeaderCell>
                  </SettingsTableHeaderRow>
                </SettingsTableHead>
                <SettingsTableBody>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">
                      <FieldLabel hint="optional">name</FieldLabel>
                    </SettingsTableCell>
                    <SettingsTableCell>
                      <Input
                        value={provider().name}
                        onInput={(event) => props.onChangeName(event.currentTarget.value)}
                        placeholder="OpenAI"
                        size="sm"
                        class="w-full"
                        disabled={!props.canInteract}
                      />
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">User-facing label shown in selectors.</SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">
                      <FieldLabel>type</FieldLabel>
                    </SettingsTableCell>
                    <SettingsTableCell>
                      <Select
                        value={provider().type}
                        onChange={(value) => props.onChangeType(value as AIProviderType)}
                        disabled={!props.canInteract}
                        options={[...AI_PROVIDER_TYPE_OPTIONS]}
                        class="w-full"
                      />
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">
                      Changing the provider type can replace the base URL and recommended model presets.
                    </SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">
                      <FieldLabel hint="read-only">provider_id</FieldLabel>
                    </SettingsTableCell>
                    <SettingsTableCell>
                      <CodeBadge>{providerID() || '—'}</CodeBadge>
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">
                      Stable internal key used for secrets and wire model ids.
                    </SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">
                      <FieldLabel hint={providerTypeRequiresBaseURL(provider().type) ? 'required' : 'optional'}>base_url</FieldLabel>
                    </SettingsTableCell>
                    <SettingsTableCell>
                      <Input
                        value={provider().base_url}
                        onInput={(event) => props.onChangeBaseURL(event.currentTarget.value)}
                        placeholder={defaultBaseURLForProviderType(provider().type)}
                        size="sm"
                        class="w-full"
                        disabled={!props.canInteract}
                      />
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">
                      Required for custom/OpenAI-compatible endpoints and some native providers.
                    </SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">
                      <FieldLabel hint="stored locally, never shown again">api_key</FieldLabel>
                    </SettingsTableCell>
                    <SettingsTableCell>
                      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <SettingsPill tone={props.keySet ? 'success' : 'default'}>{props.keySet ? 'Key set' : 'Key not set'}</SettingsPill>
                        <Input
                          type="password"
                          value={props.keyDraft}
                          onInput={(event) => props.onChangeKeyDraft(event.currentTarget.value)}
                          placeholder="Paste API key"
                          size="sm"
                          class="w-full"
                          disabled={!props.canInteract || !props.canAdmin || !providerID()}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={props.onSaveKey}
                          loading={props.keySaving}
                          disabled={!props.canInteract || !props.canAdmin || !providerID()}
                        >
                          Save key
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          class="text-muted-foreground hover:text-destructive"
                          onClick={props.onClearKey}
                          disabled={!props.canInteract || !props.canAdmin || !providerID()}
                        >
                          Clear
                        </Button>
                      </div>
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">
                      Secrets stay in a separate local secrets file and never go back into config responses.
                    </SettingsTableCell>
                  </SettingsTableRow>
                </SettingsTableBody>
              </SettingsTable>

              <Show when={props.recommendedModels.length > 0}>
                <div class="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                  <SubSectionHeader
                    title="Recommended models"
                    description="Maintained presets with context metadata for quick setup."
                    actions={
                      <Button size="sm" variant="outline" onClick={props.onApplyAllPresets} disabled={!props.canInteract}>
                        Apply all presets
                      </Button>
                    }
                  />
                  <div class="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                    <Select
                      value={props.presetModel}
                      onChange={(value) => props.onSetPresetModel(String(value ?? '').trim())}
                      options={[...props.recommendedModelOptions]}
                      placeholder="Select a recommended model..."
                      class="w-full"
                      disabled={!props.canInteract}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={props.onAddSelectedPreset}
                      disabled={!props.canInteract || !props.presetModel}
                    >
                      Add selected preset
                    </Button>
                  </div>
                  <SettingsTable minWidthClass="min-w-[48rem]">
                    <SettingsTableHead>
                      <SettingsTableHeaderRow>
                        <SettingsTableHeaderCell>Model</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-32">Context</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-32">Max Output</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="w-32">Effective %</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell>Notes</SettingsTableHeaderCell>
                      </SettingsTableHeaderRow>
                    </SettingsTableHead>
                    <SettingsTableBody>
                      <For each={props.recommendedModels}>
                        {(preset) => (
                          <SettingsTableRow>
                            <SettingsTableCell class="font-mono">{preset.model_name}</SettingsTableCell>
                            <SettingsTableCell>{formatTokenCount(preset.context_window)}</SettingsTableCell>
                            <SettingsTableCell>{preset.max_output_tokens ? formatTokenCount(preset.max_output_tokens) : '—'}</SettingsTableCell>
                            <SettingsTableCell>{preset.effective_context_window_percent ?? '—'}</SettingsTableCell>
                            <SettingsTableCell class="text-[11px] text-muted-foreground">{preset.note ?? '—'}</SettingsTableCell>
                          </SettingsTableRow>
                        )}
                      </For>
                    </SettingsTableBody>
                  </SettingsTable>
                </div>
              </Show>

              <div class="space-y-3">
                <SubSectionHeader
                  title="Models"
                  description="Shown in Flower Chat. Every provider model must stay inside this registry."
                  actions={
                    <Button size="sm" variant="outline" onClick={props.onAddModel} disabled={!props.canInteract}>
                      Add Model
                    </Button>
                  }
                />

                <SettingsTable minWidthClass="min-w-[72rem]">
                  <SettingsTableHead sticky>
                    <SettingsTableHeaderRow>
                      <SettingsTableHeaderCell class="w-56">Model Name</SettingsTableHeaderCell>
                      <SettingsTableHeaderCell class="w-36">Context Window</SettingsTableHeaderCell>
                      <SettingsTableHeaderCell class="w-36">Max Output</SettingsTableHeaderCell>
                      <SettingsTableHeaderCell class="w-44">Effective Context %</SettingsTableHeaderCell>
                      <SettingsTableHeaderCell>Wire Model ID</SettingsTableHeaderCell>
                      <SettingsTableHeaderCell class="w-28">Actions</SettingsTableHeaderCell>
                    </SettingsTableHeaderRow>
                  </SettingsTableHead>
                  <SettingsTableBody>
                    <Index each={provider().models}>
                      {(model, modelIndex) => (
                        <SettingsTableRow>
                          <SettingsTableCell>
                            <Input
                              value={model().model_name}
                              onInput={(event) => props.onChangeModelName(modelIndex, event.currentTarget.value)}
                              placeholder="model_name"
                              size="sm"
                              class="w-full font-mono text-xs"
                              disabled={!props.canInteract}
                            />
                          </SettingsTableCell>
                          <SettingsTableCell>
                            <Input
                              type="number"
                              value={model().context_window ?? ''}
                              onInput={(event) => props.onChangeModelNumber(modelIndex, 'context_window', event.currentTarget.value)}
                              placeholder="context_window"
                              size="sm"
                              class="w-full font-mono text-xs"
                              disabled={!props.canInteract}
                            />
                          </SettingsTableCell>
                          <SettingsTableCell>
                            <Input
                              type="number"
                              value={model().max_output_tokens ?? ''}
                              onInput={(event) => props.onChangeModelNumber(modelIndex, 'max_output_tokens', event.currentTarget.value)}
                              placeholder="max_output_tokens"
                              size="sm"
                              class="w-full font-mono text-xs"
                              disabled={!props.canInteract}
                            />
                          </SettingsTableCell>
                          <SettingsTableCell>
                            <Input
                              type="number"
                              value={model().effective_context_window_percent ?? ''}
                              onInput={(event) =>
                                props.onChangeModelNumber(modelIndex, 'effective_context_window_percent', event.currentTarget.value)}
                              placeholder="effective_context_window_percent"
                              size="sm"
                              class="w-full font-mono text-xs"
                              disabled={!props.canInteract}
                            />
                          </SettingsTableCell>
                          <SettingsTableCell>
                            <div class="break-all font-mono text-[11px] text-muted-foreground">
                              {modelID(providerID(), model().model_name) || '—'}
                            </div>
                            <div class="mt-1 text-[11px] text-muted-foreground">
                              ctx {formatTokenCount(Number(model().context_window ?? 0))}
                              <Show when={model().max_output_tokens}>
                                {' '}
                                · max {formatTokenCount(Number(model().max_output_tokens ?? 0))}
                              </Show>
                            </div>
                          </SettingsTableCell>
                          <SettingsTableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="text-muted-foreground hover:text-destructive"
                              onClick={() => props.onRemoveModel(modelIndex)}
                              disabled={!props.canInteract || (provider().models?.length ?? 0) <= 1}
                            >
                              Remove
                            </Button>
                          </SettingsTableCell>
                        </SettingsTableRow>
                      )}
                    </Index>
                  </SettingsTableBody>
                </SettingsTable>
              </div>
            </div>
          );
        }}
      </Show>
    </Dialog>
  );
}
