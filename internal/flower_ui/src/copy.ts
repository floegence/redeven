import type { FlowerActivityApprovalState, FlowerProviderType, FlowerThreadStatus } from './contracts/flowerSurfaceContracts';
import type { FlowerProviderModelNoteKey } from './settings/providerModelNotes';
import { localizedFlowerProviderModelNote } from './settings/providerModelNotes';
import type { FlowerProviderTypeLabels } from './settings/providerTypeLabels';
import { localizedFlowerProviderTypeLabels } from './settings/providerTypeLabels';

export type FlowerThreadTimeGroup = 'today' | 'yesterday' | 'this_week' | 'older';

export type FlowerEmptyStateSuggestionCopy = Readonly<{
  title: string;
  description: string;
  prompt: string;
}>;

export type FlowerEmptyStateCopy = Readonly<{
  title: string;
  description: string;
  suggestions: readonly FlowerEmptyStateSuggestionCopy[];
  sendKeyLabel: string;
  newLineKeyLabel: string;
}>;

export type FlowerThreadListCopy = Readonly<{
  title: string;
  description: string;
  refreshLabel: string;
  searchPlaceholder: string;
  empty: string;
  untitled: string;
  working: string;
  unread: string;
  deleteLabel: (title: string) => string;
  contextMenuLabel: (title: string) => string;
  copyThreadID: string;
  copyWorkingDirectory: string;
  threadIDLabel: string;
  workingDirectoryLabel: string;
  copied: (label: string) => string;
  fork: string;
  pin: string;
  unpin: string;
  pinnedGroup: string;
  pinnedBadge: string;
  rename: string;
  renameTitle: string;
  renameNameLabel: string;
  cancel: string;
  save: string;
  saving: string;
  now: string;
  minutes: (count: number) => string;
  hours: (count: number) => string;
  days: (count: number) => string;
  statuses: Readonly<Record<FlowerThreadStatus, string>>;
  groups: Readonly<Record<FlowerThreadTimeGroup, string>>;
}>;

export type FlowerAutoSaveCopy = Readonly<{
  saving: string;
  saveFailed: string;
  unsaved: string;
  saved: string;
  ready: string;
}>;

export type FlowerSettingsCopy = Readonly<{
  title: string;
  backToChat: string;
  description: string;
  currentModel: string;
  noModelSelected: string;
  text: string;
  imageInput: string;
  selectModelPlaceholder: string;
  userApprovalTitle: string;
  userApprovalDescription: string;
  on: string;
  off: string;
  dangerousCommandsTitle: string;
  dangerousCommandsDescription: string;
  blocked: string;
  allowed: string;
  providersTitle: string;
  providersDescription: string;
  managedByLocalAIProfileTitle: string;
  managedByLocalAIProfileDescription: string;
  managedByLocalAIProfileReady: string;
  managedByLocalAIProfileNeedsKey: string;
  managedByLocalAIProfileModelCount: (count: number) => string;
  managedByLocalAIProfileMissingKeys: (providers: string) => string;
  managedByLocalAIProfileOpenLocal: string;
  addProvider: string;
  noProviders: string;
  defaultProvider: string;
  editProvider: string;
  removeProvider: string;
  apiKey: string;
  ready: string;
  needsKey: string;
  models: string;
  web: string;
  vision: string;
  terminalLimitsTitle: string;
  terminalLimitsDescription: string;
  defaultTimeout: string;
  maximumTimeout: string;
  dangerousBlockingOff: string;
  webSearchNotSupported: string;
  webSearchDisabled: string;
  openAIBuiltIn: string;
  braveSearch: string;
  needsBraveKey: string;
  providerTypeLabels: FlowerProviderTypeLabels;
  builtInWebSearch: Readonly<Record<Exclude<FlowerProviderType, 'anthropic' | 'openai_compatible'>, string>>;
  autoSave: FlowerAutoSaveCopy;
  validation: Readonly<{
    providerIDRequired: string;
    providerIDNoSlash: string;
    duplicateProviderID: (providerID: string) => string;
    providerRequiresBaseURL: (providerName: string) => string;
    providerInvalidBaseURL: (providerName: string) => string;
    providerBaseURLProtocol: (providerName: string) => string;
    providerNeedsModel: (providerName: string) => string;
    providerUnnamedModel: (providerName: string) => string;
    modelNameNoSlash: string;
    duplicateModel: (providerName: string, modelName: string) => string;
    modelNeedsContextWindow: (modelName: string) => string;
    selectCurrentModel: string;
    currentModelUnavailable: (modelID: string) => string;
    terminalTimeoutPositive: string;
    terminalTimeoutOrder: string;
  }>;
  dialog: FlowerProviderDialogCopy;
}>;

export type FlowerProviderDialogCopy = Readonly<{
  addTitle: string;
  editTitle: string;
  discard: string;
  saveProvider: string;
  providerRemoved: string;
  providerTypeTitle: string;
  providerTypeDescription: string;
  current: string;
  collapse: string;
  configure: string;
  providerTypeLabels: FlowerProviderTypeLabels;
  providerTypeHints: Readonly<Record<FlowerProviderType, string>>;
  connectionTitle: string;
  connectionDescription: string;
  connectionName: string;
  apiKey: string;
  storedKeyKept: string;
  requiredBeforeUse: string;
  pasteAPIKey: string;
  required: string;
  baseURL: string;
  webSearch: string;
  disabled: string;
  openAIBuiltIn: string;
  braveSearch: string;
  requiredForBraveSearch: string;
  braveAPIKey: string;
  storedBraveKeyKept: string;
  pasteBraveAPIKey: string;
  keyReady: string;
  needsKey: string;
  braveKeyReady: string;
  needsBraveKey: string;
  builtInWebSearch: Readonly<Record<Exclude<FlowerProviderType, 'anthropic' | 'openai_compatible'>, string>>;
  recommendedModelsTitle: string;
  recommendedModelsDescription: string;
  modelNote: (noteKey: FlowerProviderModelNoteKey | undefined) => string;
  addAllPresets: string;
  customModelProvider: string;
  contextSuffix: string;
  outputSuffix: string;
  add: string;
  remove: string;
  text: string;
  imageInput: string;
  selected: string;
  customModelPlaceholder: string;
  curatedPresetsOnly: string;
  addCustomModel: string;
  selectedModelsTitle: string;
  selectedModelsDescription: string;
  noSelectedModels: string;
  unnamedModel: string;
  textAndImage: string;
  textOnly: string;
  modelIDPending: string;
  advancedTitle: string;
  advancedDescription: string;
  show: string;
  hide: string;
  providerIDPending: string;
  modelName: string;
  contextWindow: string;
  maxOutput: string;
  effectiveContextPercent: string;
}>;

export type FlowerSurfaceCopy = Readonly<{
  chat: Readonly<{
    loadingSettings: string;
    configureProviderBeforeChat: string;
    enterMessageBeforeSending: string;
    titleFallback: string;
    ready: string;
    setupNeeded: string;
    settingsLabel: string;
    needsProviderNotice: string;
    openSettings: string;
    placeholder: string;
    fromSource: (source: string) => string;
    modelLabel: string;
    noModelSelected: string;
    linkedContextLabel: string;
    handlerBlockedTitle: string;
    handlerStartFailedTitle: string;
    handlerStillStarting: string;
    handlerRetry: string;
    send: string;
    runErrorTitle: string;
    runErrorActions: Readonly<{
      updateAPIKey: string;
      addAPIKey: string;
      switchModel: string;
      openSettings: string;
    }>;
    runErrors: Readonly<{
      providerAuthFailed: string;
      providerMissingKey: string;
      providerRateLimited: string;
      providerUnreachable: string;
      providerModelUnavailable: string;
      floretEngineFailed: string;
    }>;
    messageErrorTitle: string;
    messageErrorFallback: string;
    copyCode: string;
    codeCopied: string;
    copyMessage: string;
    messageCopied: string;
    loadErrorTitle: string;
    threadLoadErrorTitle: string;
    threadLoading: string;
    composerErrorTitle: string;
    toolStatuses: Readonly<Record<'pending' | 'running' | 'waiting' | 'success' | 'error' | 'canceled', string>>;
    toolApprovalRequired: string;
    toolApprovalStates: Readonly<Record<FlowerActivityApprovalState, string>>;
    toolApprovalState: (state: string) => string;
    toolApprovalApprove: string;
    toolApprovalReject: string;
    toolApprovalSubmitting: string;
    toolApprovalUnavailable: string;
    inputRequestTitle?: string;
    inputRequestDescription?: string;
    inputRequestSubmit?: string;
    inputRequestRetry?: string;
    inputRequestAnswerRequired?: string;
    inputRequestSubmitting?: string;
    inputRequestComposerPlaceholder?: string;
    inputRequestChoicePlaceholder?: string;
    conversationsAria: string;
    resizeConversationsLabel: string;
    entryLabel: string;
    newChat: string;
  }>;
  threadList: FlowerThreadListCopy;
  emptyState: FlowerEmptyStateCopy;
  settings: FlowerSettingsCopy;
}>;

export const DEFAULT_FLOWER_SURFACE_COPY: FlowerSurfaceCopy = {
  chat: {
    loadingSettings: 'Flower settings are still loading.',
    configureProviderBeforeChat: 'Set up a model provider to start chatting.',
    enterMessageBeforeSending: 'Enter a message before sending.',
    titleFallback: 'Ask Flower',
    ready: 'Ready',
    setupNeeded: 'Set up Flower',
    settingsLabel: 'Flower settings',
    needsProviderNotice: 'Choose a provider, model, and API key once. Flower uses the same Local AI Profile from Welcome and Local Environment.',
    openSettings: 'Open Settings',
    placeholder: 'Ask Flower anything...',
    fromSource: (source) => `From ${source}`,
    modelLabel: 'Model',
    noModelSelected: 'No model selected',
    linkedContextLabel: 'Linked context',
    handlerBlockedTitle: 'Flower needs attention',
    handlerStartFailedTitle: 'Flower could not start',
    handlerStillStarting: 'Flower is still starting.',
    handlerRetry: 'Retry',
    send: 'Send',
    runErrorTitle: 'Flower could not finish this reply.',
    runErrorActions: {
      updateAPIKey: 'Update API key',
      addAPIKey: 'Add API key',
      switchModel: 'Switch model',
      openSettings: 'Open settings',
    },
    runErrors: {
      providerAuthFailed: 'The selected AI provider rejected the saved credentials. Open Settings and update the Local AI Profile key.',
      providerMissingKey: 'The selected AI provider is missing an API key. Open Settings and complete the Local AI Profile.',
      providerRateLimited: 'The selected AI provider is rate limiting this request. Try again after the provider limit resets.',
      providerUnreachable: 'The selected AI provider could not be reached. Check the provider endpoint and network connection.',
      providerModelUnavailable: 'The selected model is not available from this provider. Choose another model in the Local AI Profile.',
      floretEngineFailed: 'Flower could not finish this turn because the orchestration engine failed.',
    },
    messageErrorTitle: 'Message failed',
    messageErrorFallback: 'This message failed before Flower produced visible text.',
    copyCode: 'Copy code',
    codeCopied: 'Copied',
    copyMessage: 'Copy message',
    messageCopied: 'Copied',
    loadErrorTitle: 'Flower could not load.',
    threadLoadErrorTitle: 'Conversation could not load.',
    threadLoading: 'Loading conversation...',
    composerErrorTitle: 'Flower could not send.',
    toolStatuses: {
      pending: 'Pending',
      running: 'Running',
      waiting: 'Waiting',
      success: 'Done',
      error: 'Failed',
      canceled: 'Canceled',
    },
    toolApprovalRequired: 'Approval required',
    toolApprovalStates: {
      requested: 'Requested',
      approved: 'Approved',
      rejected: 'Rejected',
      timed_out: 'Timed out',
      canceled: 'Canceled',
    },
    toolApprovalState: (state) => `Approval: ${state}`,
    toolApprovalApprove: 'Approve',
    toolApprovalReject: 'Reject',
    toolApprovalSubmitting: 'Submitting...',
    toolApprovalUnavailable: 'Approval is no longer available.',
    inputRequestTitle: 'Waiting for your reply',
    inputRequestDescription: 'Reply in the composer to continue this conversation.',
    inputRequestSubmit: 'Continue',
    inputRequestRetry: 'Retry',
    inputRequestAnswerRequired: 'Answer the waiting prompt before continuing.',
    inputRequestSubmitting: 'Submitting...',
    inputRequestComposerPlaceholder: 'Reply to continue this conversation.',
    inputRequestChoicePlaceholder: 'Choose an option to continue.',
    conversationsAria: 'Flower conversations',
    resizeConversationsLabel: 'Resize conversations',
    entryLabel: 'Flower',
    newChat: 'New chat',
  },
  threadList: {
    title: 'Conversations',
    description: 'Created-time order stays stable while conversations update.',
    refreshLabel: 'Refresh conversations',
    searchPlaceholder: 'Search conversations...',
    empty: 'No conversations yet.',
    untitled: 'Untitled chat',
    working: 'Working',
    unread: 'Unread',
    deleteLabel: (title) => `Delete ${title}`,
    contextMenuLabel: (title) => `Actions for ${title}`,
    copyThreadID: 'Copy thread id',
    copyWorkingDirectory: 'Copy work directory',
    threadIDLabel: 'thread id',
    workingDirectoryLabel: 'work directory',
    copied: (label) => `Copied ${label}.`,
    fork: 'Fork',
    pin: 'Pin conversation',
    unpin: 'Unpin conversation',
    pinnedGroup: 'Pinned',
    pinnedBadge: 'Pinned',
    rename: 'Rename',
    renameTitle: 'Rename conversation',
    renameNameLabel: 'Name',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving...',
    now: 'now',
    minutes: (count) => `${count}m`,
    hours: (count) => `${count}h`,
    days: (count) => `${count}d`,
    statuses: {
      idle: 'Idle',
      running: 'Running',
      waiting_user: 'Waiting for input',
      waiting_approval: 'Waiting for approval',
      failed: 'Failed',
      success: 'Done',
      canceled: 'Canceled',
      read_only: 'Read only',
    },
    groups: {
      today: 'Today',
      yesterday: 'Yesterday',
      this_week: 'This week',
      older: 'Older',
    },
  },
  emptyState: {
    title: 'Ask Flower',
    description: 'Flower uses your Local AI Profile, inspects remembered environments, and prepares actions before runtimes do any read or write.',
    suggestions: [
      {
        title: 'Review a workspace',
        description: 'Ask Flower to inspect a project, summarize risks, and suggest next steps.',
        prompt: 'Review the selected workspace and tell me the highest-value next step.',
      },
      {
        title: 'Plan a transfer',
        description: 'Let Flower prepare a cross-environment transfer plan before any write happens.',
        prompt: 'Prepare a safe transfer plan for the current selection.',
      },
      {
        title: 'Explain code',
        description: 'Send files or folders and ask Flower to explain the architecture.',
        prompt: 'Explain the architecture of the selected code and call out the key boundaries.',
      },
      {
        title: 'Polish a workflow',
        description: 'Turn a rough operational idea into a concrete, auditable checklist.',
        prompt: 'Turn this workflow into a concrete checklist with verification steps.',
      },
    ],
    sendKeyLabel: 'send',
    newLineKeyLabel: 'new line',
  },
  settings: {
    title: 'Flower Settings',
    backToChat: 'Back to chat',
    description: 'Configure models and execution policy for the Local AI Profile.',
    currentModel: 'Current model',
    noModelSelected: 'No model selected',
    text: 'Text',
    imageInput: 'Image input',
    selectModelPlaceholder: 'Select model',
    userApprovalTitle: 'User approval',
    userApprovalDescription: 'Ask before sensitive runtime actions.',
    on: 'On',
    off: 'Off',
    dangerousCommandsTitle: 'Dangerous commands',
    dangerousCommandsDescription: 'Reject destructive terminal operations by policy.',
    blocked: 'Blocked',
    allowed: 'Allowed',
    providersTitle: 'Providers',
    providersDescription: 'Provider cards show the Local AI Profile model sources and capability details.',
    managedByLocalAIProfileTitle: 'Local AI Profile on this Mac',
    managedByLocalAIProfileDescription: 'Model calls are handled by Desktop from the Local AI Profile. Files, terminal, Git, and workspace actions still run in the selected runtime.',
    managedByLocalAIProfileReady: 'Ready',
    managedByLocalAIProfileNeedsKey: 'Needs local key',
    managedByLocalAIProfileModelCount: (count) => `${count} model${count === 1 ? '' : 's'}`,
    managedByLocalAIProfileMissingKeys: (providers) => `Missing local keys: ${providers}`,
    managedByLocalAIProfileOpenLocal: 'Open Local Environment Settings on this Mac to change providers, models, or keys.',
    addProvider: 'Add provider',
    noProviders: 'No providers yet. Add OpenAI, Anthropic, Kimi, ChatGLM, DeepSeek, Qwen, or a OpenAI-compatible endpoint.',
    defaultProvider: 'Default',
    editProvider: 'Edit provider',
    removeProvider: 'Remove provider',
    apiKey: 'API Key',
    ready: 'Ready',
    needsKey: 'Needs key',
    models: 'Models',
    web: 'Web',
    vision: 'Vision',
    terminalLimitsTitle: 'Terminal execution limits',
    terminalLimitsDescription: 'Timeouts are enforced before a connected runtime executes commands.',
    defaultTimeout: 'Default timeout (ms)',
    maximumTimeout: 'Maximum timeout (ms)',
    dangerousBlockingOff: 'Dangerous command blocking is currently off.',
    webSearchNotSupported: 'Not supported',
    webSearchDisabled: 'Disabled',
    openAIBuiltIn: 'OpenAI built-in',
    braveSearch: 'Brave Search',
    needsBraveKey: 'Needs Brave key',
    providerTypeLabels: localizedFlowerProviderTypeLabels('en-US'),
    builtInWebSearch: {
      openai: 'OpenAI built-in web search',
      moonshot: 'Kimi built-in web search',
      chatglm: 'GLM built-in web search',
      deepseek: 'DeepSeek built-in web search',
      qwen: 'Qwen built-in web search',
    },
    autoSave: {
      saving: 'Saving',
      saveFailed: 'Save failed',
      unsaved: 'Unsaved',
      saved: 'Saved',
      ready: 'Ready',
    },
    validation: {
      providerIDRequired: 'Provider ID is required.',
      providerIDNoSlash: 'Provider ID must not contain a slash.',
      duplicateProviderID: (providerID) => `Duplicate provider ID: ${providerID}`,
      providerRequiresBaseURL: (providerName) => `${providerName} requires a base URL.`,
      providerInvalidBaseURL: (providerName) => `${providerName} has an invalid base URL.`,
      providerBaseURLProtocol: (providerName) => `${providerName} base URL must use http or https.`,
      providerNeedsModel: (providerName) => `${providerName} needs at least one model.`,
      providerUnnamedModel: (providerName) => `${providerName} has an unnamed model.`,
      modelNameNoSlash: 'Model names must not contain a slash.',
      duplicateModel: (providerName, modelName) => `${providerName} has a duplicate model: ${modelName}.`,
      modelNeedsContextWindow: (modelName) => `${modelName} needs a context window.`,
      selectCurrentModel: 'Select a current model before saving Flower settings.',
      currentModelUnavailable: (modelID) => `Current model is not available: ${modelID}.`,
      terminalTimeoutPositive: 'Terminal execution timeouts must be positive millisecond values.',
      terminalTimeoutOrder: 'Default terminal timeout must be less than or equal to the maximum timeout.',
    },
    dialog: {
      addTitle: 'Add provider',
      editTitle: 'Edit provider',
      discard: 'Discard',
      saveProvider: 'Save provider',
      providerRemoved: 'Provider was removed.',
      providerTypeTitle: 'Provider type',
      providerTypeDescription: 'Choose the native provider or custom OpenAI-compatible endpoint Flower should use.',
      current: 'Current',
      collapse: 'Collapse',
      configure: 'Configure',
      providerTypeLabels: localizedFlowerProviderTypeLabels('en-US'),
      providerTypeHints: {
        openai: 'Native connection',
        anthropic: 'Native connection',
        moonshot: 'Native connection',
        chatglm: 'Native connection',
        deepseek: 'Native connection',
        qwen: 'Native connection',
        openai_compatible: 'Custom endpoint',
      },
      connectionTitle: 'Connection',
      connectionDescription: 'Credentials and endpoints are stored with the Local AI Profile.',
      connectionName: 'Connection name',
      apiKey: 'API key',
      storedKeyKept: 'Stored key will be kept',
      requiredBeforeUse: 'Required before use',
      pasteAPIKey: 'Paste API key',
      required: 'Required',
      baseURL: 'Base URL',
      webSearch: 'Web search',
      disabled: 'Disabled',
      openAIBuiltIn: 'OpenAI built-in',
      braveSearch: 'Brave Search',
      requiredForBraveSearch: 'Required for Brave Search',
      braveAPIKey: 'Brave API key',
      storedBraveKeyKept: 'Stored Brave key will be kept',
      pasteBraveAPIKey: 'Paste Brave API key',
      keyReady: 'Key ready',
      needsKey: 'Needs key',
      braveKeyReady: 'Brave key ready',
      needsBraveKey: 'Needs Brave key',
      builtInWebSearch: {
        openai: 'OpenAI built-in web search',
        moonshot: 'Kimi built-in web search',
        chatglm: 'GLM built-in web search',
        deepseek: 'DeepSeek built-in web search',
        qwen: 'Qwen built-in web search',
      },
      recommendedModelsTitle: 'Recommended models',
      recommendedModelsDescription: 'Start from maintained presets, then fine tune limits in Advanced.',
      modelNote: (noteKey) => localizedFlowerProviderModelNote('en-US', noteKey),
      addAllPresets: 'Add all',
      customModelProvider: 'This provider uses custom model names.',
      contextSuffix: 'context',
      outputSuffix: 'output',
      add: 'Add',
      remove: 'Remove',
      text: 'Text',
      imageInput: 'Image input',
      selected: 'Selected',
      customModelPlaceholder: 'Custom model name',
      curatedPresetsOnly: 'Curated presets only',
      addCustomModel: 'Add custom model',
      selectedModelsTitle: 'Selected models',
      selectedModelsDescription: 'These models can be selected as the current Flower model.',
      noSelectedModels: 'No selected models.',
      unnamedModel: 'Unnamed model',
      textAndImage: 'Text + Image',
      textOnly: 'Text only',
      modelIDPending: 'Model ID pending',
      advancedTitle: 'Advanced model metadata',
      advancedDescription: 'Edit context windows, output limits, model names, and image input flags.',
      show: 'Show',
      hide: 'Hide',
      providerIDPending: 'Provider ID pending',
      modelName: 'Model name',
      contextWindow: 'Context window',
      maxOutput: 'Max output',
      effectiveContextPercent: 'Effective context %',
    },
  },
};
