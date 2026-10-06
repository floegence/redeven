import { Checkbox } from '@floegence/floe-webapp-core/ui';
import type { DesktopI18n } from '../shared/i18n';
import type { GatewayPermissions } from '../shared/gatewayMembership';

export function GatewayPermissionsEditor(props: Readonly<{
  i18n: DesktopI18n; value: GatewayPermissions; onChange: (permissions: GatewayPermissions) => void;
}>) {
  return <fieldset class="space-y-2 rounded-md border border-border p-3">
    <legend class="px-1 text-xs font-medium">{props.i18n.t('gatewayMembers.permissions')}</legend>
    <div class="flex flex-col gap-2">
    <Checkbox label={props.i18n.t('gatewayMembers.access')} checked={props.value.access}
      onChange={access => props.onChange({ ...props.value, access })} />
    <Checkbox label={props.i18n.t('gatewayMembers.manageMembers')} checked={props.value.manage_members}
      onChange={manage_members => props.onChange({ ...props.value, manage_members })} />
    <Checkbox label={props.i18n.t('gatewayMembers.configureCloud')} checked={props.value.configure_cloud}
      onChange={configure_cloud => props.onChange({ ...props.value, configure_cloud })} />
    </div>
    <p class="text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.permissionBoundary')}</p>
  </fieldset>;
}
