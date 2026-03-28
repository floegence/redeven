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

export const REDEVEN_SURFACE_ROLE_CLASS: Readonly<Record<RedevenSurfaceRole, string>> = Object.freeze({
  panel: 'redeven-surface-panel',
  panelInteractive: 'redeven-surface-panel redeven-surface-panel--interactive',
  panelStrong: 'redeven-surface-panel redeven-surface-panel--strong',
  overlay: 'redeven-surface-overlay',
  control: 'redeven-surface-control',
  controlMuted: 'redeven-surface-control redeven-surface-control--muted',
  segmented: 'redeven-surface-segmented',
  inset: 'redeven-surface-inset',
});

export const REDEVEN_DIVIDER_ROLE_CLASS: Readonly<Record<RedevenDividerRole, string>> = Object.freeze({
  default: 'redeven-divider',
  strong: 'redeven-divider redeven-divider--strong',
});

const REDEVEN_SEGMENTED_ITEM_CLASS = 'redeven-surface-segmented__item';
const REDEVEN_SEGMENTED_ITEM_ACTIVE_CLASS = `${REDEVEN_SEGMENTED_ITEM_CLASS} redeven-surface-segmented__item--active`;

export function redevenSurfaceRoleClass(role: RedevenSurfaceRole): string {
  return REDEVEN_SURFACE_ROLE_CLASS[role];
}

export function redevenDividerRoleClass(role: RedevenDividerRole = 'default'): string {
  return REDEVEN_DIVIDER_ROLE_CLASS[role];
}

export function redevenSegmentedItemClass(active: boolean): string {
  return active ? REDEVEN_SEGMENTED_ITEM_ACTIVE_CLASS : REDEVEN_SEGMENTED_ITEM_CLASS;
}
