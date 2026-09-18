import { createSignal } from 'solid-js';
import { desktopSettingsDraftRequiresRuntimeRestart } from '../shared/desktopAccessModel';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopSettingsResult, DesktopSettingsDraft, SaveDesktopSettingsRequest } from '../shared/settingsIPC';
import type { DesktopSettingsSurfaceSnapshot } from '../shared/desktopSettingsSurface';

type EnvironmentAccessDraft = Readonly<{
  baseline_surface: DesktopSettingsSurfaceSnapshot;
  draft: DesktopSettingsDraft;
  dirty: boolean;
}>;
function accessDraft(surface: DesktopSettingsSurfaceSnapshot): EnvironmentAccessDraft {
  return { baseline_surface: surface, draft: surface.draft, dirty: false };
}

export type EnvironmentSettingsTab = 'connection' | 'access';
export function environmentHasAccessSettings(environment: DesktopEnvironmentEntry): boolean {
  return environment.registration_ref?.kind === 'local_environment' || environment.registration_ref?.kind === 'runtime_target';
}
export type EnvironmentSettingsSession<C> = Readonly<{
  token: number;
  environment: DesktopEnvironmentEntry;
  tab: EnvironmentSettingsTab;
  metadata_label: string;
  connection: C;
  connection_baseline: C;
  access: EnvironmentAccessDraft | null;
  access_state: 'idle' | 'loading' | 'ready' | 'error';
  access_error: Extract<DesktopSettingsResult, { ok: false }> | null;
  saving: 'connection' | 'access' | null;
}>;

/** One opening owns both drafts. Remote completions never choose or reopen a surface. */
export function createEnvironmentSettingsController<C>(io: {
  load: (environmentID: string) => Promise<DesktopSettingsResult>;
  save: (request: SaveDesktopSettingsRequest) => Promise<DesktopSettingsResult>;
  lateError: (message: string) => void;
}) {
  const [session, setSession] = createSignal<EnvironmentSettingsSession<C> | null>(null);
  let sequence = 0;
  let readSequence = 0;
  const current = (opening: EnvironmentSettingsSession<C>) => session()?.token === opening.token
    && session()?.environment.id === opening.environment.id;
  const update = (patch: Partial<EnvironmentSettingsSession<C>>) => setSession(value => value ? { ...value, ...patch } : value);
  async function loadAccess() {
    const opening = session();
    if (!opening || opening.saving || !environmentHasAccessSettings(opening.environment)) return;
    const request = ++readSequence;
    update({ access_state: 'loading', access_error: null });
    let result: DesktopSettingsResult;
    try { result = await io.load(opening.environment.id); }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    if (!current(opening) || request !== readSequence) return;
    if (!result.ok) { update({ access_state: 'error', access_error: result }); return; }
    const previous = session()?.access;
    update({
      access_state: 'ready', access_error: null,
      access: previous?.dirty ? {
        ...previous, baseline_surface: { ...previous.baseline_surface,
          runtime_configuration_pending: result.snapshot.runtime_configuration_pending,
          runtime_started_at_unix_ms: result.snapshot.runtime_started_at_unix_ms },
      } : accessDraft(result.snapshot),
    });
  }
  async function saveAccess(): Promise<boolean> {
    const opening = session();
    if (!opening?.access || opening.saving) return false;
    ++readSequence;
    update({ saving: 'access', access_error: null });
    let result: DesktopSettingsResult;
    try { result = await io.save({ environment_id: opening.environment.id, draft: opening.access.draft }); }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    if (!current(opening)) { if (!result.ok) io.lateError(result.error); return result.ok; }
    update({ saving: null, access_state: 'ready' });
    if (!result.ok) { update({ access_error: result }); return false; }
    ++readSequence;
    update({ access: accessDraft(result.snapshot), access_state: 'ready' });
    return true;
  }
  return {
    session, update, current, loadAccess, saveAccess,
    open(environment: DesktopEnvironmentEntry, connection: C) {
      const tab = environment.registration_ref?.kind === 'local_environment' ? 'access' : 'connection';
      setSession({ token: ++sequence, environment, tab, metadata_label: environment.label, connection, connection_baseline: connection,
        access: null, access_state: 'idle', access_error: null, saving: null });
      if (tab === 'access') void loadAccess();
    },
    close() { ++readSequence; setSession(null); },
    selectTab(tab: EnvironmentSettingsTab) {
      update({ tab });
      if (tab === 'access' && session()?.access_state === 'idle') void loadAccess();
    },
    updateDraft(updater: (draft: DesktopSettingsDraft) => DesktopSettingsDraft) {
      const access = session()?.access;
      if (access && !session()?.saving) {
        const draft = updater(access.draft);
        update({ access: { ...access, draft, dirty: desktopSettingsDraftRequiresRuntimeRestart(access.baseline_surface.draft, draft) } });
      }
    },
    resetAccess() {
      const access = session()?.access;
      if (access && !session()?.saving) update({ access: accessDraft(access.baseline_surface), access_error: null });
    },
    savedConnection(environment: DesktopEnvironmentEntry, connection: C) {
      const changed = session()?.environment.id !== environment.id;
      if (changed) ++readSequence;
      update({ environment, metadata_label: environment.label, connection, connection_baseline: connection, saving: null,
        ...(changed ? { access: null, access_state: 'idle' as const, access_error: null } : {}) });
    },
  };
}
