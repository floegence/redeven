import { isLoopbackOnlyBind, parseLocalUIBind } from './localUIBind';
import type {
  DesktopPageFieldModel,
  DesktopPageMode,
  DesktopSettingsSurfaceSnapshot,
} from '../shared/desktopSettingsSurface';
import {
  normalizeDesktopLocalUIPasswordMode,
  type DesktopSettingsDraft,
} from '../shared/settingsIPC';
import {
  buildDesktopSettingsSummaryItems,
  deriveDesktopAccessDraftModel,
  DESKTOP_ACCESS_MODE_OPTIONS,
  desktopAccessModeForDraft,
  desktopAccessModeLabel,
  type DesktopAccessModelOptions,
} from '../shared/desktopAccessModel';

export { desktopAccessModeForDraft };

type ManagedEnvironmentSettingsSnapshotOptions = DesktopAccessModelOptions & Readonly<{
  environment_id: string;
  environment_label: string;
  environment_kind: 'local' | 'controlplane';
}>;

export function pageWindowTitle(_mode: DesktopPageMode, environmentLabel: string): string {
  return `${trimString(environmentLabel) || 'Environment'} Settings`;
}

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

type BuildDesktopSettingsSurfaceSnapshotOptions = ManagedEnvironmentSettingsSnapshotOptions;

function localUIPasswordMode(
  draft: DesktopSettingsDraft,
  localUIPasswordConfigured: boolean,
) {
  return normalizeDesktopLocalUIPasswordMode(
    draft.local_ui_password_mode,
    localUIPasswordConfigured ? 'keep' : 'replace',
  );
}

function loopbackBindDraft(draft: DesktopSettingsDraft): boolean {
  try {
    return isLoopbackOnlyBind(parseLocalUIBind(trimString(draft.local_ui_bind)));
  } catch {
    return true;
  }
}

function hostFields(
  draft: DesktopSettingsDraft,
  options: BuildDesktopSettingsSurfaceSnapshotOptions,
): readonly DesktopPageFieldModel[] {
  const localUIPasswordConfigured = options.local_ui_password_configured === true;
  const runtimePasswordRequired = options.runtime_password_required === true;
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
      helpHTML: 'Examples: <code>localhost:23998</code>, <code>127.0.0.1:0</code>, or <code>0.0.0.0:23998</code>. Non-loopback binds require a Local UI password.',
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

export function buildDesktopSettingsSurfaceSnapshot(
  mode: DesktopPageMode,
  draft: DesktopSettingsDraft,
  options: BuildDesktopSettingsSurfaceSnapshotOptions,
): DesktopSettingsSurfaceSnapshot {
  const localUIPasswordConfigured = options.local_ui_password_configured === true;
  const accessModel = deriveDesktopAccessDraftModel(draft, options);
  const canClearLocalUIPassword = localUIPasswordConfigured
    && localUIPasswordMode(draft, localUIPasswordConfigured) !== 'clear'
    && loopbackBindDraft(draft);

  return {
    mode,
    environment_id: options.environment_id,
    environment_label: options.environment_label,
    environment_kind: options.environment_kind,
    window_title: pageWindowTitle(mode, options.environment_label),
    save_label: `Save ${options.environment_label || 'Environment'} Settings`,
    access_mode: accessModel.access_mode,
    access_mode_label: desktopAccessModeLabel(accessModel.access_mode),
    access_mode_options: DESKTOP_ACCESS_MODE_OPTIONS,
    next_start_address_display: accessModel.next_start_address_display,
    current_runtime_url: accessModel.current_runtime_url,
    password_state_label: accessModel.password_state_label,
    password_state_tone: accessModel.password_state_tone,
    local_ui_password_configured: localUIPasswordConfigured,
    runtime_password_required: options.runtime_password_required === true,
    local_ui_password_can_clear: canClearLocalUIPassword,
    summary_items: buildDesktopSettingsSummaryItems(draft, options),
    host_fields: hostFields(draft, options),
    draft,
  };
}
