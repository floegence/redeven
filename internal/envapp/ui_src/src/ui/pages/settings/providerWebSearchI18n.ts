import type { I18nHelpers } from '../../i18n';
import type { AIProviderType } from './types';

export function localizedProviderBuiltInWebSearchLabel(i18n: I18nHelpers, providerType: AIProviderType): string | undefined {
  switch (providerType) {
    case 'openai':
      return i18n.t('flowerSettings.webSearchOpenAIBuiltIn');
    case 'moonshot':
      return i18n.t('flowerSettings.webSearchKimiBuiltIn');
    case 'chatglm':
      return i18n.t('flowerSettings.webSearchGLMBuiltIn');
    case 'deepseek':
      return i18n.t('flowerSettings.webSearchDeepSeekBuiltIn');
    case 'qwen':
      return i18n.t('flowerSettings.webSearchQwenBuiltIn');
    default:
      return undefined;
  }
}
