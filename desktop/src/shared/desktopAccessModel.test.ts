import { describe, expect, it } from 'vitest';

import {
  applyDesktopAccessAutoPortToDraft,
  applyDesktopAccessFixedPortToDraft,
  applyDesktopAccessModeToDraft,
  buildDesktopSettingsSummaryItems,
  deriveDesktopAccessDraftModel,
  desktopAccessModeForDraft,
  desktopSettingsDraftRequiresRuntimeRestart,
} from './desktopAccessModel';
import type { DesktopSettingsDraft } from './settingsIPC';

function draft(overrides: Partial<DesktopSettingsDraft>): DesktopSettingsDraft {
  return {
    local_ui_bind: 'localhost:23998',
    local_ui_password: '',
    local_ui_password_mode: 'replace',
    auto_runtime_probe_enabled: false,
    ...overrides,
  };
}

describe('desktopAccessModel', () => {
  it('treats a fixed loopback bind as local-only with a predictable localhost address', () => {
    const model = deriveDesktopAccessDraftModel(draft({
      local_ui_bind: 'localhost:23998',
    }));

    expect(model.access_mode).toBe('local_only');
    expect(model.port_mode).toBe('fixed');
    expect(model.fixed_port_value).toBe('23998');
    expect(model.next_start_address_display).toBe('localhost:23998');
    expect(model.next_start_address_kind).toBe('raw');
    expect(model.password_state_id).toBe('not_required');
  });

  it('keeps dynamic loopback binds in local-only mode but describes them as auto-select', () => {
    const model = deriveDesktopAccessDraftModel(draft({
      local_ui_bind: '127.0.0.1:0',
    }));

    expect(model.access_mode).toBe('local_only');
    expect(model.port_mode).toBe('auto');
    expect(model.fixed_port_value).toBe('23998');
    expect(model.next_start_address_display).toBe('');
    expect(model.next_start_address_kind).toBe('auto_loopback');
  });

  it('treats wildcard binds as shared-local-network even when the saved fixed port differs from the default', () => {
    const model = deriveDesktopAccessDraftModel(draft({
      local_ui_bind: '0.0.0.0:24000',
    }));

    expect(desktopAccessModeForDraft(draft({
      local_ui_bind: '0.0.0.0:24000',
    }))).toBe('shared_local_network');
    expect(model.fixed_port_value).toBe('24000');
    expect(model.next_start_address_display).toBe('24000');
    expect(model.next_start_address_kind).toBe('lan_ip_port');
    expect(model.password_state_id).toBe('required');
  });

  it('treats a write-only kept password as custom exposure on loopback', () => {
    const sourceDraft = draft({
      local_ui_bind: 'localhost:23998',
      local_ui_password_mode: 'keep',
    });

    expect(desktopAccessModeForDraft(sourceDraft, {
      local_ui_password_configured: true,
    })).toBe('custom_exposure');

    const model = deriveDesktopAccessDraftModel(sourceDraft, {
      local_ui_password_configured: true,
    });
    expect(model.password_state_id).toBe('configured');
    expect(model.password_state_tone).toBe('success');
  });

  it('falls back to custom exposure when loopback adds a password', () => {
    expect(desktopAccessModeForDraft(draft({
      local_ui_bind: 'localhost:23998',
      local_ui_password: 'secret',
    }))).toBe('custom_exposure');
  });

  it('switches from auto local-only to shared-local-network on the fixed shared baseline port', () => {
    expect(applyDesktopAccessModeToDraft(draft({
      local_ui_bind: '127.0.0.1:0',
    }), 'shared_local_network')).toEqual(draft({
      local_ui_bind: '0.0.0.0:23998',
    }));
  });

  it('updates fixed-port presets and auto-port toggles semantically', () => {
    const withPort = applyDesktopAccessFixedPortToDraft(draft({
      local_ui_bind: 'localhost:23998',
    }), '24111');
    expect(withPort.local_ui_bind).toBe('localhost:24111');

    const autoEnabled = applyDesktopAccessAutoPortToDraft(withPort, true);
    expect(autoEnabled.local_ui_bind).toBe('127.0.0.1:0');

    const autoDisabled = applyDesktopAccessAutoPortToDraft(autoEnabled, false);
    expect(autoDisabled.local_ui_bind).toBe('localhost:23998');
  });

  it('builds summary items around visibility and next-start address instead of raw bind presets', () => {
    const items = buildDesktopSettingsSummaryItems(draft({
      local_ui_bind: 'localhost:23998',
    }), {
      current_runtime_url: 'http://localhost:23998/',
    });

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'visibility',
        value_key: 'settings.localOnlyLabel',
      }),
      expect.objectContaining({
        id: 'next_start_address',
        value: 'localhost:23998',
      }),
      expect.objectContaining({
        id: 'password_state',
        value_key: 'settings.noPassword',
      }),
    ]));
  });

  it('requires a Runtime restart only for startup access changes', () => {
    const baseline = draft({
      local_ui_bind: 'localhost:23998',
      local_ui_password_mode: 'replace',
    });

    expect(desktopSettingsDraftRequiresRuntimeRestart(baseline, baseline)).toBe(false);
    expect(desktopSettingsDraftRequiresRuntimeRestart(baseline, {
      ...baseline,
      auto_runtime_probe_enabled: true,
    })).toBe(false);
    expect(desktopSettingsDraftRequiresRuntimeRestart(baseline, {
      ...baseline,
      local_ui_bind: '0.0.0.0:23998',
    })).toBe(true);
    expect(desktopSettingsDraftRequiresRuntimeRestart(baseline, {
      ...baseline,
      local_ui_password: 'replacement',
    })).toBe(true);
  });

  it('detects password removal and acknowledgement changes without treating an empty replacement as a change', () => {
    const passwordBaseline = draft({
      local_ui_bind: '0.0.0.0:23998',
      local_ui_password_mode: 'keep',
      plaintext_network_exposure_acknowledgement_bind: '0.0.0.0:23998',
    });

    expect(desktopSettingsDraftRequiresRuntimeRestart(passwordBaseline, {
      ...passwordBaseline,
      local_ui_password_mode: 'clear',
    })).toBe(true);
    expect(desktopSettingsDraftRequiresRuntimeRestart(passwordBaseline, {
      ...passwordBaseline,
      plaintext_network_exposure_acknowledgement_bind: '',
    })).toBe(true);
    expect(desktopSettingsDraftRequiresRuntimeRestart(draft({}), draft({
      local_ui_password: '',
      local_ui_password_mode: 'replace',
    }))).toBe(false);
  });
});
