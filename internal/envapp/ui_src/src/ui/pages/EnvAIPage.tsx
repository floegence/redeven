import { createMemo } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';

import { FlowerSurface } from '../../../../../flower_ui/src';
import type { FlowerSurfaceNotification } from '../../../../../flower_ui/src';
import {
  createLocalizedFlowerSurfaceCopy,
  type FlowerSurfaceTranslator,
} from '../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { createEnvLocalFlowerSurfaceAdapter } from '../flower/envLocalFlowerSurfaceAdapter';
import { useI18n, type EnvAppTranslationKey, type I18nHelpers } from '../i18n';
import { useEnvContext } from './EnvContext';
import { readDesktopSessionContextSnapshot } from '../services/desktopSessionContext';
import '../flower-feature.css';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function createEnvFlowerSurfaceCopy(i18n: I18nHelpers, locale: string) {
  const translator: FlowerSurfaceTranslator = {
    locale,
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
  };
  return createLocalizedFlowerSurfaceCopy(translator);
}

export function EnvAIPage() {
  const env = useEnvContext();
  const rpc = useRedevenRpc();
  const i18n = useI18n();
  const notification = useNotification();
  const adapter = createMemo(() => createEnvLocalFlowerSurfaceAdapter({
    envPublicID: trim(env.env_id()),
    envLabel: trim(env.env()?.name) || trim(env.env_id()) || i18n.t('flower.currentEnvironmentFallback'),
    desktopSessionTargetRoute: readDesktopSessionContextSnapshot()?.target_route,
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
    openLinkedFilePreview: env.openFlowerLinkedFilePreview,
    openLinkedDirectoryBrowser: env.openFlowerLinkedDirectoryBrowser,
  }));

  return (
    <FlowerSurface
      adapter={adapter()}
      notify={(notice: FlowerSurfaceNotification) => {
        const title = trim(notice.title) || (notice.tone === 'error'
          ? i18n.t('flower.errorNotificationTitle')
          : i18n.t('flower.notificationTitle'));
        if (notice.tone === 'success') {
          notification.success(title, notice.message);
        } else if (notice.tone === 'info') {
          notification.info(title, notice.message);
        } else {
          notification.error(title, notice.message);
        }
      }}
      copy={createEnvFlowerSurfaceCopy(i18n, i18n.locale())}
      focusThreadRequest={env.aiThreadFocusRequest()}
      onFocusThreadRequestConsumed={env.consumeAIThreadFocusRequest}
      onThreadSelectionEvent={createUIPresentationEventRecorder({
        surface: 'flower',
        source: (event) => event.metadata?.source ?? 'thread-list',
      })}
      class="h-full min-h-0"
    />
  );
}
