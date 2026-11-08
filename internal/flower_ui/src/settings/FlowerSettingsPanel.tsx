import { Show, createResource, createSignal, createEffect, on, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { withFlowerModelDirectory } from '../modelDirectory';
import { FlowerSettingsSurface } from './FlowerSettingsSurface';
import type { FlowerSurfaceAdapter, FlowerSettingsSnapshot } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';

/** One provider/default editor, shared by every product carrier. */
export function FlowerSettingsPanel(props: {
  active?: boolean;
  adapter: FlowerSurfaceAdapter; copy: FlowerSurfaceCopy; canEdit: boolean;
  onChanged?: () => void; onOpenComputer: () => void;
  revision?: string | number;
  providerFocusRequest?: { providerID: string; modelName: string; sequence: number };
}) {
  const lifetime = new AbortController();
  onCleanup(() => lifetime.abort());
  const [snapshot, { mutate, refetch }] = createResource(() => props.adapter.loadSettings(true, lifetime.signal));
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const assertCurrent = () => {
    lifetime.signal.throwIfAborted();
    if (!props.canEdit || props.adapter.canMutate === false) throw new DOMException('Settings authority is unavailable.', 'NotAllowedError');
  };
  createEffect(on(() => props.revision, () => { if (!lifetime.signal.aborted) void refetch(); }, { defer: true }));
  const unsubscribe = props.adapter.subscribeModelDirectory?.(directory => { if (!lifetime.signal.aborted) mutate(previous => previous ? withFlowerModelDirectory(previous, directory) : previous); });
  onCleanup(() => unsubscribe?.());
  const accountAction: NonNullable<FlowerSurfaceAdapter['chatGPTAuth']> = async (action, input) => {
    assertCurrent();
    const result = await props.adapter.chatGPTAuth!(action, input);
    assertCurrent();
    if (action !== 'status' && action !== 'start') { await refetch(); assertCurrent(); props.onChanged?.(); }
    return result;
  };
  const save = async (operation: () => Promise<FlowerSettingsSnapshot>) => {
    // IMPORTANT: Retained forms are not authority. Check the current host grant
    // on every mutation, and discard late results from a retired host lifetime.
    assertCurrent();
    setSaving(true); setError('');
    try {
      const result = await operation();
      assertCurrent();
      mutate(result); setSavedAt(Date.now()); props.onChanged?.();
      return result;
    } catch (error) {
      if (!lifetime.signal.aborted) setError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally { if (!lifetime.signal.aborted) setSaving(false); }
  };
  return <>
    <Show when={snapshot.error}><p role="alert">{String(snapshot.error)}</p><Button onClick={() => void refetch()}>{props.copy.chat.handlerRetry}</Button></Show>
    <Show when={snapshot()} fallback={<p role="status">{props.copy.chat.loadingSettings}</p>}>
      <div inert={!props.canEdit || props.adapter.canMutate === false}>
        <FlowerSettingsSurface active={props.active} snapshot={snapshot() ?? null} copy={props.copy.settings} dialog
          providerFocusRequest={props.providerFocusRequest}
          onDiscoverModels={props.adapter.discoverProviderModels ? async input => { assertCurrent(); const result = await props.adapter.discoverProviderModels!(input); assertCurrent(); return result; } : undefined}
          chatGPTAuth={props.adapter.chatGPTAuth ? accountAction : undefined} loadChatGPTAccounts={props.adapter.loadChatGPTAccounts ? async () => { assertCurrent(); const result = await props.adapter.loadChatGPTAccounts!(); assertCurrent(); return result; } : undefined}
          onSaveDefaultPermission={value => save(() => props.adapter.saveDefaultPermission(value))}
          onSaveComputerUseEnabled={props.adapter.saveComputerUseEnabled ? value => save(() => props.adapter.saveComputerUseEnabled!(value)) : undefined}
          onSaveAutoUpdateModelCatalog={props.adapter.saveAutoUpdateModelCatalog ? value => save(() => props.adapter.saveAutoUpdateModelCatalog!(value)) : undefined}
          onSaveModelProfile={draft => save(() => props.adapter.saveModelProfile(draft))}
          onOpenComputerSettings={props.onOpenComputer} computerCopy={props.copy.computer}
          saving={saving()} savedAt={savedAt()} saveError={error()} />
      </div>
    </Show>
  </>;
}
