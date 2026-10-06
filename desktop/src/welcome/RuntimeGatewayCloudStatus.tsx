import { Button } from '@floegence/floe-webapp-core/ui';
import type { DesktopI18n } from '../shared/i18n';
import { runtimeGatewayManagementURL, type RuntimeGatewayCloudAccess } from '../shared/runtimeGatewayCloud';

export function RuntimeGatewayCloudStatus(props: Readonly<{
  access: RuntimeGatewayCloudAccess;
  i18n: DesktopI18n;
  openInBrowser: (url: string) => Promise<void>;
}>) {
  const state = () => {
    switch (props.access.state) {
      case 'connected': return props.i18n.t('providerRecovery.connected');
      case 'connecting': return props.i18n.t('providerRecovery.connecting');
      case 'pending': return props.i18n.t('gatewayCloud.pending');
      case 'revoked': return props.i18n.t('gatewayCloud.revoked');
      case 'disabled': return props.i18n.t('gatewayCloud.runtimeDisabled');
    }
  };
  return <div class="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-xs">
    <div class="min-w-0"><p class="font-medium">{props.i18n.t('gatewayCloud.viaGateway')}</p><p role="status" class="text-muted-foreground">{state()}</p></div>
    <Button size="sm" variant="ghost" class="cursor-pointer" onClick={() => void props.openInBrowser(runtimeGatewayManagementURL(props.access))}>{props.i18n.t('gatewayCloud.manage')}</Button>
  </div>;
}
