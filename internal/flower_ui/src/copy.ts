import type { FlowerActivityApprovalState, FlowerPermissionType, FlowerProviderType, FlowerThreadStatus } from './contracts/flowerSurfaceContracts';
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
  warmupDescription: string;
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
  defaultPermissionTitle: string;
  defaultPermissionDescription: string;
  defaultPermissionBadge: string;
  permissionTypes: Readonly<Record<FlowerPermissionType, Readonly<{
    label: string;
    description: string;
  }>>>;
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
  webSearchNotSupported: string;
  webSearchDisabled: string;
  openAIBuiltIn: string;
  braveSearch: string;
  needsBraveKey: string;
  providerTypeLabels: FlowerProviderTypeLabels;
  builtInWebSearch: Readonly<Partial<Record<FlowerProviderType, string>>>;
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
  builtInWebSearch: Readonly<Partial<Record<FlowerProviderType, string>>>;
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
  providerModelID: string;
  contextWindow: string;
  maxOutput: string;
  effectiveContextPercent: string;
}>;

export type FlowerSubagentsCopy = Readonly<{
  title: string;
  description: string;
	openLabel: string;
	openThread: string;
	backToChat: string;
	emptyTitle: string;
  emptyDescription: string;
  activeLabel: string;
  completedLabel: string;
  threadIDLabel: string;
  lastMessageLabel: string;
  loadMore?: string;
  loadingMore?: string;
  unavailableThread: string;
  readOnlyComposerLabel: string;
  statusLabels: Readonly<Record<'queued' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'canceled' | 'timed_out' | 'unknown', string>>;
  typeLabels: Readonly<Record<'explore' | 'worker' | 'reviewer' | 'unknown', string>>;
  activity: Readonly<{
    actions: Readonly<Record<'spawn' | 'send_input' | 'wait' | 'list' | 'inspect' | 'close' | 'close_all' | 'unknown', string>>;
    titleVerbs: Readonly<Record<'spawn' | 'send_input' | 'wait' | 'list' | 'inspect' | 'close' | 'close_all', string>>;
    labels: Readonly<Record<'approval' | 'action' | 'status' | 'thread' | 'subagent' | 'task' | 'title' | 'profile' | 'target' | 'targets' | 'ids' | 'accepted' | 'closed' | 'affected' | 'agents' | 'total' | 'runningOnly' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled' | 'timedOut' | 'requested' | 'found' | 'missing' | 'missingIds' | 'lastMessage' | 'waitingPrompt' | 'canSendInput' | 'canInterrupt' | 'canClose' | 'runtime' | 'summary' | 'details' | 'errorCode' | 'errorMessage' | 'retryable', string>>;
    values: Readonly<Record<'yes' | 'no', string>>;
    agentsCount: (count: string) => string;
  }>;
}>;

export type FlowerSurfaceCopy = Readonly<{
  chat: Readonly<{
    loadingSettings: string;
    warmupTitle: string;
    warmupDetail: string;
    warmupComposerPlaceholder: string;
    warmupModelLabel: string;
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
    stop: string;
    compactContext: string;
    compactChooseThread: string;
    compactFinishInputRequest: string;
    compactNeedsConversation: string;
    commandMenuLabel: string;
    commandCompactContext: string;
    pendingSending: string;
    pendingQueued: string;
    scrollToLatest: string;
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
      runtimeRestarted: string;
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
    modelStatus: Readonly<{
      preparing: string;
      waitingResponse: string;
      streaming: string;
      retrying: string;
      finalizing: string;
    }>;
    contextIndicator: Readonly<{
      label: string;
      stable: string;
      nearThreshold: string;
      willCompact: string;
      hardLimit: string;
      estimated: string;
      unknown: string;
      unknownPercent: string;
      unavailable: string;
      usedLabel: string;
      ratioLabel: string;
      thresholdLabel: string;
      safeLimitLabel: string;
      statusLabel: string;
      usage: (used: string, total: string) => string;
      percent: (percent: number) => string;
    }>;
    compactionDivider: Readonly<{
      compacting: string;
      compacted: string;
      failed: string;
      cancelled: string;
      fallback: string;
      tokenChange: (before: string, after: string) => string;
    }>;
    toolStatuses: Readonly<Record<'pending' | 'running' | 'waiting' | 'success' | 'error' | 'canceled', string>>;
    toolApprovalRequired: string;
    toolApprovalStates: Readonly<Record<FlowerActivityApprovalState, string>>;
    toolApprovalState: (state: string) => string;
    toolApprovalApprove: string;
    toolApprovalReject: string;
    toolApprovalSubmitting: string;
    toolApprovalUnavailable: string;
    toolApprovalCommand: string;
    toolApprovalCommandText: string;
    toolApprovalShowCommand: string;
    toolApprovalCopy: string;
    toolApprovalCopyCommand: string;
    toolApprovalCopyCwd: string;
    toolApprovalCopied: string;
    toolApprovalSubtaskSuffix: (subagentID: string) => string;
    toolApprovalApproveAction: (label: string, subtaskSuffix: string) => string;
    toolApprovalRejectAction: (label: string, subtaskSuffix: string) => string;
    threadApprovalPanelLabel: string;
    threadApprovalPanelTitle: (count: number) => string;
    delegatedApprovalStatus: Readonly<{
      unavailable: string;
      pending: string;
      delivered: string;
      failed: string;
      handledInCurrentThread: string;
      deliveryInProgress: string;
      deliveryDelivered: string;
      deliveryNeedsReview: string;
    }>;
    readOnlyComposerLabel?: string;
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
  subagents?: FlowerSubagentsCopy;
}>;

export const DEFAULT_FLOWER_SURFACE_COPY: FlowerSurfaceCopy = {
  chat: {
    loadingSettings: 'Flower settings are still loading.',
    warmupTitle: 'Preparing Flower',
    warmupDetail: 'Desktop is starting the Local Environment runtime before Flower loads conversations.',
    warmupComposerPlaceholder: 'Preparing Flower on Local Environment...',
    warmupModelLabel: 'Loading Local AI Profile...',
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
    stop: 'Stop',
    compactContext: 'Compact context',
    compactChooseThread: 'Choose a conversation before compacting context.',
    compactFinishInputRequest: 'Finish the current input request before compacting context.',
    compactNeedsConversation: 'There is no context to compact yet.',
    commandMenuLabel: 'Flower commands',
    commandCompactContext: 'Compact current context',
    pendingSending: 'Sending',
    pendingQueued: 'Queued',
    scrollToLatest: 'Scroll to latest',
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
      runtimeRestarted: 'The local runtime restarted before this reply finished. Start a new reply when the runtime is ready.',
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
    modelStatus: {
      preparing: 'Preparing model request...',
      waitingResponse: 'Waiting for model response...',
      streaming: 'Thinking...',
      retrying: 'Retrying model request...',
      finalizing: 'Finalizing reply...',
    },
    contextIndicator: {
      label: 'Context',
      stable: 'Stable',
      nearThreshold: 'Near limit',
      willCompact: 'Compacting soon',
      hardLimit: 'At limit',
      estimated: 'Estimated',
      unknown: 'Tracking',
      unknownPercent: '--%',
      unavailable: 'Not available',
      usedLabel: 'Used',
      ratioLabel: 'Usage',
      thresholdLabel: 'Compaction threshold',
      safeLimitLabel: 'Request safe limit',
      statusLabel: 'Status',
      usage: (used, total) => `${used} of ${total}`,
      percent: (percent) => `${percent}%`,
    },
    compactionDivider: {
      compacting: 'Compacting context',
      compacted: 'Context compacted',
      failed: 'Context compaction failed',
      cancelled: 'Context compaction cancelled',
      fallback: 'Context checkpoint',
      tokenChange: (before, after) => `${before} to ${after}`,
    },
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
    toolApprovalCommand: 'Command',
    toolApprovalCommandText: 'Command text',
    toolApprovalShowCommand: 'Show command',
    toolApprovalCopy: 'Copy',
    toolApprovalCopyCommand: 'Copy command',
    toolApprovalCopyCwd: 'Copy cwd',
    toolApprovalCopied: 'Copied',
    toolApprovalSubtaskSuffix: (subagentID) => ` for subtask ${subagentID}`,
    toolApprovalApproveAction: (label, subtaskSuffix) => `Approve ${label}${subtaskSuffix}`,
    toolApprovalRejectAction: (label, subtaskSuffix) => `Reject ${label}${subtaskSuffix}`,
    threadApprovalPanelLabel: 'Current thread confirmations',
    threadApprovalPanelTitle: (count) => `Current thread has ${count} subtask confirmation${count === 1 ? '' : 's'}`,
    delegatedApprovalStatus: {
      unavailable: 'This subtask confirmation is no longer available. The operation was not released from this approval surface.',
      pending: 'Your decision is recorded and is being delivered to the subtask. This does not mean the tool has run yet.',
      delivered: 'Your decision was delivered to the subtask. Tool execution status comes from the subtask activity.',
      failed: 'Your decision was recorded, but delivery could not be confirmed. This thread will show any child activity it can observe.',
      handledInCurrentThread: 'Confirmation is handled in the current thread waiting area.',
      deliveryInProgress: 'Decision delivery in progress.',
      deliveryDelivered: 'Decision delivered.',
      deliveryNeedsReview: 'Delivery status needs review.',
    },
    readOnlyComposerLabel: 'Read only · Managed by parent thread',
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
    warmupDescription: 'Loading after the Local Environment runtime is ready.',
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
  subagents: {
    title: 'Subagents',
    description: 'Delegated work managed inside the current Flower conversation.',
	    openLabel: 'Open subagents',
	    openThread: 'View details',
	    backToChat: 'Back to chat',
	    emptyTitle: 'No subagents yet',
    emptyDescription: 'When Flower delegates work, subagents will appear here with status and handoff details.',
    activeLabel: 'Active',
    completedLabel: 'Ended',
    threadIDLabel: 'Thread',
    lastMessageLabel: 'Latest handoff',
    loadMore: 'Load more',
    loadingMore: 'Loading...',
    unavailableThread: 'Thread not available',
    readOnlyComposerLabel: 'Read only · Managed by parent thread',
    statusLabels: {
      queued: 'Queued',
      running: 'Running',
      waiting_input: 'Waiting input',
      completed: 'Completed',
      failed: 'Failed',
      canceled: 'Canceled',
      timed_out: 'Timed out',
      unknown: 'Unknown',
    },
    typeLabels: {
      explore: 'Explore',
      worker: 'Worker',
      reviewer: 'Reviewer',
      unknown: 'Subagent',
    },
    activity: {
      actions: {
        spawn: 'Spawn subagent',
        send_input: 'Steer subagent',
        wait: 'Wait for subagents',
        list: 'List subagents',
        inspect: 'Inspect subagents',
        close: 'Close subagent',
        close_all: 'Close subagents',
        unknown: 'Subagents',
      },
      titleVerbs: {
        spawn: 'Spawn',
        send_input: 'Steer',
        wait: 'Wait',
        list: 'List',
        inspect: 'Inspect',
        close: 'Close',
        close_all: 'Close',
      },
      labels: {
        approval: 'approval',
        action: 'action',
        status: 'result status',
        thread: 'thread',
        subagent: 'subagent',
        task: 'task',
        title: 'title',
        profile: 'profile',
        target: 'target',
        targets: 'targets',
        ids: 'ids',
        accepted: 'accepted',
        closed: 'closed',
        affected: 'affected',
        agents: 'agents',
        total: 'total',
        runningOnly: 'running only',
        queued: 'queued',
        running: 'running',
        waiting: 'waiting',
        completed: 'completed',
        failed: 'failed',
        canceled: 'canceled',
        timedOut: 'timed out',
        requested: 'requested',
        found: 'found',
        missing: 'missing',
        missingIds: 'missing ids',
        lastMessage: 'last message',
        waitingPrompt: 'waiting prompt',
        canSendInput: 'can send input',
        canInterrupt: 'can interrupt',
        canClose: 'can close',
        runtime: 'runtime',
        summary: 'summary',
        details: 'details',
        errorCode: 'error code',
        errorMessage: 'error message',
        retryable: 'retryable',
      },
      values: {
        yes: 'Yes',
        no: 'No',
      },
      agentsCount: (count) => `${count} agents`,
    },
  },
  settings: {
    title: 'Flower Settings',
    backToChat: 'Back to chat',
    description: 'Configure models and the default Flower permission for the Local AI Profile.',
    currentModel: 'Current model',
    noModelSelected: 'No model selected',
    text: 'Text',
    imageInput: 'Image input',
    selectModelPlaceholder: 'Select model',
    defaultPermissionTitle: 'Default permission',
    defaultPermissionDescription: 'Applies to new Flower threads. Existing threads keep their own permission.',
    defaultPermissionBadge: 'Default',
    permissionTypes: {
      readonly: {
        label: 'Read only',
        description: 'Safe read tools, search, todos, ask, and delegated subagents. No shell or file edits.',
      },
      approval_required: {
        label: 'Approval required',
        description: 'Standard tools and subagent orchestration stay available. Child tasks inherit this permission, so shell, file changes, and child tool approvals ask before running; readonly-only helpers are hidden.',
      },
      full_access: {
        label: 'Full access',
        description: 'Standard tools and subagent orchestration run without per-tool confirmation. Child tasks inherit this permission, while timeouts, limits, and audit still apply; readonly-only helpers are hidden.',
      },
    },
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
    noProviders: 'No providers yet. Add OpenAI, Anthropic, Kimi, ChatGLM, DeepSeek, Qwen, OpenRouter, xAI, Groq, Ollama, or a custom endpoint.',
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
        openrouter: 'Dynamic model metadata',
        xai: 'OpenAI-compatible native endpoint',
        groq: 'OpenAI-compatible native endpoint',
        ollama: 'Local OpenAI-compatible endpoint',
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
      providerModelID: 'Provider model ID',
      contextWindow: 'Context window',
      maxOutput: 'Max output',
      effectiveContextPercent: 'Effective context %',
    },
  },
};
