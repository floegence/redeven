import type { DesktopCodeWorkspaceProgress } from '../../../../../../desktop/src/shared/desktopCodeWorkspaceIPC';

export type BrowserEditorSetupProgressPhase =
  | 'lookup'
  | 'download'
  | 'package_validation'
  | 'upload'
  | 'verify'
  | 'install'
  | 'finalize';

export type BrowserEditorSetupProgressState = 'running' | 'completed' | 'cancelled' | 'failed';

export type BrowserEditorSetupProgress = Readonly<{
  operation_id: string;
  phase: BrowserEditorSetupProgressPhase;
  state: BrowserEditorSetupProgressState;
  completed_bytes?: number;
  total_bytes?: number;
  from_cache?: boolean;
  updated_at_unix_ms: number;
}>;

export type BrowserEditorTransferMetrics = Readonly<{
  determinate: boolean;
  percent: number;
  elapsed_seconds: number;
  bytes_per_second?: number;
  eta_seconds?: number;
  stalled: boolean;
  awaiting_confirmation: boolean;
}>;

const ETA_WARMUP_MS = 1_500;
const STALL_THRESHOLD_MS = 15_000;
const RATE_EMA_ALPHA = 0.25;
export const PROGRESS_TEXT_REFRESH_INTERVAL_MS = 1_000;

function progressKey(progress: BrowserEditorSetupProgress): string {
  return [progress.operation_id, progress.phase, progress.total_bytes ?? 0].join(':');
}

function safeBytes(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Math.floor(Number(value)) : 0;
}

export function browserEditorProgressFromDesktop(progress: DesktopCodeWorkspaceProgress): BrowserEditorSetupProgress {
  return { ...progress };
}

export function createBrowserEditorSetupOperationID(): string {
  if (typeof crypto.randomUUID === 'function') return `browser-editor:${crypto.randomUUID()}`;
  return `browser-editor:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function shouldRefreshBrowserEditorProgressText(
  previous: BrowserEditorSetupProgress | null | undefined,
  next: BrowserEditorSetupProgress,
  elapsedSinceRefreshMS: number,
): boolean {
  if (!previous) return true;
  if (
    previous.operation_id !== next.operation_id
    || previous.phase !== next.phase
    || previous.state !== next.state
    || previous.from_cache !== next.from_cache
  ) {
    return true;
  }
  const previousCompleted = safeBytes(previous.completed_bytes);
  const nextCompleted = safeBytes(next.completed_bytes);
  const nextTotal = safeBytes(next.total_bytes);
  if (nextTotal > 0 && previousCompleted < nextTotal && nextCompleted >= nextTotal) return true;
  return elapsedSinceRefreshMS >= PROGRESS_TEXT_REFRESH_INTERVAL_MS;
}

export class BrowserEditorTransferEstimator {
  private key = '';
  private startedAtMS = 0;
  private lastIncreaseAtMS = 0;
  private sampleAtMS = 0;
  private sampleBytes = 0;
  private increaseCount = 0;
  private emaBytesPerSecond = 0;

  update(progress: BrowserEditorSetupProgress, nowMS: number): void {
    const nextKey = progressKey(progress);
    const completedBytes = safeBytes(progress.completed_bytes);
    if (this.key !== nextKey) {
      this.key = nextKey;
      this.startedAtMS = nowMS;
      this.lastIncreaseAtMS = nowMS;
      this.sampleAtMS = nowMS;
      this.sampleBytes = completedBytes;
      this.increaseCount = 0;
      this.emaBytesPerSecond = 0;
      return;
    }
    if (completedBytes <= this.sampleBytes) return;
    const elapsedMS = nowMS - this.sampleAtMS;
    if (elapsedMS > 0) {
      const instantRate = ((completedBytes - this.sampleBytes) * 1000) / elapsedMS;
      this.emaBytesPerSecond = this.emaBytesPerSecond > 0
        ? (RATE_EMA_ALPHA * instantRate) + ((1 - RATE_EMA_ALPHA) * this.emaBytesPerSecond)
        : instantRate;
      this.increaseCount += 1;
    }
    this.sampleAtMS = nowMS;
    this.sampleBytes = completedBytes;
    this.lastIncreaseAtMS = nowMS;
  }

  metrics(progress: BrowserEditorSetupProgress, nowMS: number): BrowserEditorTransferMetrics {
    const completedBytes = safeBytes(progress.completed_bytes);
    const totalBytes = safeBytes(progress.total_bytes);
    const determinate = totalBytes > 0;
    const awaitingConfirmation = determinate && completedBytes >= totalBytes && progress.state === 'running';
    const elapsedMS = Math.max(0, nowMS - this.startedAtMS);
    const stalled = progress.state === 'running'
      && !awaitingConfirmation
      && nowMS - this.lastIncreaseAtMS >= STALL_THRESHOLD_MS;
    const canEstimate = determinate
      && !stalled
      && !awaitingConfirmation
      && this.increaseCount >= 2
      && elapsedMS >= ETA_WARMUP_MS
      && this.emaBytesPerSecond > 0;
    const remainingBytes = Math.max(0, totalBytes - completedBytes);
    return {
      determinate,
      percent: determinate ? Math.min(100, Math.max(0, (completedBytes / totalBytes) * 100)) : 0,
      elapsed_seconds: Math.floor(elapsedMS / 1000),
      ...(canEstimate ? { bytes_per_second: this.emaBytesPerSecond } : {}),
      ...(canEstimate ? { eta_seconds: remainingBytes / this.emaBytesPerSecond } : {}),
      stalled,
      awaiting_confirmation: awaitingConfirmation,
    };
  }
}
