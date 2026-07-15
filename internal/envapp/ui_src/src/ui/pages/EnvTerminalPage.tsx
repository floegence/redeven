import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { AlertTriangle, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';

import { useEnvContext } from './EnvContext';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { useI18n } from '../i18n';
import { useTerminalSessionCatalog } from '../services/terminalSessionCatalog';
import { canLaunchProcess } from '../utils/permission';
import { TerminalPanel } from '../widgets/TerminalPanel';

export function EnvTerminalPage() {
  const env = useEnvContext();
  const i18n = useI18n();
  const terminalCatalog = useTerminalSessionCatalog();
  const [catalogWaitVisible, setCatalogWaitVisible] = createSignal(false);
  const permissionDenied = () => (
    terminalCatalog?.permissionDenied?.()
    || (env.env.state === 'ready' && !canLaunchProcess(env.env()?.permissions))
  );
  const catalogReady = () => !terminalCatalog || terminalCatalog.hydrated() || permissionDenied();
  const catalogError = () => terminalCatalog?.error?.() ?? null;

  createEffect(() => {
    if (catalogReady()) {
      setCatalogWaitVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setCatalogWaitVisible(true), 150);
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <Show
        when={catalogReady()}
        fallback={
          <div class="h-full min-h-0" data-terminal-catalog-gate="pending">
            <Show
              when={catalogError()}
              fallback={
                <RedevenLoadingCurtain
                  visible={catalogWaitVisible() && !env.connectionOverlayVisible()}
                  surface="page"
                  eyebrow={i18n.t('shell.nav.terminal')}
                  message={i18n.t('terminal.loadingSessions')}
                  progressLabel={i18n.t('terminal.loadingSessions')}
                  testId="terminal-catalog-loading-curtain"
                  dataStage="sessions"
                />
              }
            >
              {(error) => (
                <div
                  class="absolute inset-0 flex items-center justify-center p-8"
                  role="alert"
                  data-testid="terminal-catalog-error-state"
                >
                  <div class="max-w-md text-center flex flex-col items-center gap-3">
                    <AlertTriangle class="h-5 w-5 text-error" aria-hidden="true" />
                    <div class="text-sm font-medium text-foreground">{i18n.t('terminal.sessions')}</div>
                    <div class="text-xs text-muted-foreground break-words">{error()}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={RefreshIcon}
                      loading={terminalCatalog?.loading?.() ?? false}
                      onClick={() => void terminalCatalog?.refresh().catch(() => undefined)}
                    >
                      {i18n.t('terminal.refresh')}
                    </Button>
                  </div>
                </div>
              )}
            </Show>
          </div>
        }
      >
        <TerminalPanel
          variant="panel"
          openSessionRequest={env.openTerminalInDirectoryRequest()}
          onOpenSessionRequestHandled={env.consumeOpenTerminalInDirectoryRequest}
        />
      </Show>
      <RedevenLoadingCurtain
        visible={env.connectionOverlayVisible()}
        surface="page"
        eyebrow={i18n.t('uiCopy.runtime.eyebrow')}
        message={env.connectionOverlayMessage()}
      />
    </div>
  );
}
