import {
  ActivityRailGlyph,
  RailGlobe,
  RailSettings,
  RailSwitch,
  type ActivityRailIconProps,
} from '@floegence/floe-webapp-core/icons';

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

/** Product-owned Flower outline, using Floe's shared light-face/solid recipe. */
export function ActivityBarFlowerIcon(props: ActivityRailIconProps) {
  return (
    <ActivityRailGlyph
      {...props}
      identity="flower"
      shape={() => <path d="M12 3.5c2 0 3.4 1.5 3.3 3.5 1.9-.7 3.7.2 4.2 2.1.6 1.9-.2 3.5-2 4.2 1.3 1.5 1.1 3.4-.5 4.6-1.6 1.2-3.4.9-4.5-.6-1 1.7-2.8 2.2-4.5 1.2-1.7-1-2.1-2.8-1.1-4.5-1.9-.3-3-1.9-2.7-3.8.4-1.9 2-3 3.9-2.5C7.8 5.5 9.5 3.5 12 3.5Z" />}
      detail={() => <circle cx="12" cy="11.25" r="2" />}
    />
  );
}
