import { Checkbox, Select } from '@floegence/floe-webapp-core/ui';
import type { FlowerProviderModel, FlowerProviderType, FlowerReasoningCapability } from '../contracts/flowerSurfaceContracts';
import type { ModelCatalogCopy } from './modelCatalogCopy';

const reasoningShapes: Partial<Record<FlowerProviderType, string>> = {
  openai: 'openai_responses_reasoning_effort', openai_compatible: 'openai_chat_reasoning_effort',
  anthropic: 'anthropic_thinking_budget_tokens', google: 'gemini_openai_thinking_budget',
  moonshot: 'kimi_thinking_type', chatglm: 'glm_thinking_type', qwen: 'qwen_enable_thinking',
  deepseek: 'deepseek_responses_reasoning_effort', xai: 'openai_chat_reasoning_effort', groq: 'openai_chat_reasoning_effort',
  openrouter: 'openrouter_reasoning_metadata',
};

export function manualReasoningCapability(type: FlowerProviderType, baseURL: string, enabled: boolean): FlowerReasoningCapability {
  const shape = enabled ? reasoningShapes[type] : undefined;
  if (!shape) return {};
  const effort = shape.includes('effort') || shape === 'openrouter_reasoning_metadata';
  return {
    kind: effort ? 'effort' : 'toggle', wire_shape: shape,
    supported_levels: effort ? ['low', 'medium', 'high'] : ['on'],
    disable_supported: !effort,
    ...(shape === 'anthropic_thinking_budget_tokens' ? { kind: 'budget', budget_shape: shape, min_budget_tokens: 1024 } : {}),
    ...(shape === 'gemini_openai_thinking_budget' ? { kind: 'budget', budget_shape: 'gemini_thinking_budget' } : {}),
    ...(shape === 'qwen_enable_thinking' ? { budget_shape: 'qwen_thinking_budget' } : {}),
    source_urls: [baseURL], source_checked_at: new Date().toISOString().slice(0, 10), fixture: 'manual_provider_capability',
  };
}

export function ManualModelCapabilities(props: Readonly<{
  model: FlowerProviderModel; type: FlowerProviderType; baseURL: string; copy: ModelCatalogCopy;
  disabled?: boolean; onChange: (patch: Partial<FlowerProviderModel>) => void;
}>) {
  return <div class="space-y-3 md:col-span-3">
    <Checkbox checked={props.model.supports_tools !== false && props.model.supports_tools !== undefined} disabled={props.disabled}
      label={props.copy.tools} size="sm" onChange={supports_tools => props.onChange({ supports_tools })} />
    <div class="space-y-1">
      <label class="text-xs font-medium">{props.copy.reasoning}</label>
      <Select value={props.model.reasoning_capability?.wire_shape ? 'enabled' : 'disabled'}
        aria-label={props.copy.reasoning} disabled={props.disabled || !reasoningShapes[props.type]}
        options={[{ value: 'disabled', label: props.copy.reasoningDisabled }, { value: 'enabled', label: props.copy.reasoningEnabled }]}
        onChange={value => props.onChange({ reasoning_capability: manualReasoningCapability(props.type, props.baseURL, value === 'enabled'),
          default_reasoning_selection: value === 'enabled' && props.type === 'anthropic' ? { level: 'on', budget_tokens: 1024 } : undefined })} />
    </div>
  </div>;
}
