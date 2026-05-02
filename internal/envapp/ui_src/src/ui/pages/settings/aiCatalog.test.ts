import { describe, expect, it } from 'vitest';

import { AI_PROVIDER_PRESET_CATALOG, defaultBaseURLForProviderType, recommendedModelsForProviderType } from './aiCatalog';
import type { AIProviderType } from './types';

function modelNames(providerType: AIProviderType): string[] {
  return recommendedModelsForProviderType(providerType).map((model) => model.model_name);
}

describe('AI provider preset catalog', () => {
  it('prioritizes the latest verified Flower-compatible model IDs', () => {
    expect(modelNames('openai').slice(0, 4)).toEqual(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano']);
    expect(modelNames('anthropic').slice(0, 3)).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    expect(modelNames('moonshot').slice(0, 2)).toEqual(['kimi-k2.6', 'kimi-k2.5']);
    expect(modelNames('chatglm')[0]).toBe('glm-5.1');
    expect(modelNames('deepseek')).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
  });

  it('does not recommend provider IDs that official docs mark as deprecated or incompatible with streaming', () => {
    const allPresetNames = Object.values(AI_PROVIDER_PRESET_CATALOG).flatMap((preset) => preset.models.map((model) => model.model_name));

    expect(allPresetNames).not.toContain('gpt-5.5-pro');
    expect(allPresetNames).not.toContain('claude-opus-4-1-20250805');
    expect(allPresetNames).not.toContain('claude-sonnet-4-5-20250929');
    expect(allPresetNames).not.toContain('deepseek-chat');
    expect(allPresetNames).not.toContain('deepseek-reasoner');
    expect(allPresetNames).not.toContain('kimi-k2-thinking');
    expect(allPresetNames).not.toContain('kimi-k2-thinking-turbo');
  });

  it('uses the current Z.AI OpenAI-compatible endpoint for new ChatGLM providers', () => {
    expect(defaultBaseURLForProviderType('chatglm')).toBe('https://api.z.ai/api/paas/v4/');
  });
});
