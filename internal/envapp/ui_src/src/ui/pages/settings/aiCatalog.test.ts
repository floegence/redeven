import { describe, expect, it } from 'vitest';

import {
  AI_PROVIDER_PRESET_CATALOG,
  AI_PROVIDER_TYPE_OPTIONS,
  defaultBaseURLForProviderType,
  providerBrandForType,
  providerDisplayName,
  providerSupportsCustomModelNames,
  providerTypeLabel,
  providerUsesCustomConnectionName,
  recommendedModelsForProviderType,
} from './aiCatalog';
import type { AIProviderType } from './types';

function modelNames(providerType: AIProviderType): string[] {
  return recommendedModelsForProviderType(providerType).map((model) => model.model_name);
}

describe('AI provider preset catalog', () => {
  it('prioritizes the latest verified Flower-compatible model IDs', () => {
    expect(modelNames('openai').slice(0, 4)).toEqual(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano']);
    expect(modelNames('anthropic').slice(0, 3)).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    expect(modelNames('moonshot')).toEqual(['kimi-k2.6']);
    expect(modelNames('chatglm')[0]).toBe('glm-5.1');
    expect(modelNames('deepseek')).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
    expect(modelNames('qwen')).toEqual(['qwen3.6-plus', 'qwen3.6-plus-2026-04-02', 'qwen3.6-flash', 'qwen3.6-flash-2026-04-16']);
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
    expect(allPresetNames).not.toContain('kimi-k2.5');
    expect(allPresetNames).not.toContain('glm-5');
    expect(allPresetNames).not.toContain('glm-4.7');
    expect(allPresetNames).not.toContain('glm-4.5-air');
    expect(allPresetNames).not.toContain('glm-4.5-flash');
    expect(allPresetNames).not.toContain('qwen3.6-max-preview');
    expect(allPresetNames).not.toContain('qwen3.6-35b-a3b');
    expect(allPresetNames).not.toContain('qwen3-max');
    expect(allPresetNames).not.toContain('qwen-plus');
    expect(allPresetNames).not.toContain('qwen-flash');
    expect(allPresetNames).not.toContain('qwen3-coder-plus');
  });

  it('uses the current Z.AI OpenAI-compatible endpoint for new ChatGLM providers', () => {
    expect(defaultBaseURLForProviderType('chatglm')).toBe('https://api.z.ai/api/paas/v4/');
  });

  it('keeps provider display metadata centralized for settings UI', () => {
    const optionTypes = AI_PROVIDER_TYPE_OPTIONS.map((option) => option.value);

    expect(optionTypes).toEqual(['openai', 'anthropic', 'moonshot', 'chatglm', 'deepseek', 'qwen', 'openai_compatible']);
    for (const providerType of optionTypes) {
      const brand = providerBrandForType(providerType);
      expect(brand.label).toBe(providerTypeLabel(providerType));
      expect(brand.icon.paths.join('')).not.toEqual('');
      expect(brand.icon.viewBox).not.toEqual('');
    }
    expect(providerBrandForType('deepseek').icon.title).toBe('DeepSeek');
    expect(providerUsesCustomConnectionName('openai')).toBe(false);
    expect(providerUsesCustomConnectionName('deepseek')).toBe(false);
    expect(providerUsesCustomConnectionName('openai_compatible')).toBe(true);
    expect(providerSupportsCustomModelNames('openai')).toBe(true);
    expect(providerSupportsCustomModelNames('deepseek')).toBe(false);
    expect(providerSupportsCustomModelNames('openai_compatible')).toBe(true);
    expect(providerDisplayName({ type: 'deepseek', name: 'Personal DeepSeek' })).toBe('DeepSeek');
    expect(providerDisplayName({ type: 'openai_compatible', name: 'Gateway A' })).toBe('Gateway A');
  });
});
