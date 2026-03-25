import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { createAIContextTelemetryController } from './createAIContextTelemetryController';

describe('createAIContextTelemetryController', () => {
  it('binds telemetry to a run and preserves the same run binding on replay', () => {
    const dispose = createRoot((disposeRoot) => {
      const controller = createAIContextTelemetryController();

      expect(controller.bindRun('run_1')).toEqual({ ok: true, switched: true });

      controller.applyUsagePayload('run_1', {
        estimate_tokens: 240,
        context_limit: 4000,
        sections_tokens: { transcript: 120 },
      }, {
        eventId: 11,
        atUnixMs: 500,
      });
      controller.commitReplayCursor('run_1', 25);

      expect(controller.bindRun('run_1')).toEqual({ ok: true, switched: false });
      expect(controller.activeContextRunId()).toBe('run_1');
      expect(controller.contextUsage()?.estimateTokens).toBe(240);
      expect(controller.contextTelemetryByRun().run_1?.cursor).toBe(25);

      return disposeRoot;
    });

    dispose();
  });

  it('tracks compaction events and clears all telemetry on reset', () => {
    const dispose = createRoot((disposeRoot) => {
      const controller = createAIContextTelemetryController();

      controller.bindRun('run_2');
      controller.applyCompactionPayload('run_2', 'context.compaction.applied', {
        compaction_id: 'cmp_1',
        step_index: 2,
        estimate_tokens_before: 3200,
        estimate_tokens_after: 1800,
      }, {
        eventId: 12,
        atUnixMs: 800,
      });

      expect(controller.contextCompactions()).toHaveLength(1);
      expect(controller.hasContextTelemetry()).toBe(true);

      controller.reset();

      expect(controller.activeContextRunId()).toBe('');
      expect(controller.contextTelemetryByRun()).toEqual({});
      expect(controller.contextCompactions()).toEqual([]);

      return disposeRoot;
    });

    dispose();
  });
});
