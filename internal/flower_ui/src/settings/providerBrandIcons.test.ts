import { describe, expect, it } from 'vitest';
import { FLOWER_PROVIDER_ICON_DEFINITIONS } from './providerBrandIcons';
import { FLOWER_PROVIDER_TYPES } from './providerCatalog';
import manifest from '../../../../assets/flower_provider_icons.json';

describe('Flower provider brands', () => {
  it('identifies every connection with its displayed provider brand', () => {
    for (const { value, label } of FLOWER_PROVIDER_TYPES) {
      expect(FLOWER_PROVIDER_ICON_DEFINITIONS[value].title, value).toBe(label);
    }
  });

  it('uses bundled upstream SVG assets instead of hand-authored paths', () => {
    for (const { value } of FLOWER_PROVIDER_TYPES) {
      const icon = FLOWER_PROVIDER_ICON_DEFINITIONS[value];
      expect(icon, value).toHaveProperty('src', expect.stringContaining('/assets/provider-icons/'));
      expect(icon).not.toHaveProperty('paths');
      expect(icon).not.toHaveProperty('svgContent');
    }
  });

  it('maps every provider to the matching audited theSVG identity', () => {
    const identities = { openai: 'openai', anthropic: 'anthropic', google: 'gemini', kimi_code: 'kimi', moonshot: 'kimi', chatglm: 'zdotai', deepseek: 'deepseek', qwen: 'qwen', openrouter: 'openrouter', xai: 'xai', groq: 'groq', ollama: 'ollama', openai_compatible: 'openai' };
    for (const { value } of FLOWER_PROVIDER_TYPES) {
      const asset = manifest.assets.find(asset => asset.identity === identities[value])!;
      expect(asset, value).toBeDefined();
      expect(FLOWER_PROVIDER_ICON_DEFINITIONS[value].src).toContain('/provider-icons/' + asset.file);
      expect(FLOWER_PROVIDER_ICON_DEFINITIONS[value].monochrome).toBe(asset.monochrome);
    }
  });
});
