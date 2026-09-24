import { Show } from 'solid-js';
import { AlertTriangle, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';

import { useEnvContext } from './EnvContext';
import { ActivityPageLoading } from '../primitives/ActivityPageLoading';
import { useI18n } from '../i18n';
import { useTerminalSessionCatalog } from '../services/terminalSessionCatalog';
import { canLaunchProcess } from '../utils/permission';
import { TerminalPanel } from '../widgets/TerminalPanel';

export function EnvTerminalPage() {
  const env = useEnvContext();
  const i18n = useI18n();
  const terminalCatalog = useTerminalSessionCatalog();
  const permissionDenied = () => (
    terminalCatalog?.permissionDenied?.()
    || (env.env.state === 'ready' && !canLaunchProcess(env.env()?.permissions))
  );
  const catalogReady = () => !terminalCatalog || terminalCatalog.hydrated() || permissionDenied();
  const catalogError = () => terminalCatalog?.error?.() ?? null;

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <Show
        when={catalogReady()}
        fallback={
          <div class="h-full min-h-0" data-terminal-catalog-gate="pending">
            <Show
              when={catalogError()}
              fallback={<ActivityPageLoading />}
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
          mobileSessionsOpen={env.terminalSessionsOpen?.()}
          onMobileSessionsOpenChange={env.setTerminalSessionsOpen}
          mobileSessionsTrigger={env.terminalSessionsTrigger}
          openSessionRequest={env.openTerminalInDirectoryRequest()}
          onOpenSessionRequestHandled={env.consumeOpenTerminalInDirectoryRequest}
        />
      </Show>
    </div>
  );
}
