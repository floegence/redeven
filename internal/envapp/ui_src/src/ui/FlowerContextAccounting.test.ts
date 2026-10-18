import { describe, expect, it } from 'vitest';
import { buildFlowerContextComposition, buildFlowerContextWindow, buildFlowerComposerContextIndicatorView } from '../../../../flower_ui/src/chat/flowerContextPresentation';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerContextSample } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

// These are mapped Floret results, not a claim of provider token attribution.
const sample = (tokens: number, characters = 169903): FlowerContextSample => ({
  available: true, measured: true, characters_available: true,
  request_id: 'request-a', payload_fingerprint: 'frozen-a',
  phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1,
  input_tokens: tokens, context_window_tokens: 525000,
  characters: { source: 'prepared_characters_v1', unit: 'unicode_code_points', total_characters: characters,
    categories: [{ category: 'tool_result', characters }], limitations: ['hosted_context'] },
});

describe('Flower confirmed request units', () => {
  it.each([0, 1, 68074, 126467, 1000000])('keeps chars independent of native input %d', tokens => {
    const composition = buildFlowerContextComposition({ confirmed: sample(tokens) })!;
    expect(composition.total).toBe(169903);
    expect(composition.rows).toEqual([{ key: 'tool_outputs', characters: 169903, share: 100, items: [] }]);
    expect(buildFlowerContextWindow({ confirmed: sample(tokens) })!.input).toBe(tokens);
  });
  it('keeps one confirmed sample while current requests change', () => {
    const confirmed = sample(126467);
    const estimate = { ...sample(90000, 300000), measured: false, phase: 'projected_request' as const, pressure_status: 'near_threshold' as const };
    expect(buildFlowerContextWindow({ confirmed, estimate })!.input).toBe(126467);
    expect(buildFlowerContextComposition({ confirmed, estimate })!.total).toBe(169903);
    expect(buildFlowerComposerContextIndicatorView({ confirmed, estimate }, DEFAULT_FLOWER_SURFACE_COPY).warning).toBe('Current request: Near limit');
  });
  it('never reconstructs missing history from a newer estimate or current context', () => {
    const confirmed = { ...sample(100), characters_available: false, characters: undefined };
    expect(buildFlowerContextComposition({ confirmed, estimate: sample(200) })).toBeNull();
    expect(buildFlowerContextWindow({ confirmed })!.input).toBe(100);
    expect(buildFlowerContextWindow({ estimate: sample(200) })).toBeNull();
  });
  it('distinguishes measured zero, empty visible input and unavailable input', () => {
    const zero = sample(0, 0);
    expect(buildFlowerContextWindow({ confirmed: zero })!.input).toBe(0);
    expect(buildFlowerContextComposition({ confirmed: zero })).toEqual({ total: 0, rows: [] });
    expect(buildFlowerContextWindow({ confirmed: { ...zero, available: false } })).toBeNull();
    expect(buildFlowerContextWindow({ confirmed: { ...zero, context_window_tokens: 0 } })).toEqual({ input: 0, capacity: null, share: 0 });
  });
  it('excludes output and safety budgets from visible content', () => {
    const confirmed = sample(100);
    expect(buildFlowerContextComposition({ confirmed: { ...confirmed, safety_margin_tokens: 4096, request_output_tokens: 50000 } })).toEqual(buildFlowerContextComposition({ confirmed }));
  });
});
