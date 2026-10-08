import { extensionI18n, type ExtensionI18n } from './extensions/context';
import { markdownMediaEnUS, type FlowerMarkdownMediaCopy } from './chat/markdown/mediaCopy';
import { toolActivityEnUS, type FlowerToolActivityCopy } from './toolActivityCopy';
import { computerUseEnUS, type FlowerComputerCopy } from './computerUseCopy';
import { reasoningControlEnUS, type ReasoningControlCopy } from './i18n/reasoningControlMessages';
import { modelCatalogCopy, type ModelCatalogCopy } from './settings/modelCatalogCopy';
import type { FilesystemPickerCopy } from './filePicker/filesystemPicker';
import { filesystemPickerEnUS } from './i18n/filesystemPickerMessages';
import type { FlowerActivityApprovalState, FlowerPermissionType, FlowerProviderType, FlowerThreadStatus } from './contracts/flowerSurfaceContracts';
import type { FlowerProviderModelNoteKey } from './settings/providerModelNotes';
import { localizedFlowerProviderModelNote } from './settings/providerModelNotes';
import type { FlowerProviderTypeLabels } from './settings/providerTypeLabels';
import { localizedFlowerProviderTypeLabels } from './settings/providerTypeLabels';

export type FlowerWebSearchCopy = Readonly<{
 search: string; openPage: string; findInPage: string; webActivity: string;
 noDetails: string; noSources: string; sourcesUnavailable: string;
 sourcesTitle: string; queryLabel: string; targetLabel: string; patternLabel: string;
 sources: (count: number) => string; queries: (count: number) => string;
 showMore: (count: number) => string; showLess: string;
}>;

export type FlowerThreadTimeGroup = 'today' | 'yesterday' | 'this_week' | 'older';

export type FlowerEmptyStateSuggestionCopy = Readonly<{
  title: string;
  description: string;
  prompt: string;
}>;

export type FlowerEmptyStateCopy = Readonly<{
  suggestionsLabel: string;
  moreSuggestions: string;
  fewerSuggestions: string;
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
  stopping: string;
  unread: string;
  stop: string;
  deleteMenuAction: string;
  deleteDialogTitle: string;
  deleteDialogDescription: (title: string) => string;
  deleteDialogActiveDescription: string;
  deleteDialogWorkspaceDescription: string;
  deleteConfirm: string;
  deleteCommittedNotification: string;
  deletePendingNotification: string;
  deleteFailedNotification: string;
  contextMenuLabel: (title: string) => string;
  copyThreadID: string;
  copyWorkingDirectory: string;
  browseWorkingDirectory: string;
  openTerminalInWorkingDirectory: string;
  copySelectedText: string;
  workingDirectoryUnavailable: string;
  browseWorkingDirectoryReadDenied: string;
  workingDirectoryTerminalDenied: string;
  workingDirectoryDisconnected: string;
  threadIDLabel: string;
  workingDirectoryLabel: string;
  copied: (label: string) => string;
  fork: string;
  forkSuffix: string;
  forkCreating: string;
  forkCreated: string;
  forkLoadFailed: string;
  dragPinned: string;
  movePinnedUp: string;
  movePinnedDown: string;
  clearSearchToReorder: string;
  pinUpdateFailed: string;
  pinRefreshFailed: string;
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
  reasoningControl: ReasoningControlCopy;
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
  computerUseTitle: string;
	computerUseLabel: string;
  connectBrowserTitle: string;
  connectBrowserPlaceholder: string;
  connectBrowser: string;
  connectingBrowser: string;
  connectBrowserEmpty: string;
  connectBrowserFailed: string;
  permissionTypes: Readonly<Record<FlowerPermissionType, Readonly<{
    label: string;
    description: string;
  }>>>;
  providersTitle: string;
  providersDescription: string;
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
  webSearchNotSupported: string;
  webSearchDisabled: string;
  openAIBuiltIn: string;
  braveSearch: string;
  needsBraveKey: string;
  providerTypeLabels: FlowerProviderTypeLabels;
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
  }>;
  dialog: FlowerProviderDialogCopy;
}>;

export type FlowerProviderDialogCopy = Readonly<{
  catalog: ModelCatalogCopy;
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
  detailTimelineLabel: string;
  detailInstructionLabel: string;
  detailConstraintsLabel: string;
  detailAnalysisLabel: string;
  detailActivityLabel: (count: number) => string;
  detailOutcomeLabel: string;
  detailRetry: string;
  feedbackClose: string;
  unavailableThread: string;
  readOnlyComposerLabel: string;
  statusLabels: Readonly<Record<'queued' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'canceled' | 'timed_out' | 'unknown', string>>;
  typeLabels: Readonly<Record<'explore' | 'worker' | 'reviewer' | 'unknown', string>>;
  activity: Readonly<{
    actions: Readonly<Record<'spawn' | 'send_input' | 'wait' | 'list' | 'inspect' | 'close' | 'close_all' | 'unknown', string>>;
    titles: Readonly<{
      operation: string;
      failed: string;
      timedOut: string;
      needsInput: string;
      starting: string;
      started: string;
      createFailed: string;
      waiting: (count: string) => string;
      completed: (count: string) => string;
      waitTimedOut: (completed: string, count: string) => string;
    }>;
    labels: Readonly<Record<'approval' | 'action' | 'status' | 'thread' | 'subagent' | 'task' | 'title' | 'profile' | 'target' | 'targets' | 'ids' | 'accepted' | 'closed' | 'affected' | 'agents' | 'total' | 'runningOnly' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled' | 'timedOut' | 'requested' | 'found' | 'missing' | 'missingIds' | 'lastMessage' | 'waitingPrompt' | 'canSendInput' | 'canInterrupt' | 'canClose' | 'runtime' | 'summary' | 'details' | 'errorCode' | 'errorMessage' | 'retryable', string>>;
    values: Readonly<Record<'yes' | 'no', string>>;
    agentsCount: (count: string) => string;
  }>;
}>;

export type FlowerSurfaceCopy = Readonly<{
  extensions: ExtensionI18n;
  computer: FlowerComputerCopy;
  reasoningControl: ReasoningControlCopy;
  filesystemPicker: FilesystemPickerCopy;
  attachments: Readonly<{
    listLabel: string;
    add: string;
    retry: string;
    reselect: string;
    cancel: string;
    remove: string;
    restore: string;
    preview: string;
    copyReference: string;
    uploading: string;
    queued: string;
    ready: string;
    failed: string;
    incompatible: string;
    reselectRequired: string;
    errorTooLarge: string;
    errorCountExceeded: string;
    errorTotalSizeExceeded: string;
    errorUnsupported: string;
    errorInvalidEncoding: string;
    errorUploadFailed: string;
    errorUnavailable: string;
    lines: (count: number) => string;
    added: (name: string) => string;
    converted: (name: string) => string;
    uploaded: (name: string) => string;
    uploadFailedAnnouncement: (name: string) => string;
    unavailable: string;
    overLimit: (limit: number) => string;
    invalidText: string;
    restoreFailed: string;
    pendingDraft: string;
    modelSupportChecking: string;
    modelSupported: string;
    modelUnsupported: string;
    modelSupportUnavailable: string;
  }>;
  chat: Readonly<{
    media: FlowerMarkdownMediaCopy;
    restoredInputTitle: string;
    restoredInputDescription: string;
    restoredInputCopy: string;

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
    inputHistoryPosition: (position: number, total: number) => string;
    inputHistoryCleared: string;
    fromSource: (source: string) => string;
    modelLabel: string;
    reasoningLabel: string;
    reasoningLoading: string;
    noModelSelected: string;
    linkedContextLabel: string;
		truncatedLabel: string;
    permissionSelectorLabel: string;
    permissionSelectorSaving: string;
    permissionSelectorErrorTitle: string;
    terminalCommandActions: string;
    terminalWaitingOutput: string;
    terminalStartedNoOutput: string;
    terminalFinishedNoOutput: string;
    terminalNoOutput: string;
    terminalInputSent: string;
    terminalInputFailed: string;
    terminalInputPending: string;
    terminalStopped: string;
    terminalExitCode: (code: number) => string;
    terminalPartialOutput: string;
    terminalLiveOutputUnavailable: (error: string) => string;
    terminalTimedOut: string;
    terminalNoNewOutput: string;
    toolActivity: FlowerToolActivityCopy;
    toolActivityDetailsPending: string;
    toolActivityNoAdditionalDetails: string;
    toolActivityRunCommand: string;
    toolActivityReadCommandOutput: string;
    toolActivityWriteCommandInput: string;
    toolActivityTerminateCommand: string;
    webSearch: FlowerWebSearchCopy;
    toolActivityOpenWebPage: string;
	toolActivityExternalContentNotice: string;
    toolActivityComputerSuggestedAction: string;
    toolActivityComputerAvailableTargets: string;
	toolActivityPreviewTruncated: string;
	toolActivityDiffTruncated: string;
	toolActivityNoTextualDiff: string;
    handlerBlockedTitle: string;
    handlerStartFailedTitle: string;
    handlerStillStarting: string;
    computerViewLastScreenshot: string;
    computerResumeControl: string;
    computerStageTitle: string;
    computerStageMaximize: string;
    computerStageRestoreSize: string;
    computerStageZoomIn: string;
    computerStageZoomOut: string;
    computerStageRestore: string;
    computerStageStatus: Readonly<Record<'running' | 'awaiting_user' | 'completed' | 'failed' | 'taking_control' | 'user_control' | 'checking' | 'paused' | 'historical' | 'stopped' | 'disconnected' | 'awaiting_control', string>>;
    computerStageMove: string;
    computerStageClose: string;
    handlerRetry: string;
    send: string;
    stop: string;
    stopping: string;
    stopOutcomeUnknownTitle: string;
    stopOutcomeUnknownDescription: string;
    stopRequestFailed: string;
    commandMenuLabel: string;
    commandCompactContext: string;
    compactContext: string;
    compactContextBlocked: string;
    commandArgumentsInvalid: string;
    commandUnknown: (command: string) => string;
    composerMoreLabel: string;
    composerReferencesLabel: string;
    composerReferenceLoading: string;
    composerReferenceEmpty: string;
    composerReferenceError: string;
    composerReferenceBrowseDirectory: (name: string) => string;
    composerReferenceRemove: (path: string) => string;
    composerReferenceAdded: (path: string) => string;
    composerReferenceExists: (path: string) => string;
    pendingSending: string;
    pendingQueued: string;
    queuedSendNow: string;
    queuedDelete: string;
    scrollToLatest: string;
    runtimeRestartedDivider: string;
    runErrorTitle: string;
    runContextErrorTitle: string;
    runErrorDetails: string;
    runErrorCopyDetails: string;
    runContinuationErrorTitle: string;
    retryReply: string;
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
      providerStreamInterrupted: string;
      providerModelUnavailable: string;
      modelGatewayContractFailed: string;
      contextBudgetInvalid: string;
      contextFixedOverhead: string;
      contextCompactionLimit: string;
      floretEngineFailed: string;
      floretControlContractFailed: string;
      floretAuthorityConsistencyFailed: string;
      floretEffectOutcomeUnknown: string;
      runtimeRestarted: string;
    }>;
    messageErrorTitle: string;
    messageErrorFallback: string;
    copyCode: string;
    codeCopied: string;
    showFullCommand: string;
    hideFullCommand: string;
    copyCommand: string;
    commandCopied: string;
    copyMessage: string;
    messageCopied: string;
    loadErrorTitle: string;
    threadLoadErrorTitle: string;
    threadLoading: string;
    threadEmpty: string;
    threadSyncingLatest: string;
    threadSyncFailed: string;
    activeTurnBusy: string;
    composerErrorTitle: string;
    expandThinking: string;
    collapseThinking: string;
    modelStatus: Readonly<{
      preparing: string;
      waitingResponse: string;
      streaming: string;
      retrying: string;
      finalizing: string;
    }>;
    liveProgressTool: string;
    liveProgressOutput: string;
    contextIndicator: Readonly<{
      label: string;
      nearThreshold: string;
      willCompact: string;
      hardLimit: string;
      unknownPercent: string;
      unavailable: string;
      cacheHitLabel: string;
      percent: (percent: number) => string;
    }>;
    compactionDivider: Readonly<{
      compacting: string;
      compacted: string;
      failed: string;
      cancelled: string;
      noop: string;
      fallback: string;
      tokenChange: (before: string, after: string) => string;
    }>;
    projectionUnavailable: Readonly<{
      title: string;
      description: string;
    }>;
    toolStatuses: Readonly<Record<'pending' | 'running' | 'waiting' | 'success' | 'error' | 'declined' | 'canceled', string>>;
    toolCallCanceled: string;
    toolApprovalRejectedDetail: string;
    toolApprovalRequired: string;
    toolApprovalStates: Readonly<Record<FlowerActivityApprovalState, string>>;
    toolApprovalState: (state: string) => string;
    toolApprovalApprove: string;
    toolApprovalReject: string;
    toolApprovalSubmitting: string;
    toolApprovalUnavailable: string;
    toolApprovalComposerTitle: string;
    toolApprovalEditFile: string;
    toolApprovalRunCommand: string;
    toolApprovalAccessNetwork: string;
    toolApprovalExecuteRequestedAction: string;
    toolApprovalWorkingDirectoryDetail: (target: string) => string;
    toolApprovalComposerDescription: string;
    toolApprovalDetails: string;
    feedbackClose: string;
    toolApprovalScope: string;
    toolApprovalOnceScope: string;
    toolApprovalExpandCommand: string;
    toolApprovalHideCommand: string;
    toolApprovalEligibleCount: (count: number) => string;
    toolApprovalQueueCount: (count: number) => string;
    toolApprovalPendingCount: (count: number) => string;
    toolApprovalRejectBatch: (count: number) => string;
    toolApprovalRejectBatchAction: (count: number) => string;
    toolApprovalApproveBatch: (count: number) => string;
    toolApprovalApproveBatchAction: (count: number) => string;
    toolApprovalOutsideWorkspaceRisk: string;
    toolApprovalWritesFilesRisk: string;
    toolApprovalWorkingDirectory: string;
    toolApprovalCommand: string;
    toolApprovalCommandText: string;
    toolApprovalShowCommand: string;
    toolApprovalCopy: string;
    toolApprovalCopyCommand: string;
    toolApprovalCopyCwd: string;
    toolApprovalCopied: string;
    toolApprovalSubtaskSuffix: (childThreadID: string) => string;
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
    computerFrameRate: string;
    computerFrameRateHint: string;
    computerReceivedFrameRate: string;
    computerControlTaken: string;
    computerControlNotReady: string;
    computerTakeControl?: string;
    computerContinueCheck?: string;
    computerControlHint?: string;
    computerControlFailed?: string;
    inputRequestTitle?: string;
    inputRequestSubmit?: string;
    inputRequestRetry?: string;
    inputRequestAnswerRequired?: string;
    inputRequestAnswerHidden?: string;
    inputRequestPrevious?: string;
    inputRequestNext?: string;
    inputRequestComposerPlaceholder?: string;
    inputRequestChoicePlaceholder?: string;
    inputRequestOther?: string;
    inputRequestAnswered?: string;
    conversationsAria: string;
    resizeConversationsLabel: string;
    entryLabel: string;
    newChat: string;
    workingDirPickerHomeLabel: string;
    workingDirPickerTitle: string;
    workingDirPickerRecent: string;
    workingDirPickerConfirm: string;
  }>;
  threadList: FlowerThreadListCopy;
  emptyState: FlowerEmptyStateCopy;
  settings: FlowerSettingsCopy;
  subagents?: FlowerSubagentsCopy;
}>;

export const DEFAULT_FLOWER_SURFACE_COPY: FlowerSurfaceCopy = {
  extensions: extensionI18n(),
  computer: computerUseEnUS,
  reasoningControl: reasoningControlEnUS,
  filesystemPicker: { ...filesystemPickerEnUS, selectedCount: (count) => filesystemPickerEnUS.selectedCount.replace('{count}', String(count)) },
  attachments: {
    listLabel: 'Attachments',
    add: 'Add attachments',
    retry: 'Retry upload',
    reselect: 'Select file',
    cancel: 'Cancel upload',
    remove: 'Remove attachment',
    restore: 'Restore to editor',
    preview: 'Preview attachment',
    copyReference: 'Copy reference',
    uploading: 'Uploading',
    queued: 'Waiting to upload',
    ready: 'Ready',
    failed: 'Upload failed',
    incompatible: 'Not supported by this model',
    reselectRequired: 'Select the file again',
    errorTooLarge: 'This file is larger than the per-file limit.',
    errorCountExceeded: 'The attachment count limit has been reached.',
    errorTotalSizeExceeded: 'These attachments exceed the total size limit.',
    errorUnsupported: 'This file type is not supported by the selected model.',
    errorInvalidEncoding: 'This text file is not valid UTF-8.',
    errorUploadFailed: 'The upload failed. Try again.',
    errorUnavailable: 'Attachments are unavailable for the selected model.',
    lines: (count) => `${count.toLocaleString()} lines`,
    added: (name) => `${name} added.`,
    converted: (name) => `Long text converted to attachment ${name}.`,
    uploaded: (name) => `${name} uploaded.`,
    uploadFailedAnnouncement: (name) => `${name} upload failed.`,
    unavailable: 'Attachments are unavailable for the selected model.',
    overLimit: (limit) => `Text longer than ${limit.toLocaleString()} characters will be sent as an attachment.`,
    invalidText: 'This text contains invalid Unicode and cannot be attached.',
    restoreFailed: 'Flower could not restore this text attachment.',
    pendingDraft: 'Unsent draft preserved.',
    modelSupportChecking: 'Checking attachment support',
    modelSupported: 'Supports current attachments',
    modelUnsupported: 'Does not support current attachments',
    modelSupportUnavailable: 'Could not check attachment support',
  },
  chat: {
    media: markdownMediaEnUS,
    restoredInputTitle: 'Input preserved after restore',
    restoredInputDescription: 'This input will not run automatically. Copy it into a new task to run it again.',
    restoredInputCopy: 'Copy input',

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
    placeholder: 'Ask Flower...',
    inputHistoryPosition: (position, total) => `Previous input ${position} of ${total}. Use Up or Down to browse, or Escape to clear.`,
    inputHistoryCleared: 'Returned to empty input.',
    fromSource: (source) => `From ${source}`,
    modelLabel: 'Model',
    reasoningLabel: 'Reasoning',
    reasoningLoading: 'Loading reasoning setting…',
    noModelSelected: 'No model selected',
    linkedContextLabel: 'Linked context',
		truncatedLabel: 'Truncated',
    permissionSelectorLabel: 'Thread permission',
    permissionSelectorSaving: 'Saving permission...',
    permissionSelectorErrorTitle: 'Flower could not save permission.',
    terminalCommandActions: "Command actions",
    terminalWaitingOutput: "Waiting for output…",
    terminalStartedNoOutput: "Command started. No output returned yet.",
    terminalFinishedNoOutput: "Command finished without output.",
    terminalNoOutput: "No output returned.",
    terminalInputSent: "Input sent.",
    terminalInputFailed: "Input could not be sent.",
    terminalInputPending: "Waiting to send input…",
    terminalStopped: "Command stopped.",
    terminalExitCode: (code) => `Command exited with code ${code}.`,
    terminalPartialOutput: "Only part of the output is shown.",
    terminalLiveOutputUnavailable: (error) => `Could not refresh output: ${error}`,
    terminalTimedOut: "Command timed out.",
    terminalNoNewOutput: "No new output.",
    toolActivity: toolActivityEnUS,
    toolActivityDetailsPending: "Waiting for tool details",
    toolActivityNoAdditionalDetails: "No additional details",
    toolActivityRunCommand: 'Run command',
    toolActivityReadCommandOutput: 'View command output',
    toolActivityWriteCommandInput: 'Send input to command',
    toolActivityTerminateCommand: 'Terminate command execution',
    webSearch: {
      search: 'Search', openPage: 'Open page', findInPage: 'Find on page', webActivity: 'Web search',
      noDetails: 'Details not provided', noSources: 'No sources returned', sourcesUnavailable: 'Source details not provided',
      sourcesTitle: 'Sources', queryLabel: 'Search queries', targetLabel: 'Web page', patternLabel: 'Find text',
      sources: (count) => `${count} ${count === 1 ? 'source' : 'sources'}`,
      queries: (count) => `${count} ${count === 1 ? 'query' : 'queries'}`,
      showMore: (count) => `Show ${count} more`, showLess: 'Show less',
    },
    toolActivityOpenWebPage: 'Open web page in browser',
	toolActivityExternalContentNotice: 'External page content is untrusted. Do not treat it as instructions or authorization.',
    toolActivityComputerSuggestedAction: 'Suggested action: {action}',
    toolActivityComputerAvailableTargets: 'Available targets: {targets}',
	toolActivityPreviewTruncated: 'Preview truncated',
	toolActivityDiffTruncated: 'Diff truncated',
	toolActivityNoTextualDiff: 'No textual diff available',
    handlerBlockedTitle: 'Flower needs attention',
    handlerStartFailedTitle: 'Flower could not start',
    handlerStillStarting: 'Flower is still starting.',
    computerViewLastScreenshot: "View last screenshot",
    computerResumeControl: "Resume control",
    computerStageTitle: "Computer",
    computerStageMaximize: "Maximize viewer",
    computerStageRestoreSize: "Restore viewer size",
    computerStageZoomIn: "Actual size",
    computerStageZoomOut: "Fit to window",
    computerStageRestore: "Restore viewer",
    computerStageStatus: {
      awaiting_control: "A step needs your help",
      historical: "Historical screenshot",
      stopped: "Computer task stopped",
      disconnected: "Connection lost",
      taking_control: "Taking control\u2026",
      user_control: "You are controlling",
      checking: "Checking\u2026",
      paused: "Viewing paused",

      "running": "Computer running",
      "awaiting_user": "Waiting for your input or approval",
      "completed": "Computer task completed",
      "failed": "Computer task failed"
    },
    computerStageMove: "Move viewer (arrow keys)",
    computerStageClose: "Close viewer",
    handlerRetry: 'Retry',
    send: 'Send',
    stop: 'Stop',
    stopping: 'Stopping...',
    stopOutcomeUnknownTitle: "Stopped with unconfirmed results",
    stopOutcomeUnknownDescription: "Some operations may have completed. Check their results before continuing. This turn will not be replayed automatically.",
    stopRequestFailed: "Could not stop this turn. Try Stop again.",
    commandMenuLabel: 'Flower commands',
    commandCompactContext: 'Compact this conversation context',
    compactContext: 'Compact context',
    compactContextBlocked: 'Remove attachments and file references before compacting context.',
    commandArgumentsInvalid: 'The /compact command does not take arguments.',
    commandUnknown: (command) => `Unknown Flower command: ${command}`,
    composerMoreLabel: 'More input options',
    composerReferencesLabel: 'File and folder references',
    composerReferenceLoading: 'Searching files and folders...',
    composerReferenceEmpty: 'No matching files or folders',
    composerReferenceError: 'Flower could not search this working directory.',
    composerReferenceBrowseDirectory: (name) => `Browse folder ${name}`,
    composerReferenceRemove: (path) => `Remove reference ${path}`,
    composerReferenceAdded: (path) => `${path} referenced.`,
    composerReferenceExists: (path) => `${path} is already referenced.`,
    pendingSending: 'Sending',
    pendingQueued: 'Queued',
    queuedSendNow: 'Send now',
    queuedDelete: 'Delete queued message',
    scrollToLatest: 'Scroll to latest',
    runtimeRestartedDivider: 'Redeven runtime restarted',
    runErrorTitle: 'Flower could not finish this reply.',
    runContextErrorTitle: 'Model context limit',
    runErrorDetails: 'Technical details',
    runErrorCopyDetails: 'Copy details',
    runContinuationErrorTitle: 'Reply could not continue.',
    retryReply: 'Retry reply',
    runErrorActions: {
      updateAPIKey: 'Update API key',
      addAPIKey: 'Add API key',
      switchModel: 'Switch model',
      openSettings: 'Open settings',
    },
    runErrors: {
      contextBudgetInvalid: "The output allowance leaves no room for input. Increase the model's configured context window or lower its output limit, then retry. For Ollama, set num_ctx in the Modelfile and reload the model.",
      contextFixedOverhead: "The system instructions and tool definitions exceed the model's available context. Increase the serving context window or choose a model with more context, then retry. Compressing chat history cannot resolve this.",
      contextCompactionLimit: "The conversation still exceeds the model's context limit after compression. Shorten the input or choose a model with more context, then retry.",
      providerAuthFailed: 'The selected AI provider rejected the saved credentials. Open Settings and update the Local AI Profile key.',
      providerMissingKey: 'The selected AI provider is missing an API key. Open Settings and complete the Local AI Profile.',
      providerRateLimited: 'The selected AI provider is rate limiting this request. Try again after the provider limit resets.',
      providerUnreachable: 'The selected AI provider could not be reached. Check the provider endpoint and network connection.',
      providerStreamInterrupted: 'The selected AI provider ended the response stream unexpectedly. Try again, or check the provider endpoint if this keeps happening.',
      providerModelUnavailable: 'The selected model is not available from this provider. Choose another model in the Local AI Profile.',
      modelGatewayContractFailed: 'The model source returned an incomplete tool call. No tool was run. Try again or choose another model.',
      floretEngineFailed: 'Flower could not finish this turn because the orchestration engine failed.',
      floretControlContractFailed: 'Flower could not generate a valid question. The reply so far has been preserved. Retry to continue.',
      floretAuthorityConsistencyFailed: 'Flower could not finish this turn because the committed tool result could not be verified. The tool was not run again; start a new reply to continue.',
      floretEffectOutcomeUnknown: 'Some operations may have completed, but their results could not be confirmed. The task was stopped to avoid duplicate execution.',
      runtimeRestarted: 'The local runtime restarted before this reply finished. Start a new reply when the runtime is ready.',
    },
    messageErrorTitle: 'Message failed',
    messageErrorFallback: 'This message failed before Flower produced visible text.',
    copyCode: 'Copy code',
    codeCopied: 'Copied',
    showFullCommand: 'Show full command',
    hideFullCommand: 'Hide full command',
    copyCommand: 'Copy command',
    commandCopied: 'Command copied',
    copyMessage: 'Copy message',
    messageCopied: 'Copied',
    loadErrorTitle: 'Flower could not load.',
    threadLoadErrorTitle: 'Conversation could not load.',
    threadLoading: 'Loading conversation...',
    threadEmpty: 'This conversation has no content yet.',
    threadSyncingLatest: 'Syncing the latest reply...',
    threadSyncFailed: 'Flower could not sync the latest reply. Try again.',
    activeTurnBusy: 'The previous reply is still active. You can stop it before sending again.',
    composerErrorTitle: 'Flower could not send.',
    expandThinking: 'Expand full thinking',
    collapseThinking: 'Collapse thinking',
    modelStatus: {
      preparing: 'Preparing model request...',
      waitingResponse: 'Waiting for model response...',
      streaming: 'Thinking...',
      retrying: 'Retrying model request...',
      finalizing: 'Finalizing reply...',
    },
    liveProgressTool: 'Using a tool',
    liveProgressOutput: 'Writing the reply',
    contextIndicator: {
      label: 'Context',
      nearThreshold: 'Near limit',
      willCompact: 'Compacting soon',
      hardLimit: 'At limit',
      unknownPercent: '—',
      unavailable: 'Not available',
      cacheHitLabel: 'Cache hit rate',
      percent: (percent) => `${percent}%`,
    },
    compactionDivider: {
      compacting: 'Compacting context',
      compacted: 'Context compacted',
      failed: 'Context compaction failed',
      cancelled: 'Context compaction cancelled',
      noop: 'Context does not need compression',
      fallback: 'Context checkpoint',
      tokenChange: (before, after) => `${before} to ${after}`,
    },
    projectionUnavailable: {
      title: 'Response unavailable',
      description: 'The saved response for this turn could not be loaded.',
    },
    toolStatuses: {
      pending: 'Pending',
      running: 'Running',
      waiting: 'Waiting',
      success: 'Done',
      error: 'Failed',
      declined: 'Declined',
      canceled: 'Canceled',
    },
    toolCallCanceled: 'Tool call was canceled',
    toolApprovalRejectedDetail: 'User declined tool execution',
    toolApprovalRequired: 'Approval required',
    toolApprovalStates: {
      requested: 'Requested',
      approved: 'Approved',
      rejected: 'Rejected',
      timed_out: 'Timed out',
      canceled: 'Canceled',
    },
    toolApprovalState: (state) => `Approval: ${state}`,
    toolApprovalApprove: 'Allow once',
    toolApprovalReject: 'Reject',
    toolApprovalSubmitting: 'Submitting...',
    toolApprovalUnavailable: 'Approval is no longer available.',
    toolApprovalComposerTitle: 'Allow the following action?',
    toolApprovalEditFile: 'Edit file',
    toolApprovalRunCommand: 'Run command',
    toolApprovalAccessNetwork: 'Access network resource',
    toolApprovalExecuteRequestedAction: 'Execute requested action',
    toolApprovalWorkingDirectoryDetail: (target) => 'Working directory: ' + target,
    toolApprovalComposerDescription: 'The conversation is paused until you approve or reject this action.',
    toolApprovalDetails: 'View action details',
    feedbackClose: 'Close feedback',
    toolApprovalScope: 'Approval applies only to the listed actions.',
    toolApprovalOnceScope: 'This time only',
    toolApprovalExpandCommand: 'View full command',
    toolApprovalHideCommand: 'Collapse',
    toolApprovalEligibleCount: (count) => `Can approve · ${count}`,
    toolApprovalQueueCount: (count) => `${count} more approval${count === 1 ? '' : 's'} waiting`,
    toolApprovalPendingCount: (count) => `Approval required · ${count}`,
    toolApprovalRejectBatch: (count) => `Reject · ${count}`,
    toolApprovalRejectBatchAction: (count) => `Reject all ${count} pending tool approvals`,
    toolApprovalApproveBatch: (count) => `Allow once · ${count}`,
    toolApprovalApproveBatchAction: (count) => `Allow all ${count} pending tool approvals`,
    toolApprovalOutsideWorkspaceRisk: 'This action may access resources outside the workspace.',
    toolApprovalWritesFilesRisk: 'This action will modify files.',
    toolApprovalWorkingDirectory: 'Working directory',
    toolApprovalCommand: 'Command',
    toolApprovalCommandText: 'Command text',
    toolApprovalShowCommand: 'Show command',
    toolApprovalCopy: 'Copy',
    toolApprovalCopyCommand: 'Copy command',
    toolApprovalCopyCwd: 'Copy cwd',
    toolApprovalCopied: 'Copied',
    toolApprovalSubtaskSuffix: (childThreadID) => ` for subtask ${childThreadID}`,
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
    computerFrameRate: "Frame rate",
    computerFrameRateHint: "Higher frame rates use more bandwidth. Actual updates depend on your device and connection.",
    computerReceivedFrameRate: "Receiving {fps} FPS",
    computerControlTaken: "You have control",
    computerControlNotReady: "The selected page is unavailable. Continue and Flower will check the available targets.",
    computerTakeControl: "Open page",
    computerContinueCheck: "Continue check",
    computerControlHint: "Complete sign-in in the image using your mouse and keyboard. Passwords and codes stay out of the conversation.",
    computerControlFailed: "Your answer could not be delivered. Try again.",
    inputRequestTitle: 'Waiting for your reply',
    inputRequestSubmit: 'Continue',
    inputRequestRetry: 'Retry',
    inputRequestAnswerRequired: 'Answer the waiting prompt before continuing.',
    inputRequestAnswerHidden: 'Answer hidden',
    inputRequestPrevious: 'Previous question',
    inputRequestNext: 'Next question',
    inputRequestComposerPlaceholder: 'Reply to continue this conversation.',
    inputRequestChoicePlaceholder: 'Choose an option to continue.',
    inputRequestOther: 'None of the above / Other',
    inputRequestAnswered: 'Answered',
    conversationsAria: 'Flower conversations',
    resizeConversationsLabel: 'Resize conversations',
    entryLabel: 'Flower',
    newChat: 'New chat',
    workingDirPickerHomeLabel: 'Home',
    workingDirPickerTitle: 'Select working directory',
    workingDirPickerRecent: 'Recently used',
    workingDirPickerConfirm: 'Select',
  },
  threadList: {
    title: 'Conversations',
    description: 'Pinned first, newest below',
    warmupDescription: 'Loading after the Local Environment runtime is ready.',
    refreshLabel: 'Refresh conversations',
    searchPlaceholder: 'Search conversations...',
    empty: 'No conversations yet.',
    untitled: 'Untitled chat',
    working: 'Working',
    stopping: 'Stopping...',
    unread: 'Unread',
    stop: 'Stop conversation',
    deleteMenuAction: 'Delete conversation',
    deleteDialogTitle: 'Delete conversation?',
    deleteDialogDescription: (title) => `Permanently delete "${title}" and its conversation history? This cannot be undone.`,
    deleteDialogActiveDescription: 'Any active or waiting tasks and their SubAgents will be stopped.',
    deleteDialogWorkspaceDescription: "Ordinary files in this conversation's workspace are not affected.",
    deleteConfirm: 'Delete',
    deleteCommittedNotification: 'Conversation deleted.',
    deletePendingNotification: 'Deletion was accepted and will continue in the background. The conversation has been removed from this view.',
    deleteFailedNotification: 'This conversation has been retired and cannot be used, but deletion is incomplete. Repair the Local Environment data, then restart Redeven.',
    contextMenuLabel: (title) => `Actions for ${title}`,
    copyThreadID: 'Copy thread id',
    copyWorkingDirectory: 'Copy working directory',
    browseWorkingDirectory: 'Browse working directory',
    openTerminalInWorkingDirectory: 'Open terminal in working directory',
    copySelectedText: 'Copy selected text',
    workingDirectoryUnavailable: 'The conversation working directory is unavailable.',
    browseWorkingDirectoryReadDenied: 'Read permission is required to browse the working directory.',
    workingDirectoryTerminalDenied: 'Read, write, and execute permissions are required to open a terminal.',
    workingDirectoryDisconnected: 'Connect to the environment to open its working directory.',
    threadIDLabel: 'thread id',
    workingDirectoryLabel: 'working directory',
    copied: (label) => `Copied ${label}.`,
    fork: 'Fork',
    forkSuffix: "Fork",
    forkCreating: "Creating branch…",
    forkCreated: "Branch created.",
    forkLoadFailed: "Branch created, but could not load the conversation.",
    dragPinned: "Drag to reorder pinned conversation",
    movePinnedUp: "Move up",
    movePinnedDown: "Move down",
    clearSearchToReorder: "Clear search to reorder pinned conversations",
    pinUpdateFailed: "Could not update pinned conversations.",
    pinRefreshFailed: "Pinned conversations were saved, but the list could not refresh. Refresh to see the latest order.",
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
      waiting_user: 'Reply needed',
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
    suggestionsLabel: 'Start with a suggestion',
    moreSuggestions: 'More suggestions',
    fewerSuggestions: 'Fewer suggestions',
    title: 'Ask Flower',
    description: 'Flower uses your Local AI Profile, inspects remembered environments, and prepares actions before runtimes do any read or write.',
    suggestions: [
      {
        title: "Explore this folder",
        description: "Understand what is here, what it is for, and how to get started.",
        prompt: "Look at the current working directory and explain in everyday language what is here, what it is for, and how I can use it.\n\nFirst inspect the top-level contents and any necessary introductory documents to determine whether this is a software project, an application, a collection of reference materials, or another kind of folder.\n\nIf it is a software project, focus on the problem it solves, its main features, who it is for, and where to start. Based on the actual documentation and current environment, give me the shortest getting-started steps and one concrete usage example. Explain which prerequisites are already available and which are missing.\n\nIf it contains documents or reference materials, summarize the main content, identify the best files to read first, and suggest a reading order.\n\nDeliver a concise usage guide. Clearly state anything uncertain rather than guessing. If the folder contains several independent projects, give an overview first and let me choose. This task is for understanding only; do not install or modify anything.",
      },
      {
        title: "Understand this computer",
        description: "Check its specifications, resource usage, and current operating condition.",
        prompt: "Help me understand the computer I am currently connected to with a brief system health check.\n\nFirst confirm which device you are actually inspecting and whether it is local or remote. Check the operating system, processor, memory, disk capacity and free space, and current CPU, memory, and disk usage. Include graphics hardware and battery information when available.\n\nExplain what these findings mean in everyday language, and list the few processes using the most resources right now. If you find something worth attention, provide the actual measurements, possible impact, and the most useful first step. If a single sample is insufficient to reach a conclusion, say so.\n\nFinish with a concise report covering specifications, current condition, and points to watch. Mark information you cannot obtain, do not invent problems just to fill a recommendations list, and do not change settings or end processes.",
      },
      {
        title: "Discover available apps",
        description: "Find installed apps and tools for everyday tasks.",
        prompt: "Take stock of the main applications already installed on the connected device so I can understand what this computer can help me do right away.\n\nStart with the system application list and standard installation locations. Group the apps by their actual uses, such as office work and reading, web browsing and communication, images and design, media, and development tools. Do not turn background components and internal system programs into a long, undifferentiated list.\n\nFor each main application, briefly explain what it can help me do and how to open it. Where several apps serve similar purposes, explain when each is useful. Based on the software you actually find, suggest three to five concrete tasks I could do now, such as editing a PDF, working with a spreadsheet, or trimming a video, and name the app for each.\n\nDistinguish installed apps from apps whose usability you have confirmed, and do not promise features you cannot verify. There is no need to install or launch any software.",
      },
      {
        title: "Organize this folder",
        description: "Understand the files and prepare a clear, practical organization plan.",
        prompt: "Help me make sense of the current working directory: what is in it, and how could it be organized to make things easier to find?\n\nStart with file names, types, sizes, and the folder structure. If needed, sample a few introductory documents to summarize the main contents. Identify loose files, confusing names, possible duplicate versions, and candidates for archiving, but do not treat matching names or older dates alone as reasons to delete anything.\n\nBased on how this folder is actually used, propose a simple organization scheme. Use existing files as examples and show their exact locations before and after. Explain what should stay as it is and which moves might affect projects, applications, or file references.\n\nFirst deliver the folder overview and organization plan in the conversation, clearly listing proposed moves, renames, and decisions I need to make. Wait for my confirmation before carrying out the plan.",
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
    detailTimelineLabel: 'Subagent execution record',
    detailInstructionLabel: 'Delegated instruction',
    detailConstraintsLabel: 'Runtime constraints',
    detailAnalysisLabel: 'Analysis',
    detailActivityLabel: (count) => count === 1 ? '1 operation' : `${count} operations`,
    detailOutcomeLabel: 'Outcome',
    detailRetry: 'Retry',
    feedbackClose: 'Close feedback',
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
        spawn: 'Create subagent',
        send_input: 'Steer subagent',
        wait: 'Wait for subagents',
        list: 'List subagents',
        inspect: 'Inspect subagents',
        close: 'Close subagent',
        close_all: 'Close subagents',
        unknown: 'Subagent operation',
      },
      titles: {
        operation: 'Subagent operation',
        failed: 'Subagent operation failed',
        timedOut: 'Subagent timed out',
        needsInput: 'Subagent needs input',
        starting: 'Creating subagent',
        started: 'Created subagent',
        createFailed: 'Failed to create subagent',
        waiting: (count) => `Waiting for ${count} subagents`,
        completed: (count) => `${count} subagents completed`,
        waitTimedOut: (completed, count) => `Wait timed out · ${completed}/${count} completed`,
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
    reasoningControl: reasoningControlEnUS,
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
    computerUseTitle: 'Computer and browser use',
	computerUseLabel: 'Enable computer use',
    connectBrowserTitle: 'Connect current Chrome',
    connectBrowserPlaceholder: 'http://127.0.0.1:9222',
    connectBrowser: 'Connect',
    connectingBrowser: 'Connecting…',
    connectBrowserEmpty: 'Enter a browser connection address.',
    connectBrowserFailed: 'Could not connect the browser.',
    permissionTypes: {
      readonly: {
        label: 'Read only',
        description: 'Read and search only. No shell, file edits, or write tools.',
      },
      approval_required: {
        label: 'Approval required',
        description: 'All tools available. Shell, file changes, and child tasks ask before running.',
      },
      full_access: {
        label: 'Full access',
        description: 'All tools run without confirmation. Limits and audit still apply.',
      },
    },
    providersTitle: 'Providers',
    providersDescription: 'Connect model providers and manage the models available to Flower.',
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
    webSearchNotSupported: 'Not supported',
    webSearchDisabled: 'Disabled',
    openAIBuiltIn: 'OpenAI built-in',
    braveSearch: 'Brave Search',
    needsBraveKey: 'Needs Brave key',
    providerTypeLabels: localizedFlowerProviderTypeLabels('en-US'),

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
    },
    dialog: {
      catalog: modelCatalogCopy('en-US'),
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
        google: 'Gemini',
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

      recommendedModelsTitle: "Models",
      recommendedModelsDescription: "Choose the models available in Flower. Search and collapse keep your selection.",
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
