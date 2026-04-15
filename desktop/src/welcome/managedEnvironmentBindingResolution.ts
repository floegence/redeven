import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';

export type ManagedEnvironmentBindingSelection = Readonly<{
  mode: 'create' | 'edit';
  environment_id: string;
  use_control_plane_binding: boolean;
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
}>;

export type ManagedEnvironmentBindingResolutionKind =
  | 'available_new_binding'
  | 'editing_same_binding'
  | 'reuse_existing_entry'
  | 'focus_existing_open_session'
  | 'wait_for_existing_opening_session'
  | 'attachable_existing_local_host'
  | 'blocked_by_external_local_owner';

export type ManagedEnvironmentBindingResolution = Readonly<{
  kind: ManagedEnvironmentBindingResolutionKind;
  existing_entry: DesktopEnvironmentEntry | null;
}>;

export type ManagedEnvironmentBindingResolutionView = Readonly<{
  tone: 'neutral' | 'primary' | 'warning' | 'success';
  title: string;
  description: string;
  detail: string;
  save_label: string;
  connect_label: string;
  save_disabled: boolean;
  connect_disabled: boolean;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function selectedBindingKey(selection: ManagedEnvironmentBindingSelection): string {
  return [
    compact(selection.provider_origin),
    compact(selection.provider_id),
    compact(selection.env_public_id),
  ].join('|');
}

function entryBindingKey(entry: DesktopEnvironmentEntry): string {
  return [
    compact(entry.provider_origin),
    compact(entry.provider_id),
    compact(entry.env_public_id),
  ].join('|');
}

function currentManagedEntry(
  selection: ManagedEnvironmentBindingSelection,
  environments: readonly DesktopEnvironmentEntry[],
): DesktopEnvironmentEntry | null {
  const environmentID = compact(selection.environment_id);
  if (environmentID === '') {
    return null;
  }
  return environments.find((entry) => entry.kind === 'managed_environment' && entry.id === environmentID) ?? null;
}

export function resolveManagedEnvironmentBindingResolution(
  selection: ManagedEnvironmentBindingSelection,
  environments: readonly DesktopEnvironmentEntry[],
): ManagedEnvironmentBindingResolution | null {
  if (
    selection.use_control_plane_binding !== true
    || compact(selection.provider_origin) === ''
    || compact(selection.provider_id) === ''
    || compact(selection.env_public_id) === ''
  ) {
    return null;
  }

  const currentEntry = currentManagedEntry(selection, environments);
  if (
    currentEntry
    && currentEntry.kind === 'managed_environment'
    && entryBindingKey(currentEntry) === selectedBindingKey(selection)
  ) {
    return {
      kind: 'editing_same_binding',
      existing_entry: currentEntry,
    };
  }

  const existingEntry = environments.find((entry) => (
    entry.kind === 'managed_environment'
    && entryBindingKey(entry) === selectedBindingKey(selection)
  )) ?? null;
  if (!existingEntry) {
    return {
      kind: 'available_new_binding',
      existing_entry: null,
    };
  }
  if (existingEntry.is_open) {
    return {
      kind: 'focus_existing_open_session',
      existing_entry: existingEntry,
    };
  }
  if (existingEntry.is_opening) {
    return {
      kind: 'wait_for_existing_opening_session',
      existing_entry: existingEntry,
    };
  }
  if (existingEntry.managed_local_owner && existingEntry.managed_local_owner !== 'desktop') {
    return {
      kind: 'blocked_by_external_local_owner',
      existing_entry: existingEntry,
    };
  }
  if (existingEntry.managed_has_local_hosting) {
    return {
      kind: 'attachable_existing_local_host',
      existing_entry: existingEntry,
    };
  }
  return {
    kind: 'reuse_existing_entry',
    existing_entry: existingEntry,
  };
}

export function describeManagedEnvironmentBindingResolution(
  resolution: ManagedEnvironmentBindingResolution | null,
  options: Readonly<{
    isCreate: boolean;
  }>,
): ManagedEnvironmentBindingResolutionView | null {
  if (!resolution) {
    return null;
  }

  const existingLabel = compact(resolution.existing_entry?.label) || 'this environment';
  const defaultSaveLabel = options.isCreate ? 'Save' : 'Update';
  const defaultConnectLabel = options.isCreate ? 'Save & Connect' : 'Save & Reconnect';

  switch (resolution.kind) {
    case 'available_new_binding':
      return {
        tone: 'primary',
        title: 'This Control Plane environment is available.',
        description: 'Desktop will bind this entry to the selected Control Plane environment and keep one shared identity for local and remote access.',
        detail: 'Local state will be stored under the selected Control Plane environment scope on this device.',
        save_label: defaultSaveLabel,
        connect_label: defaultConnectLabel,
        save_disabled: false,
        connect_disabled: false,
      };
    case 'editing_same_binding':
      return {
        tone: 'success',
        title: 'This entry is already connected to the selected Control Plane environment.',
        description: `Desktop will keep using "${existingLabel}" and update its local hosting settings in place.`,
        detail: resolution.existing_entry?.is_open
          ? 'That environment is already open, so connect will focus the existing window after saving.'
          : 'Desktop will keep one stable managed entry instead of creating a duplicate.',
        save_label: options.isCreate ? 'Save' : 'Update',
        connect_label: resolution.existing_entry?.is_open ? 'Save & Focus' : defaultConnectLabel,
        save_disabled: false,
        connect_disabled: resolution.existing_entry?.is_opening === true,
      };
    case 'focus_existing_open_session':
      return {
        tone: 'success',
        title: `This Control Plane environment is already open as "${existingLabel}".`,
        description: 'Desktop will reuse that existing managed entry instead of creating a duplicate.',
        detail: 'Connect will focus the existing window after saving.',
        save_label: 'Save & Reuse',
        connect_label: 'Save & Focus',
        save_disabled: false,
        connect_disabled: false,
      };
    case 'wait_for_existing_opening_session':
      return {
        tone: 'warning',
        title: `Desktop is already opening "${existingLabel}".`,
        description: 'Wait for that opening attempt to finish before saving another binding to the same Control Plane environment.',
        detail: 'This avoids racing two launcher actions into the same managed entry.',
        save_label: 'Already Opening',
        connect_label: 'Already Opening',
        save_disabled: true,
        connect_disabled: true,
      };
    case 'attachable_existing_local_host':
      return {
        tone: 'success',
        title: `Desktop already manages the local host for "${existingLabel}".`,
        description: 'Saving here will reuse that existing managed entry and keep one shared local host for this Control Plane environment.',
        detail: 'Desktop will not create a second local host on this device for the same Control Plane environment.',
        save_label: 'Save & Reuse',
        connect_label: defaultConnectLabel,
        save_disabled: false,
        connect_disabled: false,
      };
    case 'blocked_by_external_local_owner':
      return {
        tone: 'warning',
        title: `Another Redeven host process owns "${existingLabel}".`,
        description: 'Desktop cannot take over that local host from this launcher session.',
        detail: 'Use the existing host process instead, or stop it first and then try again here.',
        save_label: 'Blocked',
        connect_label: 'Blocked',
        save_disabled: true,
        connect_disabled: true,
      };
    case 'reuse_existing_entry':
    default:
      return {
        tone: 'success',
        title: `This Control Plane environment is already connected as "${existingLabel}".`,
        description: 'Desktop will reuse that entry instead of creating a duplicate.',
        detail: 'Saving here will keep one stable managed identity for this Control Plane environment.',
        save_label: 'Save & Reuse',
        connect_label: defaultConnectLabel,
        save_disabled: false,
        connect_disabled: false,
      };
  }
}
