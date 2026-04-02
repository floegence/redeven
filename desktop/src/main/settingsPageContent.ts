import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import type {
  DesktopAccessMode,
  DesktopAccessModeOption,
  DesktopPageFieldModel,
  DesktopPageMode,
  DesktopSettingsSurfaceSnapshot,
} from '../shared/desktopSettingsSurface';

export function pageWindowTitle(_mode: DesktopPageMode): string {
  return 'This Device Options';
}

export const DESKTOP_ACCESS_MODE_OPTIONS: readonly DesktopAccessModeOption[] = [
  {
    value: 'private_device',
    label: 'Private to this device',
    description: 'Keep Redeven on loopback for this machine only.',
  },
  {
    value: 'shared_local_network',
    label: 'Shared on your local network',
    description: 'Expose Redeven on your LAN and require a password.',
  },
  {
    value: 'custom_exposure',
    label: 'Custom exposure',
    description: 'Edit the bind address and password directly.',
  },
] as const;

const hostFields = [
  {
    id: 'local-ui-bind',
    name: 'local_ui_bind',
    label: 'Local UI bind address',
    autocomplete: 'off',
    helpHTML: 'Use <code>127.0.0.1:0</code> for the default private bind. Non-loopback binds require a Local UI password.',
    helpId: 'local-ui-bind-help',
    describedBy: ['local-ui-bind-help', 'settings-error'],
  },
  {
    id: 'local-ui-password',
    name: 'local_ui_password',
    label: 'Local UI password',
    type: 'password',
    autocomplete: 'new-password',
    helpHTML: 'Desktop stores this secret locally and forwards it through a non-interactive stdin startup channel.',
    helpId: 'local-ui-password-help',
    describedBy: ['local-ui-password-help', 'settings-error'],
  },
] as const satisfies readonly DesktopPageFieldModel[];

const bootstrapFields = [
  {
    id: 'controlplane-url',
    name: 'controlplane_url',
    label: 'Control plane URL',
    type: 'url',
    autocomplete: 'url',
    inputMode: 'url',
    describedBy: ['settings-error'],
  },
  {
    id: 'env-id',
    name: 'env_id',
    label: 'Environment ID',
    autocomplete: 'off',
    describedBy: ['settings-error'],
  },
  {
    id: 'env-token',
    name: 'env_token',
    label: 'Environment token',
    type: 'password',
    autocomplete: 'off',
    helpHTML: 'Desktop stores this request locally and consumes it on the next successful desktop-managed start.',
    helpId: 'env-token-help',
    describedBy: ['env-token-help', 'settings-error'],
  },
] as const satisfies readonly DesktopPageFieldModel[];

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

export function desktopAccessModeForDraft(draft: DesktopSettingsDraft): DesktopAccessMode {
  const bind = trimString(draft.local_ui_bind);
  const hasPassword = trimString(draft.local_ui_password) !== '';
  if (bind === '127.0.0.1:0' && !hasPassword) {
    return 'private_device';
  }
  if (bind === '0.0.0.0:24000') {
    return 'shared_local_network';
  }
  return 'custom_exposure';
}

function desktopAccessModeLabel(mode: DesktopAccessMode): string {
  return DESKTOP_ACCESS_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Custom exposure';
}

function desktopAccessModeDescription(mode: DesktopAccessMode): string {
  switch (mode) {
    case 'private_device':
      return 'Redeven only listens on loopback and keeps This Device private until you choose a broader exposure.';
    case 'shared_local_network':
      return 'Redeven listens on your LAN-facing interface and expects a password before the next This Device open.';
    default:
      return 'Redeven uses the raw bind and password values shown below.';
  }
}

function passwordState(mode: DesktopAccessMode, draft: DesktopSettingsDraft): Readonly<{
  label: string;
  tone: 'default' | 'warning' | 'success';
}> {
  const hasPassword = trimString(draft.local_ui_password) !== '';
  if (mode === 'private_device') {
    return {
      label: 'No password required',
      tone: 'default',
    };
  }
  if (hasPassword) {
    return {
      label: 'Password configured',
      tone: 'success',
    };
  }
  return {
    label: 'Password required before the next open of This Device',
    tone: 'warning',
  };
}

function bootstrapStatus(draft: DesktopSettingsDraft): Readonly<{
  pending: boolean;
  label: string;
  detail: string;
}> {
  const hasBootstrap = trimString(draft.controlplane_url) !== ''
    || trimString(draft.env_id) !== ''
    || trimString(draft.env_token) !== '';
  if (hasBootstrap) {
    return {
      pending: true,
      label: 'Registration queued for next start',
      detail: 'Desktop will consume and clear this bootstrap request after the next successful This Device startup.',
    };
  }
  return {
    pending: false,
    label: 'No bootstrap request queued',
    detail: 'Add a one-shot control plane registration only when the next desktop-managed start needs it.',
  };
}

export function buildDesktopSettingsSurfaceSnapshot(
  mode: DesktopPageMode,
  draft: DesktopSettingsDraft,
): DesktopSettingsSurfaceSnapshot {
  const accessMode = desktopAccessModeForDraft(draft);
  const password = passwordState(accessMode, draft);
  const bootstrap = bootstrapStatus(draft);

  return {
    mode,
    window_title: pageWindowTitle(mode),
    lead: 'Edit the startup, access, and one-shot bootstrap behavior that applies the next time you open This Device from Connect Environment.',
    status_label: 'This device',
    status_tone: 'local',
    save_label: 'Save This Device Options',
    access_mode: accessMode,
    access_mode_label: desktopAccessModeLabel(accessMode),
    access_mode_description: desktopAccessModeDescription(accessMode),
    access_mode_options: DESKTOP_ACCESS_MODE_OPTIONS,
    access_bind_display: trimString(draft.local_ui_bind) || '127.0.0.1:0',
    password_state_label: password.label,
    password_state_tone: password.tone,
    bootstrap_pending: bootstrap.pending,
    bootstrap_status_label: bootstrap.label,
    bootstrap_status_detail: bootstrap.detail,
    alert: {
      kicker: 'Primary workflow',
      title: 'Environment selection stays in Connect Environment',
      body: 'Use Connect Environment when you want to choose This Device or another Environment. This screen only changes future This Device startup behavior.',
      bodyId: 'desktop-target-alert-body',
      tone: 'info',
    },
    host_fields: hostFields,
    bootstrap_fields: bootstrapFields,
    draft,
  };
}
