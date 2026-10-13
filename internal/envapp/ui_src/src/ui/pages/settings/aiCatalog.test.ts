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
} from './aiCatalog';

describe('AI provider preset catalog', () => {
  it('keeps provider model defaults out of the frontend preset catalog', () => {
    for (const preset of Object.values(AI_PROVIDER_PRESET_CATALOG)) expect(preset.models).toEqual([]);
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
