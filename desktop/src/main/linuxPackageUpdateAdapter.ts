import { CancellationToken, type ProgressInfo, type UpdateInfo } from 'builder-util-runtime';
import { autoUpdater, type AppUpdater, type UpdateDownloadedEvent } from 'electron-updater';

import type { DesktopUpdateSnapshot } from '../shared/desktopUpdateIPC';
import type { DesktopUpdateAdapter } from './desktopUpdateCoordinator';

type LinuxUpdaterClient = Pick<AppUpdater,
  | 'on'
  | 'removeListener'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'autoRunAppAfterInstall'
  | 'allowPrerelease'
  | 'allowDowngrade'
  | 'logger'
>;

export type LinuxPackageUpdateAdapterOptions = Readonly<{
  currentVersion: string;
  automaticallyChecksForUpdates: () => boolean;
  setAutomaticallyChecksForUpdates: (enabled: boolean) => void;
  updater?: LinuxUpdaterClient;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}
function updateVersion(info: UpdateInfo | UpdateDownloadedEvent): string {
  return compact(info.version);
}

export class LinuxPackageUpdateAdapter implements DesktopUpdateAdapter {
  readonly platform = 'linux_package' as const;

  private current: DesktopUpdateSnapshot;
  private started = false;
  private cancellationToken: CancellationToken | null = null;
  private readonly listeners = new Set<(snapshot: DesktopUpdateSnapshot) => void>();
  private readonly updater: LinuxUpdaterClient;

  constructor(private readonly options: LinuxPackageUpdateAdapterOptions) {
    this.updater = options.updater ?? autoUpdater;
    this.current = this.idleSnapshot();
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.autoRunAppAfterInstall = true;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.updater.logger = {
      info: (message?: unknown) => console.info(`[redeven:desktop-update] ${compact(message)}`),
      warn: (message?: unknown) => console.warn(`[redeven:desktop-update] ${compact(message)}`),
      error: (message?: unknown) => console.error(`[redeven:desktop-update] ${compact(message)}`),
      debug: (message: unknown) => console.debug(`[redeven:desktop-update] ${compact(message)}`),
    };
    this.updater.on('checking-for-update', this.handleChecking);
    this.updater.on('update-available', this.handleAvailable);
    this.updater.on('update-not-available', this.handleNotAvailable);
    this.updater.on('download-progress', this.handleDownloadProgress);
    this.updater.on('update-downloaded', this.handleDownloaded);
    this.updater.on('update-cancelled', this.handleCanceled);
    this.updater.on('error', this.handleError);
    this.publish(this.idleSnapshot());
  }

  snapshot(): DesktopUpdateSnapshot {
    return this.current;
  }

  subscribe(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async checkForUpdates(): Promise<void> {
    await this.updater.checkForUpdates();
  }

  openUpdateUI(): void {
    // Linux uses Redeven's renderer dialog; the coordinator owns opening it.
  }

  setAutomaticallyChecksForUpdates(enabled: boolean): void {
    this.options.setAutomaticallyChecksForUpdates(enabled);
    this.publish({
      ...this.current,
      automatically_checks_for_updates: enabled,
    });
  }

  async downloadUpdate(): Promise<void> {
    if (this.cancellationToken) {
      return;
    }
    this.cancellationToken = new CancellationToken();
    this.publish({
      ...this.current,
      state: 'downloading',
      download_percent: 0,
      capabilities: ['open_update_ui', 'automatic_checks', 'cancel_download', 'open_release_page'],
      error_detail: undefined,
      message_key: 'desktopUpdate.downloading',
    });
    try {
      await this.updater.downloadUpdate(this.cancellationToken);
    } finally {
      this.cancellationToken = null;
    }
  }

  cancelDownload(): void {
    this.cancellationToken?.cancel();
  }

  installUpdate(): void {
    this.updater.quitAndInstall(false, true);
  }

  dispose(): void {
    this.cancellationToken?.cancel();
    this.cancellationToken = null;
    if (!this.started) {
      return;
    }
    this.started = false;
    this.updater.removeListener('checking-for-update', this.handleChecking);
    this.updater.removeListener('update-available', this.handleAvailable);
    this.updater.removeListener('update-not-available', this.handleNotAvailable);
    this.updater.removeListener('download-progress', this.handleDownloadProgress);
    this.updater.removeListener('update-downloaded', this.handleDownloaded);
    this.updater.removeListener('update-cancelled', this.handleCanceled);
    this.updater.removeListener('error', this.handleError);
  }

  private readonly handleChecking = (): void => {
    this.publish({
      ...this.current,
      state: 'checking',
      capabilities: ['open_update_ui', 'automatic_checks', 'open_release_page'],
      message_key: 'desktopUpdate.checking',
      error_detail: undefined,
      download_percent: undefined,
    });
  };

  private readonly handleAvailable = (info: UpdateInfo): void => {
    this.publish({
      ...this.current,
      state: 'available',
      available_version: updateVersion(info),
      capabilities: ['check', 'open_update_ui', 'automatic_checks', 'download', 'open_release_page'],
      message_key: 'desktopUpdate.available',
      error_detail: undefined,
      download_percent: undefined,
    });
  };

  private readonly handleNotAvailable = (): void => {
    this.publish({
      ...this.idleSnapshot(),
      message_key: 'desktopUpdate.upToDate',
    });
  };

  private readonly handleDownloadProgress = (progress: ProgressInfo): void => {
    this.publish({
      ...this.current,
      state: 'downloading',
      download_percent: Math.min(100, Math.max(0, progress.percent)),
      capabilities: ['open_update_ui', 'automatic_checks', 'cancel_download', 'open_release_page'],
      message_key: 'desktopUpdate.downloading',
      error_detail: undefined,
    });
  };

  private readonly handleDownloaded = (event: UpdateDownloadedEvent): void => {
    this.publish({
      ...this.current,
      state: 'ready',
      available_version: updateVersion(event),
      download_percent: 100,
      capabilities: ['open_update_ui', 'automatic_checks', 'install', 'open_release_page'],
      message_key: 'desktopUpdate.ready',
      error_detail: undefined,
    });
  };

  private readonly handleCanceled = (): void => {
    this.publish({
      ...this.current,
      state: 'available',
      download_percent: undefined,
      capabilities: ['check', 'open_update_ui', 'automatic_checks', 'download', 'open_release_page'],
      message_key: 'desktopUpdate.downloadCanceled',
      error_detail: undefined,
    });
  };

  private readonly handleError = (error: Error): void => {
    this.publish({
      ...this.current,
      state: 'error',
      capabilities: ['check', 'open_update_ui', 'automatic_checks', 'open_release_page'],
      message_key: 'desktopUpdate.failed',
      error_detail: compact(error.message) || 'Unknown update error.',
      download_percent: undefined,
    });
  };

  private idleSnapshot(): DesktopUpdateSnapshot {
    return {
      platform: this.platform,
      state: 'idle',
      current_version: compact(this.options.currentVersion),
      automatically_checks_for_updates: this.options.automaticallyChecksForUpdates(),
      capabilities: ['check', 'open_update_ui', 'automatic_checks', 'open_release_page'],
    };
  }

  private publish(snapshot: DesktopUpdateSnapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
