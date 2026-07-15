import type { Logger } from '@floegence/floeterm-terminal-web/preload';
import { publishDebugConsoleStructuredEvent } from './debugConsoleCapture';
import { markTerminalPerformance } from './terminalPerformance';

type PreloadOptions = Readonly<{
  logger?: Logger;
  reason?: 'idle' | 'intent' | 'retry';
}>;

let inFlight: Promise<void> | null = null;
let idleHandle: number | ReturnType<typeof setTimeout> | null = null;

function report(logger: Logger | undefined, event: string, meta: Record<string, unknown> = {}): void {
  logger?.debug(`[terminal-preload] ${event}`, meta);
  publishDebugConsoleStructuredEvent({
    created_at: new Date().toISOString(),
    source: 'ui',
    scope: 'terminal_preload',
    kind: `terminal_${event}`,
    message: `Terminal preload ${event}`,
    detail: meta,
  });
  if (event === 'module_ready') markTerminalPerformance('terminal-module-ready');
  if (event === 'resources_ready') markTerminalPerformance('resources-ready');
}

/**
 * Loads the Terminal page chunk and renderer resources as one retryable
 * single-flight. The imports remain dynamic so the initial Env App bundle does
 * not pay for Ghostty, Beamterm, or the Terminal panel.
 */
export function preloadTerminalFeatureResources(options: PreloadOptions = {}): Promise<void> {
  if (inFlight) return inFlight;

  const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
  const reason = options.reason ?? 'idle';
  report(options.logger, 'start', { reason });
  const moduleReady = Promise.all([
    import('../pages/EnvTerminalPage'),
    import('../widgets/TerminalPanel'),
  ]).then(() => report(options.logger, 'module_ready', { reason }));
  const resourcesReady = import('@floegence/floeterm-terminal-web/preload')
    .then(({ preloadTerminalResources }) => preloadTerminalResources())
    .then(() => report(options.logger, 'resources_ready', { reason }));
  inFlight = Promise.all([moduleReady, resourcesReady]).then(() => {
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    report(options.logger, 'ready', { reason, durationMs: Math.max(0, now - startedAt) });
  }).catch((error) => {
    // A failed dynamic import must not poison later intent-driven retries.
    inFlight = null;
    report(options.logger, 'failed', {
      reason,
      failure_code: 'feature_or_resource_load_failed',
    });
    throw error;
  });

  return inFlight;
}

export function scheduleTerminalFeaturePreload(options: PreloadOptions = {}): () => void {
  if (inFlight || idleHandle !== null) return () => undefined;

  const callback = () => {
    idleHandle = null;
    void preloadTerminalFeatureResources(options).catch(() => undefined);
  };
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    idleHandle = window.requestIdleCallback(callback, { timeout: 1_000 });
  } else if (typeof window !== 'undefined') {
    idleHandle = window.setTimeout(callback, 16);
  } else {
    callback();
  }

  return () => {
    if (idleHandle === null || typeof window === 'undefined') return;
    if (typeof window.cancelIdleCallback === 'function' && typeof idleHandle === 'number') {
      window.cancelIdleCallback(idleHandle);
    } else {
      window.clearTimeout(idleHandle);
    }
    idleHandle = null;
  };
}

export function resetTerminalFeaturePreloadForTests(): void {
  inFlight = null;
  idleHandle = null;
}
