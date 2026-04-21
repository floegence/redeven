import type { DesktopSettingsSurfaceSnapshot } from '../shared/desktopSettingsSurface';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';

export type DesktopSettingsDraftSession = Readonly<{
  identity_key: string;
  baseline_surface: DesktopSettingsSurfaceSnapshot;
  draft: DesktopSettingsDraft;
  dirty: boolean;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function desktopSettingsDraftSessionKey(surface: DesktopSettingsSurfaceSnapshot): string {
  return `${surface.mode}:${surface.environment_kind}:${compact(surface.environment_id)}`;
}

export function createDesktopSettingsDraftSession(
  surface: DesktopSettingsSurfaceSnapshot,
): DesktopSettingsDraftSession {
  return {
    identity_key: desktopSettingsDraftSessionKey(surface),
    baseline_surface: surface,
    draft: surface.draft,
    dirty: false,
  };
}

export function updateDesktopSettingsDraftSessionDraft(
  session: DesktopSettingsDraftSession,
  updater: (draft: DesktopSettingsDraft) => DesktopSettingsDraft,
): DesktopSettingsDraftSession {
  return {
    ...session,
    draft: updater(session.draft),
    dirty: true,
  };
}

export function reconcileDesktopSettingsDraftSession(
  session: DesktopSettingsDraftSession,
  surface: DesktopSettingsSurfaceSnapshot,
  open: boolean,
): DesktopSettingsDraftSession {
  const nextIdentityKey = desktopSettingsDraftSessionKey(surface);
  if (!open || session.identity_key !== nextIdentityKey || !session.dirty) {
    return createDesktopSettingsDraftSession(surface);
  }
  return session;
}
