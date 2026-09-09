// @vitest-environment jsdom

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
  it('includes current native models and reserves dynamic catalogs for discovery', () => {
    expect(modelNames('openai')).toContain('gpt-6-astra');
    expect(modelNames('anthropic')).toContain('claude-fable-5-1');
    expect(modelNames('google')).toContain('gemini-3.8-flash');
    expect(modelNames('moonshot')).toContain('kimi-k3');
    expect(modelNames('chatglm')).toContain('glm-5.3');
    expect(modelNames('deepseek')).toContain('deepseek-v4-flash-vision-exp');
    expect(modelNames('qwen')).toContain('qwen3.8-max');
    expect(modelNames('groq')).toContain('qwen%2Fqwen3.8-27b');
    expect(modelNames('openrouter')).toEqual([]);
    expect(modelNames('ollama')).toEqual([]);
  });

  it('omits retired IDs and dedicated non-Agent models', () => {
    const names = Object.values(AI_PROVIDER_PRESET_CATALOG).flatMap((preset) => preset.models.map((model) => model.model_name));
    for (const retired of ['kimi-k2.5', 'deepseek-chat', 'deepseek-reasoner', 'llama-3.3-70b-versatile']) expect(names).not.toContain(retired);
    expect(modelNames('groq')).not.toContain('qwen3-32b');
    expect(names.some((name) => /embedding|realtime|transcribe|tts/.test(name))).toBe(false);
  });

  it('uses the current Z.AI OpenAI-compatible endpoint for new ChatGLM providers', () => {
    expect(defaultBaseURLForProviderType('chatglm')).toBe('https://api.z.ai/api/paas/v4/');
  });

  it('keeps provider display metadata centralized for settings UI', () => {
    const optionTypes = AI_PROVIDER_TYPE_OPTIONS.map((option) => option.value);

    expect(optionTypes).toEqual(['openai', 'anthropic', 'google', 'moonshot', 'chatglm', 'deepseek', 'qwen', 'openrouter', 'xai', 'groq', 'ollama', 'openai_compatible']);
    for (const providerType of optionTypes) {
      const brand = providerBrandForType(providerType);
      expect(brand.label).toBe(providerTypeLabel(providerType));
      expect(brand.icon.paths?.join('') || brand.icon.svgContent || '').not.toEqual('');
      expect(brand.icon.viewBox).not.toEqual('');
    }
    expect(providerBrandForType('deepseek').icon.title).toBe('DeepSeek');
    expect(providerUsesCustomConnectionName('openai')).toBe(false);
    expect(providerUsesCustomConnectionName('deepseek')).toBe(false);
    expect(providerUsesCustomConnectionName('openrouter')).toBe(true);
    expect(providerUsesCustomConnectionName('ollama')).toBe(true);
    expect(providerUsesCustomConnectionName('openai_compatible')).toBe(true);
    expect(providerSupportsCustomModelNames('openai')).toBe(true);
    expect(providerSupportsCustomModelNames('deepseek')).toBe(true);
    expect(providerSupportsCustomModelNames('groq')).toBe(true);
    expect(providerSupportsCustomModelNames('ollama')).toBe(false);
    expect(providerSupportsCustomModelNames('openai_compatible')).toBe(true);
    expect(providerDisplayName({ type: 'deepseek', name: 'Personal DeepSeek' })).toBe('DeepSeek');
    expect(providerDisplayName({ type: 'openai_compatible', name: 'Endpoint A' })).toBe('Endpoint A');
  });
});
