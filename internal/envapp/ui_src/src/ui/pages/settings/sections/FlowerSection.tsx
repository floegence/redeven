import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { AlertTriangle, Bot, Pencil, Plus, Shield, Trash, Zap } from '@floegence/floe-webapp-core/icons';
import { Button, Checkbox, ConfirmDialog, Input, Select } from '@floegence/floe-webapp-core/ui';
import { cn } from '@floegence/floe-webapp-core';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import {
  SettingsCard, ViewToggle, AutoSaveIndicator, JSONEditor, SubSectionHeader,
  CodeBadge, SettingsPill, type ViewMode,
} from '../SettingsPrimitives';
import { AIProviderDialog } from '../AIProviderDialog';
import { ProviderBrandIcon } from '../ProviderBrandIcon';
import { redevenSurfaceRoleClass } from '../../../utils/redevenSurfaceRoles';
import { formatUnknownError } from '../../../maintenance/shared';
import {
  cloneAIProviderRow, defaultBaseURLForProviderType, modelID, modelSupportsImageInput,
  normalizeAIProviderRowDraft, providerBuiltInWebSearchLabel, providerDisplayName,
  providerNeedsWebSearchConfig, providerPresetForType, providerTypeLabel,
  providerTypeRequiresBaseURL, providerUsesCustomConnectionName,
  recommendedModelsForProviderType, normalizeContextWindowByProvider,
  normalizeEffectiveContextPercent, normalizeInputModalities, normalizePositiveInteger,
  providerSupportsCustomModelNames, defaultContextWindowForProviderType,
} from '../aiCatalog';
import type {
  AIProviderRow, AIProviderType, AIProviderModelRow, AIProviderWebSearchMode,
  AIProviderDialogMode,
} from '../types';

const AUTO_SAVE_DELAY_MS = 700;
const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 80;

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

function providerWebSearchSummary(provider: AIProviderRow): string {
  const builtInLabel = providerBuiltInWebSearchLabel(provider.type);
  if (builtInLabel) return builtInLabel;
  if (!providerNeedsWebSearchConfig(provider.type)) return 'Not supported';
  switch (normalizeAIProviderWebSearchMode(provider.web_search?.mode)) {
    case 'openai_builtin': return 'OpenAI Responses built-in';
    case 'brave': return 'Brave web.search';
    default: return 'Disabled';
  }
}

function normalizeProviderModelRows(type: AIProviderType, models: AIProviderModelRow[]): AIProviderModelRow[] {
  return models.map((m) => ({ ...m, context_window: normalizeContextWindowByProvider(type, m.context_window), effective_context_window_percent: normalizeEffectiveContextPercent(m.effective_context_window_percent) }));
}

export function FlowerSection() {
  const ctx = useEnvSettingsPage();

  const [viewMode, setViewMode] = createSignal<ViewMode>('ui');
  const [aiEnabled, setAiEnabled] = createSignal(true);
  const [requireUserApproval, setRequireUserApproval] = createSignal(false);
  const [blockDangerousCommands, setBlockDangerousCommands] = createSignal(false);
  const [currentModelID, setCurrentModelID] = createSignal('');
  const [providers, setProviders] = createSignal<AIProviderRow[]>([]);
  const [providerKeySet, setProviderKeySet] = createSignal<Record<string, boolean>>({});
  const [providerKeyDraft, setProviderKeyDraft] = createSignal<Record<string, string>>({});
  const [providerKeySaving, setProviderKeySaving] = createSignal<Record<string, boolean>>({});
  const [webSearchKeySet, setWebSearchKeySet] = createSignal<Record<string, boolean>>({});
  const [webSearchKeyDraft, setWebSearchKeyDraft] = createSignal<Record<string, string>>({});
  const [webSearchKeySaving, setWebSearchKeySaving] = createSignal<Record<string, boolean>>({});
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
  const effectiveCurrentModelID = createMemo(() => normalizeAICurrentModelID(currentModelID(), providers()));

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
        setSaving(false); setError(formatUnknownError(e) || 'Save failed.');
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
    } catch (e) { /* ignore */ }
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
    if (idx != null) {
      setProviders((prev) => normalizeAIProviders(prev.map((p, i) => (i === idx ? normalizeAIProviderRowDraft(draft) : p))));
    } else {
      setProviders((prev) => normalizeAIProviders([...prev, normalizeAIProviderRowDraft(draft)]));
    }
    setCurrentModelID(normalizeAICurrentModelID(currentModelID(), providers()));
    setDirty(true);
    closeAIProviderDialog();
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
    } catch (e) { /* ignore */ }
    setDisableAISaving(false);
  };

  return (
    <>
      <SettingsCard
        icon={Zap}
        title="Flower"
        description="Configure Flower providers, models, execution safeguards, and local AI secrets."
        badge={aiEnabled() ? 'Active' : 'Disabled'}
        badgeVariant={aiEnabled() ? 'success' : 'default'}
        error={error()}
        actions={
          <>
            <ViewToggle value={viewMode} disabled={!ctx.canInteract()} onChange={switchView} />
            <AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={ctx.canInteract()} />
            <Show when={aiEnabled()}>
              <Button size="sm" variant="destructive" onClick={() => setDisableAIOpen(true)} disabled={!ctx.canInteract() || saving()}>Disable Flower</Button>
            </Show>
          </>
        }
      >
        <Show when={!aiEnabled() && !ctx.settings.loading && !ctx.settings.error}>
          <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <Zap class="h-5 w-5 text-muted-foreground" />
            <div class="text-sm text-muted-foreground">Flower is currently disabled. Configure providers below to enable it automatically.</div>
          </div>
        </Show>

        <Show
          when={viewMode() === 'ui'}
          fallback={<JSONEditor value={jsonText()} onChange={(v) => { try { const p = JSON.parse(v); if (p.current_model_id) setCurrentModelID(p.current_model_id); if (p.execution_policy) { setRequireUserApproval(p.execution_policy.require_user_approval ?? false); setBlockDangerousCommands(p.execution_policy.block_dangerous_commands ?? false); } setDirty(true); } catch {} }} disabled={!ctx.canInteract()} rows={14} />}
        >
          <div class="space-y-6">
            {/* Execution Policy */}
            <div class="space-y-3">
              <SubSectionHeader title="Execution Policy" description="Guardrails for tool execution and user interaction." />
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class={cn('group flex cursor-pointer flex-col gap-2.5 rounded-xl border px-4 py-3.5 transition-all duration-150', redevenSurfaceRoleClass('panel'), ctx.canInteract() && 'hover:border-primary/40 hover:shadow-sm', !ctx.canInteract() && 'cursor-not-allowed opacity-50')}>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                      <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10"><Shield class="h-4 w-4 text-blue-500" /></div>
                      <span class="text-sm font-semibold text-foreground">User approval</span>
                    </div>
                    <Checkbox checked={requireUserApproval()} onChange={(v) => { setRequireUserApproval(v); setDirty(true); }} disabled={!ctx.canInteract()} label="" size="sm" />
                  </div>
                  <p class="text-xs leading-relaxed text-muted-foreground">Require explicit approval before executing mutating tools.</p>
                </label>
                <label class={cn('group flex cursor-pointer flex-col gap-2.5 rounded-xl border px-4 py-3.5 transition-all duration-150', redevenSurfaceRoleClass('panel'), ctx.canInteract() && 'hover:border-primary/40 hover:shadow-sm', !ctx.canInteract() && 'cursor-not-allowed opacity-50')}>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                      <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10"><AlertTriangle class="h-4 w-4 text-amber-500" /></div>
                      <span class="text-sm font-semibold text-foreground">Block dangerous commands</span>
                    </div>
                    <Checkbox checked={blockDangerousCommands()} onChange={(v) => { setBlockDangerousCommands(v); setDirty(true); }} disabled={!ctx.canInteract()} label="" size="sm" />
                  </div>
                  <p class="text-xs leading-relaxed text-muted-foreground">Prevent high-risk terminal commands from executing directly in act mode.</p>
                </label>
              </div>
              <Show when={!blockDangerousCommands()}>
                <div class="flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning/10 p-3">
                  <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div class="text-xs font-medium text-foreground">Dangerous command blocking is disabled.</div>
                </div>
              </Show>
            </div>

            {/* Current Model */}
            <div class="space-y-3">
              <SubSectionHeader title="Current Model" description="Default model used when creating a new chat thread." />
              <div class={cn('flex items-center gap-4 rounded-xl border bg-background p-4', redevenSurfaceRoleClass('panel'))}>
                <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Show when={aiCurrentModelOption()} fallback={<Bot class="h-5 w-5 text-muted-foreground" />}>
                    <ProviderBrandIcon type={providers().find((p) => currentModelID().startsWith(String(p.id ?? '').trim() + '/'))?.type ?? 'openai'} class="h-5 w-5" />
                  </Show>
                </div>
                <div class="min-w-0 flex-1">
                  <Show when={aiCurrentModelOption()} fallback={<div class="text-sm font-medium text-muted-foreground">No model selected</div>}>
                    <div class="truncate text-sm font-semibold text-foreground">{aiCurrentModelOption()!.label}</div>
                    <div class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-success/70"></span>Text</span>
                      <Show when={aiCurrentModelOption()?.supportsImageInput}>
                        <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-success/70"></span>Image Input</span>
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
                    placeholder="Select model..." class="w-52" disabled={!ctx.canInteract() || aiModelOptions().length === 0 || saving() || disableAISaving()} />
                </div>
              </div>
            </div>

            {/* Providers */}
            <div class="space-y-3">
              <SubSectionHeader title="Providers" description="AI service providers available to Flower Chat."
                actions={<Button size="sm" variant="default" onClick={addAIProviderAndOpenDialog} disabled={!ctx.canInteract()}>Add Provider</Button>} />
              <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <For each={providers()}>
                  {(provider, index) => {
                    const providerID = () => String(provider.id ?? '').trim();
                    const displayName = () => providerDisplayName(provider, `Provider ${index() + 1}`);
                    const modelNames = () => (Array.isArray(provider.models) ? provider.models : []).map((m) => String(m.model_name ?? '').trim()).filter(Boolean);
                    const hasImageModel = () => (Array.isArray(provider.models) ? provider.models : []).some((m) => modelSupportsImageInput(m.input_modalities));
                    const isDefault = () => currentModelID().startsWith(`${providerID()}/`);
                    const keyOk = () => providerKeySet()?.[providerID()];
                    const webSearchLabel = () => providerWebSearchSummary(provider);
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
                              <Show when={isDefault()}><span class="flex-shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">active</span></Show>
                            </div>
                            <div class="flex flex-shrink-0 items-center">
                              <Button size="icon" variant="ghost" class="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openAIProviderDialog(index())} disabled={!ctx.canInteract()} aria-label="Edit provider"><Pencil class="h-3.5 w-3.5" /></Button>
                              <Button size="icon" variant="ghost" class="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => { setProviders((prev) => { const n = normalizeAIProviders(prev.filter((_, i) => i !== index())); setCurrentModelID(normalizeAICurrentModelID(currentModelID(), n)); return n; }); setDirty(true); }}
                                disabled={!ctx.canInteract() || providers().length <= 1} aria-label="Remove provider"><Trash class="h-3.5 w-3.5" /></Button>
                            </div>
                          </div>
                          <div class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{modelNames().length} model{modelNames().length !== 1 ? 's' : ''}</span>
                            <span class={keyOk() ? 'text-success' : ''}>{keyOk() ? 'Key verified' : 'Needs key'}</span>
                            <Show when={webSearchLabel() !== 'Not supported'}><span class={webSearchLabel() !== 'Disabled' ? 'text-success' : ''}>{webSearchLabel()}</span></Show>
                            <Show when={hasImageModel()}><span>Image input</span></Show>
                          </div>
                          <Show when={modelNames().length > 0}>
                            <div class="mt-2.5 flex flex-wrap gap-1">
                              <For each={modelNames().slice(0, 5)}>
                                {(name) => (
                                  <code class={cn('rounded px-1.5 py-0.5 text-[11px] font-mono', isDefault() && currentModelID() === `${providerID()}/${name}` ? 'bg-primary/10 text-primary font-semibold' : 'bg-muted text-muted-foreground')}>{name}</code>
                                )}
                              </For>
                              <Show when={modelNames().length > 5}><span class="self-center text-[11px] text-muted-foreground">+{modelNames().length - 5} more</span></Show>
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
        title={providerDialogMode() === 'create' ? 'Add Provider' : 'Edit Provider'}
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
        onChangeModelNumber={(i, k, raw) => { /* simplified */ }}
        onChangeModelImageInput={(i, enabled) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).map((m, mi) => mi === i ? { ...m, input_modalities: enabled ? ['text', 'image'] : ['text'] } : m) }))}
        onRemoveModel={(i) => updateAIProviderDialogDraft((c) => ({ ...c, models: (Array.isArray(c.models) ? c.models : []).filter((_, mi) => mi !== i) }))}
      />

      <ConfirmDialog open={disableAIOpen()} onOpenChange={(open) => setDisableAIOpen(open)}
        title="Disable Flower" confirmText="Disable" variant="destructive" loading={disableAISaving()} onConfirm={() => void disableAI()}>
        <div class="space-y-3">
          <p class="text-sm">Are you sure you want to disable Flower?</p>
          <p class="text-xs text-muted-foreground">This will remove the <CodeBadge>ai</CodeBadge> section from the runtime config file.</p>
        </div>
      </ConfirmDialog>
    </>
  );
}
