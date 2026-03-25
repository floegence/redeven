import { createMemo, createSignal, type Accessor } from 'solid-js';

import {
  applyContextCompactionToRun,
  applyContextUsageToRun,
  ensureContextTelemetryRun,
  getContextTelemetryRun,
  hasContextTelemetryData,
  setContextTelemetryCursor,
  type ContextTelemetryByRun,
  type ContextTelemetryRunState,
} from './aiContextTelemetryState';
import type { ContextCompactionEventView, ContextUsageView } from './aiDataNormalizers';

export interface AIContextTelemetryController {
  contextTelemetryByRun: Accessor<ContextTelemetryByRun>;
  activeContextRunId: Accessor<string>;
  activeContextTelemetry: Accessor<ContextTelemetryRunState | null>;
  contextUsage: Accessor<ContextUsageView | null>;
  contextCompactions: Accessor<ContextCompactionEventView[]>;
  hasContextTelemetry: Accessor<boolean>;
  reset: () => void;
  bindRun: (runId: string) => { ok: boolean; switched: boolean };
  applyUsagePayload: (
    runId: string,
    payload: unknown,
    meta?: {
      eventId?: unknown;
      atUnixMs?: unknown;
    },
  ) => void;
  applyCompactionPayload: (
    runId: string,
    eventType: string,
    payload: unknown,
    meta?: {
      eventId?: unknown;
      atUnixMs?: unknown;
    },
    maxItems?: number,
  ) => void;
  commitReplayCursor: (runId: string, cursor: number) => void;
}

export function createAIContextTelemetryController(): AIContextTelemetryController {
  const [contextTelemetryByRun, setContextTelemetryByRun] = createSignal<ContextTelemetryByRun>({});
  const [activeContextRunId, setActiveContextRunId] = createSignal('');

  const activeContextTelemetry = createMemo(() => {
    const runId = activeContextRunId();
    return runId ? getContextTelemetryRun(contextTelemetryByRun(), runId) : null;
  });
  const contextUsage = createMemo<ContextUsageView | null>(() => activeContextTelemetry()?.usage ?? null);
  const contextCompactions = createMemo<ContextCompactionEventView[]>(() => activeContextTelemetry()?.compactions ?? []);
  const hasContextTelemetry = createMemo(() => hasContextTelemetryData(activeContextTelemetry()));

  const reset = (): void => {
    setContextTelemetryByRun({});
    setActiveContextRunId('');
  };

  const bindRun = (runId: string): { ok: boolean; switched: boolean } => {
    const normalizedRunId = String(runId ?? '').trim();
    if (!normalizedRunId) {
      return { ok: false, switched: false };
    }

    const previousRunId = String(activeContextRunId() ?? '').trim();
    const switched = previousRunId !== normalizedRunId;
    if (switched) {
      setActiveContextRunId(normalizedRunId);
    }
    setContextTelemetryByRun((current) => ensureContextTelemetryRun(current, normalizedRunId));
    return { ok: true, switched };
  };

  const applyUsagePayload = (
    runId: string,
    payload: unknown,
    meta?: {
      eventId?: unknown;
      atUnixMs?: unknown;
    },
  ): void => {
    const normalizedRunId = String(runId ?? '').trim();
    if (!normalizedRunId) return;
    setContextTelemetryByRun((current) => applyContextUsageToRun(current, normalizedRunId, payload, meta));
  };

  const applyCompactionPayload = (
    runId: string,
    eventType: string,
    payload: unknown,
    meta?: {
      eventId?: unknown;
      atUnixMs?: unknown;
    },
    maxItems = 200,
  ): void => {
    const normalizedRunId = String(runId ?? '').trim();
    if (!normalizedRunId) return;
    setContextTelemetryByRun((current) => (
      applyContextCompactionToRun(current, normalizedRunId, eventType, payload, meta, maxItems)
    ));
  };

  const commitReplayCursor = (runId: string, cursor: number): void => {
    const normalizedRunId = String(runId ?? '').trim();
    if (!normalizedRunId) return;
    setContextTelemetryByRun((current) => setContextTelemetryCursor(current, normalizedRunId, cursor));
  };

  return {
    contextTelemetryByRun,
    activeContextRunId,
    activeContextTelemetry,
    contextUsage,
    contextCompactions,
    hasContextTelemetry,
    reset,
    bindRun,
    applyUsagePayload,
    applyCompactionPayload,
    commitReplayCursor,
  };
}
