import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { EnvironmentAccessRoute } from '../shared/environmentAccess';
import type { DesktopI18n } from '../shared/i18n';
import type { EnvironmentActionPresentation } from './viewModel';

export function environmentAccessRouteLabel(route: EnvironmentAccessRoute, i18n: DesktopI18n): string {
  return route.kind === 'gateway_member' ? i18n.t('gatewayAccess.viaNamedGateway', { gateway: route.gateway_label ?? route.label })
    : i18n.t('gatewayAccess.registeredConnection');
}

/** Access choices extend the existing split button without changing lifecycle owners. */
export function environmentAccessPresentation(entry: DesktopEnvironmentEntry, presentation: EnvironmentActionPresentation, i18n: DesktopI18n): EnvironmentActionPresentation {
  if (entry.kind === 'provider_environment' || !entry.access_routes?.length) return presentation;
  const routes = entry.access_routes;
  const selected = routes.find(route => route.id === entry.default_access_route_id);
  const open = (route: EnvironmentAccessRoute) => ({ intent: 'open' as const, enabled: true, variant: 'outline' as const,
    label: environmentAccessRouteLabel(route, i18n), access_route_id: route.id });
  return { ...presentation,
    primary_action: !selected ? { ...presentation.primary_action, intent: 'unavailable', enabled: false,
      label: i18n.t('gatewayAccess.chooseDefault'), disabled_reason: i18n.t('gatewayAccess.defaultMissing') }
      : selected.environment_id === entry.id ? presentation.primary_action
      : { ...open(selected), variant: 'default', label: i18n.t(selected.is_open ? 'environmentAction.focus' : 'environmentAction.open') },
    primary_action_overlay: selected?.kind === 'direct' ? presentation.primary_action_overlay : {
      kind: 'tooltip', tone: selected ? 'neutral' : 'warning',
      message: selected ? environmentAccessRouteLabel(selected, i18n) : i18n.t('gatewayAccess.defaultMissing'),
    },
    menu_actions: [...(routes.length > 1 || !selected ? routes.map(route => ({ id: `access:${route.id}`, action: open(route),
      label: `${environmentAccessRouteLabel(route, i18n)}${route.id === selected?.id ? ` · ${i18n.t('gatewayAccess.defaultLabel')}` : ''}` })) : []),
      ...presentation.menu_actions],
  };
}
