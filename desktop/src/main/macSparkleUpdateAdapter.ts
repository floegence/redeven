import path from 'node:path';

import type {
  DesktopUpdateCapability,
  DesktopUpdateSnapshot,
  DesktopUpdateState,
} from '../shared/desktopUpdateIPC';
import type { DesktopUpdateAdapter } from './desktopUpdateCoordinator';

type SparkleNativeSnapshot = Readonly<{
  kind?: unknown;
  state?: unknown;
  available_version?: unknown;
  error_detail?: unknown;
  can_check?: unknown;
  automatically_checks_for_updates?: unknown;
}>;

type SparkleNativeEvent = SparkleNativeSnapshot | Readonly<{ kind: 'install_requested' }>;

export type SparkleNativeBridge = Readonly<{
  start: (listener: (event: SparkleNativeEvent) => void) => SparkleNativeSnapshot;
  snapshot: () => SparkleNativeSnapshot;
  checkForUpdates: () => void;
  openUpdateUI: () => void;
  setAutomaticallyChecksForUpdates: (enabled: boolean) => void;
  continueInstallation: () => boolean;
}>;

export type MacSparkleUpdateAdapterOptions = Readonly<{
  currentVersion: string;
  loadNativeBridge?: () => SparkleNativeBridge;
}>;

const UPDATE_STATES = new Set<DesktopUpdateState>([
  'idle',
  'checking',
  'available',
  'downloading',
  'ready',
  'installing',
  'error',
]);

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function loadPackagedBridge(): SparkleNativeBridge {
  const addonPath = path.join(process.resourcesPath, 'native', 'redeven_sparkle.node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(addonPath) as SparkleNativeBridge;
}

function capabilitiesFor(state: DesktopUpdateState, canCheck: boolean): DesktopUpdateCapability[] {
  const capabilities: DesktopUpdateCapability[] = ['open_update_ui', 'automatic_checks', 'open_release_page'];
  if (canCheck && state !== 'downloading' && state !== 'installing') {
    capabilities.unshift('check');
  }
  return capabilities;
}

function messageKeyFor(state: DesktopUpdateState): string | undefined {
  switch (state) {
    case 'checking':
      return 'desktopUpdate.checking';
    case 'available':
      return 'desktopUpdate.available';
    case 'downloading':
      return 'desktopUpdate.downloading';
    case 'ready':
      return 'desktopUpdate.ready';
    case 'installing':
      return 'desktopUpdate.installing';
    case 'error':
      return 'desktopUpdate.failed';
    default:
      return undefined;
  }
}

export class MacSparkleUpdateAdapter implements DesktopUpdateAdapter {
  readonly platform = 'macos_sparkle' as const;

  private current: DesktopUpdateSnapshot;
  private bridge: SparkleNativeBridge | null = null;
  private started = false;
  private readonly listeners = new Set<(snapshot: DesktopUpdateSnapshot) => void>();
  private readonly installListeners = new Set<(continueInstallation: () => void) => void>();

  constructor(private readonly options: MacSparkleUpdateAdapterOptions) {
    this.current = this.normalize({ state: 'idle', can_check: false });
  }

  start(): void {
    if (this.started) {
      return;
    }
    const bridge = (this.options.loadNativeBridge ?? loadPackagedBridge)();
    this.bridge = bridge;
    this.started = true;
    try {
      const initial = bridge.start((event) => this.handleNativeEvent(event));
      this.publish(this.normalize(initial));
    } catch (error) {
      this.bridge = null;
      this.started = false;
      throw error;
    }
  }

  snapshot(): DesktopUpdateSnapshot {
    if (this.bridge && this.started) {
      this.current = this.normalize(this.bridge.snapshot());
    }
    return this.current;
  }

  subscribe(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeInstallRequest(listener: (continueInstallation: () => void) => void): () => void {
    this.installListeners.add(listener);
    return () => this.installListeners.delete(listener);
  }

  checkForUpdates(): void {
    this.requireBridge().checkForUpdates();
  }

  openUpdateUI(): void {
    this.requireBridge().openUpdateUI();
  }

  setAutomaticallyChecksForUpdates(enabled: boolean): void {
    this.requireBridge().setAutomaticallyChecksForUpdates(enabled);
    this.publish(this.normalize(this.requireBridge().snapshot()));
  }

  private handleNativeEvent(event: SparkleNativeEvent): void {
    if (event.kind === 'install_requested') {
      let continued = false;
      const continueInstallation = (): void => {
        if (continued) {
          return;
        }
        continued = true;
        if (!this.requireBridge().continueInstallation()) {
          throw new Error('Sparkle did not accept the pending installation request.');
        }
      };
      for (const listener of this.installListeners) {
        listener(continueInstallation);
      }
      return;
    }
    this.publish(this.normalize(event));
  }

  private normalize(native: SparkleNativeSnapshot): DesktopUpdateSnapshot {
    const stateValue = compact(native.state) as DesktopUpdateState;
    const state = UPDATE_STATES.has(stateValue) ? stateValue : 'error';
    const availableVersion = compact(native.available_version);
    const errorDetail = state === 'error'
      ? compact(native.error_detail) || 'Sparkle returned an invalid update state.'
      : '';
    return {
      platform: this.platform,
      state,
      current_version: compact(this.options.currentVersion),
      ...(availableVersion ? { available_version: availableVersion } : {}),
      automatically_checks_for_updates: native.automatically_checks_for_updates === true,
      capabilities: capabilitiesFor(state, native.can_check === true),
      ...(messageKeyFor(state) ? { message_key: messageKeyFor(state) } : {}),
      ...(errorDetail ? { error_detail: errorDetail } : {}),
    };
  }

  private requireBridge(): SparkleNativeBridge {
    if (!this.bridge || !this.started) {
      throw new Error('Sparkle has not been started.');
    }
    return this.bridge;
  }

  private publish(snapshot: DesktopUpdateSnapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
