export type RedevenSurfaceRole =
  | 'panel'
  | 'panelInteractive'
  | 'panelStrong'
  | 'overlay'
  | 'control'
  | 'controlMuted'
  | 'segmented'
  | 'inset';

export type RedevenDividerRole = 'default' | 'strong';

const REDEVEN_SURFACE_ROLE_CLASS: Readonly<Record<RedevenSurfaceRole, string>> = Object.freeze({
  panel: 'redeven-surface-panel',
  panelInteractive: 'redeven-surface-panel redeven-surface-panel--interactive',
  panelStrong: 'redeven-surface-panel redeven-surface-panel--strong',
  overlay: 'redeven-surface-overlay',
  control: 'redeven-surface-control',
  controlMuted: 'redeven-surface-control redeven-surface-control--muted',
  segmented: 'redeven-surface-segmented',
  inset: 'redeven-surface-inset',
});

const REDEVEN_DIVIDER_ROLE_CLASS: Readonly<Record<RedevenDividerRole, string>> = Object.freeze({
  default: 'redeven-divider',
  strong: 'redeven-divider redeven-divider--strong',
});

export function redevenSurfaceRoleClass(role: RedevenSurfaceRole): string {
  return REDEVEN_SURFACE_ROLE_CLASS[role];
}

export function redevenDividerRoleClass(role: RedevenDividerRole = 'default'): string {
  return REDEVEN_DIVIDER_ROLE_CLASS[role];
}
