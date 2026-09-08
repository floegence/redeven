import { describe, expect, it } from 'vitest';
import { surfaceFailureDiagnostic, surfaceOpeningFeedback } from './pluginSurfaceOpeningFeedback';

describe('surface opening diagnostic presentation', () => {
  const progress = { phase: 'opening', stage: 'preparing', elapsedMs: 800, stageElapsedMs: 800, pendingMilestones: ['prepare'] };

  it('copies only bounded SDK diagnostics without unknown fields or mutable arrays', () => {
    const source = { ...progress, token: 'secret', pluginContent: 'private' };
    const opening = surfaceOpeningFeedback(source)!;
    expect(opening).toEqual({ stage: 'preparing', elapsedMs: 800, stageElapsedMs: 800, pendingMilestones: ['prepare'] });
    expect(opening.pendingMilestones).not.toBe(source.pendingMilestones);
    expect(surfaceFailureDiagnostic('PLUGIN_BRIDGE_TIMEOUT', opening)).not.toMatch(/secret|private|token/);
    expect(surfaceFailureDiagnostic('untrusted content')).toBe('{}');
  });

  it.each([
    null, {}, { ...progress, phase: 'ready' }, { ...progress, stage: '__proto__' },
    { ...progress, elapsedMs: -1 }, { ...progress, elapsedMs: Infinity },
    { ...progress, stageElapsedMs: 801 }, { ...progress, pendingMilestones: ['token', 'worker_ready', 'first_commit'] },
    { ...progress, pendingMilestones: ['plugin-content'] },
  ])('omits malformed diagnostic details: %j', (value) => {
    expect(surfaceOpeningFeedback(value)).toBeUndefined();
  });
});
