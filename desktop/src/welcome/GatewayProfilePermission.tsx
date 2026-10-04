import { Checkbox, createFloatingPresence } from '@floegence/floe-webapp-core/ui';
import { HelpIcon, ShieldCheck } from '@floegence/floe-webapp-core/icons';
import { Show, createSignal, createUniqueId } from 'solid-js';
import type { DesktopI18n } from '../shared/i18n';

export function GatewayProfilePermission(props: Readonly<{
  i18n: DesktopI18n;
  checked: boolean;
  onChange: (checked: boolean) => void;
}>) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  const presence = createFloatingPresence({ open, exitDurationMs: 160 });
  return (
    <div class="redeven-gateway-permission">
      <div class="redeven-gateway-permission__control">
        <Checkbox checked={props.checked} onChange={props.onChange}
          label={props.i18n.t('gatewayAccess.grantWrite')} size="sm" />
        <button type="button" class="redeven-gateway-permission__help"
          aria-label={props.i18n.t('gatewayAccess.profileHelpLabel')}
          aria-expanded={open()} aria-controls={presence.mounted() ? id : undefined}
          onClick={() => setOpen(value => !value)}>
          <HelpIcon class="h-4 w-4" />
        </button>
      </div>
      <Show when={presence.mounted()}>
        <div id={id} class="redeven-gateway-permission__explanation" data-state={presence.state()}
          aria-hidden={presence.exiting()} inert={presence.exiting()}>
          <ShieldCheck class="h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p class="font-medium text-foreground">{props.i18n.t('gatewayAccess.profileHelpTitle')}</p>
            <p>{props.i18n.t('gatewayAccess.profileHelpBody')}</p>
            <p>{props.i18n.t('gatewayAccess.profileHelpBoundary')}</p>
          </div>
        </div>
      </Show>
    </div>
  );
}
