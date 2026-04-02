import { isLoopbackOnlyBind, parseLocalUIBind } from './localUIBind';
import {
  normalizeDesktopLocalUIPasswordMode,
  type DesktopSettingsDraft,
} from '../shared/settingsIPC';
import type {
  DesktopAccessMode,
  DesktopAccessModeOption,
  DesktopPageFieldModel,
  DesktopPageMode,
  DesktopSettingsSummaryItem,
  DesktopSettingsSurfaceSnapshot,
} from '../shared/desktopSettingsSurface';

export function pageWindowTitle(_mode: DesktopPageMode): string {
  return 'Local Environment Settings';
}

export const DESKTOP_ACCESS_MODE_OPTIONS: readonly DesktopAccessModeOption[] = [
  {
    value: 'local_only',
    label: 'Local only',
    description: 'Keep the local environment on loopback for this machine only.',
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

type BuildDesktopSettingsSurfaceSnapshotOptions = Readonly<{
  local_ui_password_configured?: boolean;
  runtime_password_required?: boolean;
}>;

function localUIPasswordMode(
  draft: DesktopSettingsDraft,
  localUIPasswordConfigured: boolean,
) {
  return normalizeDesktopLocalUIPasswordMode(
    draft.local_ui_password_mode,
    localUIPasswordConfigured ? 'keep' : 'replace',
  );
}

function effectiveLocalUIPasswordConfigured(
  draft: DesktopSettingsDraft,
  localUIPasswordConfigured: boolean,
): boolean {
  switch (localUIPasswordMode(draft, localUIPasswordConfigured)) {
    case 'keep':
      return localUIPasswordConfigured;
    case 'clear':
      return false;
    default:
      return trimString(draft.local_ui_password) !== '';
  }
}

function loopbackBindDraft(draft: DesktopSettingsDraft): boolean {
  try {
    return isLoopbackOnlyBind(parseLocalUIBind(trimString(draft.local_ui_bind) || '127.0.0.1:0'));
  } catch {
    return true;
  }
}

export function desktopAccessModeForDraft(
  draft: DesktopSettingsDraft,
  options?: BuildDesktopSettingsSurfaceSnapshotOptions,
): DesktopAccessMode {
  const bind = trimString(draft.local_ui_bind);
  const hasPassword = effectiveLocalUIPasswordConfigured(draft, options?.local_ui_password_configured === true);
  if (bind === '127.0.0.1:0' && !hasPassword) {
    return 'local_only';
  }
  if (bind === '0.0.0.0:24000') {
    return 'shared_local_network';
  }
  return 'custom_exposure';
}

function desktopAccessModeLabel(mode: DesktopAccessMode): string {
  return DESKTOP_ACCESS_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Custom exposure';
}

function passwordStateForDraft(
  mode: DesktopAccessMode,
  draft: DesktopSettingsDraft,
  options?: BuildDesktopSettingsSurfaceSnapshotOptions,
): Readonly<{
  label: string;
  tone: 'default' | 'warning' | 'success';
}> {
  const storedPasswordConfigured = options?.local_ui_password_configured === true;
  const passwordMode = localUIPasswordMode(draft, storedPasswordConfigured);
  const typedPassword = trimString(draft.local_ui_password) !== '';
  const hasEffectivePassword = effectiveLocalUIPasswordConfigured(draft, storedPasswordConfigured);
  if (mode === 'local_only') {
    return {
      label: 'No password required',
      tone: 'default',
    };
  }
  if (passwordMode === 'clear') {
    return {
      label: 'Password will be removed on save',
      tone: 'warning',
    };
  }
  if (passwordMode === 'replace' && typedPassword) {
    return {
      label: storedPasswordConfigured ? 'Password will be replaced on save' : 'Password will be configured on save',
      tone: 'success',
    };
  }
  if (hasEffectivePassword) {
    return {
      label: 'Password configured',
      tone: 'success',
    };
  }
  return {
    label: 'Password required before the next open of Local Environment',
    tone: 'warning',
  };
}

function hostFields(
  draft: DesktopSettingsDraft,
  options?: BuildDesktopSettingsSurfaceSnapshotOptions,
): readonly DesktopPageFieldModel[] {
  const localUIPasswordConfigured = options?.local_ui_password_configured === true;
  const runtimePasswordRequired = options?.runtime_password_required === true;
  const passwordMode = localUIPasswordMode(draft, localUIPasswordConfigured);
  const typedPassword = trimString(draft.local_ui_password) !== '';
  const passwordHelpHTML = (() => {
    const base = 'Desktop stores this secret locally and forwards it through a non-interactive stdin startup channel.';
    if (passwordMode === 'clear') {
      return 'Desktop will remove the stored password on save. Enter a new value to replace it instead.';
    }
    if (passwordMode === 'replace' && typedPassword) {
      return `${base} Saving will replace the stored password.`;
    }
    if (localUIPasswordConfigured) {
      return `${base} Leave this blank to keep the current stored password.`;
    }
    if (runtimePasswordRequired) {
      return `${base} The current runtime is protected, but Desktop does not have a stored password ready to reuse. Enter it here to save it for the next desktop-managed start.`;
    }
    return base;
  })();

  return [
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
      placeholder: localUIPasswordConfigured ? 'Enter a new password to replace the stored one' : undefined,
      helpHTML: passwordHelpHTML,
      helpId: 'local-ui-password-help',
      describedBy: ['local-ui-password-help', 'settings-error'],
    },
  ] as const;
}

function bootstrapStatus(draft: DesktopSettingsDraft): Readonly<{
  pending: boolean;
  label: string;
  detail: string;
  tone: 'default' | 'primary';
}> {
  const hasBootstrap = trimString(draft.controlplane_url) !== ''
    || trimString(draft.env_id) !== ''
    || trimString(draft.env_token) !== '';
  if (hasBootstrap) {
    return {
      pending: true,
      label: 'Registration queued for next start',
      detail: 'Will be consumed after the next successful desktop-managed start.',
      tone: 'primary',
    };
  }
  return {
    pending: false,
    label: 'No bootstrap request queued',
    detail: 'Optional for the next desktop-managed start only.',
    tone: 'default',
  };
}

function buildSummaryItems(
  accessMode: DesktopAccessMode,
  draft: DesktopSettingsDraft,
  password: Readonly<{ label: string; tone: 'default' | 'warning' | 'success' }>,
  bootstrap: Readonly<{ label: string; detail: string; tone: 'default' | 'primary' }>,
): readonly DesktopSettingsSummaryItem[] {
  return [
    {
      id: 'access_mode',
      label: 'Access mode',
      value: desktopAccessModeLabel(accessMode),
      detail: DESKTOP_ACCESS_MODE_OPTIONS.find((option) => option.value === accessMode)?.description,
      tone: 'default',
    },
    {
      id: 'bind_address',
      label: 'Bind address',
      value: trimString(draft.local_ui_bind) || '127.0.0.1:0',
      detail: accessMode === 'local_only'
        ? 'Loopback only'
        : accessMode === 'shared_local_network'
          ? 'Local network preset'
          : 'Custom bind',
      tone: 'default',
    },
    {
      id: 'password_state',
      label: 'Password',
      value: password.label,
      tone: password.tone,
    },
    {
      id: 'next_start',
      label: 'Next start',
      value: bootstrap.label,
      detail: bootstrap.detail,
      tone: bootstrap.tone,
    },
  ] as const;
}

export function buildDesktopSettingsSurfaceSnapshot(
  mode: DesktopPageMode,
  draft: DesktopSettingsDraft,
  options?: BuildDesktopSettingsSurfaceSnapshotOptions,
): DesktopSettingsSurfaceSnapshot {
  const localUIPasswordConfigured = options?.local_ui_password_configured === true;
  const accessMode = desktopAccessModeForDraft(draft, options);
  const password = passwordStateForDraft(accessMode, draft, options);
  const bootstrap = bootstrapStatus(draft);
  const canClearLocalUIPassword = localUIPasswordConfigured
    && localUIPasswordMode(draft, localUIPasswordConfigured) !== 'clear'
    && loopbackBindDraft(draft);

  return {
    mode,
    window_title: pageWindowTitle(mode),
    save_label: 'Save Local Environment Settings',
    access_mode: accessMode,
    access_mode_label: desktopAccessModeLabel(accessMode),
    access_mode_options: DESKTOP_ACCESS_MODE_OPTIONS,
    access_bind_display: trimString(draft.local_ui_bind) || '127.0.0.1:0',
    password_state_label: password.label,
    password_state_tone: password.tone,
    local_ui_password_configured: localUIPasswordConfigured,
    runtime_password_required: options?.runtime_password_required === true,
    local_ui_password_can_clear: canClearLocalUIPassword,
    bootstrap_pending: bootstrap.pending,
    bootstrap_status_label: bootstrap.label,
    summary_items: buildSummaryItems(accessMode, draft, password, bootstrap),
    host_fields: hostFields(draft, options),
    bootstrap_fields: bootstrapFields,
    draft,
  };
}
