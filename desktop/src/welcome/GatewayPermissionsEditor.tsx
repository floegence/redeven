import { Checkbox, Select } from '@floegence/floe-webapp-core/ui';
import { ChevronDown } from '@floegence/floe-webapp-core/icons';
import { createSignal } from 'solid-js';
import type { DesktopI18n } from '../shared/i18n';
import type { GatewayPermissions } from '../shared/gatewayMembership';

export function GatewayPermissionsEditor(props: Readonly<{
  i18n: DesktopI18n; value: GatewayPermissions; onChange: (permissions: GatewayPermissions) => void;
  disabled?: boolean;
}>) {
  const preset = () => props.value.access && props.value.manage_members && props.value.configure_cloud ? 'administrator'
    : props.value.access && !props.value.manage_members && !props.value.configure_cloud ? 'viewer' : 'custom';
  const [customizing, setCustomizing] = createSignal(preset() === 'custom');
  const [customSelected, setCustomSelected] = createSignal(false);
  const selection = () => customSelected() ? 'custom' : preset();
  const updatePermission = (permissions: GatewayPermissions) => {
    setCustomSelected(true);
    props.onChange(permissions);
  };
  return <fieldset class="space-y-3 rounded-lg border border-border/70 p-4" disabled={props.disabled}>
    <legend class="px-1 text-sm font-medium">{props.i18n.t('gatewayDesktopAccess.title')}</legend>
    <div role="group" aria-label={props.i18n.t('gatewayDesktopAccess.title')}>
      <Select value={selection()} disabled={props.disabled}
        options={(['viewer', 'administrator', 'custom'] as const).map(value => ({ value, label: props.i18n.t(`gatewayDesktopAccess.${value}`) }))}
        onChange={value => {
          setCustomSelected(value === 'custom');
          setCustomizing(value === 'custom');
          if (value !== 'custom') props.onChange({ access: true, manage_members: value === 'administrator', configure_cloud: value === 'administrator' });
        }} />
      <p class="mt-2 text-xs leading-5 text-muted-foreground">{props.i18n.t(`gatewayDesktopAccess.${selection()}Help`)}</p>
    </div>
    <details class="redeven-gateway-disclosure group border-t border-border/60 pt-2" open={customizing()}
      onToggle={event => setCustomizing(event.currentTarget.open)}>
      <summary class="flex list-none items-center justify-between gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        {props.i18n.t('gatewayDesktopAccess.customize')}<ChevronDown class="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div class="flex flex-col items-start gap-5 py-3">
        <Checkbox label={props.i18n.t('gatewayDesktopAccess.access')} checked={props.value.access} disabled={props.disabled}
          onChange={access => updatePermission({ ...props.value, access })} />
        <Checkbox label={props.i18n.t('gatewayDesktopAccess.members')} checked={props.value.manage_members} disabled={props.disabled}
          onChange={manage_members => updatePermission({ ...props.value, manage_members })} />
        <Checkbox label={props.i18n.t('gatewayDesktopAccess.cloud')} checked={props.value.configure_cloud} disabled={props.disabled}
          onChange={configure_cloud => updatePermission({ ...props.value, configure_cloud })} />
        <p class="text-xs leading-5 text-muted-foreground">{props.i18n.t('gatewayDesktopAccess.boundary')}</p>
      </div>
    </details>
  </fieldset>;
}
