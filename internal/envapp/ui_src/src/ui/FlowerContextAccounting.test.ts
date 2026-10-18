import { describe, expect, it } from 'vitest';
import { buildFlowerContextComposition, buildFlowerContextWindow, buildFlowerComposerContextIndicatorView } from '../../../../flower_ui/src/chat/flowerContextPresentation';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerContextSample } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

// Reconciliation belongs to the published Floret API. These fixtures are its
// mapped output, including the sanitized screenshot and official-account facts.
const sample = (total: number, visible: number, tools: number): FlowerContextSample => ({
  available: true, measured: true, breakdown_available: true,
  unattributed_tokens: total - visible, request_id: 'request-a', payload_fingerprint: 'frozen-a',
  phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1,
  input_tokens: total, context_window_tokens: 525000,
  breakdown: { source: 'prepared_content_v4', quality: 'token_estimate', tokenizer: 'proxy_bpe',
    attribution_coverage: 'partial', limitation: 'hosted_context',
    user_tokens: visible - tools, tool_definition_tokens: tools,
    details: { items: [{ category: 'tool_definition', key: 'fixed-toolset', source: 'builtin', tokens: tools }] },
  },
});

describe('Flower request accounting presentation', () => {
  it.each([
    { total: 46292, visible: 18363, tools: 7936, remainder: 27929 },
    { total: 14374, visible: 11280, tools: 10356, remainder: 3094 },
    { total: 23373, visible: 15464, tools: 10356, remainder: 7909 },
    { total: 90589, visible: 30994, tools: 10356, remainder: 59595 },
  ])('preserves visible estimates for measured input $total', row => {
    const composition = buildFlowerContextComposition({ confirmed: sample(row.total, row.visible, row.tools) })!;
    expect(composition.rows.find(item => item.key === 'system_tools')!.tokens).toBe(row.tools);
    expect(composition.rows.find(item => item.key === 'unattributed_usage')!.tokens).toBe(row.remainder);
    expect(composition.rows.reduce((sum, item) => sum + item.tokens, 0)).toBe(row.total);
    expect(composition.rows.find(item => item.key === 'system_tools')!.items.reduce((sum, item) => sum + item.tokens, 0)).toBe(row.tools);
  });
  it('keeps one confirmed sample while current requests change', () => {
    const confirmed = sample(46292, 18363, 7936);
    const estimate = { ...sample(90000, 90000, 10356), measured: false, phase: 'projected_request' as const, pressure_status: 'near_threshold' as const };
    expect(buildFlowerContextWindow({ confirmed, estimate })!.input).toBe(46292);
    expect(buildFlowerContextComposition({ confirmed, estimate })!.rows.find(row => row.key === 'system_tools')!.tokens).toBe(7936);
    expect(buildFlowerComposerContextIndicatorView({ confirmed, estimate }, DEFAULT_FLOWER_SURFACE_COPY).warning).toBe('Current request: Near limit');
  });
  it('does not reconstruct suppressed attribution or substitute a newer estimate', () => {
    const confirmed = { ...sample(100, 100, 30), breakdown_available: false, breakdown: undefined, limitation: 'categories_exceed_total' };
    expect(buildFlowerContextComposition({ confirmed, estimate: sample(200, 100, 30) })).toBeNull();
    expect(buildFlowerContextWindow({ confirmed })!.input).toBe(100);
  });
  it('distinguishes a measured zero from unavailable partial content', () => {
    const zero = sample(0, 0, 0);
    expect(buildFlowerContextWindow({ confirmed: zero })!.input).toBe(0);
    expect(buildFlowerContextWindow({ confirmed: zero })!.estimated).toBe(false);
    expect(buildFlowerContextComposition({ confirmed: zero })!.rows).toEqual([]);
    expect(buildFlowerContextWindow({ estimate: { ...zero, available: false, measured: false } })).toBeNull();
  });
  it('does not change fixed tool amounts when unattributed usage grows', () => {
    const amounts = [23373, 90589].map(total => buildFlowerContextComposition({ confirmed: sample(total, 15464, 10356) })!.rows.find(row => row.key === 'system_tools')!.tokens);
    expect(amounts).toEqual([10356, 10356]);
  });
  it('keeps output and safety budgets out of composition', () => {
    const confirmed = sample(100, 100, 30);
    expect(buildFlowerContextComposition({ confirmed: { ...confirmed, safety_margin_tokens: 4096, request_output_tokens: 50000 } })).toEqual(buildFlowerContextComposition({ confirmed }));
  });
});
