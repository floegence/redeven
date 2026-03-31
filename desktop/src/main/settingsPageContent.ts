import type { DesktopSettingsDraft } from '../shared/settingsIPC';

export type DesktopPageMode = 'advanced_settings';
export type DesktopTargetKind = DesktopSettingsDraft['target_kind'];
export type DesktopStatusTone = 'local' | 'external';

export interface DesktopTargetPresentation {
  statusLabel: string;
  statusTone: DesktopStatusTone;
  targetSummaryBody: string;
  hostStateNote: string;
  bootstrapStateNote: string;
  advancedSettingsNotice: string;
  saveLabel: string;
}

export interface DesktopSummaryItem {
  label: string;
  value: string;
  body: string;
  valueId?: string;
  bodyId?: string;
}

export interface DesktopPageAlertModel {
  kicker: string;
  title: string;
  body: string;
  bodyId?: string;
  tone?: 'info' | 'default';
}

export interface DesktopPageChoiceModel {
  id: string;
  value: string;
  title: string;
  description: string;
}

export interface DesktopPageFieldModel {
  id: string;
  name: keyof DesktopSettingsDraft;
  label: string;
  type?: 'text' | 'password' | 'url';
  autocomplete?: string;
  inputMode?: 'url';
  placeholder?: string;
  helpHTML?: string;
  helpId?: string;
  describedBy?: readonly string[];
  hidden?: boolean;
}

export interface DesktopPageCardModel {
  id: string;
  kicker: string;
  title: string;
  descriptionHTML: string;
  badge?: string;
  choices?: readonly DesktopPageChoiceModel[];
  choiceLegend?: string;
  choiceHint?: Readonly<{
    id: string;
    text: string;
  }>;
  stateNote?: Readonly<{
    id: string;
    text: string;
  }>;
  fields: readonly DesktopPageFieldModel[];
}

export interface DesktopPageSectionModel {
  id: string;
  title: string;
  cards: readonly DesktopPageCardModel[];
}

export interface DesktopPageViewModel {
  windowTitle: string;
  lead: string;
  statusLabel: string;
  statusTone: DesktopStatusTone;
  summaryItems: readonly DesktopSummaryItem[];
  alert: DesktopPageAlertModel;
  sections: readonly DesktopPageSectionModel[];
  saveLabel: string;
}

export function pageWindowTitle(_mode: DesktopPageMode): string {
  return 'This Device Options';
}

export const desktopTargetPresentations = {
  managed_local: {
    statusLabel: 'This device',
    statusTone: 'local',
    targetSummaryBody: 'Desktop starts the bundled runtime on this machine.',
    hostStateNote: 'These values apply to desktop-managed starts on this machine.',
    bootstrapStateNote: 'If saved, the next successful desktop-managed start on this device will consume and clear them automatically.',
    advancedSettingsNotice: 'Use Switch Device... when you want to choose This device or Another device without editing the raw startup inputs below.',
    saveLabel: 'Save and apply',
  },
  external_local_ui: {
    statusLabel: 'Another device',
    statusTone: 'external',
    targetSummaryBody: "Desktop opens another device's Local UI inside this shell.",
    hostStateNote: 'Desktop is currently targeting Another device. These values stay saved for the next This device start.',
    bootstrapStateNote: 'Desktop is currently targeting Another device. This request stays saved for the next This device start and is never sent to the external target.',
    advancedSettingsNotice: 'Desktop is currently targeting Another device, so the values below stay scoped to the next This device start.',
    saveLabel: 'Save for this device',
  },
} as const satisfies Record<DesktopTargetKind, DesktopTargetPresentation>;

const hostFields = [
  {
    id: 'local-ui-bind',
    name: 'local_ui_bind',
    label: 'Local UI bind address',
    autocomplete: 'off',
    helpHTML: 'Non-loopback Local UI binds require a Local UI password.',
    helpId: 'local-ui-bind-help',
    describedBy: ['local-ui-bind-help', 'settings-error'],
  },
  {
    id: 'local-ui-password',
    name: 'local_ui_password',
    label: 'Local UI password',
    type: 'password',
    autocomplete: 'new-password',
    helpHTML: 'Desktop stores this secret locally and passes it through <code>--password-env</code>.',
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
    helpHTML: 'Desktop passes this secret through <code>--env-token-env</code> instead of putting it in the process arguments.',
    helpId: 'env-token-help',
    describedBy: ['env-token-help', 'settings-error'],
  },
] as const satisfies readonly DesktopPageFieldModel[];

export function buildSettingsPageViewModel(
  mode: DesktopPageMode,
  targetKind: DesktopTargetKind,
): DesktopPageViewModel {
  const presentation = desktopTargetPresentations[targetKind] ?? desktopTargetPresentations.managed_local;

  return {
    windowTitle: pageWindowTitle(mode),
    lead: 'Edit the low-level This device startup, access, and one-shot bootstrap inputs that sit behind the device chooser.',
    statusLabel: presentation.statusLabel,
    statusTone: presentation.statusTone,
    saveLabel: presentation.saveLabel,
    summaryItems: [
      {
        label: 'Current target',
        value: presentation.statusLabel,
        body: presentation.targetSummaryBody,
        valueId: 'target-summary-value',
        bodyId: 'target-summary-note',
      },
      {
        label: 'Host This Device',
        value: 'Desktop-managed Local UI',
        body: presentation.hostStateNote,
        bodyId: 'host-summary-note',
      },
      {
        label: 'Next start',
        value: 'One-shot bootstrap',
        body: presentation.bootstrapStateNote,
        bodyId: 'bootstrap-summary-note',
      },
    ],
    alert: {
      kicker: 'Primary workflow',
      title: 'The device chooser owns machine selection',
      body: presentation.advancedSettingsNotice,
      bodyId: 'desktop-target-alert-body',
      tone: 'info',
    },
    sections: [
      {
        id: 'desktop-startup',
        title: 'Desktop-managed startup',
        cards: [
          {
            id: 'host-this-device-card',
            kicker: 'Desktop startup',
            title: 'Host This Device',
            descriptionHTML: 'Use <code>127.0.0.1:0</code> for the default loopback-only dynamic port, or an explicit bind such as <code>0.0.0.0:24000</code> to make this Desktop reachable on your LAN.',
            badge: 'Desktop shell',
            stateNote: {
              id: 'host-this-device-state-note',
              text: presentation.hostStateNote,
            },
            fields: hostFields,
          },
        ],
      },
      {
        id: 'desktop-bootstrap',
        title: 'Next desktop-managed start',
        cards: [
          {
            id: 'register-next-start-card',
            kicker: 'One-shot request',
            title: 'Register to Redeven on next start',
            descriptionHTML: 'Queue a one-shot bootstrap request for the next successful desktop-managed start on this device. Desktop clears the request automatically after a successful startup.',
            badge: 'One-shot request',
            stateNote: {
              id: 'bootstrap-state-note',
              text: presentation.bootstrapStateNote,
            },
            fields: bootstrapFields,
          },
        ],
      },
    ],
  };
}
