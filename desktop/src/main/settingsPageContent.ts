import type { DesktopSettingsDraft } from '../shared/settingsIPC';

export type DesktopPageMode = 'desktop_settings' | 'connect';
export type DesktopTargetKind = DesktopSettingsDraft['target_kind'];
export type DesktopStatusTone = 'local' | 'external';

export interface DesktopTargetPresentation {
  statusLabel: string;
  statusTone: DesktopStatusTone;
  targetSummaryBody: string;
  hostStateNote: string;
  bootstrapStateNote: string;
  desktopSettingsNotice: string;
  saveLabel: Readonly<Record<DesktopPageMode, string>>;
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
  value: DesktopTargetKind;
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
  stateNote?: Readonly<{
    id: string;
    text: string;
  }>;
  choiceLegend?: string;
  choiceHint?: Readonly<{
    id: string;
    text: string;
  }>;
  choices?: readonly DesktopPageChoiceModel[];
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

export function pageWindowTitle(mode: DesktopPageMode): string {
  return mode === 'connect' ? 'Connect to Redeven' : 'Desktop Settings';
}

export const desktopTargetPresentations = {
  managed_local: {
    statusLabel: 'This device',
    statusTone: 'local',
    targetSummaryBody: 'Desktop starts the bundled runtime on this machine.',
    hostStateNote: 'These values apply to desktop-managed starts on this machine.',
    bootstrapStateNote: 'If saved, the next successful desktop-managed start on this device will consume and clear them automatically.',
    desktopSettingsNotice: 'Use Connect to Redeven... from the app menu when you want to switch between This device and External Redeven.',
    saveLabel: {
      desktop_settings: 'Save and apply',
      connect: 'Use this device',
    },
  },
  external_local_ui: {
    statusLabel: 'External Redeven',
    statusTone: 'external',
    targetSummaryBody: 'Desktop opens another machine’s Local UI inside this shell.',
    hostStateNote: 'Desktop is currently targeting External Redeven. These values stay saved for the next This device start.',
    bootstrapStateNote: 'Desktop is currently targeting External Redeven. This request stays saved for the next This device start and is never sent to the external target.',
    desktopSettingsNotice: 'Desktop is currently targeting External Redeven, so the values below are stored for the next time you switch back to This device.',
    saveLabel: {
      desktop_settings: 'Save for this device',
      connect: 'Connect',
    },
  },
} as const satisfies Record<DesktopTargetKind, DesktopTargetPresentation>;

const targetChoices = [
  {
    id: 'target-kind-managed-local',
    value: 'managed_local',
    title: 'This device',
    description: 'Use the bundled Desktop-managed Redeven runtime on this machine.',
  },
  {
    id: 'target-kind-external-local-ui',
    value: 'external_local_ui',
    title: 'External Redeven',
    description: 'Open another machine’s Redeven Local UI directly inside this Desktop shell.',
  },
] as const satisfies readonly DesktopPageChoiceModel[];

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

  if (mode === 'connect') {
    return {
      windowTitle: pageWindowTitle(mode),
      lead: 'Choose whether Desktop opens this machine or another Redeven Local UI endpoint.',
      statusLabel: presentation.statusLabel,
      statusTone: presentation.statusTone,
      saveLabel: presentation.saveLabel.connect,
      summaryItems: [
        {
          label: 'Current target',
          value: presentation.statusLabel,
          body: presentation.targetSummaryBody,
          valueId: 'target-summary-value',
          bodyId: 'target-summary-note',
        },
        {
          label: 'Desktop settings',
          value: 'Stay separate',
          body: 'Host This Device and Register to Redeven on next start stay in Desktop Settings. Agent runtime configuration appears later inside Agent Settings after Local UI opens.',
        },
        {
          label: 'External URLs',
          value: 'IP or localhost only',
          body: 'Paste a Local UI base URL using localhost or an IP literal. Hostnames are intentionally not supported.',
        },
      ],
      alert: {
        kicker: 'Desktop shell boundary',
        title: 'Desktop Settings stay separate',
        body: 'Host This Device and Register to Redeven on next start live in Desktop Settings. Agent runtime configuration appears later inside Agent Settings after Local UI opens.',
        tone: 'info',
      },
      sections: [
        {
          id: 'connection',
          title: 'Connection',
          cards: [
            {
              id: 'connection-target-card',
              kicker: 'Connection target',
              title: 'Connect to Redeven',
              descriptionHTML: 'Switch between this machine and another Redeven Local UI endpoint without mixing that choice into desktop-managed startup settings.',
              badge: 'Connection target',
              choiceLegend: 'Target',
              choiceHint: {
                id: 'target-kind-help',
                text: 'Choose where Desktop opens the Redeven Local UI.',
              },
              choices: targetChoices,
              fields: [
                {
                  id: 'external-local-ui-url',
                  name: 'external_local_ui_url',
                  label: 'Redeven URL',
                  type: 'url',
                  autocomplete: 'url',
                  inputMode: 'url',
                  placeholder: 'http://192.168.1.11:24000/',
                  helpHTML: 'Paste the Local UI base URL. Hostnames are intentionally not supported; use localhost or an IP literal.',
                  helpId: 'external-local-ui-url-help',
                  describedBy: ['external-local-ui-url-help', 'settings-error'],
                  hidden: targetKind !== 'external_local_ui',
                },
              ],
            },
          ],
        },
      ],
    };
  }

  return {
    windowTitle: pageWindowTitle(mode),
    lead: 'Configure how Desktop starts, exposes, and bootstraps the bundled Redeven runtime when this app is targeting this device.',
    statusLabel: presentation.statusLabel,
    statusTone: presentation.statusTone,
    saveLabel: presentation.saveLabel.desktop_settings,
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
      kicker: 'Connection target',
      title: 'Connection target is managed separately',
      body: presentation.desktopSettingsNotice,
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
