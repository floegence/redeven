import { createMemo, createSignal } from 'solid-js';

import { FlowerSurface } from '../../../../../flower_ui/src';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../flower_ui/src/copy';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { createEnvLocalFlowerSurfaceAdapter } from '../flower/envLocalFlowerSurfaceAdapter';
import { useI18n } from '../i18n';
import { useEnvContext } from './EnvContext';

function trim(value: unknown): string {
  return String(value ?? '').trim();
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
  }));

  return (
    <FlowerSurface
      adapter={adapter()}
      copy={{
        ...DEFAULT_FLOWER_SURFACE_COPY,
        chat: {
          ...DEFAULT_FLOWER_SURFACE_COPY.chat,
          titleFallback: i18n.t('flowerChat.composer.describePlaceholder'),
          settingsLabel: i18n.t('common.actions.settings'),
          openSettings: i18n.t('common.actions.settings'),
          placeholder: i18n.t('flowerChat.composer.typeMessagePlaceholder'),
          send: i18n.t('flowerChat.composer.sendMessage'),
          handlerSelectionLabel: i18n.t('flowerChat.router.handlerSelectionLabel'),
          handlerResolving: i18n.t('flowerChat.router.handlerResolving'),
          handlerUnavailable: i18n.t('flowerChat.router.handlerUnavailable'),
          handlerRetry: i18n.t('common.actions.retry'),
          conversationsAria: i18n.t('flowerChat.router.conversationsAria'),
          newChat: i18n.t('flowerChat.router.newChat'),
        },
        threadList: {
          ...DEFAULT_FLOWER_SURFACE_COPY.threadList,
          title: i18n.t('flowerChat.router.conversationsTitle'),
          refreshLabel: i18n.t('common.actions.refresh'),
          searchPlaceholder: i18n.t('flowerChat.router.searchConversations'),
          empty: i18n.t('flowerChat.router.noConversations'),
        },
      }}
      focusThreadID={focusedThreadID()}
      class="h-full min-h-0"
    />
  );
}
