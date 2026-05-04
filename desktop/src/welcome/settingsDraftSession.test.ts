import { describe, expect, it } from 'vitest';

import type { DesktopSettingsSurfaceSnapshot } from '../shared/desktopSettingsSurface';
import {
  createDesktopSettingsDraftSession,
  desktopSettingsDraftSessionKey,
  reconcileDesktopSettingsDraftSession,
  updateDesktopSettingsDraftSessionDraft,
} from './settingsDraftSession';

function surface(
  environmentID: string,
  localUIBind: string,
  environmentKind: DesktopSettingsSurfaceSnapshot['environment_kind'] = 'local',
): DesktopSettingsSurfaceSnapshot {
  return {
    mode: 'environment_settings',
    environment_id: environmentID,
    environment_label: environmentID,
    environment_kind: environmentKind,
    window_title: `${environmentID} Settings`,
    save_label: `Save ${environmentID} Settings`,
    access_mode: localUIBind.startsWith('0.0.0.0:') ? 'shared_local_network' : 'local_only',
    access_mode_label: localUIBind.startsWith('0.0.0.0:') ? 'Shared on your local network' : 'Local only',
    access_mode_options: [],
    next_start_address_display: localUIBind,
    current_runtime_url: '',
    password_state_label: 'No password required',
    password_state_tone: 'default',
    local_ui_password_configured: false,
    runtime_password_required: false,
    local_ui_password_can_clear: false,
    summary_items: [],
    host_fields: [],
    draft: {
      local_ui_bind: localUIBind,
      local_ui_password: '',
      local_ui_password_mode: 'replace',
    },
  };
}

describe('settingsDraftSession', () => {
  it('keys the editable settings session by dialog identity', () => {
    expect(desktopSettingsDraftSessionKey(surface('local', 'localhost:23998')))
      .toBe('environment_settings:local:local');
  });

  it('keeps an idle open dialog aligned with the latest snapshot draft', () => {
    const session = createDesktopSettingsDraftSession(surface('local', 'localhost:23998'));
    const reconciled = reconcileDesktopSettingsDraftSession(
      session,
      surface('local', 'localhost:24000'),
      true,
    );

    expect(reconciled.dirty).toBe(false);
    expect(reconciled.draft.local_ui_bind).toBe('localhost:24000');
  });

  it('preserves user edits from same-environment runtime refresh snapshots', () => {
    const session = updateDesktopSettingsDraftSessionDraft(
      createDesktopSettingsDraftSession(surface('local', 'localhost:23998')),
      (draft) => ({
        ...draft,
        local_ui_bind: '0.0.0.0:23998',
        local_ui_password: 'secret',
        local_ui_password_mode: 'replace',
      }),
    );

    const reconciled = reconcileDesktopSettingsDraftSession(
      session,
      surface('local', 'localhost:23998'),
      true,
    );

    expect(reconciled).toBe(session);
    expect(reconciled.draft.local_ui_bind).toBe('0.0.0.0:23998');
    expect(reconciled.draft.local_ui_password).toBe('secret');
  });

  it('reinitializes edits when the selected environment changes', () => {
    const session = updateDesktopSettingsDraftSessionDraft(
      createDesktopSettingsDraftSession(surface('local', 'localhost:23998')),
      (draft) => ({
        ...draft,
        local_ui_bind: '0.0.0.0:23998',
      }),
    );

    const reconciled = reconcileDesktopSettingsDraftSession(
      session,
      surface('cp:https%3A%2F%2Fcp.example.invalid:env:env_demo', 'localhost:25000', 'controlplane'),
      true,
    );

    expect(reconciled.dirty).toBe(false);
    expect(reconciled.identity_key).toBe('environment_settings:controlplane:cp:https%3A%2F%2Fcp.example.invalid:env:env_demo');
    expect(reconciled.draft.local_ui_bind).toBe('localhost:25000');
  });

  it('resets closed dialogs to the latest canonical snapshot', () => {
    const session = updateDesktopSettingsDraftSessionDraft(
      createDesktopSettingsDraftSession(surface('local', 'localhost:23998')),
      (draft) => ({
        ...draft,
        local_ui_bind: '0.0.0.0:23998',
      }),
    );

    const reconciled = reconcileDesktopSettingsDraftSession(
      session,
      surface('local', 'localhost:24000'),
      false,
    );

    expect(reconciled.dirty).toBe(false);
    expect(reconciled.draft.local_ui_bind).toBe('localhost:24000');
  });
});
