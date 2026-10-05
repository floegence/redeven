import type { TessivenOpenRequest } from '../../../../../tessiven_ui/src/navigation';
import { createMemo } from 'solid-js';
import { TessivenPage } from '../../../../../tessiven_ui/src/TessivenPage';
import { tessivenText } from '../../../../../tessiven_ui/src/i18n';
import { tessivenFlowerIntent } from '../../../../../tessiven_ui/src/flower';
import { createTessivenTransport } from '../../../../../tessiven_ui/src/transport';
import { TESSIVEN_API } from '../../../../../tessiven_ui/src/types';
import { useEnvContext } from './EnvContext';
import { useI18n } from '../i18n';
import { fetchSessionJSON, readSessionEvents } from '../services/sessionHTTP';
import {
  openWebServiceRoute,
  resolveWebServiceOpenRoute,
} from '../services/webServiceWindows';
import { readDesktopSessionContextSnapshot } from '../services/desktopSessionContext';
import { desktopShellWebServiceWindowOpenAvailable } from '../services/desktopShellBridge';

export default function EnvTessivenPage(props: {
  visible: boolean;
  openRequest?: TessivenOpenRequest | null;
}) {
  const env = useEnvContext(),
    i18n = useI18n();
  const t = createMemo(() => tessivenText(i18n.locale()));
  const transport = createTessivenTransport(
    (method, path, body, signal) =>
      fetchSessionJSON(`${TESSIVEN_API}${path}`, {
        method,
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    (path, signal) => readSessionEvents(path, { method: 'GET', signal }),
  );
  const params = new URLSearchParams(window.location.search);
  const requestedCanvas = params.get('canvas'),
    requestedVersion = params.get('version');
  const request = requestedCanvas
    ? {
        canvasID: requestedCanvas,
        ...(requestedVersion && /^[1-9][0-9]*$/.test(requestedVersion)
          ? { version: Number(requestedVersion) }
          : {}),
        nonce: 1,
      }
    : null;
  return (
    <TessivenPage
      locale={i18n.locale()}
      visible={props.visible}
      t={(key, values) => t()(key, values)}
      transport={transport}
      canWrite={env.env()?.permissions?.can_write === true}
      openRequest={props.openRequest ?? request}
      onAsk={(selection) =>
        env.openFlowerTurnLauncher(tessivenFlowerIntent(selection, t()))
      }
      onOpenService={async (opening, runtime) => {
        if (runtime !== 'local:local') throw new Error(t()('openUnavailable'));
        const forward = opening.forward as {
          forward_id: string;
          target_url: string;
          access_mode?: 'unified_proxy' | 'desktop_loopback';
        };
        const desktop = desktopShellWebServiceWindowOpenAvailable();
        if (forward.access_mode === 'desktop_loopback' && !desktop)
          throw new Error(
            i18n.t('webServices.errors.desktopLoopbackRequiresDesktop'),
          );
        const win = desktop
          ? null
          : window.open(
              'about:blank',
              `tessiven-service-${forward.forward_id}`,
            );
        if (!desktop && !win)
          throw new Error(i18n.t('webServices.errors.popupBlocked'));
        try {
          const route = resolveWebServiceOpenRoute({
            forwardID: forward.forward_id,
            localRuntime: env.localRuntime(),
            desktopContext: readDesktopSessionContextSnapshot(),
            appPath: opening.app_path,
            desktopWindowAvailable: desktop,
          });
          await openWebServiceRoute(
            route,
            forward.forward_id,
            forward.target_url,
            forward.access_mode ?? 'unified_proxy',
            opening.app_path,
            desktop,
            () => undefined,
            {
              missingEnvContext: i18n.t('webServices.errors.missingEnvContext'),
              opening: i18n.t('webServices.status.opening'),
              openingLocalProxy: i18n.t('webServices.status.openingLocalProxy'),
              requestingEntryTicket: i18n.t(
                'webServices.status.requestingEntryTicket',
              ),
              updating: i18n.t('webServices.status.updating'),
              desktopWindowFailed: i18n.t(
                'webServices.errors.desktopWindowFailed',
              ),
              popupBlocked: i18n.t('webServices.errors.popupBlocked'),
            },
            win,
          );
        } catch (error) {
          win?.close();
          throw error;
        }
      }}
    />
  );
}
