import { createMemo, createSignal, type Accessor } from 'solid-js';

import {
  applyContextCompactionToRun,
  applyContextUsageToRun,
  ensureContextTelemetryRun,
  getContextTelemetryRun,
  hasContextTelemetryData,
  selectVisibleContextRunId,
  setContextTelemetryCursor,
  type ContextTelemetryByRun,
  type ContextTelemetryRunState,
} from './aiContextTelemetryState';
import type { ContextCompactionEventView, ContextUsageView } from './aiDataNormalizers';

export interface AIContextTelemetryController {
  contextTelemetryByRun: Accessor<ContextTelemetryByRun>;
  liveContextRunId: Accessor<string>;
  stableContextRunId: Accessor<string>;
  activeContextRunId: Accessor<string>;
  activeContextTelemetry: Accessor<ContextTelemetryRunState | null>;
  contextUsage: Accessor<ContextUsageView | null>;
  contextCompactions: Accessor<ContextCompactionEventView[]>;
  hasContextTelemetry: Accessor<boolean>;
  hasKnownContextRun: Accessor<boolean>;
  reset: () => void;
  setLiveRun: (runId: string | null | undefined) => { ok: boolean; switched: boolean };
  setStableRun: (runId: string | null | undefined) => { ok: boolean; switched: boolean };
  ensureRun: (runId: string | null | undefined) => boolean;
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
  const [liveContextRunId, setLiveContextRunId] = createSignal('');
  const [stableContextRunId, setStableContextRunId] = createSignal('');

  const activeContextRunId = createMemo(() => (
    selectVisibleContextRunId(contextTelemetryByRun(), liveContextRunId(), stableContextRunId())
  ));

  const activeContextTelemetry = createMemo(() => {
    const runId = activeContextRunId();
    return runId ? getContextTelemetryRun(contextTelemetryByRun(), runId) : null;
  });
  const contextUsage = createMemo<ContextUsageView | null>(() => activeContextTelemetry()?.usage ?? null);
  const contextCompactions = createMemo<ContextCompactionEventView[]>(() => activeContextTelemetry()?.compactions ?? []);
  const hasContextTelemetry = createMemo(() => hasContextTelemetryData(activeContextTelemetry()));
  const hasKnownContextRun = createMemo(() => !!activeContextRunId());

  const reset = (): void => {
    setContextTelemetryByRun({});
    setLiveContextRunId('');
    setStableContextRunId('');
  };

  const ensureRun = (runId: string | null | undefined): boolean => {
    const normalizedRunId = String(runId ?? '').trim();
    if (!normalizedRunId) return false;
    setContextTelemetryByRun((current) => ensureContextTelemetryRun(current, normalizedRunId));
    return true;
  };

  const setRunAccessor = (
    currentValue: () => string,
    setValue: (runId: string) => void,
    runId: string | null | undefined,
  ): { ok: boolean; switched: boolean } => {
    const normalizedRunId = String(runId ?? '').trim();
    const previousRunId = String(currentValue() ?? '').trim();
    if (!normalizedRunId) {
      if (!previousRunId) return { ok: false, switched: false };
      setValue('');
      return { ok: false, switched: true };
    }
    ensureRun(normalizedRunId);
    if (previousRunId === normalizedRunId) {
      return { ok: true, switched: false };
    }
    setValue(normalizedRunId);
    return { ok: true, switched: true };
  };

  const setLiveRun = (runId: string | null | undefined): { ok: boolean; switched: boolean } => (
    setRunAccessor(liveContextRunId, setLiveContextRunId, runId)
  );

  const setStableRun = (runId: string | null | undefined): { ok: boolean; switched: boolean } => (
    setRunAccessor(stableContextRunId, setStableContextRunId, runId)
  );

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
    liveContextRunId,
    stableContextRunId,
    activeContextRunId,
    activeContextTelemetry,
    contextUsage,
    contextCompactions,
    hasContextTelemetry,
    hasKnownContextRun,
    reset,
    setLiveRun,
    setStableRun,
    ensureRun,
    applyUsagePayload,
    applyCompactionPayload,
    commitReplayCursor,
  };
}
