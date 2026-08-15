import { createSignal, getOwner, onCleanup, type Accessor } from 'solid-js';

import { fetchLocalApiJSON, LocalApiError } from '../services/localApi';

export type AIReadinessState =
  | 'unavailable'
  | 'inspecting'
  | 'migrating'
  | 'verifying'
  | 'recovering'
  | 'ready'
  | 'degraded'
  | 'blocked';

export type AIReadinessReasonCode =
  | 'temporarily_blocked'
  | 'update_required'
  | 'unsupported_store'
  | 'store_integrity_error'
  | 'configuration_error'
  | 'environment_permission_error'
  | 'store_io_error'
  | 'migration_rolled_back'
  | 'post_commit_verification_error'
  | 'cancelled'
  | 'contract_error'
  | 'ai_service_startup_error'
  | 'host_thread_settings_missing'
  | 'ai_readiness_contract_error';

export type AIReadinessSnapshot = Readonly<{
  state: AIReadinessState;
  reason_code: AIReadinessReasonCode | '';
  retryable: boolean;
  safe_to_retry: boolean;
  committed: boolean;
  rolled_back: boolean;
  issue_count?: number;
  trace_id?: string;
  startup_phase?: string;
  retry_reason?: string;
}>;

export type AIReadinessController = Readonly<{
  snapshot: Accessor<AIReadinessSnapshot>;
  loading: Accessor<boolean>;
  retryPending: Accessor<boolean>;
  nextCheckAt: Accessor<number | null>;
  refresh: () => Promise<AIReadinessSnapshot>;
  retry: () => Promise<AIReadinessSnapshot>;
  pause: () => void;
  resume: () => Promise<AIReadinessSnapshot>;
  dispose: () => void;
}>;

type ReadinessRequest = (url: string, init: RequestInit) => unknown | PromiseLike<unknown>;

type VisibilitySource = Readonly<{
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
}>;

type CreateAIReadinessControllerArgs = Readonly<{
  request?: ReadinessRequest;
  visibilitySource?: VisibilitySource | null;
  foregroundDelayMs?: number;
  backgroundDelayMs?: number;
  maxAutomaticRetries?: number;
  autoStart?: boolean;
  initialPaused?: boolean;
  canAutomaticallyRetry?: () => boolean;
}>;

const READINESS_URL = '/_redeven_proxy/api/ai/readiness';
const READINESS_RETRY_URL = '/_redeven_proxy/api/ai/readiness/retry';
const CONTRACT_ERROR_REASON: AIReadinessReasonCode = 'ai_readiness_contract_error';

const readinessStates = new Set<AIReadinessState>([
  'unavailable',
  'inspecting',
  'migrating',
  'verifying',
  'recovering',
  'ready',
  'degraded',
  'blocked',
]);

const readinessReasonCodes = new Set<AIReadinessReasonCode>([
  'temporarily_blocked',
  'update_required',
  'unsupported_store',
  'store_integrity_error',
  'configuration_error',
  'environment_permission_error',
  'store_io_error',
  'migration_rolled_back',
  'post_commit_verification_error',
  'cancelled',
  'contract_error',
  'ai_service_startup_error',
  'host_thread_settings_missing',
  CONTRACT_ERROR_REASON,
]);

const unavailableSnapshot: AIReadinessSnapshot = Object.freeze({
  state: 'unavailable',
  reason_code: '',
  retryable: false,
  safe_to_retry: false,
  committed: false,
  rolled_back: false,
});

const contractErrorSnapshot: AIReadinessSnapshot = Object.freeze({
  state: 'blocked',
  reason_code: CONTRACT_ERROR_REASON,
  retryable: false,
  safe_to_retry: false,
  committed: false,
  rolled_back: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type BooleanReadinessFacts = Readonly<{
  retryable: boolean;
  safe_to_retry: boolean;
  committed: boolean;
  rolled_back: boolean;
}>;

function hasBooleanFacts(value: Record<string, unknown>): value is Record<string, unknown> & BooleanReadinessFacts {
  return typeof value.retryable === 'boolean'
    && typeof value.safe_to_retry === 'boolean'
    && typeof value.committed === 'boolean'
    && typeof value.rolled_back === 'boolean';
}

function stableSnapshot(state: Exclude<AIReadinessState, 'blocked'>): AIReadinessSnapshot {
  return Object.freeze({ ...unavailableSnapshot, state });
}

function optionalDiagnostic(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length > maxLength || (normalized && !/^[A-Za-z0-9._-]+$/u.test(normalized))) return null;
  return normalized || undefined;
}

/** Normalizes the complete, sanitized Redeven readiness wire contract. */
export function normalizeAIReadinessSnapshot(value: unknown): AIReadinessSnapshot {
  if (!isRecord(value) || !hasBooleanFacts(value)) return contractErrorSnapshot;
  if (value.committed && value.rolled_back) return contractErrorSnapshot;
  if (value.safe_to_retry && !value.retryable) return contractErrorSnapshot;

  const state = typeof value.state === 'string' ? value.state.trim() : '';
  if (!readinessStates.has(state as AIReadinessState)) return contractErrorSnapshot;
  const reasonCode = value.reason_code === undefined
    ? ''
    : typeof value.reason_code === 'string'
      ? value.reason_code.trim()
      : null;
  if (reasonCode === null || (reasonCode && !readinessReasonCodes.has(reasonCode as AIReadinessReasonCode))) {
    return contractErrorSnapshot;
  }

  const issueCount = value.issue_count === undefined ? 0 : value.issue_count;
  if (!Number.isSafeInteger(issueCount) || (issueCount as number) < 0) return contractErrorSnapshot;
  const traceID = optionalDiagnostic(value.trace_id, 128);
  const startupPhase = optionalDiagnostic(value.startup_phase, 64);
  const retryReason = optionalDiagnostic(value.retry_reason, 128);
  if (traceID === null || startupPhase === null || retryReason === null) return contractErrorSnapshot;

  if (state === 'degraded') {
    if (reasonCode !== 'host_thread_settings_missing' || issueCount === 0
      || value.retryable || value.safe_to_retry || value.committed || value.rolled_back) {
      return contractErrorSnapshot;
    }
    return Object.freeze({
      ...unavailableSnapshot,
      state: 'degraded',
      reason_code: 'host_thread_settings_missing',
      issue_count: issueCount as number,
    });
  }

  if (state === 'recovering') {
    if (!reasonCode || !readinessReasonCodes.has(reasonCode as AIReadinessReasonCode)
      || !value.retryable || !value.safe_to_retry || value.committed || value.rolled_back || issueCount !== 0) {
      return contractErrorSnapshot;
    }
    return Object.freeze({
      ...unavailableSnapshot,
      state: 'recovering',
      reason_code: (reasonCode ?? '') as AIReadinessReasonCode | '',
      retryable: value.retryable,
      safe_to_retry: value.safe_to_retry,
      ...(traceID ? { trace_id: traceID } : {}),
      ...(startupPhase ? { startup_phase: startupPhase } : {}),
      ...(retryReason ? { retry_reason: retryReason } : {}),
    });
  }

  if (state !== 'blocked') {
    if (reasonCode || issueCount !== 0 || value.retryable || value.safe_to_retry || value.committed || value.rolled_back) {
      return contractErrorSnapshot;
    }
    if (state === 'ready') return stableSnapshot('ready');
    return Object.freeze({
      ...stableSnapshot(state as Exclude<AIReadinessState, 'blocked'>),
      ...(traceID ? { trace_id: traceID } : {}),
      ...(startupPhase ? { startup_phase: startupPhase } : {}),
    });
  }

  if (!readinessReasonCodes.has(reasonCode as AIReadinessReasonCode)) return contractErrorSnapshot;
  if ((reasonCode === 'migration_rolled_back') !== value.rolled_back) return contractErrorSnapshot;
  if ((reasonCode === 'post_commit_verification_error') !== value.committed) return contractErrorSnapshot;

  return Object.freeze({
    state: 'blocked',
    reason_code: reasonCode as AIReadinessReasonCode,
    retryable: value.retryable,
    safe_to_retry: value.safe_to_retry,
    committed: value.committed,
    rolled_back: value.rolled_back,
    ...(traceID ? { trace_id: traceID } : {}),
    ...(startupPhase ? { startup_phase: startupPhase } : {}),
    ...(retryReason ? { retry_reason: retryReason } : {}),
  });
}

/** Reads typed readiness facts only from the Local API error data envelope. */
export function aiReadinessFromLocalApiError(error: unknown): AIReadinessSnapshot | null {
  if (!(error instanceof LocalApiError)
    || !isRecord(error.data)
    || !Object.prototype.hasOwnProperty.call(error.data, 'readiness')) {
    return null;
  }
  return normalizeAIReadinessSnapshot(error.data.readiness);
}

function normalizedDelay(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : fallback;
}

function normalizedCount(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : fallback;
}

function isAutomaticRetryCandidate(snapshot: AIReadinessSnapshot): boolean {
  if (snapshot.state !== 'blocked' || !snapshot.retryable || !snapshot.safe_to_retry) return false;
  return snapshot.reason_code === 'temporarily_blocked' || snapshot.reason_code === 'store_io_error';
}

function shouldPoll(snapshot: AIReadinessSnapshot): boolean {
  return snapshot.state === 'unavailable'
    || snapshot.state === 'inspecting'
    || snapshot.state === 'migrating'
    || snapshot.state === 'verifying'
    || snapshot.state === 'recovering';
}

export function createAIReadinessController(args: CreateAIReadinessControllerArgs = {}): AIReadinessController {
  const request = args.request ?? fetchLocalApiJSON;
  const visibilitySource = args.visibilitySource === undefined
    ? (typeof document === 'undefined' ? null : document)
    : args.visibilitySource;
  const foregroundDelayMs = normalizedDelay(args.foregroundDelayMs, 1_500);
  const backgroundDelayMs = normalizedDelay(args.backgroundDelayMs, 15_000);
  const maxAutomaticRetries = normalizedCount(args.maxAutomaticRetries, 3);

  const [snapshot, setSnapshot] = createSignal<AIReadinessSnapshot>(unavailableSnapshot);
  const [loading, setLoading] = createSignal(args.autoStart !== false && args.initialPaused !== true);
  const [retryPending, setRetryPending] = createSignal(false);
  const [nextCheckAt, setNextCheckAt] = createSignal<number | null>(null);

  let disposed = false;
  let paused = args.initialPaused === true;
  let generation = 0;
  let loadingGeneration = 0;
  let automaticRetryCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryInFlight: Promise<AIReadinessSnapshot> | null = null;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    setNextCheckAt(null);
  };

  const currentDelay = (): number => visibilitySource?.visibilityState === 'hidden'
    ? backgroundDelayMs
    : foregroundDelayMs;

  let refresh!: () => Promise<AIReadinessSnapshot>;
  let startRetry!: (manual: boolean) => Promise<AIReadinessSnapshot>;

  const schedule = (nextSnapshot: AIReadinessSnapshot): void => {
    clearTimer();
    if (disposed || paused || loading() || retryPending()) return;

    if (shouldPoll(nextSnapshot)) {
      const delay = currentDelay();
      setNextCheckAt(Date.now() + delay);
      timer = setTimeout(() => {
        timer = null;
        setNextCheckAt(null);
        void refresh();
      }, delay);
      return;
    }

    if (isAutomaticRetryCandidate(nextSnapshot)
      && (args.canAutomaticallyRetry?.() ?? true)
      && automaticRetryCount < maxAutomaticRetries) {
      const delay = currentDelay();
      setNextCheckAt(Date.now() + delay);
      timer = setTimeout(() => {
        timer = null;
        setNextCheckAt(null);
        if (!(args.canAutomaticallyRetry?.() ?? true)) return;
        automaticRetryCount += 1;
        void startRetry(false);
      }, delay);
    }
  };

  const apply = (requestGeneration: number, nextSnapshot: AIReadinessSnapshot): void => {
    if (disposed || requestGeneration !== generation) return;
    if (nextSnapshot.state === 'ready'
      || (nextSnapshot.state === 'blocked' && !isAutomaticRetryCandidate(nextSnapshot))) {
      automaticRetryCount = 0;
    }
    setSnapshot(nextSnapshot);
    schedule(nextSnapshot);
  };

  const resolveFailure = (error: unknown): AIReadinessSnapshot => (
    aiReadinessFromLocalApiError(error) ?? contractErrorSnapshot
  );

  const invokeRequest = (url: string, init: RequestInit): Promise<unknown> => {
    try {
      return Promise.resolve(request(url, init));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  refresh = (): Promise<AIReadinessSnapshot> => {
    if (disposed || paused) return Promise.resolve(snapshot());
    if (retryInFlight) return retryInFlight;
    clearTimer();
    const requestGeneration = ++generation;
    loadingGeneration = requestGeneration;
    setLoading(true);

    return invokeRequest(READINESS_URL, { method: 'GET' })
      .then((value) => {
        const nextSnapshot = normalizeAIReadinessSnapshot(value);
        apply(requestGeneration, nextSnapshot);
        return nextSnapshot;
      })
      .catch((error: unknown) => {
        const nextSnapshot = resolveFailure(error);
        apply(requestGeneration, nextSnapshot);
        return nextSnapshot;
      })
      .finally(() => {
        if (disposed || loadingGeneration !== requestGeneration) return;
        setLoading(false);
        schedule(snapshot());
      });
  };

  startRetry = (manual: boolean): Promise<AIReadinessSnapshot> => {
    if (disposed || paused) return Promise.resolve(snapshot());
    if (retryInFlight) return retryInFlight;
    clearTimer();
    if (manual) automaticRetryCount = 0;

    const requestGeneration = ++generation;
    loadingGeneration = 0;
    setLoading(false);
    setRetryPending(true);
    const pending = invokeRequest(READINESS_RETRY_URL, { method: 'POST' })
      .then((value) => {
        const nextSnapshot = normalizeAIReadinessSnapshot(value);
        apply(requestGeneration, nextSnapshot);
        return nextSnapshot;
      })
      .catch((error: unknown) => {
        const nextSnapshot = resolveFailure(error);
        apply(requestGeneration, nextSnapshot);
        return nextSnapshot;
      })
      .finally(() => {
        if (retryInFlight === pending) retryInFlight = null;
        if (disposed || requestGeneration !== generation) return;
        setRetryPending(false);
        schedule(snapshot());
      });
    retryInFlight = pending;
    return pending;
  };

  const retry = (): Promise<AIReadinessSnapshot> => startRetry(true);

  const pause = (): void => {
    if (disposed || paused) return;
    paused = true;
    generation += 1;
    loadingGeneration = 0;
    retryInFlight = null;
    automaticRetryCount = 0;
    clearTimer();
    setLoading(false);
    setRetryPending(false);
    setSnapshot(unavailableSnapshot);
  };

  const resume = (): Promise<AIReadinessSnapshot> => {
    if (disposed || !paused) return Promise.resolve(snapshot());
    paused = false;
    return refresh();
  };

  const handleVisibilityChange = (): void => {
    if (disposed) return;
    schedule(snapshot());
  };
  visibilitySource?.addEventListener('visibilitychange', handleVisibilityChange);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    clearTimer();
    setLoading(false);
    setRetryPending(false);
    visibilitySource?.removeEventListener('visibilitychange', handleVisibilityChange);
  };

  if (getOwner()) onCleanup(dispose);
  if (args.autoStart !== false && !paused) void refresh();

  return { snapshot, loading, retryPending, nextCheckAt, refresh, retry, pause, resume, dispose };
}
