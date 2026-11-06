import { SESSION_RESTART_MAX_BYTES, validSessionRestartState, type SessionRestartBridge, type SessionRestartState } from '../../../../../../desktop/src/shared/sessionRestartIPC';
import type { FlowerComposerDraftCoordinator, FlowerComposerRestartDraft } from '../../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { readDesktopHostBridge } from './desktopHostWindow';
import { capturePluginDraftsForRestart, restorePluginDraftsAfterRestart } from '../plugins/pluginComposerPersistence';

export type RestartWorkspace = Readonly<{ viewMode: 'activity' | 'workbench'; activityID: string; pluginDraftID?: string }>;
type SavedDraft = Readonly<{ scope_id: string; value: FlowerComposerRestartDraft['value']; files: readonly Readonly<{ id: string; local_id: string }>[] }>;
type SavedRestartState = Readonly<{
  workspace: RestartWorkspace;
  drafts: readonly SavedDraft[];
  pluginDrafts?: readonly Readonly<{ id: string; composer?: SavedDraft; comment?: string }>[];
}>;

declare global { interface Window { redevenDesktopSessionRestart?: SessionRestartBridge } }

export function desktopSessionRestartBridge(): SessionRestartBridge | null {
  return readDesktopHostBridge('redevenDesktopSessionRestart', (value): value is SessionRestartBridge => {
    const bridge = value as Partial<SessionRestartBridge> | null;
    return !!bridge && typeof bridge.register === 'function' && typeof bridge.read === 'function' && typeof bridge.restored === 'function';
  });
}

export async function captureSessionRestartState(coordinator: FlowerComposerDraftCoordinator, workspace: RestartWorkspace): Promise<SessionRestartState> {
  const drafts = coordinator.exportForRestart();
  const pluginDrafts = await capturePluginDraftsForRestart();
  const allDrafts = [...drafts, ...pluginDrafts.flatMap(entry => entry.composer ? [entry.composer] : [])];
  const totalFileBytes = allDrafts.reduce((total, draft) => total + draft.files.reduce((sum, entry) => sum + entry.file.size, 0), 0);
  if (totalFileBytes > SESSION_RESTART_MAX_BYTES) throw new Error('Unsent attachments exceed the temporary restart transfer limit.');
  const files: Array<SessionRestartState['files'][number]> = [];
  const saveDraft = async (draft: FlowerComposerRestartDraft, owner: readonly string[]): Promise<SavedDraft> => ({
    scope_id: draft.scope_id, value: draft.value,
    files: await Promise.all(draft.files.map(async ({ local_id, file }) => {
      const id = JSON.stringify([...owner, local_id]);
      files.push({ id, name: file.name, type: file.type, lastModified: file.lastModified, bytes: new Uint8Array(await file.arrayBuffer()) });
      return { id, local_id };
    })),
  });
  const saved: SavedRestartState = { workspace,
    drafts: await Promise.all(drafts.map(draft => saveDraft(draft, ['flower', draft.scope_id]))),
    pluginDrafts: await Promise.all(pluginDrafts.map(async entry => ({ ...entry,
      composer: entry.composer ? await saveDraft(entry.composer, ['plugin', entry.id]) : undefined,
    }))),
  };
  const state = { v: 1 as const, json: JSON.stringify(saved), files };
  if (!validSessionRestartState(state)) throw new Error('The workspace exceeds the temporary restart transfer limit.');
  return state;
}

export async function restoreSessionRestartState(coordinator: FlowerComposerDraftCoordinator, state: SessionRestartState): Promise<RestartWorkspace> {
  if (!validSessionRestartState(state)) throw new Error('Invalid Env App restart state.');
  const saved = JSON.parse(state.json) as SavedRestartState;
  if (!saved || !Array.isArray(saved.drafts) || !saved.workspace
    || !['activity', 'workbench'].includes(saved.workspace.viewMode)
    || typeof saved.workspace.activityID !== 'string'
    || (saved.workspace.pluginDraftID !== undefined && typeof saved.workspace.pluginDraftID !== 'string')
    || (saved.pluginDrafts !== undefined && !Array.isArray(saved.pluginDrafts))) throw new Error('Invalid Env App restart state.');
  const files = new Map(state.files.map(file => [file.id, file]));
  const restoreDraft = (draft: SavedDraft): FlowerComposerRestartDraft => ({
    scope_id: draft.scope_id, value: draft.value,
    files: draft.files.map(reference => {
      const file = files.get(reference.id);
      if (!file) throw new Error('Restart state is missing an unsent attachment.');
      return { local_id: reference.local_id, file: new File([file.bytes.slice().buffer as ArrayBuffer], file.name, { type: file.type, lastModified: file.lastModified }) };
    }),
  });
  const drafts = saved.drafts.map(restoreDraft);
  const pluginDrafts = (saved.pluginDrafts ?? []).map(entry => ({ ...entry,
    composer: entry.composer ? restoreDraft(entry.composer) : undefined,
  }));
  // Acknowledge Desktop only after the new origin has committed its cache.
  await restorePluginDraftsAfterRestart(pluginDrafts);
  coordinator.restoreAfterRestart(drafts);
  return saved.workspace;
}
