export type DesktopTargetKind = 'managed_local' | 'external_local_ui';

export type ManagedLocalDesktopTarget = Readonly<{
  kind: 'managed_local';
}>;

export type ExternalLocalUIDesktopTarget = Readonly<{
  kind: 'external_local_ui';
  external_local_ui_url: string;
}>;

export type DesktopSessionTarget = ManagedLocalDesktopTarget | ExternalLocalUIDesktopTarget;
