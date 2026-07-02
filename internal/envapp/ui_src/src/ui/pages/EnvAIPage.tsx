import { createMemo } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';

import { FlowerSurface } from '../../../../../flower_ui/src';
import type { FlowerSurfaceNotification } from '../../../../../flower_ui/src';
import { DEFAULT_FLOWER_SURFACE_COPY, type FlowerSurfaceCopy } from '../../../../../flower_ui/src/copy';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { createEnvLocalFlowerSurfaceAdapter } from '../flower/envLocalFlowerSurfaceAdapter';
import { useI18n, type I18nHelpers } from '../i18n';
import { useEnvContext } from './EnvContext';

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function createEnvFlowerSurfaceCopy(i18n: I18nHelpers): FlowerSurfaceCopy {
  return {
    ...DEFAULT_FLOWER_SURFACE_COPY,
    chat: {
      ...DEFAULT_FLOWER_SURFACE_COPY.chat,
      titleFallback: i18n.t('flowerChat.composer.describePlaceholder'),
      settingsLabel: i18n.t('common.actions.settings'),
      openSettings: i18n.t('common.actions.settings'),
      placeholder: i18n.t('flowerChat.composer.typeMessagePlaceholder'),
      modelLabel: i18n.t('flowerChat.model.label'),
      reasoningLabel: i18n.t('chatChrome.reasoning'),
      noModelSelected: i18n.t('flowerSettings.noModelSelected'),
      linkedContextLabel: i18n.t('flowerTurnLauncher.linkedContextLabel'),
      send: i18n.t('flowerChat.composer.launchTurn'),
      stop: i18n.t('common.actions.stop'),
      handlerBlockedTitle: i18n.t('flowerChat.router.handlerBlockedTitle'),
      handlerStartFailedTitle: i18n.t('flowerChat.router.handlerStartFailedTitle'),
      handlerStillStarting: i18n.t('flowerChat.router.handlerStillStarting'),
      handlerRetry: i18n.t('common.actions.retry'),
      modelStatus: {
        preparing: i18n.t('chatChrome.modelStatusPreparing'),
        waitingResponse: i18n.t('chatChrome.modelStatusWaitingResponse'),
        streaming: i18n.t('chatChrome.thinkingEllipsis'),
        retrying: i18n.t('chatChrome.modelStatusRetrying'),
        finalizing: i18n.t('chatChrome.modelStatusFinalizing'),
      },
      toolApprovalStates: {
        ...DEFAULT_FLOWER_SURFACE_COPY.chat.toolApprovalStates,
        requested: i18n.t('flowerChat.sidebar.status.waitingApproval'),
        approved: i18n.t('flowerChat.sidebar.status.done'),
        rejected: i18n.t('flowerChat.sidebar.status.failed'),
        timed_out: i18n.t('flowerChat.sidebar.status.timedOut'),
        canceled: i18n.t('flowerChat.sidebar.status.canceled'),
      },
      conversationsAria: i18n.t('flowerChat.router.conversationsAria'),
      newChat: i18n.t('flowerChat.router.newChat'),
    },
    threadList: {
      ...DEFAULT_FLOWER_SURFACE_COPY.threadList,
      title: i18n.t('flowerChat.router.conversationsTitle'),
      description: i18n.t('flowerChat.sidebar.description'),
      refreshLabel: i18n.t('common.actions.refresh'),
      searchPlaceholder: i18n.t('flowerChat.router.searchConversations'),
      empty: i18n.t('flowerChat.router.noConversations'),
      untitled: i18n.t('flowerChat.sidebar.untitledChat'),
      working: i18n.t('flowerChat.sidebar.working'),
      unread: i18n.t('flowerChat.sidebar.unread'),
      deleteLabel: (title) => i18n.t('flowerChat.sidebar.delete.aria', { title }),
      contextMenuLabel: (title) => i18n.t('flowerChat.sidebar.contextMenu.label', { title }),
      copyThreadID: i18n.t('flowerChat.sidebar.contextMenu.copyThreadId'),
      copyWorkingDirectory: i18n.t('flowerChat.sidebar.contextMenu.copyWorkingDirectory'),
      threadIDLabel: i18n.t('flowerChat.sidebar.contextMenu.threadIdLabel'),
      workingDirectoryLabel: i18n.t('flowerChat.sidebar.contextMenu.workingDirectoryLabel'),
      copied: (label) => i18n.t('flowerChat.sidebar.contextMenu.copied', { label }),
      fork: i18n.t('flowerChat.sidebar.contextMenu.fork'),
      pin: i18n.t('flowerChat.sidebar.contextMenu.pin'),
      unpin: i18n.t('flowerChat.sidebar.contextMenu.unpin'),
      pinnedGroup: i18n.t('flowerChat.sidebar.pinnedGroup'),
      pinnedBadge: i18n.t('flowerChat.sidebar.pinnedBadge'),
      rename: i18n.t('flowerChat.sidebar.contextMenu.rename'),
      renameTitle: i18n.t('flowerChat.sidebar.rename.title'),
      renameNameLabel: i18n.t('flowerChat.sidebar.rename.nameLabel'),
      cancel: i18n.t('common.actions.cancel'),
      save: i18n.t('flowerChat.sidebar.save'),
      saving: i18n.t('flowerChat.sidebar.saving'),
      now: i18n.t('flowerChat.sidebar.time.now'),
      minutes: (count) => i18n.t('flowerChat.sidebar.time.minutes', { count }),
      hours: (count) => i18n.t('flowerChat.sidebar.time.hours', { count }),
      days: (count) => i18n.t('flowerChat.sidebar.time.days', { count }),
      statuses: {
        ...DEFAULT_FLOWER_SURFACE_COPY.threadList.statuses,
        idle: i18n.t('flowerChat.sidebar.status.idle'),
        running: i18n.t('flowerChat.sidebar.status.running'),
        waiting_user: i18n.t('flowerChat.sidebar.status.waitingInput'),
        waiting_approval: i18n.t('flowerChat.sidebar.status.waitingApproval'),
        failed: i18n.t('flowerChat.sidebar.status.failed'),
        success: i18n.t('flowerChat.sidebar.status.done'),
        canceled: i18n.t('flowerChat.sidebar.status.canceled'),
        read_only: i18n.t('flowerChat.sidebar.status.readOnly'),
      },
      groups: {
        today: i18n.t('flowerChat.sidebar.groups.today'),
        yesterday: i18n.t('flowerChat.sidebar.groups.yesterday'),
        this_week: i18n.t('flowerChat.sidebar.groups.thisWeek'),
        older: i18n.t('flowerChat.sidebar.groups.older'),
      },
    },
    subagents: {
      title: i18n.t('flowerChat.subagents.title'),
      description: i18n.t('flowerChat.subagents.description'),
      openLabel: i18n.t('flowerChat.subagents.openLabel'),
      openThread: i18n.t('flowerChat.subagents.openThread'),
      backToChat: i18n.t('flowerChat.subagents.backToChat'),
      emptyTitle: i18n.t('flowerChat.subagents.emptyTitle'),
      emptyDescription: i18n.t('flowerChat.subagents.emptyDescription'),
      activeLabel: i18n.t('flowerChat.subagents.activeLabel'),
      completedLabel: i18n.t('flowerChat.subagents.completedLabel'),
      threadIDLabel: i18n.t('flowerChat.subagents.threadIDLabel'),
      lastMessageLabel: i18n.t('flowerChat.subagents.lastMessageLabel'),
      unavailableThread: i18n.t('flowerChat.subagents.unavailableThread'),
      readOnlyComposerLabel: i18n.t('flowerChat.subagents.readOnlyComposerLabel'),
      statusLabels: {
        queued: i18n.t('flowerChat.subagents.status.queued'),
        running: i18n.t('flowerChat.subagents.status.running'),
        waiting_input: i18n.t('flowerChat.subagents.status.waitingInput'),
        completed: i18n.t('flowerChat.subagents.status.completed'),
        failed: i18n.t('flowerChat.subagents.status.failed'),
        canceled: i18n.t('flowerChat.subagents.status.canceled'),
        timed_out: i18n.t('flowerChat.subagents.status.timedOut'),
        unknown: i18n.t('flowerChat.subagents.status.unknown'),
      },
      typeLabels: {
        explore: i18n.t('flowerChat.subagents.types.explore'),
        worker: i18n.t('flowerChat.subagents.types.worker'),
        reviewer: i18n.t('flowerChat.subagents.types.reviewer'),
        unknown: i18n.t('flowerChat.subagents.types.unknown'),
      },
      activity: {
        actions: {
          spawn: i18n.t('flowerChat.subagents.activity.actions.spawn'),
          send_input: i18n.t('flowerChat.subagents.activity.actions.sendInput'),
          wait: i18n.t('flowerChat.subagents.activity.actions.wait'),
          list: i18n.t('flowerChat.subagents.activity.actions.list'),
          inspect: i18n.t('flowerChat.subagents.activity.actions.inspect'),
          close: i18n.t('flowerChat.subagents.activity.actions.close'),
          close_all: i18n.t('flowerChat.subagents.activity.actions.closeAll'),
          unknown: i18n.t('flowerChat.subagents.activity.actions.unknown'),
        },
        titleVerbs: {
          spawn: i18n.t('flowerChat.subagents.activity.titleVerbs.spawn'),
          send_input: i18n.t('flowerChat.subagents.activity.titleVerbs.sendInput'),
          wait: i18n.t('flowerChat.subagents.activity.titleVerbs.wait'),
          list: i18n.t('flowerChat.subagents.activity.titleVerbs.list'),
          inspect: i18n.t('flowerChat.subagents.activity.titleVerbs.inspect'),
          close: i18n.t('flowerChat.subagents.activity.titleVerbs.close'),
          close_all: i18n.t('flowerChat.subagents.activity.titleVerbs.closeAll'),
        },
        labels: {
          approval: i18n.t('flowerChat.subagents.activity.labels.approval'),
          action: i18n.t('flowerChat.subagents.activity.labels.action'),
          status: i18n.t('flowerChat.subagents.activity.labels.status'),
          thread: i18n.t('flowerChat.subagents.activity.labels.thread'),
          subagent: i18n.t('flowerChat.subagents.activity.labels.subagent'),
          task: i18n.t('flowerChat.subagents.activity.labels.task'),
          title: i18n.t('flowerChat.subagents.activity.labels.title'),
          profile: i18n.t('flowerChat.subagents.activity.labels.profile'),
          target: i18n.t('flowerChat.subagents.activity.labels.target'),
          targets: i18n.t('flowerChat.subagents.activity.labels.targets'),
          ids: i18n.t('flowerChat.subagents.activity.labels.ids'),
          accepted: i18n.t('flowerChat.subagents.activity.labels.accepted'),
          closed: i18n.t('flowerChat.subagents.activity.labels.closed'),
          affected: i18n.t('flowerChat.subagents.activity.labels.affected'),
          agents: i18n.t('flowerChat.subagents.activity.labels.agents'),
          total: i18n.t('flowerChat.subagents.activity.labels.total'),
          runningOnly: i18n.t('flowerChat.subagents.activity.labels.runningOnly'),
          queued: i18n.t('flowerChat.subagents.activity.labels.queued'),
          running: i18n.t('flowerChat.subagents.activity.labels.running'),
          waiting: i18n.t('flowerChat.subagents.activity.labels.waiting'),
          completed: i18n.t('flowerChat.subagents.activity.labels.completed'),
          failed: i18n.t('flowerChat.subagents.activity.labels.failed'),
          canceled: i18n.t('flowerChat.subagents.activity.labels.canceled'),
          timedOut: i18n.t('flowerChat.subagents.activity.labels.timedOut'),
          requested: i18n.t('flowerChat.subagents.activity.labels.requested'),
          found: i18n.t('flowerChat.subagents.activity.labels.found'),
          missing: i18n.t('flowerChat.subagents.activity.labels.missing'),
          missingIds: i18n.t('flowerChat.subagents.activity.labels.missingIds'),
          lastMessage: i18n.t('flowerChat.subagents.activity.labels.lastMessage'),
          waitingPrompt: i18n.t('flowerChat.subagents.activity.labels.waitingPrompt'),
          canSendInput: i18n.t('flowerChat.subagents.activity.labels.canSendInput'),
          canInterrupt: i18n.t('flowerChat.subagents.activity.labels.canInterrupt'),
          canClose: i18n.t('flowerChat.subagents.activity.labels.canClose'),
          runtime: i18n.t('flowerChat.subagents.activity.labels.runtime'),
          summary: i18n.t('flowerChat.subagents.activity.labels.summary'),
          details: i18n.t('flowerChat.subagents.activity.labels.details'),
          errorCode: i18n.t('flowerChat.subagents.activity.labels.errorCode'),
          errorMessage: i18n.t('flowerChat.subagents.activity.labels.errorMessage'),
          retryable: i18n.t('flowerChat.subagents.activity.labels.retryable'),
        },
        values: {
          yes: i18n.t('common.actions.yes'),
          no: i18n.t('common.actions.no'),
        },
        agentsCount: (count) => i18n.t('flowerChat.subagents.activity.agentsCount', { count }),
      },
    },
  };
}

export function EnvAIPage() {
  const env = useEnvContext();
  const rpc = useRedevenRpc();
  const i18n = useI18n();
  const notification = useNotification();
  const adapter = createMemo(() => createEnvLocalFlowerSurfaceAdapter({
    envPublicID: trim(env.env_id()),
    envLabel: trim(env.env()?.name) || trim(env.env_id()) || 'This environment',
    rpc,
    copy: {
      currentEnvironment: i18n.t('flowerChat.router.currentEnvSource'),
      usingCurrentEnvironment: i18n.t('flowerChat.router.currentEnvHandler'),
      environmentLocalSubtitle: i18n.t('flowerChat.router.envLocalSubtitle'),
      missingThreadID: i18n.t('flowerChat.router.missingThreadID'),
      enterMessageBeforeSending: i18n.t('flowerChat.router.enterMessageBeforeSending'),
      selectModelBeforeChat: i18n.t('flowerChat.router.selectModelBeforeChat'),
      failedToCreateChat: i18n.t('flowerChat.router.failedToCreateChat'),
    },
    onSettingsChanged: env.bumpSettingsSeq,
    uploadAttachment: async (file) => {
      const { uploadLocalApiFile } = await import('../services/localApi');
      return uploadLocalApiFile(file);
    },
    openFileBrowser: env.openFlowerFileBrowser,
    openFilePreview: env.openFlowerFilePreview,
  }));

  return (
    <FlowerSurface
      adapter={adapter()}
      notify={(notice: FlowerSurfaceNotification) => {
        const title = trim(notice.title) || (notice.tone === 'error' ? 'Flower could not complete.' : 'Flower');
        if (notice.tone === 'success') {
          notification.success(title, notice.message);
        } else if (notice.tone === 'info') {
          notification.info(title, notice.message);
        } else {
          notification.error(title, notice.message);
        }
      }}
      copy={createEnvFlowerSurfaceCopy(i18n)}
      focusThreadRequest={env.aiThreadFocusRequest()}
      onFocusThreadRequestConsumed={env.consumeAIThreadFocusRequest}
      class="h-full min-h-0"
    />
  );
}
