import type { BrowserWindow } from 'electron';

import type { DesktopStateStore } from './desktopStateStore';
import {
  DESKTOP_LANGUAGE_UPDATED_CHANNEL,
} from '../shared/desktopLanguageIPC';
import {
  normalizeRedevenLocalePreference,
  resolveRedevenLanguageSnapshot,
  sameRedevenLanguageSnapshot,
  REDEVEN_LANGUAGE_PREFERENCE_STATE_KEY,
  type RedevenLanguageSnapshot,
  type RedevenLocalePreference,
} from '../shared/i18n/desktopLanguage';

export type DesktopLanguageSystemLocaleProvider = Readonly<{
  getPreferredSystemLanguages?: () => readonly string[];
  getLocale?: () => string;
}>;

export type DesktopLanguageStateOptions = Readonly<{
  onSnapshotChanged?: (snapshot: RedevenLanguageSnapshot) => void;
}>;

export type DesktopLanguageWindowOptions = Readonly<{
  titleForSnapshot?: false | ((snapshot: RedevenLanguageSnapshot) => string);
}>;

type DesktopLanguageWindowRecord = Readonly<{
  win: BrowserWindow;
  titleForSnapshot?: false | ((snapshot: RedevenLanguageSnapshot) => string);
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function systemCandidatesFromProvider(provider: DesktopLanguageSystemLocaleProvider): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value: unknown) => {
    const candidate = compact(value);
    if (!candidate) {
      return;
    }
    const identity = candidate.replace(/_/g, '-').toLowerCase();
    if (candidates.some((existing) => existing.replace(/_/g, '-').toLowerCase() === identity)) {
      return;
    }
    candidates.push(candidate);
  };

  try {
    for (const candidate of provider.getPreferredSystemLanguages?.() ?? []) {
      pushCandidate(candidate);
    }
  } catch {
    // Keep locale resolution available even if the host API is temporarily unavailable.
  }

  try {
    pushCandidate(provider.getLocale?.());
  } catch {
    // Keep locale resolution available even if the host API is temporarily unavailable.
  }

  return candidates;
}

export class DesktopLanguageState {
  private initialized = false;
  private preference: RedevenLocalePreference = 'system';
  private snapshot: RedevenLanguageSnapshot = resolveRedevenLanguageSnapshot('system', []);
  private readonly windows = new Map<BrowserWindow, DesktopLanguageWindowRecord>();

  constructor(
    private readonly store: Pick<DesktopStateStore, 'getRendererItem' | 'setRendererItem'>,
    private readonly systemLocaleProvider: DesktopLanguageSystemLocaleProvider,
    private readonly options: DesktopLanguageStateOptions = {},
  ) {}

  initialize(): RedevenLanguageSnapshot {
    if (this.initialized) {
      return this.snapshot;
    }

    this.initialized = true;
    this.preference = normalizeRedevenLocalePreference(
      this.store.getRendererItem(REDEVEN_LANGUAGE_PREFERENCE_STATE_KEY),
      'system',
    );
    this.snapshot = resolveRedevenLanguageSnapshot(this.preference, systemCandidatesFromProvider(this.systemLocaleProvider));
    return this.snapshot;
  }

  getSnapshot(): RedevenLanguageSnapshot {
    this.initialize();
    this.publishSnapshotIfChanged();
    return this.snapshot;
  }

  refreshSystemLocale(): RedevenLanguageSnapshot {
    this.initialize();
    this.publishSnapshotIfChanged();
    return this.snapshot;
  }

  setPreference(nextPreference: unknown): RedevenLanguageSnapshot {
    this.initialize();

    const normalized = normalizeRedevenLocalePreference(nextPreference, 'system');
    if (normalized === this.preference) {
      this.publishSnapshotIfChanged();
      return this.snapshot;
    }

    this.preference = normalized;
    this.store.setRendererItem(REDEVEN_LANGUAGE_PREFERENCE_STATE_KEY, normalized);
    this.refreshSnapshot();
    this.publishSnapshot();
    return this.snapshot;
  }

  registerWindow(win: BrowserWindow, options: DesktopLanguageWindowOptions = {}): void {
    this.initialize();
    this.windows.set(win, {
      win,
      titleForSnapshot: options.titleForSnapshot,
    });
    this.sendSnapshotToWindow(win);
    win.on('closed', () => {
      this.windows.delete(win);
    });
  }

  private refreshSnapshot(): boolean {
    const next = resolveRedevenLanguageSnapshot(
      this.preference,
      systemCandidatesFromProvider(this.systemLocaleProvider),
    );
    if (sameRedevenLanguageSnapshot(this.snapshot, next)) {
      return false;
    }
    this.snapshot = next;
    return true;
  }

  private publishSnapshotIfChanged(): void {
    if (this.refreshSnapshot()) {
      this.publishSnapshot();
    }
  }

  private publishSnapshot(): void {
    this.broadcastSnapshot();
    this.options.onSnapshotChanged?.(this.snapshot);
  }

  private sendSnapshotToWindow(win: Pick<BrowserWindow, 'isDestroyed' | 'webContents'>): void {
    if (win.isDestroyed()) {
      return;
    }
    const titleForSnapshot = this.windows.get(win as BrowserWindow)?.titleForSnapshot;
    if (titleForSnapshot && 'setTitle' in win && typeof win.setTitle === 'function') {
      const title = titleForSnapshot(this.snapshot);
      if (title !== '') {
        win.setTitle(title);
      }
    }
    win.webContents.send(DESKTOP_LANGUAGE_UPDATED_CHANNEL, this.snapshot);
  }

  private broadcastSnapshot(): void {
    for (const [win] of Array.from(this.windows)) {
      if (win.isDestroyed()) {
        this.windows.delete(win);
        continue;
      }
      this.sendSnapshotToWindow(win);
    }
  }
}
