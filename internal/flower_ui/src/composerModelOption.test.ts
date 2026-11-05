import { describe, expect, it } from 'vitest';
import { flowerComposerModelOption } from './composerModelOption';
import { DEFAULT_FLOWER_SURFACE_COPY } from './copy';
import type { FlowerModelDirectoryModel } from './contracts/flowerSurfaceContracts';

const model: FlowerModelDirectoryModel = {
  id: 'team/sonnet', label: 'Team Provider / Claude / Sonnet', model_name: 'sonnet',
  provider_name: 'Team Provider', provider_id: 'team', provider_type: 'anthropic',
  source: 'runtime_config', state: 'ready', alias_group: 'sonnet',
};

describe('shared Flower model presentation', () => {
  it('preserves provider identity, complete model name and request identity', () => {
    expect(flowerComposerModelOption(model, DEFAULT_FLOWER_SURFACE_COPY)).toMatchObject({
      id: 'team/sonnet', label: model.label, name: 'Claude / Sonnet', group: 'Team Provider',
      providerType: 'anthropic', source: 'model_profile', aliasKey: 'sonnet', disabled: false,
    });
    expect(flowerComposerModelOption({ ...model, id: 'another/sonnet', provider_name: 'Another Provider' }, DEFAULT_FLOWER_SURFACE_COPY))
      .toMatchObject({ id: 'another/sonnet', name: 'Claude / Sonnet', group: 'Another Provider' });
  });

  it('shares translated availability and pending states across both pickers', () => {
    const copy = { ...DEFAULT_FLOWER_SURFACE_COPY, chat: { ...DEFAULT_FLOWER_SURFACE_COPY.chat, modelUnavailableMissingKeys: 'Missing provider credentials' } };
    expect(flowerComposerModelOption({ ...model, state: 'unavailable', reason: 'missing_keys' }, copy))
      .toMatchObject({ disabled: true, pending: false, unavailableReason: 'Missing provider credentials' });
    expect(flowerComposerModelOption({ ...model, state: 'pending' }, copy)).toMatchObject({ disabled: true, pending: true });
  });

  it('retains billing and reasoning capability without replacing the model label', () => {
    const configured = { ...model, billing_source: 'chatgpt_plan' as const, default_reasoning_selection: { level: 'default' as const } };
    expect(flowerComposerModelOption(configured, DEFAULT_FLOWER_SURFACE_COPY)).toMatchObject({
      name: 'Claude / Sonnet', billingSource: 'chatgpt_plan', defaultReasoningSelection: { level: 'default' },
    });
  });
});
