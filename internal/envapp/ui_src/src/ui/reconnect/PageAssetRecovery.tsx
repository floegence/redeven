import { Show } from 'solid-js';
import type { DocumentAssetRecoveryReason } from '@floegence/floe-webapp-core/app';
import { Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { reopenEnvironmentPage } from '../utils/windowNavigation';

type RecoveryActionProps = {
  ready: boolean;
  onReload?: () => void;
};

function ReloadAppButton(props: RecoveryActionProps) {
  const i18n = useI18n();
  return (
    <Button size="sm" variant="outline" icon={Refresh} class="shrink-0 cursor-pointer"
      disabled={!props.ready}
      onClick={() => props.onReload ? props.onReload() : reopenEnvironmentPage(window)}>
      {i18n.t(props.ready ? 'pageAssetRecovery.reload' : 'pageAssetRecovery.waiting')}
    </Button>
  );
}

export function PageAssetRecoveryNotice(props: RecoveryActionProps & { reason: DocumentAssetRecoveryReason }) {
  const i18n = useI18n();
  return (
    <Show when={props.reason}>
      <div role="status" aria-live="polite" class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-muted px-4 py-3 text-foreground">
        <div class="min-w-0 flex-1 basis-56">
          <p class="text-sm font-medium">{i18n.t(props.reason === 'updated' ? 'pageAssetRecovery.updated' : 'pageAssetRecovery.failed')}</p>
          <p class="mt-1 text-xs text-muted-foreground">{i18n.t('pageAssetRecovery.guidance')}</p>
        </div>
        <ReloadAppButton ready={props.ready} onReload={props.onReload} />
      </div>
    </Show>
  );
}

export function PageLoadError(props: RecoveryActionProps) {
  const i18n = useI18n();
  return (
    <div role="alert" class="flex h-full min-h-0 items-center justify-center overflow-auto bg-background p-6 text-foreground">
      <div class="max-w-md space-y-3 text-center">
        <h2 class="text-base font-semibold">{i18n.t('pageAssetRecovery.pageFailed')}</h2>
        <p class="text-sm text-muted-foreground">{i18n.t('pageAssetRecovery.guidance')}</p>
        <ReloadAppButton ready={props.ready} onReload={props.onReload} />
      </div>
    </div>
  );
}
