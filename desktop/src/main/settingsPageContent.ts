import type { DesktopSettingsDraft } from '../shared/settingsIPC';

export type DesktopPageMode = 'advanced_settings';
export type DesktopStatusTone = 'local';

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

export function buildSettingsPageViewModel(mode: DesktopPageMode): DesktopPageViewModel {
  return {
    windowTitle: pageWindowTitle(mode),
    lead: 'Edit the low-level This Device startup, access, and one-shot bootstrap inputs that sit behind the Desktop welcome launcher.',
    statusLabel: 'This device',
    statusTone: 'local',
    saveLabel: 'Save This Device Options',
    summaryItems: [
      {
        label: 'Launcher model',
        value: 'Choose a machine on launch',
        body: 'Desktop always opens the welcome launcher first. These settings only affect future opens of This Device.',
        valueId: 'target-summary-value',
        bodyId: 'target-summary-note',
      },
      {
        label: 'Host This Device',
        value: 'Desktop-managed Local UI',
        body: 'These values apply only when you open This Device from the welcome launcher.',
        bodyId: 'host-summary-note',
      },
      {
        label: 'Next start',
        value: 'One-shot bootstrap',
        body: 'If provided, Desktop will consume and clear this bootstrap request after the next successful This Device startup.',
        bodyId: 'bootstrap-summary-note',
      },
    ],
    alert: {
      kicker: 'Primary workflow',
      title: 'Machine selection stays in the welcome launcher',
      body: 'Use Switch Device... or the startup welcome page when you want to choose This Device or another machine. This screen only edits This Device startup details.',
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
            descriptionHTML: 'Set the Local UI bind and access password that Desktop should use when it starts the bundled runtime on this machine.',
            badge: 'This device',
            stateNote: {
              id: 'host-this-device-state-note',
              text: 'These values are saved locally and applied the next time you open This Device.',
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
              text: 'This request is never sent until a future This Device start succeeds.',
            },
            fields: bootstrapFields,
          },
        ],
      },
    ],
  };
}
