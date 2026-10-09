export const DESKTOP_SHELL_OPEN_SERVICE_CANVAS_WINDOW_CHANNEL = 'redeven-desktop:shell-open-service-canvas-window';

export type DesktopShellOpenServiceCanvasWindowRequest = Readonly<{
  canvas_id?: string;
  version?: number;
}>;

export type DesktopShellOpenServiceCanvasWindowResponse = Readonly<{ ok: boolean }>;

export function normalizeDesktopShellOpenServiceCanvasWindowRequest(value: unknown): DesktopShellOpenServiceCanvasWindowRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some(key => key !== 'canvas_id' && key !== 'version')) return null;
  if (candidate.canvas_id !== undefined && (typeof candidate.canvas_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(candidate.canvas_id))) return null;
  if (candidate.version !== undefined && (!candidate.canvas_id || !Number.isSafeInteger(candidate.version) || Number(candidate.version) < 1)) return null;
  return {
    ...(typeof candidate.canvas_id === 'string' ? { canvas_id: candidate.canvas_id } : {}),
    ...(typeof candidate.version === 'number' ? { version: candidate.version } : {}),
  };
}

export function normalizeDesktopShellOpenServiceCanvasWindowResponse(value: unknown): DesktopShellOpenServiceCanvasWindowResponse {
  return { ok: Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).ok === true) };
}
