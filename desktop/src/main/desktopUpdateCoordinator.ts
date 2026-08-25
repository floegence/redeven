import type {
  DesktopUpdateAction,
  DesktopUpdateActionResponse,
  DesktopUpdateCapability,
  DesktopUpdatePlatform,
  DesktopUpdateSnapshot,
} from '../shared/desktopUpdateIPC';

export type DesktopUpdateAdapter = Readonly<{
  platform: Exclude<DesktopUpdatePlatform, 'unsupported'>;
  start: () => Promise<void> | void;
  snapshot: () => DesktopUpdateSnapshot;
  subscribe: (listener: (snapshot: DesktopUpdateSnapshot) => void) => () => void;
  subscribeInstallRequest?: (listener: (continueInstallation: () => void) => void) => () => void;
  checkForUpdates: () => Promise<void> | void;
  openUpdateUI: () => Promise<void> | void;
  setAutomaticallyChecksForUpdates: (enabled: boolean) => Promise<void> | void;
  downloadUpdate?: () => Promise<void> | void;
  cancelDownload?: () => Promise<void> | void;
  installUpdate?: () => Promise<void> | void;
}>;

export type DesktopUpdateCoordinatorOptions = Readonly<{
  adapter: DesktopUpdateAdapter | null;
  currentVersion: string;
  blockedMessageKey?: string;
  startupDelayMS?: number;
  now?: () => number;
  schedule?: (action: () => void, delayMS: number) => ReturnType<typeof setTimeout>;
  automaticCheckDue?: () => boolean;
  recordAutomaticCheck?: (checkedAtMS: number) => void;
  prepareForInstallation: () => Promise<void>;
  openReleasePage: () => Promise<void> | void;
  revealApplication: () => Promise<void> | void;
  openApplicationsFolder: () => Promise<void> | void;
  requestRendererUI: () => void;
  onInstallationFailure?: () => Promise<void> | void;
  onSnapshotChanged?: (snapshot: DesktopUpdateSnapshot) => void;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function errorMessage(error: unknown): string {
  return compact(error instanceof Error ? error.message : error) || 'Unknown update error.';
}

function blockedSnapshot(options: DesktopUpdateCoordinatorOptions): DesktopUpdateSnapshot {
  const capabilities: DesktopUpdateCapability[] = ['open_release_page'];
  if (options.blockedMessageKey === 'desktopUpdate.moveToApplications') {
    capabilities.unshift('reveal_application', 'open_applications_folder');
  }
  return {
    platform: options.adapter?.platform ?? 'unsupported',
    state: 'blocked',
    current_version: compact(options.currentVersion),
    automatically_checks_for_updates: false,
    capabilities,
    message_key: options.blockedMessageKey ?? 'desktopUpdate.unsupportedBuild',
  };
}

export class DesktopUpdateCoordinator {
  private current: DesktopUpdateSnapshot;
  private started = false;
  private startupScheduled = false;
  private disposed = false;
  private checkTask: Promise<void> | null = null;
  private installTask: Promise<void> | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly options: DesktopUpdateCoordinatorOptions) {
    this.current = options.blockedMessageKey || !options.adapter
      ? blockedSnapshot(options)
      : options.adapter.snapshot();
    if (options.adapter && !options.blockedMessageKey) {
      this.disposers.push(options.adapter.subscribe((snapshot) => this.publish(snapshot)));
      if (options.adapter.subscribeInstallRequest) {
        this.disposers.push(options.adapter.subscribeInstallRequest((continueInstallation) => {
          void this.prepareAndInstall(continueInstallation).catch((error) => {
            this.publish({
              ...this.current,
              state: 'error',
              error_detail: errorMessage(error),
            });
          });
        }));
      }
    }
  }

  snapshot(): DesktopUpdateSnapshot {
    return this.current;
  }

  scheduleStartup(): void {
    if (this.disposed || this.startupScheduled || !this.options.adapter || this.options.blockedMessageKey) {
      return;
    }
    this.startupScheduled = true;
    const schedule = this.options.schedule ?? ((action, delayMS) => setTimeout(action, delayMS));
    try {
      schedule(() => {
        void this.startAndMaybeCheckAutomatically().catch((error) => {
          this.publish({
            ...this.current,
            state: 'error',
            error_detail: errorMessage(error),
          });
        });
      }, Math.max(0, this.options.startupDelayMS ?? 30_000));
    } catch (error) {
      this.startupScheduled = false;
      throw error;
    }
  }

  async perform(action: DesktopUpdateAction): Promise<DesktopUpdateActionResponse> {
    try {
      switch (action.kind) {
        case 'check_for_updates':
          await this.checkForUpdates();
          break;
        case 'open_update_ui':
          await this.openUpdateUI();
          break;
        case 'set_automatic_checks':
          await this.setAutomaticallyChecksForUpdates(action.enabled);
          break;
        case 'download_update':
          await this.requireCapability(
            'download',
            this.options.adapter?.downloadUpdate
              ? () => this.options.adapter!.downloadUpdate!()
              : undefined,
          );
          break;
        case 'cancel_download':
          await this.requireCapability(
            'cancel_download',
            this.options.adapter?.cancelDownload
              ? () => this.options.adapter!.cancelDownload!()
              : undefined,
          );
          break;
        case 'install_update':
          if (!this.options.adapter?.installUpdate) {
            throw new Error('This update cannot be installed from the current build.');
          }
          await this.prepareAndInstall(() => this.options.adapter!.installUpdate!());
          break;
        case 'reveal_application':
          await this.options.revealApplication();
          break;
        case 'open_applications_folder':
          await this.options.openApplicationsFolder();
          break;
        case 'open_release_page':
          await this.options.openReleasePage();
          break;
      }
      return { ok: true, snapshot: this.current };
    } catch (error) {
      const message = errorMessage(error);
      this.publish({
        ...this.current,
        state: 'error',
        error_detail: message,
      });
      return { ok: false, snapshot: this.current, message };
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.started || !this.options.adapter) {
      return;
    }
    this.started = true;
    try {
      await this.options.adapter.start();
      this.publish(this.options.adapter.snapshot());
    } catch (error) {
      this.started = false;
      throw error;
    }
  }

  private async startAndMaybeCheckAutomatically(): Promise<void> {
    await this.ensureStarted();
    if (
      this.options.adapter?.platform === 'linux_package'
      && this.current.automatically_checks_for_updates
      && (this.options.automaticCheckDue?.() ?? true)
    ) {
      this.options.recordAutomaticCheck?.((this.options.now ?? Date.now)());
      await this.runAdapterCheck();
    }
  }

  private async checkForUpdates(): Promise<void> {
    if (!this.options.adapter || this.options.blockedMessageKey) {
      this.options.requestRendererUI();
      return;
    }
    await this.ensureStarted();
    if (this.options.adapter.platform === 'linux_package') {
      this.options.requestRendererUI();
    }
    if (this.checkTask) {
      if (this.options.adapter.platform === 'linux_package') {
        // The renderer dialog is already open and reflects the active operation.
      } else {
        await this.options.adapter.openUpdateUI();
      }
      await this.checkTask;
      return;
    }
    if (this.current.state === 'checking' || this.current.state === 'downloading' || this.current.state === 'installing') {
      if (this.options.adapter.platform === 'linux_package') {
        // The renderer dialog is already open and reflects the active operation.
      } else {
        await this.options.adapter.openUpdateUI();
      }
      return;
    }
    await this.runAdapterCheck();
  }

  private async runAdapterCheck(): Promise<void> {
    if (this.checkTask) {
      await this.checkTask;
      return;
    }
    const checkTask = Promise.resolve(this.options.adapter!.checkForUpdates());
    this.checkTask = checkTask;
    try {
      await checkTask;
    } finally {
      if (this.checkTask === checkTask) {
        this.checkTask = null;
      }
    }
  }

  private async openUpdateUI(): Promise<void> {
    if (!this.options.adapter || this.options.blockedMessageKey) {
      this.options.requestRendererUI();
      return;
    }
    await this.ensureStarted();
    if (this.options.adapter.platform === 'linux_package') {
      this.options.requestRendererUI();
      return;
    }
    await this.options.adapter.openUpdateUI();
  }

  private async setAutomaticallyChecksForUpdates(enabled: boolean): Promise<void> {
    if (!this.options.adapter || this.options.blockedMessageKey) {
      throw new Error('Automatic update checks are unavailable for this build.');
    }
    await this.ensureStarted();
    await this.options.adapter.setAutomaticallyChecksForUpdates(enabled);
    this.publish(this.options.adapter.snapshot());
  }

  private async requireCapability(
    capability: DesktopUpdateCapability,
    action: (() => Promise<void> | void) | undefined,
  ): Promise<void> {
    if (!action || !this.current.capabilities.includes(capability)) {
      throw new Error('This update action is unavailable right now.');
    }
    await action();
  }

  private async prepareAndInstall(install: () => Promise<void> | void): Promise<void> {
    if (this.installTask) {
      return this.installTask;
    }
    this.installTask = (async () => {
      this.publish({
        ...this.current,
        state: 'installing',
        capabilities: [],
        message_key: 'desktopUpdate.preparingInstallation',
        error_detail: undefined,
      });
      await this.options.prepareForInstallation();
      await install();
    })();
    try {
      await this.installTask;
    } catch (error) {
      await Promise.resolve(this.options.onInstallationFailure?.()).catch(() => undefined);
      throw error;
    } finally {
      this.installTask = null;
    }
  }

  private publish(snapshot: DesktopUpdateSnapshot): void {
    this.current = snapshot;
    this.options.onSnapshotChanged?.(snapshot);
  }
}
