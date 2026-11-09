import { SettingsSelect as Select } from './SettingsSelect';
import { createEffect, createMemo, createResource, createSignal, on, onCleanup, Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FlowerSurfaceAdapter, FlowerConversationPreferencePatch } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../../../../../../flower_ui/src/copy';
import { FlowerReasoningControl } from '../../../../../../flower_ui/src/ReasoningControl';
import { FlowerWorkingDirPickerDialog } from '../../../../../../flower_ui/src/filePicker/FlowerWorkingDirPickerDialog';
import { mapFilesystemPickerContext, mapFilesystemPickerEntries, formatFilesystemPickerError } from '../../../../../../flower_ui/src/filePicker/filesystemPicker';
import { useI18n } from '../../i18n';

import { SettingsSection, SettingsList, SettingRow } from './SettingsPrimitives';

/** Personal defaults use the same authenticated CAS owner as the composer. */
export function ConversationDefaultsSettings(props: {
  adapter: FlowerSurfaceAdapter; copy: FlowerSurfaceCopy; canEdit: boolean;
  active: boolean; revision: number; scope: string; generation: number; onChanged: () => void;
}) {
  const i18n = useI18n();
  const lifetime = new AbortController(); onCleanup(() => lifetime.abort());
  const [snapshot, { mutate, refetch }] = createResource(() => props.generation, () => props.adapter.loadSettings(false, lifetime.signal));
  const data = () => snapshot.error ? undefined : snapshot();
  const [pending, setPending] = createSignal(false), [error, setError] = createSignal(''), [directoryOpen, setDirectoryOpen] = createSignal(false);
  const editable = () => props.canEdit && props.adapter.canMutate !== false && !lifetime.signal.aborted && !!props.adapter.saveConversationPreferences;
  const modelID = () => data()?.conversation_preferences?.model_id || data()?.model_directory?.current_model_id || data()?.model_profile?.current_model_id || '';
  const models = createMemo(() => data()?.model_directory?.models ?? []);
  const model = () => models().find(value => value.id === modelID());
  const options = createMemo(() => {
    const values = models().map(value => ({ value: value.id, label: value.label, disabled: value.state !== 'ready' }));
    if (modelID() && !values.some(value => value.value === modelID())) values.push({ value: modelID(), label: modelID(), disabled: true });
    return values;
  });
  createEffect(on(() => props.revision, () => { void refetch(); }, { defer: true }));
  createEffect(() => { if (!props.active || !editable()) setDirectoryOpen(false); });
  async function save(patch: FlowerConversationPreferencePatch) {
    if (!props.active || !editable() || pending()) return;
    const adapter = props.adapter, scope = props.scope, generation = props.generation;
    const current = () => editable() && props.adapter === adapter && props.scope === scope && props.generation === generation;
    setPending(true); setError('');
    try {
      // IMPORTANT: Patch only the explicit choice. Never persist effective runtime
      // defaults, replay a failed write, or modify an existing conversation here.
      const saved = await adapter.saveConversationPreferences!(patch);
      if (!current()) return;
      mutate(previous => previous ? { ...previous, conversation_preferences: saved } : previous);
      props.onChanged();
    } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (!lifetime.signal.aborted) setPending(false); }
  }
  return <section data-testid="conversation-defaults-settings"><SettingsSection title={i18n.t('settings.conversationDefaults.title')}>
    <Show when={snapshot.error || error()}><div role="alert" class="text-sm text-destructive">{error() || String(snapshot.error)}</div><Button variant="ghost" disabled={pending()} onClick={() => void refetch()}>{i18n.t('common.actions.refresh')}</Button></Show>
    <Show when={data()} fallback={<p role="status">{props.copy.chat.loadingSettings}</p>}>
      <fieldset disabled={!editable() || pending()} class="min-w-0 space-y-3"><SettingsList>
        <SettingRow title={props.copy.chat.modelLabel} control={<Select section="ai" active={props.active && editable() && !pending()} ariaLabel={props.copy.chat.modelLabel} value={modelID()} options={options()} placeholder={props.copy.settings.selectModelPlaceholder} onChange={id => { if (models().some(value => value.id === id && value.state === 'ready')) void save({ model_id: id }); }} />} />
        <Show when={model()}>{selected => <SettingRow title={props.copy.chat.reasoningLabel} control={<FlowerReasoningControl variant="segment" copy={props.copy.settings.reasoningControl} capability={selected().reasoning_capability} label={props.copy.chat.reasoningLabel}
          selection={data()?.conversation_preferences?.reasoning_by_model[selected().id] ?? { level: 'default' }} readOnly={!editable() || pending()}
          onChange={selection => void save({ reasoning: { model_id: selected().id, selection: selection ?? { level: 'default' } } })} />} />}</Show>
        <SettingRow title={props.copy.chat.workingDirPickerTitle} description={data()?.conversation_preferences?.working_dir || i18n.t('settings.conversationDefaults.environmentDirectory')} control={<Button variant="outline" disabled={!editable() || pending() || !props.adapter.getWorkingDirectoryPathContext || !props.adapter.listWorkingDirectoryEntries} onClick={() => setDirectoryOpen(true)}>{props.copy.chat.workingDirPickerTitle}</Button>} />
      </SettingsList></fieldset>
    </Show>
    </SettingsSection><FlowerWorkingDirPickerDialog open={directoryOpen()} onOpenChange={setDirectoryOpen} scopeKey={props.scope}
      initialPath={data()?.conversation_preferences?.working_dir} directoryFavorites={props.adapter.directoryFavorites?.(() => props.copy.filesystemPicker.favoritesLoadFailed)}
      loadPathContext={async () => mapFilesystemPickerContext(await props.adapter.getWorkingDirectoryPathContext!(), () => props.copy.filesystemPicker)}
      loadDirectory={async (path, options) => mapFilesystemPickerEntries(await props.adapter.listWorkingDirectoryEntries!({ path, showHidden: options.showHidden }))}
      copy={props.copy.filesystemPicker} formatError={failure => formatFilesystemPickerError(failure, props.copy.filesystemPicker)}
      title={props.copy.chat.workingDirPickerTitle} confirmText={props.copy.chat.workingDirPickerConfirm}
      onSelect={path => { if (!path || !editable() || pending()) return; setDirectoryOpen(false); void save({ working_dir: path }); }} />
  </section>;
}
