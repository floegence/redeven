import { For, Show, createEffect, createSignal, on } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import { environmentAccessRouteLabel } from './environmentAccessPresentation';

export function EnvironmentAccessSettings(props: {
  environment: DesktopEnvironmentEntry;
  i18n: DesktopI18n;
  save: (environmentID: string, routeID: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = createSignal(props.environment.default_access_route_id ?? '');
  const [saving, setSaving] = createSignal(false);
  createEffect(on(() => props.environment.id, () => setDraft(props.environment.default_access_route_id ?? '')));
  return <Show when={(props.environment.access_routes?.length ?? 0) > 1 || props.environment.default_access_route_missing}>
    <fieldset class="redeven-access-settings" disabled={saving()}>
      <legend>{props.i18n.t('gatewayAccess.defaultConnection')}</legend>
      <p>{props.i18n.t('gatewayAccess.defaultHelp')}</p>
      <div class="redeven-access-settings__routes">
        <For each={props.environment.access_routes}>{route => (
          <label class="redeven-access-choice" data-selected={draft() === route.id}>
            <input type="radio" name={`access-route-${props.environment.id}`} value={route.id} checked={draft() === route.id}
              onChange={() => setDraft(route.id)} />
            <span><strong>{environmentAccessRouteLabel(route, props.i18n)}</strong>
              <small>{props.i18n.t(route.kind === 'gateway_member' ? 'gatewayAccess.routeIsolation' : 'gatewayAccess.directManagementUnchanged')}</small></span>
          </label>
        )}</For>
      </div>
      <Show when={props.environment.default_access_route_missing}><p role="status">{props.i18n.t('gatewayAccess.defaultMissing')}</p></Show>
      <div class="flex justify-end">
        <Button size="sm" variant="outline" disabled={saving() || draft() === props.environment.default_access_route_id || !props.environment.access_routes?.some(route => route.id === draft())}
          loading={saving()} onClick={() => { setSaving(true); void props.save(props.environment.id, draft()).finally(() => setSaving(false)); }}>
          {props.i18n.t('gatewayAccess.saveDefault')}
        </Button>
      </div>
    </fieldset>
  </Show>;
}
