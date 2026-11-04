import {
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
