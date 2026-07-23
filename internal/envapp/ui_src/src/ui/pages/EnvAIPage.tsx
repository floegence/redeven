import { createMemo, type JSX } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';

import { FlowerSurface } from '../../../../../flower_ui/src';
import type {
  FlowerCompanionPresenceProjection,
  FlowerCompanionProgressKind,
  FlowerCompanionPriorityStatus,
  FlowerSurfaceNotification,
  FlowerThreadFocusRequest,
  FlowerThreadSwitcherCopy,
} from '../../../../../flower_ui/src';
import {
  createLocalizedFlowerSurfaceCopy,
  type FlowerSurfaceTranslator,
} from '../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { createEnvLocalFlowerSurfaceAdapter } from '../flower/envLocalFlowerSurfaceAdapter';
import { useI18n, type EnvAppTranslationKey, type I18nHelpers } from '../i18n';
import { useEnvContext } from './EnvContext';
import { readDesktopSessionContextSnapshot } from '../services/desktopSessionContext';
import { openConnectionCenter, openFlowerSettings } from '../services/desktopShellBridge';
import '../flower-feature.css';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';
import type { EnvSurfaceId } from '../envViewMode';

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

export type EnvAIPageProps = Readonly<{
  presentation?: 'full' | 'companion';
  engaged?: boolean;
  transcriptVisible?: boolean;
  companionPresenceOwner?: boolean;
  companionOpen?: boolean;
  companionRegionID?: string;
  companionSummary?: Readonly<{
    visualText: string;
    accessibleText: string;
    priorityStatus: FlowerCompanionPriorityStatus;
    progressKind?: FlowerCompanionProgressKind;
    progressIdentity?: string;
    ephemeralKind?: 'completion';
    running: boolean;
  }>;
  companionActionLabel?: string;
  focusRequestScope?: 'workbench' | 'activity';
  focusThreadRequest?: FlowerThreadFocusRequest | null;
  focusComposerRequest?: number;
  onFocusThreadRequestConsumed?: (requestID: string) => void;
  onCompanionOpenRequest?: () => void;
  companionCopy?: Omit<FlowerThreadSwitcherCopy, 'threadList'>;
  headerTrailingActions?: JSX.Element;
  onPresenceChange?: (presence: FlowerCompanionPresenceProjection) => void;
  settingsReturnSurfaceId?: EnvSurfaceId;
  class?: string;
}>;

export function EnvAIPage(props: EnvAIPageProps = {}) {
  const env = useEnvContext();
  const rpc = useRedevenRpc();
  const i18n = useI18n();
  const notification = useNotification();
  const surfaceCopy = createMemo(() => createEnvFlowerSurfaceCopy(i18n, i18n.locale()));
  const companionCopy = createMemo<FlowerThreadSwitcherCopy | undefined>(() => (
    props.companionCopy
      ? { ...props.companionCopy, threadList: surfaceCopy().threadList }
      : undefined
  ));
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
    openCanonicalReferenceTarget: env.openFlowerCanonicalReferenceTarget,
    openLinkedFilePreview: env.openFlowerLinkedFilePreview,
    openLinkedDirectoryBrowser: env.openFlowerLinkedDirectoryBrowser,
    modelSourceRecovery: {
      describe: (status) => {
        if (status.state === 'missing_keys') {
          return i18n.t('flowerSettings.localAIProfileMissingKeys', {
            providers: status.missing_key_provider_ids.join(', '),
          });
        }
        if (status.state === 'empty') return i18n.t('flowerSettings.desktopModelNoUsableModel');
        if (status.state === 'unsupported') return i18n.t('flowerSettings.desktopModelUnsupported');
        if (status.state === 'expired') return i18n.t('flowerSettings.desktopModelExpired');
        if (status.state === 'connecting') return i18n.t('flowerSurface.chat.handlerStillStarting');
        if (status.state === 'error' && trim(status.diagnostic_message)) {
          return i18n.t('flowerSettings.desktopModelBindingFailedWithError', {
            message: trim(status.diagnostic_message),
          });
        }
        return i18n.t('flowerSettings.desktopModelBindingFailed');
      },
      localSettings: {
        label: i18n.t('flowerChat.header.aiSettings'),
        run: async () => {
          if (!await openFlowerSettings()) {
            throw new Error(i18n.t('settings.connection.manageConnectionFailedMessage'));
          }
        },
      },
      runtimeSettings: {
        label: i18n.t('settings.runtimeTitle'),
        run: async () => {
          env.openSettings('agent', { origin: { kind: 'flower', returnSurfaceId: props.settingsReturnSurfaceId ?? 'ai' } });
        },
      },
      connectionCenter: {
        label: i18n.t('settings.connection.manageConnection'),
        run: async () => {
          if (!await openConnectionCenter()) {
            throw new Error(i18n.t('settings.connection.manageConnectionFailedMessage'));
          }
        },
      },
    },
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
      copy={surfaceCopy()}
      presentation={props.presentation}
      engaged={props.engaged}
      transcriptVisible={props.transcriptVisible}
      companionPresenceOwner={props.companionPresenceOwner}
      companionOpen={props.companionOpen}
      companionRegionID={props.companionRegionID}
      companionSummary={props.companionSummary}
      companionActionLabel={props.companionActionLabel}
      companionCopy={companionCopy()}
      headerTrailingActions={props.headerTrailingActions}
      onPresenceChange={props.onPresenceChange}
      focusThreadRequest={props.focusRequestScope === 'activity' ? props.focusThreadRequest : env.aiThreadFocusRequest()}
      focusComposerRequest={props.focusComposerRequest}
      onFocusThreadRequestConsumed={props.focusRequestScope === 'activity'
        ? props.onFocusThreadRequestConsumed
        : env.consumeAIThreadFocusRequest}
      onCompanionOpenRequest={props.onCompanionOpenRequest}
      onThreadSelectionEvent={createUIPresentationEventRecorder({
        surface: 'flower',
        source: (event) => event.metadata?.source ?? 'thread-list',
      })}
      class={`h-full min-h-0 ${props.class ?? ''}`}
    />
  );
}
