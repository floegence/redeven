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
      code: 'control_plane_missing',
      scope: 'control_plane',
      message: 'This Control Plane is no longer saved in Desktop.',
    })).toEqual({
      message: 'This Control Plane is no longer saved in Desktop.',
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

  it('keeps dialog-scoped validation failures inline', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'action_invalid',
      scope: 'dialog',
      message: 'Local Default Environment cannot use localhost:23998 because "Lab" is already configured for localhost:23998. Choose a different Local UI bind or update that environment first.',
    })).toEqual({
      message: 'Local Default Environment cannot use localhost:23998 because "Lab" is already configured for localhost:23998. Choose a different Local UI bind or update that environment first.',
      tone: 'error',
      refresh_snapshot: false,
      delivery: 'inline',
    });
  });
});
