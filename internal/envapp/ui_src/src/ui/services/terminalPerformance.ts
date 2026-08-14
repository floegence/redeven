import { publishDebugConsoleStructuredEvent } from './debugConsoleCapture';

export type TerminalPerformanceStage =
  | 'catalog-start'
  | 'catalog-ready'
  | 'sidebar-presented'
  | 'create-intent'
  | 'pending-row-painted'
  | 'create-ack'
  | 'session-interactive';

export function pseudonymousTerminalSessionRef(sessionId: string): string {
  let hash = 2166136261;
  for (const character of String(sessionId ?? '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `session-${(hash >>> 0).toString(16)}`;
}

export function markTerminalPerformance(
  stage: TerminalPerformanceStage,
  detail: Record<string, string | number | boolean | undefined> = {},
): void {
  publishDebugConsoleStructuredEvent({
    created_at: new Date().toISOString(),
    source: 'ui',
    scope: 'terminal_performance',
    kind: `terminal_${stage.replaceAll('-', '_')}`,
    message: `Terminal performance ${stage}`,
    detail,
  });
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  performance.mark(`redeven:terminal:${stage}`, { detail });
}
