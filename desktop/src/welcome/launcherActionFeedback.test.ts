import { describe, expect, it } from 'vitest';

import { createDesktopI18n } from '../shared/i18n';
import { launcherActionFailurePresentation } from './launcherActionFeedback';

describe('launcherActionFeedback', () => {
  const i18n = createDesktopI18n('en-US');

  it('maps stale sessions to an informational toast and snapshot refresh', () => {
    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'session_stale',
      scope: 'environment',
      message: 'That window was already closed. Desktop refreshed the environment list.',
      should_refresh_snapshot: true,
    })).toEqual({
      message: 'That window was already closed. Desktop refreshed the Environment list.',
      tone: 'info',
      refresh_snapshot: true,
      delivery: 'toast',
    });
  });

  it('treats opening collisions as informational toasts', () => {
    expect(launcherActionFailurePresentation(i18n, {
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
    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'environment_offline',
      scope: 'environment',
      message: 'This environment is currently offline in the provider.',
    })).toEqual({
      message: 'This Environment is currently offline in the Provider.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'toast',
    });

    expect(launcherActionFailurePresentation(i18n, {
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

    expect(launcherActionFailurePresentation(i18n, {
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

  it('localizes runtime-not-started failures instead of echoing raw launcher strings', () => {
    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'runtime_not_started',
      scope: 'environment',
      message: 'Start the SSH runtime first, then open this environment.',
    })).toEqual({
      message: 'Start the Runtime before opening this Environment.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'toast',
    });

    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'runtime_not_started',
      scope: 'environment',
      message: '',
    })).toEqual({
      message: 'Start the Runtime before opening this Environment.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'toast',
    });
  });

  it('turns provider authorization failures into persistent reconnect actions', () => {
    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'control_plane_auth_required',
      scope: 'control_plane',
      message: 'Desktop needs fresh provider authorization before it can open or connect this provider Environment.',
      provider_origin: 'https://provider.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      should_refresh_snapshot: true,
    })).toEqual({
      title: 'Provider Authorization Expired',
      message: 'Desktop needs fresh Provider authorization before it can open or connect this Provider Environment.',
      tone: 'warning',
      refresh_snapshot: true,
      delivery: 'toast',
      action: {
        kind: 'reconnect_control_plane',
        label: 'Reconnect Provider',
        provider_origin: 'https://provider.example.invalid',
        provider_id: 'example_control_plane',
      },
      auto_dismiss: false,
    });
  });

  it('localizes fixed launcher failure chrome with the current Desktop locale', () => {
    const zhCN = createDesktopI18n('zh-CN');

    expect(launcherActionFailurePresentation(zhCN, {
      ok: false,
      code: 'control_plane_auth_required',
      scope: 'control_plane',
      message: 'Desktop needs fresh provider authorization before it can open or connect this provider Environment.',
      provider_origin: 'https://provider.example.invalid',
      env_public_id: 'env_demo',
    })).toMatchObject({
      title: 'Provider 授权已过期',
      message: 'Desktop 需要新的 Provider 授权，才能打开或连接此 Provider Environment。',
      action: {
        label: '重新连接 Provider',
      },
    });

    expect(launcherActionFailurePresentation(zhCN, {
      ok: false,
      code: 'action_invalid',
      scope: 'environment',
      message: 'Desktop could not finish opening https://env.example.invalid: ERR_CONNECTION_REFUSED',
    })).toMatchObject({
      message: 'Desktop 未能完成该操作。',
      tone: 'error',
    });

    expect(launcherActionFailurePresentation(zhCN, {
      ok: false,
      code: 'environment_opening',
      scope: 'environment',
      message: 'Desktop is still opening Demo Sandbox. Wait a moment, then try again.',
    })).toMatchObject({
      message: '打开正在停止。',
      tone: 'info',
    });

    expect(launcherActionFailurePresentation(zhCN, {
      ok: false,
      code: 'provider_unreachable',
      scope: 'control_plane',
      message: 'This provider cannot be reached right now.',
    })).toMatchObject({
      message: 'Desktop 无法将此 Runtime 连接到 Provider Environment。',
      tone: 'warning',
    });
  });

  it('keeps provider-link failures separate from runtime-start failures', () => {
    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'provider_link_failed',
      scope: 'environment',
      message: 'Desktop failed to connect the Local Runtime to this provider Environment.',
      should_refresh_snapshot: true,
    })).toEqual({
      message: 'Desktop could not connect this Runtime to the Provider Environment.',
      tone: 'warning',
      refresh_snapshot: true,
      delivery: 'toast',
    });
  });

  it('shows Start Runtime failures as error toasts with a snapshot refresh', () => {
    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'runtime_start_failed',
      scope: 'environment',
      message: 'Start Runtime did not complete because the runtime process did not stay online.',
      should_refresh_snapshot: true,
    })).toEqual({
      message: 'Start Runtime did not complete.',
      tone: 'error',
      refresh_snapshot: true,
      delivery: 'toast',
    });
  });

  it('uses structured failure summaries instead of raw launcher messages', () => {
    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'runtime_start_failed',
      scope: 'environment',
      message: 'control_stderr:',
      should_refresh_snapshot: true,
      failure: {
        code: 'ssh_connection_failed',
        severity: 'error',
        title: 'SSH Connection Failed',
        summary: 'SSH connection to "dify" failed.',
        diagnostics: [{
          channel: 'control_stderr',
          label: 'SSH stderr',
          text: 'ssh: Could not resolve hostname dify',
        }],
      },
    })).toEqual({
      title: 'SSH Connection Failed',
      message: 'SSH connection to "dify" failed.',
      tone: 'error',
      refresh_snapshot: true,
      delivery: 'toast',
    });

    const zhCN = createDesktopI18n('zh-CN');
    expect(launcherActionFailurePresentation(zhCN, {
      ok: false,
      code: 'runtime_start_failed',
      scope: 'environment',
      message: 'control_stderr:',
      failure: {
        code: 'ssh_connection_failed',
        severity: 'error',
        title: 'SSH Connection Failed',
        summary: 'SSH connection to "dify" failed.',
        target_label: 'dify',
      },
    })).toMatchObject({
      title: 'SSH 连接失败',
      message: '无法连接到 “dify” 的 SSH。',
    });
  });

  it('keeps dialog-scoped validation failures inline', () => {
    expect(launcherActionFailurePresentation(i18n, {
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

  it('explains Gateway start requirements and recovery paths', () => {
    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'gateway_start_required',
      scope: 'dialog',
      message: '',
      should_refresh_snapshot: true,
    })).toEqual({
      message: 'Start this Gateway first. Desktop will continue the pairing, refresh, or open action after the Gateway service is ready.',
      tone: 'info',
      refresh_snapshot: true,
      delivery: 'inline',
    });

    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'gateway_not_manageable',
      scope: 'dialog',
      message: '',
    })).toEqual({
      message: 'This URL Gateway is access-only. Desktop can pair and refresh it, but start, stop, restart, and update must be managed on the Gateway host.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'inline',
    });

    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'gateway_service_unreachable',
      scope: 'environment',
      message: '',
    })).toEqual({
      message: 'Desktop cannot reach the Gateway service. Start it on the target host or resolve the Gateway settings, then try again.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'toast',
    });

    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'gateway_container_unavailable',
      scope: 'environment',
      message: '',
    })).toEqual({
      message: 'The Gateway container is unavailable. Start the container or update the Gateway settings, then try again.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'toast',
    });

    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'gateway_bridge_unavailable',
      scope: 'environment',
      message: 'Bridge socket is missing.',
    })).toEqual({
      message: 'Bridge socket is missing.',
      tone: 'warning',
      refresh_snapshot: false,
      delivery: 'toast',
    });

    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'gateway_service_start_failed',
      scope: 'environment',
      message: '',
    })).toEqual({
      message: 'Desktop could not start the Gateway service. Review the Gateway target settings and try Start Gateway again.',
      tone: 'error',
      refresh_snapshot: false,
      delivery: 'toast',
    });

    expect(launcherActionFailurePresentation(i18n, {
      ok: false,
      code: 'gateway_catalog_failed',
      scope: 'environment',
      message: '',
      should_refresh_snapshot: true,
    })).toEqual({
      message: 'Desktop could not refresh this Gateway. Start or resolve the Gateway, then refresh again.',
      tone: 'warning',
      refresh_snapshot: true,
      delivery: 'toast',
    });
  });
});
