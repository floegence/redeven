import { createMemo, createSignal } from 'solid-js';

import { FlowerSurface } from '../../../../../flower_ui/src';
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
      send: i18n.t('flowerChat.composer.sendMessage'),
      handlerSelectionLabel: i18n.t('flowerChat.router.handlerSelectionLabel'),
      handlerStarting: i18n.t('flowerChat.router.handlerStarting'),
      handlerResolving: i18n.t('flowerChat.router.handlerResolving'),
      handlerBlockedTitle: i18n.t('flowerChat.router.handlerBlockedTitle'),
      handlerStartFailedTitle: i18n.t('flowerChat.router.handlerStartFailedTitle'),
      handlerStillStarting: i18n.t('flowerChat.router.handlerStillStarting'),
      handlerRetry: i18n.t('common.actions.retry'),
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
        read_only: i18n.t('flowerChat.sidebar.status.readOnly'),
      },
      groups: {
        today: i18n.t('flowerChat.sidebar.groups.today'),
        yesterday: i18n.t('flowerChat.sidebar.groups.yesterday'),
        this_week: i18n.t('flowerChat.sidebar.groups.thisWeek'),
        older: i18n.t('flowerChat.sidebar.groups.older'),
      },
    },
  };
}

export function EnvAIPage() {
  const env = useEnvContext();
  const rpc = useRedevenRpc();
  const i18n = useI18n();
  const [focusedThreadID] = createSignal('');
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
    openFileBrowser: env.openFlowerFileBrowser,
    openFilePreview: env.openFlowerFilePreview,
  }));

  return (
    <FlowerSurface
      adapter={adapter()}
      copy={createEnvFlowerSurfaceCopy(i18n)}
      focusThreadID={focusedThreadID()}
      class="h-full min-h-0"
    />
  );
}
