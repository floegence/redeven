import fs from 'node:fs';
import path from 'node:path';

export type DesktopWindowState = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
  full_screen?: boolean;
}>;

type DesktopStateFile = Readonly<{
  version?: number;
  renderer_storage?: Readonly<Record<string, string>>;
  windows?: Readonly<Record<string, DesktopWindowState>>;
}>;

type DesktopStateSnapshot = {
  version: 1;
  renderer_storage: Record<string, string>;
  windows: Record<string, DesktopWindowState>;
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeDesktopWindowState(value: unknown): DesktopWindowState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopWindowState>;
  if (
    !isFiniteNumber(candidate.x)
    || !isFiniteNumber(candidate.y)
    || !isFiniteNumber(candidate.width)
    || !isFiniteNumber(candidate.height)
  ) {
    return null;
  }

  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width: Math.max(1, Math.round(candidate.width)),
    height: Math.max(1, Math.round(candidate.height)),
    maximized: candidate.maximized === true,
    full_screen: candidate.full_screen === true,
  };
}

function normalizeSnapshot(value: unknown): DesktopStateSnapshot {
  const snapshot: DesktopStateSnapshot = {
    version: 1,
    renderer_storage: {},
    windows: {},
  };

  if (!value || typeof value !== 'object') {
    return snapshot;
  }

  const candidate = value as DesktopStateFile;
  if (candidate.renderer_storage && typeof candidate.renderer_storage === 'object') {
    for (const [rawKey, rawValue] of Object.entries(candidate.renderer_storage)) {
      const key = compact(rawKey);
      if (!key || typeof rawValue !== 'string') {
        continue;
      }
      snapshot.renderer_storage[key] = rawValue;
    }
  }

  if (candidate.windows && typeof candidate.windows === 'object') {
    for (const [rawKey, rawValue] of Object.entries(candidate.windows)) {
      const key = compact(rawKey);
      const normalized = normalizeDesktopWindowState(rawValue);
      if (!key || !normalized) {
        continue;
      }
      snapshot.windows[key] = normalized;
    }
  }

  return snapshot;
}

export function defaultDesktopStateStorePath(userDataDir: string): string {
  return path.join(userDataDir, 'desktop-ui-state.json');
}

export class DesktopStateStore {
  private snapshot: DesktopStateSnapshot | null = null;

  constructor(private readonly filePath: string) {}

  private ensureLoaded(): DesktopStateSnapshot {
    if (this.snapshot) {
      return this.snapshot;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.snapshot = normalizeSnapshot(JSON.parse(raw));
    } catch {
      this.snapshot = normalizeSnapshot(null);
    }
    return this.snapshot;
  }

  private persist(): void {
    const snapshot = this.ensureLoaded();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  }

  getRendererItem(key: string): string | null {
    const cleanKey = compact(key);
    if (!cleanKey) {
      return null;
    }
    const snapshot = this.ensureLoaded();
    return Object.prototype.hasOwnProperty.call(snapshot.renderer_storage, cleanKey)
      ? snapshot.renderer_storage[cleanKey]
      : null;
  }

  setRendererItem(key: string, value: string): void {
    const cleanKey = compact(key);
    if (!cleanKey) {
      return;
    }
    const snapshot = this.ensureLoaded();
    snapshot.renderer_storage[cleanKey] = String(value ?? '');
    this.persist();
  }

  removeRendererItem(key: string): void {
    const cleanKey = compact(key);
    if (!cleanKey) {
      return;
    }
    const snapshot = this.ensureLoaded();
    if (!Object.prototype.hasOwnProperty.call(snapshot.renderer_storage, cleanKey)) {
      return;
    }
    delete snapshot.renderer_storage[cleanKey];
    this.persist();
  }

  rendererKeys(): string[] {
    return Object.keys(this.ensureLoaded().renderer_storage).sort((a, b) => a.localeCompare(b));
  }

  getWindowState(key: string): DesktopWindowState | null {
    const cleanKey = compact(key);
    if (!cleanKey) {
      return null;
    }
    const snapshot = this.ensureLoaded();
    return snapshot.windows[cleanKey] ?? null;
  }

  setWindowState(key: string, value: DesktopWindowState): void {
    const cleanKey = compact(key);
    const normalized = normalizeDesktopWindowState(value);
    if (!cleanKey || !normalized) {
      return;
    }
    const snapshot = this.ensureLoaded();
    snapshot.windows[cleanKey] = normalized;
    this.persist();
  }

  removeWindowState(key: string): void {
    const cleanKey = compact(key);
    if (!cleanKey) {
      return;
    }
    const snapshot = this.ensureLoaded();
    if (!Object.prototype.hasOwnProperty.call(snapshot.windows, cleanKey)) {
      return;
    }
    delete snapshot.windows[cleanKey];
    this.persist();
  }
}
