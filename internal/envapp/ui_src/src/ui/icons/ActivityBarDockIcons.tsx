import {
  ActivityRailGlyph,
  RailGlobe,
  RailSettings,
  RailSwitch,
  type ActivityRailIconProps,
} from '@floegence/floe-webapp-core/icons';
import { FlowerIcon } from './FlowerIcon';

// Shared navigation geometry and state belong to Floe; these names preserve the
// product adapter boundary without maintaining a second renderer or icon set.
export {
  RailFiles as ActivityBarFolderIcon,
  RailTerminal as ActivityBarTerminalIcon,
  RailMonitor as ActivityBarMonitorIcon,
  RailCode as ActivityBarCodespacesIcon,
  RailApplications as ActivityBarHostApplicationsIcon,
  RailContainers as ActivityBarContainersIcon,
  RailConnections as ActivityBarTessivenIcon,
  RailLaunchpad as ActivityBarPluginsIcon,
} from '@floegence/floe-webapp-core/icons';

export function ActivityBarPortsIcon(props: ActivityRailIconProps) {
  return <RailGlobe {...props} data-activity-bar-icon="web-services" />;
}

export function ActivityBarSwitchIcon(props: ActivityRailIconProps) {
  return <RailSwitch {...props} data-activity-bar-icon="switch-environment" />;
}

export function ActivityBarSettingsIcon(props: ActivityRailIconProps) {
  return <RailSettings {...props} data-activity-bar-icon="runtime-settings" />;
}

export function ActivityBarAutomationIcon(props: ActivityRailIconProps) {
  return <ActivityRailGlyph {...props} identity="automation"
    shape={() => <><rect x="3.5" y="8.5" width="6" height="7" rx="2" /><rect x="15" y="3.5" width="5.5" height="6" rx="2" /><rect x="15" y="14.5" width="5.5" height="6" rx="2" /></>}
    lines={() => <path d="M9.5 12h2a1 1 0 0 0 1-1V7.5a1 1 0 0 1 1-1H15M12.5 11v5.5a1 1 0 0 0 1 1H15" />}
  />;
}

/** Preserve the product's five-petal artwork inside Floe's navigation frame. */
export function ActivityBarFlowerIcon(props: ActivityRailIconProps) {
  return (
    <FlowerIcon
      aria-hidden="true"
      {...props}
      variant="navigation"
      data-floe-rail-icon="flower"
      data-floe-rail-active={Boolean(props.active)}
    />
  );
}
