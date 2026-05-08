import { describe, expect, it } from 'vitest';

import { launcherActionFailurePresentation } from './launcherActionFeedback';

describe('launcherActionFeedback', () => {
  it('maps stale sessions to an informational toast and snapshot refresh', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'session_stale',
      scope: 'environment',
      message: 'That window was already closed. Desktop refreshed the environment list.',
      should_refresh_snapshot: true,
    })).toEqual({
      message: 'That window was already closed. Desktop refreshed the environment list.',
      tone: 'info',
      refresh_snapshot: true,
      delivery: 'toast',
    });
  });

  it('treats opening collisions as informational toasts', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'environment_opening',
      scope: 'environment',
      message: 'Desktop is still opening Demo Sandbox. Wait a moment, then try again.',
    })).toEqual({
      message: 'Desktop is still opening Demo Sandbox. Wait a moment, then try again.',
      tone: 'info',
      refresh_snapshot: false,
      delivery: 'toast',
    });
  });

  it('keeps provider and control-plane failures toast-oriented', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'environment_offline',
      scope: 'environment',
      message: 'This environment is currently offline in the provider.',
    })).toEqual({
      message: 'This environment is currently offline in the provider.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'toast',
    });

    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'control_plane_missing',
      scope: 'control_plane',
      message: 'This provider is no longer saved in Desktop.',
    })).toEqual({
      message: 'This provider is no longer saved in Desktop.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'toast',
    });

    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'action_invalid',
      scope: 'environment',
      message: 'Desktop could not finish opening https://env.example.invalid: ERR_CONNECTION_REFUSED',
    })).toEqual({
      message: 'Desktop could not finish opening https://env.example.invalid: ERR_CONNECTION_REFUSED',
      tone: 'error',
      refresh_snapshot: false,
      delivery: 'toast',
    });
  });

  it('keeps local and SSH runtime-not-started failures source-specific', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'runtime_not_started',
      scope: 'environment',
      message: 'Start the SSH runtime first, then open this environment.',
    })).toEqual({
      message: 'Start the SSH runtime first, then open this environment.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'toast',
    });
  });

  it('turns provider authorization failures into persistent reconnect actions', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'control_plane_auth_required',
      scope: 'control_plane',
      message: 'Desktop needs fresh provider authorization before it can request a one-time Local Environment bootstrap ticket for this Environment.',
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      should_refresh_snapshot: true,
    })).toEqual({
      title: 'Provider Authorization Expired',
      message: 'Desktop needs fresh provider authorization before it can request a one-time Local Environment bootstrap ticket for this Environment.',
      tone: 'warning',
      refresh_snapshot: true,
      delivery: 'toast',
      action: {
        kind: 'reconnect_control_plane',
        label: 'Reconnect Provider',
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'example_control_plane',
      },
      auto_dismiss: false,
    });
  });

  it('shows Start Runtime failures as error toasts with a snapshot refresh', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'runtime_start_failed',
      scope: 'environment',
      message: 'Start Runtime did not complete because the runtime process did not stay online.',
      should_refresh_snapshot: true,
    })).toEqual({
      message: 'Start Runtime did not complete because the runtime process did not stay online.',
      tone: 'error',
      refresh_snapshot: true,
      delivery: 'toast',
    });
  });

  it('keeps dialog-scoped validation failures inline', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'action_invalid',
      scope: 'dialog',
      message: 'Non-loopback Local UI binds require a Local UI password.',
    })).toEqual({
      message: 'Non-loopback Local UI binds require a Local UI password.',
      tone: 'error',
      refresh_snapshot: false,
      delivery: 'inline',
    });
  });
});
