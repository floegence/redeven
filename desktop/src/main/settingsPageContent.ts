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

type LocalEnvironmentSettingsSnapshotOptions = DesktopAccessModelOptions & Readonly<{
  environment_id: string;
  environment_label: string;
  environment_kind: 'local' | 'controlplane';
  auto_runtime_probe_configurable?: boolean;
}>;

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

type BuildDesktopSettingsSurfaceSnapshotOptions = LocalEnvironmentSettingsSnapshotOptions;

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
  const passwordHelpKey = (() => {
    if (passwordMode === 'clear') {
      return 'settings.localUIPasswordClearHelp';
    }
    if (passwordMode === 'replace' && typedPassword) {
      return 'settings.localUIPasswordReplaceHelp';
    }
    if (localUIPasswordConfigured) {
      return 'settings.localUIPasswordKeepHelp';
    }
    if (runtimePasswordRequired) {
      return 'settings.localUIPasswordRuntimeRequiredHelp';
    }
    return 'settings.localUIPasswordHelpBase';
  })();

  return [
    {
      id: 'local-ui-bind',
      name: 'local_ui_bind',
      label_key: 'settings.localUIBindAddressLabel',
      autocomplete: 'off',
      help_key: 'settings.localUIBindHelp',
      helpId: 'local-ui-bind-help',
      describedBy: ['local-ui-bind-help', 'settings-error'],
    },
    {
      id: 'local-ui-password',
      name: 'local_ui_password',
      label_key: 'settings.localUIPasswordLabel',
      type: 'password',
      autocomplete: 'new-password',
      placeholder_key: localUIPasswordConfigured ? 'settings.localUIPasswordReplacePlaceholder' : undefined,
      help_key: passwordHelpKey,
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
    window_title_key: 'settings.settingsWindowTitle',
    save_label_key: 'settings.saveEnvironmentSettings',
    access_mode: accessModel.access_mode,
    access_mode_label_key: desktopAccessModeLabel(accessModel.access_mode),
    access_mode_options: DESKTOP_ACCESS_MODE_OPTIONS,
    next_start_address_display: accessModel.next_start_address_display,
    next_start_address_kind: accessModel.next_start_address_kind,
    current_runtime_url: accessModel.current_runtime_url,
    password_state_id: accessModel.password_state_id,
    password_state_tone: accessModel.password_state_tone,
    local_ui_password_configured: localUIPasswordConfigured,
    runtime_password_required: options.runtime_password_required === true,
    local_ui_password_can_clear: canClearLocalUIPassword,
    auto_runtime_probe_configurable: options.auto_runtime_probe_configurable !== false,
    summary_items: buildDesktopSettingsSummaryItems(draft, options),
    host_fields: hostFields(draft, options),
    draft,
  };
}
