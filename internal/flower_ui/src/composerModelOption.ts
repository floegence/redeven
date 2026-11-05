import type { FlowerModelDirectoryModel, FlowerProviderType, FlowerReasoningCapability, FlowerReasoningSelection } from './contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from './copy';

export type ComposerModelOption = Readonly<{
  billingSource?: 'chatgpt_plan';
  id: string;
  label: string;
  name?: string;
  group: string;
  aliasKey?: string;
  source: 'model_profile' | 'desktop_model_source' | 'platform' | 'thread_snapshot';
  disabled?: boolean;
  providerType?: FlowerProviderType;
  reasoningCapability?: FlowerReasoningCapability;
  defaultReasoningSelection?: FlowerReasoningSelection;
  pending?: boolean;
  unavailableReason?: string;
}>;

export function flowerComposerModelOption(model: FlowerModelDirectoryModel, copy: FlowerSurfaceCopy): ComposerModelOption {
  return {
    id: model.id, label: model.label || model.id, billingSource: model.billing_source,
    name: model.label?.split(' / ').slice(1).join(' / ') || model.model_name,
    group: model.provider_name || (model.source === 'platform' ? 'Redeven AI' : model.source === 'desktop_model_source' ? 'Desktop' : copy.settings.dialog.catalog.unavailableModel),
    source: model.source === 'runtime_config' ? 'model_profile' : model.source || 'thread_snapshot',
    unavailableReason: ({ missing_keys: copy.chat.modelUnavailableMissingKeys, provider_disabled: copy.chat.modelUnavailableProviderDisabled, model_missing: copy.chat.modelUnavailableModelMissing, chatgpt_renewing: copy.settings.dialog.chatGPT.renewing, chatgpt_temporarily_unavailable: copy.settings.dialog.chatGPT.temporarilyUnavailable, chatgpt_review_required: copy.settings.dialog.chatGPT.reviewRequired, chatgpt_plan_permission_required: copy.settings.dialog.chatGPT.planPermission, chatgpt_authorization_required: copy.settings.dialog.chatGPT.authorizationRequired, chatgpt_signing_out: copy.settings.dialog.chatGPT.signingOut, chatgpt_signed_out: copy.settings.dialog.chatGPT.signedOut, chatgpt_storage_unavailable: copy.settings.dialog.chatGPT.storageUnavailable } as Record<string, string>)[model.reason ?? ''],
    disabled: model.state !== 'ready', pending: model.state === 'pending', providerType: model.provider_type,
    aliasKey: model.alias_group, reasoningCapability: model.reasoning_capability,
    defaultReasoningSelection: model.default_reasoning_selection,
  };
}
