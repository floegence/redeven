import type {
  DesktopEnvironmentEntry,
  DesktopLauncherSurface,
  DesktopLocalEnvironmentStateRoute,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import { desktopControlPlaneKey, type DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import type { DesktopControlPlaneSyncState } from '../shared/providerEnvironmentState';
import {
  runtimeServiceAllowsOpenAttempt,
  runtimeServiceOpenReadinessLabel,
  runtimeServiceIsOpenable,
  runtimeServiceNeedsRuntimeUpdate,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';
import { buildDesktopProviderRuntimeLinkPlan } from '../shared/providerRuntimeLinkPlanner';
import {
  normalizeDesktopProviderRuntimeLinkTargetID,
  type DesktopProviderRuntimeLinkTarget,
  type DesktopProviderRuntimeLinkTargetID,
} from '../shared/providerRuntimeLinkTarget';
import {
  desktopEntryKindOwnsRuntimeManagement,
  desktopProviderEnvironmentOpenRoute,
} from '../shared/environmentManagementPrinciples';
import {
  desktopRuntimeOperationIsVisible,
  type DesktopRuntimeOperation,
  type DesktopRuntimeOperationMethod,
  type DesktopRuntimeOperationPlan,
} from '../shared/desktopRuntimeOperations';
import {
  desktopRuntimeMaintenanceIsStaleLock,
  desktopRuntimeMaintenanceRequiresRestart,
  desktopRuntimeMaintenanceRequiresUpdate,
} from '../shared/desktopRuntimeHealth';

export type DesktopWelcomeShellViewModel = Readonly<{
  shell_title: 'Redeven Desktop';
  surface_title: string;
  connect_heading: 'Connect Environment';
  primary_action_label: 'Open Environment';
  settings_save_key: string;
}>;

export type EnvironmentCenterTab = 'environments' | 'control_planes';
export type EnvironmentCardTone = 'neutral' | 'primary' | 'success' | 'warning';
export type EnvironmentLibraryLayoutDensity = 'compact' | 'spacious';

export type EnvironmentLibraryLayoutModel = Readonly<{
  visible_card_count: number;
  layout_reference_count: number;
  density: EnvironmentLibraryLayoutDensity;
  column_count: number;
}>;

export type EnvironmentCardMetaItem = Readonly<{
  label: string;
  value: string;
  monospace?: boolean;
}>;

export type EnvironmentCardFactActionModel = Readonly<
  | {
      kind: 'filter_runtime_target';
      runtime_target_id: DesktopProviderRuntimeLinkTargetID;
      label: string;
      aria_label: string;
    }
>;

export type EnvironmentCardFactModel = Readonly<{
  label: string;
  value: string;
  value_tone: 'default' | 'placeholder';
  action?: EnvironmentCardFactActionModel;
  label_icon?: string;
  leading_icon?: string;
  endpoints?: readonly EnvironmentCardEndpointModel[];
  copy_value?: true;
}>;

export type EnvironmentCardEndpointModel = Readonly<{
  label: string;
  value: string;
  monospace: boolean;
  copy_label: string;
}>;

const DOCKER_ICON = 'data:image/svg+xml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+RG9ja2VyPC90aXRsZT48cGF0aCBkPSJNMTMuOTgzIDExLjA3OGgyLjExOWEuMTg2LjE4NiAwIDAwLjE4Ni0uMTg1VjkuMDA2YS4xODYuMTg2IDAgMDAtLjE4Ni0uMTg2aC0yLjExOWEuMTg1LjE4NSAwIDAwLS4xODUuMTg1djEuODg4YzAgLjEwMi4wODMuMTg1LjE4NS4xODVtLTIuOTU0LTUuNDNoMi4xMThhLjE4Ni4xODYgMCAwMC4xODYtLjE4NlYzLjU3NGEuMTg2LjE4NiAwIDAwLS4xODYtLjE4NWgtMi4xMThhLjE4NS4xODUgMCAwMC0uMTg1LjE4NXYxLjg4OGMwIC4xMDIuMDgyLjE4NS4xODUuMTg1bTAgMi43MTZoMi4xMThhLjE4Ny4xODcgMCAwMC4xODYtLjE4NlY2LjI5YS4xODYuMTg2IDAgMDAtLjE4Ni0uMTg1aC0yLjExOGEuMTg1LjE4NSAwIDAwLS4xODUuMTg1djEuODg3YzAgLjEwMi4wODIuMTg1LjE4NS4xODZtLTIuOTMgMGgyLjEyYS4xODYuMTg2IDAgMDAuMTg0LS4xODZWNi4yOWEuMTg1LjE4NSAwIDAwLS4xODUtLjE4NUg4LjFhLjE4NS4xODUgMCAwMC0uMTg1LjE4NXYxLjg4N2MwIC4xMDIuMDgzLjE4NS4xODUuMTg2bS0yLjk2NCAwaDIuMTE5YS4xODYuMTg2IDAgMDAuMTg1LS4xODZWNi4yOWEuMTg1LjE4NSAwIDAwLS4xODUtLjE4NUg1LjEzNmEuMTg2LjE4NiAwIDAwLS4xODYuMTg1djEuODg3YzAgLjEwMi4wODQuMTg1LjE4Ni4xODZtNS44OTMgMi43MTVoMi4xMThhLjE4Ni4xODYgMCAwMC4xODYtLjE4NVY5LjAwNmEuMTg2LjE4NiAwIDAwLS4xODYtLjE4NmgtMi4xMThhLjE4NS4xODUgMCAwMC0uMTg1LjE4NXYxLjg4OGMwIC4xMDIuMDgyLjE4NS4xODUuMTg1bS0yLjkzIDBoMi4xMmEuMTg1LjE4NSAwIDAwLjE4NC0uMTg1VjkuMDA2YS4xODUuMTg1IDAgMDAtLjE4NC0uMTg2aC0yLjEyYS4xODUuMTg1IDAgMDAtLjE4NC4xODV2MS44ODhjMCAuMTAyLjA4My4xODUuMTg1LjE4NW0tMi45NjQgMGgyLjExOWEuMTg1LjE4NSAwIDAwLjE4NS0uMTg1VjkuMDA2YS4xODUuMTg1IDAgMDAtLjE4NC0uMTg2aC0yLjEyYS4xODYuMTg2IDAgMDAtLjE4Ni4xODZ2MS44ODdjMCAuMTAyLjA4NC4xODUuMTg2LjE4NW0tMi45MiAwaDIuMTJhLjE4NS4xODUgMCAwMC4xODQtLjE4NVY5LjAwNmEuMTg1LjE4NSAwIDAwLS4xODQtLjE4NmgtMi4xMmEuMTg1LjE4NSAwIDAwLS4xODQuMTg1djEuODg4YzAgLjEwMi4wODIuMTg1LjE4NS4xODVNMjMuNzYzIDkuODljLS4wNjUtLjA1MS0uNjcyLS41MS0xLjk1NC0uNTEtLjMzOC4wMDEtLjY3Ni4wMy0xLjAxLjA4Ny0uMjQ4LTEuNy0xLjY1My0yLjUzLTEuNzE2LTIuNTY2bC0uMzQ0LS4xOTktLjIyNi4zMjdjLS4yODQuNDM4LS40OS45MjItLjYxMiAxLjQzLS4yMy45Ny0uMDkgMS44ODIuNDAzIDIuNjYxLS41OTUuMzMyLTEuNTUuNDEzLTEuNzQ0LjQySC43NTFhLjc1MS43NTEgMCAwMC0uNzUuNzQ4IDExLjM3NiAxMS4zNzYgMCAwMC42OTIgNC4wNjJjLjU0NSAxLjQyOCAxLjM1NSAyLjQ4IDIuNDEgMy4xMjQgMS4xOC43MjMgMy4xIDEuMTM3IDUuMjc1IDEuMTM3Ljk4My4wMDMgMS45NjMtLjA4NiAyLjkzLS4yNjZhMTIuMjQ4IDEyLjI0OCAwIDAwMy44MjMtMS4zODljLjk4LS41NjcgMS44Ni0xLjI4OCAyLjYxLTIuMTM2IDEuMjUyLTEuNDE4IDEuOTk4LTIuOTk3IDIuNTUzLTQuNGguMjIxYzEuMzcyIDAgMi4yMTUtLjU0OSAyLjY4LTEuMDA5LjMwOS0uMjkzLjU1LS42NS43MDctMS4wNDZsLjA5OC0uMjg4WiIvPjwvc3ZnPg==';

const PODMAN_ICON = 'data:image/svg+xml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+UG9kbWFuPC90aXRsZT48cGF0aCBkPSJNMTcuMi4yNzVMNi43NS4zMDhhLjI1OS4yNTkgMCAwIDAtLjIwMy4wOThMLjA1NiA4LjYwMmEuMjU5LjI1OSAwIDAgMC0uMDUuMjE5bDIuMzU2IDEwLjE5NGEuMjYuMjYgMCAwIDAgLjE0LjE3NGw5LjQzIDQuNTExYS4yNTguMjU4IDAgMCAwIC4yMjQtLjAwMmw5LjQwMS00LjU2NmEuMjU5LjI1OSAwIDAgMCAuMTQxLS4xNzVMMjMuOTkzIDguNzVhLjI1OC4yNTggMCAwIDAtLjA1MS0uMjJMMTcuNDAzLjM3NEEuMjU5LjI1OSAwIDAgMCAxNy4yLjI3NXptLS4xMjMuNTE3bDYuMzg1IDcuOTY2LTIuMjQyIDkuOTY0LTkuMTc3IDQuNDU3LTkuMjA1LTQuNDAyTC41NCA4LjgyNyA2Ljg3NS44MjR6TTExLjQ2IDIuODU3Yy0uOTMzIDAtMS44NC4xLTIuNDI2LjMzMmgtLjAwMmMtMS41NTQuNTY5LTIuNzI1IDIuMTA1LTMuMDc0IDMuOTUydi4wMDRjLS4zMDkgMS40NjMtLjM5MiAyLjcwMy0uNTU2IDMuODI0LS4wNy40ODEtLjE1OS45NC0uMjgzIDEuMzg3LS42MjguNDk3LTEuMDc5IDEuMjYzLTEuMjQ0IDIuMTM4di4wMDRjLS4xMTYuNTQ3LS4xODEgMS4wNC0uMjM3IDEuNWgtLjY0NHYuNTE4aDguODkxYy0uMDYxLjQ2NC0uMTIyLjk5Ni0uMTgxIDEuNDJINy41OTZ2LjUxN2g3LjkzOWMtLjI0Mi0uMDc4LS40ODYtLjIxOC0uNzU2LS41MDJoLS42OTdsLS44NS40ODgtLjIzMi0uMzk2LjE2Mi0uMDkyaC0xLjA2OWMuMTEzLS43NzYuMTctMS42MDEuMzczLTIuNTY0di0uMDA0Yy4yMi0xLjE2NC45Ni0yLjExMiAxLjg5NS0yLjQ1M2wuMDA0LS4wMDJoLjAwMmMuMzE4LS4xMjcuOTI4LS4yMDUgMS41NDMtLjIwNS42MTMgMCAxLjI0NC4wNzUgMS42MjIuMjA3LjkzNS4zNDEgMS42NzYgMS4yOSAxLjg5NSAyLjQ1M3YuMDA0Yy4yMDQuOTYzLjI2IDEuNzg4LjM3MyAyLjU2NGgtLjc0MmwuMTYyLjA5Mi0uMjMzLjM5Ni0uODUtLjQ4OGgtLjc1Yy0uMjE5LjI1LS40NzQuNDEyLS43NDcuNTAyaDQuMzAydi0uNTE4aC0uODQyYy0uMTAzLS43NDMtLjE4MS0xLjY3LS4zODItMi42MjN2LS4wMDJhNC4xNCA0LjE0IDAgMCAwLS4yNjQtLjg2M2gxLjg2M3YtLjUxN2gtMi4xM2EzLjQ4OCAzLjQ4OCAwIDAgMC0uOC0uOTA2aDEuOHYtLjUxOEgxNy45NWE4Ljg2MiA4Ljg2MiAwIDAgMS0uMTkzLS43NzVoMS40ODR2LS41MThoLTEuNTc2Yy0uMDEzLS4wODEtLjAyNy0uMTYxLS4wMzktLjI0NC0uMTY0LTEuMTItLjI0Ni0yLjM2LS41NTUtMy44MjR2LS4wMDRjLS4zNDgtMS44NDgtMS41Mi0zLjM4My0zLjA3NS0zLjk1MmwtLjAwMi0uMDAyaC0uMDAyYy0uNjUtLjIyNy0xLjU5Ni0uMzMtMi41MzEtLjMzem0wIC4zODZjLjkwNCAwIDEuODMzLjExIDIuNDA0LjMwOWguMDAyYzEuNC41MTQgMi41IDEuOTM0IDIuODI2IDMuNjY2di4wMDNjLjMwMyAxLjQzNi4zODUgMi42Ni41NTIgMy44MDUuMDc2LjUxNS4xNzMgMS4wMTMuMzE1IDEuNTA1LS40NDktLjEzNS0xLjA1LS4xOTctMS42NDgtLjE5Ny0uMTIgMC0uMjM2LjAwMy0uMzUyLjAwOGwtMS44NjMtMS44NjVhMi4xNyAyLjE3IDAgMCAwIC4xMS0uMjQ2bDIuMTMgMS4yMy4xMy0uMjI0LTIuMTg1LTEuMjYyYy4wMTYtLjA2OS4wMjctLjE0LjAzNi0uMjFsMi4zMDIuNjE2LjA2OC0uMjQ4LTIuMzU0LS42M2MtLjAyLTEuMTUzLTEuMDA4LTIuMDc4LTIuMjA4LTIuMDc4LTEuMjA1IDAtMi4xOTYuOTMxLTIuMjA2IDIuMDkxbC0yLjMwMy42MTcuMDY2LjI1IDIuMjUyLS42MDVjLjAxLjA3Ni4wMjQuMTUxLjA0MS4yMjRMNy40MzYgMTEuMjRsLjEyOS4yMjIgMi4wODctMS4yMDdjLjAzNC4wODkuMDc0LjE3Ni4xMi4yNThsLTEuMjY2IDEuMjY2YTYuOTU5IDYuOTU5IDAgMCAwLTEuMDQ1LS4wNzVjLS42MDMgMC0xLjE4Ni4wNjQtMS41NzguMjJhMi42NjggMi42NjggMCAwIDAtLjI4NS4xMjRjLjA3Ni0uMzM1LjEzNy0uNjc1LjE4Ny0xLjAyMS4xNjgtMS4xNDQuMjQ4LTIuMzcuNTUxLTMuODA1bC4wMDItLjAwMXYtLjAwMmMuMzI2LTEuNzMzIDEuNDI2LTMuMTUzIDIuODI4LTMuNjY2aC4wMDJsLjAwNC0uMDAyYy40ODgtLjE5NCAxLjM4MS0uMzA3IDIuMjg3LS4zMDd6TTguNDczIDUuMTk0YTEuMjk1IDEuMjk1IDAgMCAwLS45NjUuNTAybC0uMTE3LjE1My4zMDYuMjM2LjEyLS4xNTJhLjkyMy45MjMgMCAwIDEgLjY3My0uMzUyLjkyLjkyIDAgMCAxIC42Ny4yNjJsLjEzOS4xMzQuMjcxLS4yNzUtLjEzNi0uMTM3YTEuMjkzIDEuMjkzIDAgMCAwLS45NjEtLjM3em02LjM5IDBhMS4yODkgMS4yODkgMCAwIDAtLjk2LjM3MWwtLjEzOC4xMzcuMjc0LjI3NS4xMzYtLjEzNGEuOTIzLjkyMyAwIDAgMSAuNjcyLS4yNjIuOTIzLjkyMyAwIDAgMSAuNjc0LjM1MmwuMTE5LjE1Mi4zMDctLjIzNi0uMTItLjE1M2MtLjIzLS4zLS41ODctLjQ4Ni0uOTY0LS41MDJ6TTguNTMgNi43MDhjLS42NDIgMC0xLjE2NC41MzgtMS4xNjQgMS4xOSAwIC42NS41MjIgMS4xODcgMS4xNjQgMS4xODcuNjQzIDAgMS4xNjQtLjUzNiAxLjE2NC0xLjE4OCAwLS42NTEtLjUyMS0xLjE5LTEuMTY0LTEuMTl6bTYuMjczIDBjLS42NDMgMC0xLjE2Mi41MzgtMS4xNjIgMS4xOSAwIC42NS41MiAxLjE4NyAxLjE2MiAxLjE4Ny42NDMgMCAxLjE2NC0uNTM2IDEuMTY0LTEuMTg4IDAtLjY1MS0uNTIxLTEuMTktMS4xNjQtMS4xOXptLTYuMjczLjM4N2MuNDI4IDAgLjc3Ni4zNTUuNzc2LjgwMiAwIC40NDctLjM0OC44LS43NzYuOGEuNzg1Ljc4NSAwIDAgMS0uNzc1LS44YzAtLjAzNS4wMDItLjA3LjAwNi0uMTAzLjA3LjE5MS4yNDguMzE4LjQ0NS4zMThhLjQ4Ny40ODcgMCAwIDAgLjQ3Ny0uNDk2LjQ5LjQ5IDAgMCAwLS4zODMtLjQ4Ni43NTkuNzU5IDAgMCAxIC4yMy0uMDM1em02LjI3MyAwYy40MjggMCAuNzc3LjM1NS43NzcuODAyIDAgLjQ0Ny0uMzQ5LjgtLjc3Ny44YS43ODUuNzg1IDAgMCAxLS43Ny0uOWMuMDcyLjE5LjI0OC4zMTUuNDQ0LjMxNWEuNDg2LjQ4NiAwIDAgMCAuNDc5LS40OTYuNDkxLjQ5MSAwIDAgMC0uMzgzLS40ODQuNzU1Ljc1NSAwIDAgMSAuMjMtLjAzN3ptLTMuMDguNzE2YzEuMDEyIDAgMS44MTkuNzc1IDEuODE5IDEuNzIzIDAgLjk0Ny0uODA3IDEuNzIyLTEuODE5IDEuNzIycy0xLjgyLS43NzUtMS44Mi0xLjcyMmMwLS45NDguODA4LTEuNzIzIDEuODItMS43MjN6bS0uMDAyLjUyOGMtLjE0MiAwLS4yNTguMDQzLS4zNTUuMDc2YS44MDQuODA0IDAgMCAxLS4yMzIuMDU0Yy0uMTA3IDAtLjIuMDQ3LS4yNjguMTI3YS41NjguNTY4IDAgMCAwLS4xMDQuMjA3Yy0uMDQuMTM0LS4wNjIuMjY4LS4wOC4zMTVhLjI3Ni4yNzYgMCAwIDAgLjAzMi4yNWMuMDMzLjA1Ni4wNzEuMS4xMTcuMTQ2LjA5LjA5Mi4yMDYuMTgzLjMyMi4yNjguMTIuMDg4LjIzNy4xNjYuMzI2LjIyNGwtLjAwOC4wOWMtLjA0My4wMzYtLjE0LjEwMi0uMzI0LjE3OGEuNTMzLjUzMyAwIDAgMS0uMjk5LjAyNS40My40MyAwIDAgMS0uMjM2LS4xNzJjLjAxNS0uMTM4LjA0NC0uMjkzLjA2OC0uNDQ5bC0uMzc2LS4wOTVjLS4wNS4yMzgtLjA2Ny40My0uMDk0LjY0bC4wMzcuMDU5Yy4xNDMuMjI0LjMxOC4zNDQuNTA2LjM5MmEuOTA4LjkwOCAwIDAgMCAuNTItLjAzMyAxLjU3IDEuNTcgMCAwIDAgLjQ0NC0uMjQyYy4wODguMDY3LjI0NC4xNzQuNDQ2LjI0MmEuOTA4LjkwOCAwIDAgMCAuNTIuMDMzLjg2OC44NjggMCAwIDAgLjUwNy0uMzkybC4wMzctLjA1OWE2LjI5MiA2LjI5MiAwIDAgMC0uMDk2LS42MzdsLS4zNzcuMDkyYy4wMzIuMTQ4LjA1MS4zMi4wNy40NTFhLjQzNC40MzQgMCAwIDEtLjIzNy4xNy41MzMuNTMzIDAgMCAxLS4zLS4wMjVjLS4xNzgtLjA2OC0uMjcyLS4xNC0uMzI1LS4xNzhsLS4wMDYtLjA4NGMuMDktLjA1OC4yMDktLjEzNy4zMzYtLjIzLjExNS0uMDg1LjIzMS0uMTc2LjMyMi0uMjY4YS43Mi43MiAwIDAgMCAuMTE3LS4xNDYuMjczLjI3MyAwIDAgMCAuMDMxLS4yNWMtLjAxOC0uMDQ3LS4wMzktLjE4MS0uMDgtLjMxNWEuNTY0LjU2NCAwIDAgMC0uMTAzLS4yMDcuMzQzLjM0MyAwIDAgMC0uMjY4LS4xMjcuODE1LjgxNSAwIDAgMS0uMjM0LS4wNTRjLS4wOTctLjAzMy0uMjEyLS4wNzYtLjM1NC0uMDc2em0uMDAyLjM4NmMuMDU3IDAgLjEzNC4wMjQuMjMuMDU3LjA5LjAzLjIwOC4wNy4zMzcuMDc2LjA0LjEwMi4wNi4yMzcuMDkuMzM4YS4zNjEuMzYxIDAgMCAxLS4wNDEuMDQ1IDIuNjYgMi42NiAwIDAgMS0uMjc2LjIyOGMtLjE2NS4xMjItLjI3MS4xODgtLjM0Mi4yMzNhNS4yODcgNS4yODcgMCAwIDEtLjM0LS4yMzMgMi41NTcgMi41NTcgMCAwIDEtLjI3NS0uMjI4LjM0LjM0IDAgMCAxLS4wNC0uMDQ3Yy4wMzUtLjExOS4wNDYtLjIzNC4wODktLjM0LjA4LjAxMi4yNDYtLjA0Mi4zMzYtLjA3MmEuODM3LjgzNyAwIDAgMSAuMjMyLS4wNTd6bS0zLjIzNC42MWEuNjM1LjYzNSAwIDAgMC0uNjExLjUxN2wxLjA4NC0uMjg5YS42MTQuNjE0IDAgMCAwLS40NzMtLjIyOHptNi4zMzYgMGEuNjEuNjEgMCAwIDAtLjQzNi4xODdjLjM1Mi4wOTYuNjkuMTg0IDEuMDMzLjI3NWEuNjMyLjYzMiAwIDAgMC0uNTk3LS40NjJ6bS0uNjIzLjYwN2MtLjAwNy4wMzUtLjAwMi4wNy0uMDAyLjEwM2wuOTIxLjUzMmEuNjQ4LjY0OCAwIDAgMCAuMjc2LS4zMTNsLTEuMTk1LS4zMjJ6bS01LjA4Ni4wNWwtMS4xOC4zMTVjLjA3OC4xNS4yMDcuMjY0LjM2Mi4zMTZsLjc5Ny0uNDZjLjAxOC0uMDU5LjAxNS0uMTIuMDIxLS4xN3ptNC40NDEuNzE0bDEuNjU2IDEuNjU4YTQuMTkgNC4xOSAwIDAgMC0uODI2LjE0NmwtLjk1LTEuNjQ3YTIuNTEgMi41MSAwIDAgMCAuMTItLjE1N3ptLTMuNjQ2LjAzYy4wNC4wNTUuMDgzLjExOC4xMjkuMTY5bC0uNjU4IDEuMTM0YTIuNjU2IDIuNjU2IDAgMCAwLS4yNzYtLjExOWwtLjAwMi0uMDAyYTMuMyAzLjMgMCAwIDAtLjI5Mi0uMDgyem0zLjMzOC4zMTdsLjg5MiAxLjU0N2MtLjYyMy4yNTEtMS4xNDkuNzI1LTEuNTIzIDEuMzNoLTEuNjUyYy0uMjYyLS43NS0uNzQxLTEuMzgtMS4zNTgtMS43NjRsLjYyMy0xLjA4MmMuMzk0LjM0Ny45MTkuNTU5IDEuNDkyLjU1OWEyLjI1IDIuMjUgMCAwIDAgMS41MjYtLjU5ek03LjQ2IDEyLjA5Yy41NzQgMCAxLjE2Ny4wNzMgMS41MTguMTk1Ljg2Ny4zMTkgMS41NTUgMS4yMDMgMS43NiAyLjI4NWwuMDAxLjAwMnYuMDAyYy4xMDkuNTEzLjE3My45OC4yMjcgMS40MjRIOS44NmEuMzg2LjM4NiAwIDAgMC0uNDk0IDBIOS4xMWExLjM1MSAxLjM1MSAwIDAgMC0uMDc4LS40MTguNzk5Ljc5OSAwIDAgMCAuNTY5LjIzOGMuNDUgMCAuODE0LS4zNzUuODE0LS44MjhhLjgyNC44MjQgMCAwIDAtLjgxNC0uODI4LjgyMi44MjIgMCAwIDAtLjc5MSAxLjAxNiAxLjQ5NSAxLjQ5NSAwIDAgMC0xLjE4LS41NTljLS43OTggMC0xLjQ2LjYxMS0xLjQ4IDEuMzhoLS4zNDJhLjM4Ni4zODYgMCAwIDAtLjQ5NCAwSDQuMDI4Yy4wNTQtLjQ0NS4xMTYtLjkxMi4yMjQtMS40MjVsLjAwMi0uMDAydi0uMDAyYy4yMDUtMS4wODQuODk0LTEuOTcgMS43NjQtMi4yODdoLjAwMmwuMDA0LS4wMDJjLjI5NS0uMTE3Ljg2My0uMTkxIDEuNDM3LS4xOXptLTEuOTEgMS4xMDVhLjg5OC44OTggMCAwIDAtLjY3LjM0OGwtLjExOS4xNTQuMzA3LjIzNy4xMTktLjE1NWEuNTI1LjUyNSAwIDAgMSAuMzc5LS4xOTcuNTIuNTIgMCAwIDEgLjM3Ny4xNDdsLjEzOC4xMzYuMjcyLS4yNzUtLjEzNy0uMTM3YS44OTUuODk1IDAgMCAwLS42NjYtLjI1OHptNC4wOTQgMGEuOS45IDAgMCAwLS42NjguMjU4bC0uMTM3LjEzNy4yNzMuMjc1LjEzNy0uMTM2YS41MjIuNTIyIDAgMCAxIC4zNzctLjE0Ny41MjUuNTI1IDAgMCAxIC4zNzkuMTk3bC4xMTkuMTU1LjMwNy0uMjM3LS4xMi0uMTU0YS44OTQuODk0IDAgMCAwLS42NjctLjM0OHptNC4yMjIuNzM1YS45NDcuOTQ3IDAgMCAwLS43MDcuMzY1bC0uMTE3LjE1NC4zMDYuMjM3LjEyLS4xNTVhLjU2OC41NjggMCAwIDEgLjQxMy0uMjEzLjU3MS41NzEgMCAwIDEgLjQxNC4xNTlsLjE0LjEzNi4yNy0uMjc1LS4xMzgtLjEzN2EuOTQyLjk0MiAwIDAgMC0uNzAxLS4yNzF6bTQuMzc0IDBhLjk0Mi45NDIgMCAwIDAtLjcuMjcxbC0uMTQuMTM3LjI3Mi4yNzUuMTM5LS4xMzZhLjU3MS41NzEgMCAwIDEgLjQxNC0uMTU5LjU2OC41NjggMCAwIDEgLjQxNC4yMTNsLjExOS4xNTUuMzA2LS4yMzctLjExNy0uMTU0YS45NDcuOTQ3IDAgMCAwLS43MDctLjM2NXptLTEyLjY1LjIzMmEuODI0LjgyNCAwIDAgMC0uODE1LjgyOGMwIC40NTMuMzY1LjgyOC44MTQuODI4LjQ1IDAgLjgxNS0uMzc1LjgxNS0uODI4YS44MjQuODI0IDAgMCAwLS44MTUtLjgyOHptNS41MTguMjg1aDEuMjQyYTQuMTM3IDQuMTM3IDAgMCAwLS4yNjMuODY0di4wMDJjLS4wNS4yMzctLjA5Mi40NjQtLjEyNy42ODVoLS42MDJhMTYuNzcgMTYuNzcgMCAwIDAtLjIzNi0xLjVsLS4wMDItLjAwMmMtLjAwMy0uMDE2LS4wMDktLjAzMi0uMDEyLS4wNDl6bS01LjUxOS4xMDJhLjQzLjQzIDAgMCAxIC40MjYuNDQxLjQzLjQzIDAgMCAxLS40MjYuNDQyYy0uMjIgMC0uNC0uMTcxLS40MjItLjM5N2EuMjk4LjI5OCAwIDAgMCAuMjE1LjA5Mi4zMS4zMSAwIDAgMCAuMzA1LS4zMTYuMzE3LjMxNyAwIDAgMC0uMTI5LS4yNThjLjAxLS4wMDEuMDItLjAwNC4wMzEtLjAwNHptNC4wMTQgMGMuMjM1IDAgLjQyNy4xOTMuNDI3LjQ0MWEuNDMzLjQzMyAwIDAgMS0uNDI3LjQ0Mi40MjcuNDI3IDAgMCAxLS40MjItLjQwNS4zLjMgMCAwIDAgLjI1Ni4xNDUuMzEuMzEgMCAwIDAgLjMwNC0uMzE3LjMxNC4zMTQgMCAwIDAtLjIwNy0uMjk4Yy4wMjMtLjAwNC4wNDUtLjAwOC4wNjktLjAwOHptNC4zMDQuNDE0YS44NjUuODY1IDAgMCAwLS44NTYuODdjMCAuNDc4LjM4Mi44NzQuODU2Ljg3NGEuODY4Ljg2OCAwIDAgMCAuODU3LS44NzMuODY3Ljg2NyAwIDAgMC0uODU3LS44NzF6bTQuMjkyIDBhLjg2Ny44NjcgMCAwIDAtLjgxNCAxLjE0IDEuNTk3IDEuNTk3IDAgMCAwLTEuMjk1LS42NTJjLS44NDYgMC0xLjU0Ni42NS0xLjU2OCAxLjQ2M2wtMS41MjUuNDA4LjA2Ni4yNDggMS40NzctLjM5NGMuMDA0LjAyOC4wMDkuMDYuMDE1LjA4N2wtMS40MTguODE3LjEzMS4yMjIgMS4zNjctLjc4OWMuMjM1LjU1Mi44MDEuOTQgMS40NTUuOTQuNjYgMCAxLjIzMy0uMzk3IDEuNDYzLS45NTdsMS4zOTguODA2LjEzLS4yMjItMS40NS0uODM2Yy4wMDUtLjAyNS4wMDgtLjA1My4wMTItLjA3OGwxLjUxMS40MDQuMDY3LS4yNDgtMS41NjMtLjQxOGExLjQzOCAxLjQzOCAwIDAgMC0uMTA3LS41Yy4xNTcuMTg2LjM5LjMwMy42NDguMzAzYS44NjcuODY3IDAgMCAwIC44NTYtLjg3My44NjUuODY1IDAgMCAwLS44NTYtLjg3MXptLTEwLjU2Ny4wNDNjLjU5OCAwIDEuMDcxLjQ0NCAxLjA5Mi45OTJoLS40MWMuMDA3LS4wMS4wMTYtLjAyLjAyMy0uMDMzYS4yNC4yNCAwIDAgMCAuMDI1LS4yMmMtLjAwNS0uMDE2LS4wMjEtLjEwMi0uMDUtLjE5NmEuNDE2LjQxNiAwIDAgMC0uMDc4LS4xNTYuMjgyLjI4MiAwIDAgMC0uMjI1LS4xMDguNDk5LjQ5OSAwIDAgMS0uMTI5LS4wMzFjLS4wNjItLjAyMS0uMTQyLS4wNS0uMjQ4LS4wNS0uMTA2IDAtLjE4OC4wMjktLjI1LjA1YS40OS40OSAwIDAgMS0uMTI3LjAzMS4yOS4yOSAwIDAgMC0uMjI1LjEwOC40MjQuNDI0IDAgMCAwLS4wOC4xNTZjLS4wMjkuMDk0LS4wNDMuMTgtLjA0OC4xOTVhLjI0Mi4yNDIgMCAwIDAgLjAyMy4yMmMuMDA4LjAxNC4wMTcuMDIzLjAyNS4wMzRoLS40MWMuMDItLjU0OC40OTQtLjk5MiAxLjA5Mi0uOTkyem02LjI3NS4zNDRjLjI1OSAwIC40Ny4yMTEuNDcuNDg0YS40NzcuNDc3IDAgMCAxLS40Ny40ODYuNDcyLjQ3MiAwIDAgMS0uNDY3LS40NTMuMzIyLjMyMiAwIDAgMCAuMjQ2LjExNWMuMTggMCAuMzI2LS4xNS4zMjYtLjMzOGEuMzQuMzQgMCAwIDAtLjE1Ni0uMjg5Yy4wMTctLjAwMi4wMzMtLjAwNS4wNS0uMDA1em00LjI5MiAwYy4yNiAwIC40NjkuMjExLjQ2OS40ODQgMCAuMjcyLS4yMS40ODYtLjQ2OS40ODZhLjQ3Ny40NzcgMCAwIDEtLjQ3LS40ODZjMC0uMDE2LjAwMi0uMDMxLjAwNC0uMDQ3YS4zMy4zMyAwIDAgMCAuMzEyLjI0Yy4xOCAwIC4zMjYtLjE1LjMyNi0uMzM4YS4zMzguMzM4IDAgMCAwLS4yNTYtLjMzMi40NzUuNDc1IDAgMCAxIC4wODQtLjAwN3ptLTEwLjU2Ny4yNGMuMDIxIDAgLjA2My4wMS4xMjUuMDMxLjA4Ni4wMy4xMTcuMDM5LjE4Ni4wNDkuMDEyLjA0MS4wMjIuMDg4LjAzMy4xMjlhMS40NzUgMS40NzUgMCAwIDEtLjE2OC4xMzhjLS4wMzguMDI4LS4wNjQuMDQ1LS4wODguMDYxaC0uMTc2Yy0uMDI0LS4wMTYtLjA1Mi0uMDMzLS4wOS0uMDZhMS42MDIgMS42MDIgMCAwIDEtLjE2OC0uMTRsLjAzNC0uMTI4Yy4xMDctLjAxNC4xNDYtLjA0LjE4NS0uMDQ5YS41MDQuNTA0IDAgMCAxIC4xMjctLjAzMXptOC40NTguMjVjLjY2MSAwIDEuMTg0LjUwMiAxLjE4NCAxLjExMyAwIC4xNTYtLjAzNS4zMDQtLjA5Ni40NGwtLjAwMi0uMDI0LS4wMjItLjE1NmEyLjQ0MyAyLjQ0MyAwIDAgMC0uMDQtLjI0bC0uMzc3LjA5My4wNDQuMjc0YS4yNC4yNCAwIDAgMS0uMTE1LjA3NC4yOTkuMjk5IDAgMCAxLS4xNjgtLjAxNGMtLjA4Ny0uMDMtLjEzMi0uMDYzLS4xOC0uMDk0LjA1Ny0uMDM3LjEzLS4wODQuMTk4LS4xMzQuMDgtLjA2LjE2LS4xMjMuMjI2LS4xOWEuNTQyLjU0MiAwIDAgMCAuMDkyLS4xMTEuMjQ1LjI0NSAwIDAgMCAuMDI2LS4yMjVjLS4wMDgtLjAxOS0uMDIyLS4xMTItLjA1My0uMjFhLjQ0NC40NDQgMCAwIDAtLjA4NC0uMTYzLjI4Ni4yODYgMCAwIDAtLjIzLS4xMDcuNTY2LjU2NiAwIDAgMS0uMTQtLjAzN2MtLjA2NS0uMDIyLS4xNTItLjA1NS0uMjYzLS4wNTUtLjExIDAtLjE5NS4wMzItLjI2Mi4wNTVhLjU3NS41NzUgMCAwIDEtLjE0LjAzNy4yOTQuMjk0IDAgMCAwLS4yMy4xMDcuNDM2LjQzNiAwIDAgMC0uMDgzLjE2MmMtLjAzLjEtLjA0NS4xOTItLjA1Mi4yMTFhLjI0Ni4yNDYgMCAwIDAgLjAyNS4yMjUuNTM0LjUzNCAwIDAgMCAuMDkuMTExYy4wNjYuMDY3LjE0Ni4xMy4yMjYuMTkuMDY4LjA1LjEzOC4wOTUuMTk0LjEzMmEuNTcuNTcgMCAwIDEtLjE4LjA5Ni4zMDUuMzA1IDAgMCAxLS4xNy4wMTQuMjM3LjIzNyAwIDAgMS0uMTExLS4wNzZjLjAwOC0uMDkuMDI2LS4xNzcuMDQtLjI3MmwtLjM3Ni0uMDk0Yy0uMDMyLjE0Ni0uMDQ1LjI4Ni0uMDYzLjQwOWExLjA1MiAxLjA1MiAwIDAgMS0uMDktLjQyOGMwLS42MTEuNTIxLTEuMTEzIDEuMTgyLTEuMTEzem0wIC42MjNjLjAyNiAwIC4wNzQuMDEuMTQuMDMzLjA2Ni4wMjUuMTY5LjA1Mi4yMDYuMDU1bC4wMzUuMTU2Yy0uMDQuMDQtLjExMi4xLS4xODQuMTUyLS4wOTUuMDctLjE0LjA5NS0uMTk3LjEzMS0uMDU2LS4wMzYtLjEtLjA2MS0uMTk1LS4xM2ExLjIzNiAxLjIzNiAwIDAgMS0uMTg0LS4xNTdsLjAzNS0uMTUyYTEuMDQgMS4wNCAwIDAgMCAuMjA2LS4wNTUuNTIzLjUyMyAwIDAgMSAuMTM4LS4wMzN6bS0yLjIyLjM1M2EuNDMuNDMgMCAwIDAtLjM4NS4yNzJsLjY1Ni0uMTc2YS40MTYuNDE2IDAgMCAwLS4yNzEtLjA5NnptNC4zMzMgMGEuNDE0LjQxNCAwIDAgMC0uMjIuMDdsLjYwMy4xNmEuNDI2LjQyNiAwIDAgMC0uMzgzLS4yM3ptLTQuMDU0LjU2N2wtLjYwNy4xNjJhLjQzNi40MzYgMCAwIDAgLjEyNS4xMTN6bTMuOTI1LjAwMmwuNDA3LjIzNGEuNDQzLjQ0MyAwIDAgMCAuMDg3LS4xMDJ6bS0xLjk4Ni4yMzRjLjA2Ny4wNDcuMTY1LjEwOC4yODUuMTQ4YS42OC42OCAwIDAgMCAuMzg5LjAyNC41Ny41NyAwIDAgMCAuMjMyLS4xMjEgMS4yMDEgMS4yMDEgMCAwIDEtLjkwNC4zOTRjLS4zNTYgMC0uNjctLjE0NS0uODg1LS4zNzVhLjU4LjU4IDAgMCAwIC4yMDcuMTAyYy4xNDQuMDM2LjI4LjAxNC4zOTEtLjAyNC4xMi0uMDQuMjE4LS4xLjI4NS0uMTQ4em0tOS41MjQgMS42MXYuNTE3aDYuMjE0di0uNTE4em0zLjYxOSAxLjI5MnYuNTE3SDE1LjN2LS41MTd6Ii8+PC9zdmc+';

const CONTAINER_ENGINE_ICON: Record<string, string> = {
  docker: DOCKER_ICON,
  podman: PODMAN_ICON,
};

const ICON_RUNS_ON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS40IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjIiIHk9IjIuNSIgd2lkdGg9IjEyIiBoZWlnaHQ9IjgiIHJ4PSIxIi8+PHBhdGggZD0iTTUuNSAxMi41aDUiLz48cGF0aCBkPSJNOCAxMC41djIiLz48L3N2Zz4K';

const ICON_CONTAINER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS40IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik04IDJMMiA1djZsNiAzIDYtM1Y1TDggMnoiLz48cGF0aCBkPSJNMiA1bDYgMyA2LTMiLz48cGF0aCBkPSJNOCA4djYiLz48L3N2Zz4K';

const ICON_VERSION = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS40IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yIDN2NC41bDYgNkwxMi41IDkgNy41IDNIMnoiLz48Y2lyY2xlIGN4PSI1IiBjeT0iNSIgcj0iLjkiLz48L3N2Zz4K';

const ICON_PROVIDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS40IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik01IDEySDMuNUEyLjggMi44IDAgMDEzLjUgNi41Yy4yLTEuNiAxLjctMyAzLjUtM2EzLjQgMy40IDAgMDEzLjIgMi4yIDIuMyAyLjMgMCAwMTEuMyA0LjNIOSIvPjwvc3ZnPgo=';

const ICON_LOCAL_LINK = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS40IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik01LjUgOC41YTMgMyAwIDAxMC00TDcuNSAyLjVhMyAzIDAgMDE0LjIgNC4yTDEwIDguNSIvPjxwYXRoIGQ9Ik0xMC41IDcuNWEzIDMgMCAwMTAgNEw4LjUgMTMuNWEzIDMgMCAwMS00LjItNC4yTDYgNy41Ii8+PC9zdmc+Cg==';

const ICON_ENV_ID = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS40IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjUuNSIgY3k9IjUuNSIgcj0iMi44Ii8+PHBhdGggZD0iTTcuNSA3LjVMMTIuNSAxMi41Ii8+PHBhdGggZD0iTTEwIDEwbDIuNSAyLjUiLz48L3N2Zz4K';

export const ICON_ENDPOINTS = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS40IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjIuNSIgY3k9IjEwLjUiIHI9IjEuOCIvPjxjaXJjbGUgY3g9IjEzLjUiIGN5PSIxMC41IiByPSIxLjgiLz48Y2lyY2xlIGN4PSI4IiBjeT0iMi41IiByPSIxLjgiLz48cGF0aCBkPSJNNCA5bDMtNSIvPjxwYXRoIGQ9Ik0xMiA5TDkgNCIvPjwvc3ZnPgo=';

export const FACT_LABEL_ICONS: Record<string, string> = {
  'RUNS ON': ICON_RUNS_ON,
  CONTAINER: ICON_CONTAINER,
  VERSION: ICON_VERSION,
  PROVIDER: ICON_PROVIDER,
  'LOCAL LINK': ICON_LOCAL_LINK,
  'ENV ID': ICON_ENV_ID,
};

export type EnvironmentCardModel = Readonly<{
  kind_label: 'Local' | 'Provider' | 'Redeven URL' | 'SSH Host';
  status_label: string;
  status_tone: EnvironmentCardTone;
  runtime_started_label: string;
  target_primary: string;
  target_secondary: string;
  target_primary_monospace: boolean;
  target_secondary_monospace: boolean;
  meta: readonly EnvironmentCardMetaItem[];
}>;

export type EnvironmentActionIntent =
  | 'open'
  | 'focus'
  | 'opening'
  | 'reconnect_provider'
  | 'connect_provider_runtime'
  | 'disconnect_provider_runtime'
  | 'start_runtime'
  | 'stop_runtime'
  | 'restart_runtime'
  | 'update_runtime'
  | 'refresh_runtime'
  | 'unavailable';

export type EnvironmentActionModel = Readonly<{
  intent: EnvironmentActionIntent;
  label: string;
  enabled: boolean;
  variant: 'default' | 'outline';
  route?: DesktopLocalEnvironmentStateRoute;
  provider_origin?: string;
  provider_id?: string;
  runtime_operation?: DesktopRuntimeOperation;
  runtime_operation_method?: DesktopRuntimeOperationMethod;
  disabled_reason?: string;
}>;

export type EnvironmentActionMenuItemModel = Readonly<{
  id: string;
  label: string;
  action: EnvironmentActionModel;
}>;

export type EnvironmentActionOverlayTone = 'neutral' | 'warning';

export type EnvironmentGuidanceActionModel = Readonly<{
  label: string;
  emphasis: 'primary' | 'secondary';
  action: EnvironmentActionModel;
}>;

export type EnvironmentPrimaryActionOverlayModel =
  | Readonly<{
      kind: 'tooltip';
      tone: EnvironmentActionOverlayTone;
      message: string;
    }>
  | Readonly<{
      kind: 'popover';
      tone: EnvironmentActionOverlayTone;
      eyebrow: string;
      title: string;
      detail: string;
      actions: readonly EnvironmentGuidanceActionModel[];
    }>;

export type EnvironmentActionPresentation = Readonly<{
  kind: 'split_button';
  primary_action: EnvironmentActionModel;
  primary_action_overlay?: EnvironmentPrimaryActionOverlayModel;
  menu_button_label: string;
  menu_actions: readonly EnvironmentActionMenuItemModel[];
}>;

export type ProviderBackedEnvironmentActionModel = Readonly<{
  status_label: string;
  status_tone: EnvironmentCardTone;
  action_presentation: EnvironmentActionPresentation;
}>;

type RuntimeUpdatePresentation = Readonly<{
  uses_desktop_update_handoff: boolean;
  status_label: string;
  required_title: string;
  continue_title: string;
  blocked_detail: string;
  recovery_detail: string;
}>;

export type ControlPlaneStatusModel = Readonly<{
  label: string;
  tone: EnvironmentCardTone;
  detail: string;
}>;

export const SPACIOUS_ENVIRONMENT_GRID_CARD_THRESHOLD = 4;
export const COMPACT_ENVIRONMENT_GRID_MIN_COLUMN_REM = 17;
export const SPACIOUS_ENVIRONMENT_GRID_MIN_COLUMN_REM = 19;
export const COMPACT_ENVIRONMENT_GRID_GAP_REM = 1;
export const SPACIOUS_ENVIRONMENT_GRID_GAP_REM = 1.125;
export const LOCAL_ENVIRONMENT_LIBRARY_FILTER = '__local__';
export const PROVIDER_ENVIRONMENT_LIBRARY_FILTER = '__provider__';
export const URL_ENVIRONMENT_LIBRARY_FILTER = '__url__';
export const SSH_ENVIRONMENT_LIBRARY_FILTER = '__ssh__';
export const RUNTIME_TARGET_ENVIRONMENT_LIBRARY_FILTER_PREFIX = '__runtime_target__:';

export function capabilityUnavailableMessage(label: string): string {
  return `Connect to an Environment first to open ${label}.`;
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function formatRuntimeStartedRelativeTimestamp(unixMS: number): string {
  if (!Number.isFinite(unixMS) || unixMS <= 0) {
    return 'Unknown';
  }
  const diff = Math.max(0, Date.now() - unixMS);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

function environmentRuntimeStartedLabel(environment: DesktopEnvironmentEntry): string {
  const startedAtUnixMS = Number(environment.runtime_started_at_unix_ms);
  if (!Number.isInteger(startedAtUnixMS) || startedAtUnixMS <= 0) {
    return environment.runtime_health.status === 'online' ? 'Start time unavailable' : 'Not running';
  }
  return `Started ${formatRuntimeStartedRelativeTimestamp(startedAtUnixMS)}`;
}

function looksLikeAbsoluteURL(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function shouldUseMonospaceEndpoint(value: string): boolean {
  const clean = compact(value);
  if (clean === '') {
    return false;
  }
  return looksLikeAbsoluteURL(clean) || clean.includes(':') || clean.includes('/');
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizePositivePixelValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function environmentGridMinimumColumnRem(density: EnvironmentLibraryLayoutDensity): number {
  return density === 'spacious'
    ? SPACIOUS_ENVIRONMENT_GRID_MIN_COLUMN_REM
    : COMPACT_ENVIRONMENT_GRID_MIN_COLUMN_REM;
}

function environmentGridGapRem(density: EnvironmentLibraryLayoutDensity): number {
  return density === 'spacious'
    ? SPACIOUS_ENVIRONMENT_GRID_GAP_REM
    : COMPACT_ENVIRONMENT_GRID_GAP_REM;
}

export function shouldUseSpaciousEnvironmentGrid(cardCount: number): boolean {
  return normalizePositiveInteger(cardCount) >= SPACIOUS_ENVIRONMENT_GRID_CARD_THRESHOLD;
}

export function buildEnvironmentLibraryLayoutModel(args: Readonly<{
  visible_card_count: number;
  layout_reference_count: number;
  container_width_px: number;
  root_font_size_px?: number;
}>): EnvironmentLibraryLayoutModel {
  const visibleCardCount = normalizePositiveInteger(args.visible_card_count);
  const layoutReferenceCount = normalizePositiveInteger(args.layout_reference_count);
  const density: EnvironmentLibraryLayoutDensity = shouldUseSpaciousEnvironmentGrid(layoutReferenceCount)
    ? 'spacious'
    : 'compact';

  if (layoutReferenceCount <= 0) {
    return {
      visible_card_count: visibleCardCount,
      layout_reference_count: 0,
      density,
      column_count: 1,
    };
  }

  const containerWidthPx = normalizePositivePixelValue(args.container_width_px);
  if (containerWidthPx <= 0) {
    return {
      visible_card_count: visibleCardCount,
      layout_reference_count: layoutReferenceCount,
      density,
      column_count: 1,
    };
  }

  const rootFontSizePx = normalizePositivePixelValue(args.root_font_size_px ?? 16) || 16;
  const minColumnWidthPx = environmentGridMinimumColumnRem(density) * rootFontSizePx;
  const gapPx = environmentGridGapRem(density) * rootFontSizePx;
  const fitColumnCount = Math.floor((containerWidthPx + gapPx) / (minColumnWidthPx + gapPx));

  return {
    visible_card_count: visibleCardCount,
    layout_reference_count: layoutReferenceCount,
    density,
    column_count: Math.max(1, Math.min(layoutReferenceCount, fitColumnCount)),
  };
}

export function surfaceTitle(surface: DesktopLauncherSurface): string {
  return surface === 'environment_settings' ? 'Environment Settings' : 'Connect Environment';
}

export function shellStatus(snapshot: DesktopWelcomeSnapshot, i18n?: DesktopI18n): Readonly<{
  tone: 'connected' | 'disconnected' | 'connecting' | 'error';
  label: string;
}> {
  if (snapshot.issue) {
    return {
      tone: 'error',
      label: i18n && snapshot.issue.title_key ? i18n.t(snapshot.issue.title_key) : snapshot.issue.title,
    };
  }
  if (snapshot.open_windows.length > 0) {
    return {
      tone: 'connected',
      label: i18n
        ? (snapshot.open_windows.length === 1
          ? i18n.t('launcher.oneEnvironmentWindowOpen')
          : i18n.t('launcher.environmentWindowsOpen', { count: snapshot.open_windows.length }))
        : (snapshot.open_windows.length === 1 ? '1 environment window open' : `${snapshot.open_windows.length} environment windows open`),
    };
  }
  return {
    tone: 'disconnected',
    label: i18n ? i18n.t('launcher.noEnvironmentWindowsOpen') : 'No environment windows open',
  };
}

export function buildDesktopWelcomeShellViewModel(
  snapshot: DesktopWelcomeSnapshot,
  visibleSurface: DesktopLauncherSurface = snapshot.surface,
): DesktopWelcomeShellViewModel {
  return {
    shell_title: 'Redeven Desktop',
    surface_title: surfaceTitle(visibleSurface),
    connect_heading: 'Connect Environment',
    primary_action_label: 'Open Environment',
    settings_save_key: snapshot.settings_surface.save_label_key,
  };
}

export function isRemoteEnvironmentEntry(environment: DesktopEnvironmentEntry): boolean {
  return environment.kind === 'provider_environment'
    || environment.kind === 'external_local_ui'
    || environment.kind === 'ssh_environment';
}

export function environmentKindLabel(environment: DesktopEnvironmentEntry): EnvironmentCardModel['kind_label'] {
  switch (environment.kind) {
    case 'ssh_environment':
      return 'SSH Host';
    case 'provider_environment':
      return 'Provider';
    case 'local_environment':
      return 'Local';
    case 'external_local_ui':
      return 'Redeven URL';
    default:
      return 'Local';
  }
}

export function environmentSourceLabel(environment: DesktopEnvironmentEntry): string {
  switch (environment.category) {
    case 'local':
      return 'Local Environment';
    case 'provider':
      return 'Provider';
    case 'saved':
      return 'Saved';
    default:
      return 'Local Environment';
  }
}

function normalizeIPAddressHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

function isLoopbackIPAddressHost(value: string): boolean {
  const host = normalizeIPAddressHost(value);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isPrivateIPv4Host(value: string): boolean {
  const host = normalizeIPAddressHost(value);
  const segments = host.split('.');
  if (segments.length !== 4 || segments.some((segment) => segment === '')) {
    return false;
  }
  const octets = segments.map((segment) => Number(segment));
  if (octets.some((segment) => !Number.isInteger(segment) || segment < 0 || segment > 255)) {
    return false;
  }
  if (octets[0] === 10) {
    return true;
  }
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }
  return octets[0] === 169 && octets[1] === 254;
}

function isLocalIPv6Host(value: string): boolean {
  const host = normalizeIPAddressHost(value);
  return /^fc/i.test(host) || /^fd/i.test(host) || /^fe[89ab]/i.test(host);
}

function externalLocalUINetworkLabel(environment: DesktopEnvironmentEntry): string {
  const targetURL = compact(environment.local_ui_url) || compact(environment.secondary_text);
  if (targetURL === '') {
    return 'Unknown host';
  }
  try {
    const parsed = new URL(targetURL);
    const host = parsed.hostname;
    if (isLoopbackIPAddressHost(host)) {
      return 'This device';
    }
    if (isPrivateIPv4Host(host) || isLocalIPv6Host(host)) {
      return 'LAN host';
    }
    return 'Remote host';
  } catch {
    return 'Unknown host';
  }
}

function buildEnvironmentCardFact(
  label: string,
  value: string,
  opts?: {
    action?: EnvironmentCardFactActionModel;
    leading_icon?: string;
    endpoints?: readonly EnvironmentCardEndpointModel[];
    copy_value?: true;
  },
): EnvironmentCardFactModel {
  return {
    label,
    value,
    value_tone: 'default',
    ...(FACT_LABEL_ICONS[label] ? { label_icon: FACT_LABEL_ICONS[label] } : {}),
    ...(opts?.action ? { action: opts.action } : {}),
    ...(opts?.leading_icon ? { leading_icon: opts.leading_icon } : {}),
    ...(opts?.endpoints ? { endpoints: opts.endpoints } : {}),
    ...(opts?.copy_value ? { copy_value: true as const } : {}),
  };
}

function buildPlaceholderEnvironmentCardFact(
  label: string,
  value = 'None',
): EnvironmentCardFactModel {
  return {
    label,
    value,
    value_tone: 'placeholder',
    ...(FACT_LABEL_ICONS[label] ? { label_icon: FACT_LABEL_ICONS[label] } : {}),
  };
}

const ENVIRONMENT_CARD_FACT_ORDER = [
  'RUNS ON',
  'CONTAINER',
  'OWNER',
  'VERSION',
  'PROVIDER',
  'LOCAL LINK',
  'ENV ID',
] as const;

function orderEnvironmentCardFacts(
  facts: readonly EnvironmentCardFactModel[],
): readonly EnvironmentCardFactModel[] {
  return [...facts].sort((left, right) => (
    ENVIRONMENT_CARD_FACT_ORDER.indexOf(left.label as (typeof ENVIRONMENT_CARD_FACT_ORDER)[number])
    - ENVIRONMENT_CARD_FACT_ORDER.indexOf(right.label as (typeof ENVIRONMENT_CARD_FACT_ORDER)[number])
  ));
}

function controlPlaneDisplayLabel(environment: DesktopEnvironmentEntry): string {
  return environment.control_plane_label || environment.provider_origin || '';
}

function environmentRunsOnLabel(environment: DesktopEnvironmentEntry): string {
  if (environment.kind === 'local_environment') {
    return 'This device';
  }
  if (environment.kind === 'provider_environment') {
    return 'Provider remote';
  }
  if (environment.kind === 'ssh_environment') {
    return environment.secondary_text || 'Unknown';
  }
  return externalLocalUINetworkLabel(environment);
}

function environmentRuntimeService(environment: DesktopEnvironmentEntry): RuntimeServiceSnapshot | undefined {
  if (environment.runtime_service) {
    return environment.runtime_service;
  }
  if (environment.kind === 'local_environment') {
    return environment.local_environment_runtime_service;
  }
  return undefined;
}

function environmentOpenOperationAvailable(environment: DesktopEnvironmentEntry): boolean {
  return environment.runtime_operations.open.availability === 'available';
}

function environmentOpenPreflightAvailable(environment: DesktopEnvironmentEntry): boolean {
  if (environment.window_state !== 'closed' || environment.runtime_health.freshness !== 'unknown') {
    return false;
  }
  if (environment.kind === 'provider_environment') {
    return false;
  }
  return true;
}

function environmentRuntimeMaintenance(environment: DesktopEnvironmentEntry) {
  return environment.runtime_maintenance;
}

function runtimeServiceVersionLabel(snapshot: RuntimeServiceSnapshot | undefined): string {
  return compact(snapshot?.runtime_version) || 'UNKNOWN';
}

function runtimeVersionFact(environment: DesktopEnvironmentEntry): EnvironmentCardFactModel {
  const snapshot = environmentRuntimeService(environment);
  const version = runtimeServiceVersionLabel(snapshot);
  return version === 'UNKNOWN'
    ? buildPlaceholderEnvironmentCardFact('VERSION', version)
    : buildEnvironmentCardFact('VERSION', version);
}

function runtimePlacementFacts(environment: DesktopEnvironmentEntry): readonly EnvironmentCardFactModel[] {
  const placement = environment.managed_runtime_placement;
  if (placement?.kind !== 'container_process') {
    return [];
  }
  const engine = placement.container_engine === 'podman' ? 'podman' : 'docker';
  return [
    buildEnvironmentCardFact('CONTAINER', placement.container_label || placement.container_id, {
      leading_icon: CONTAINER_ENGINE_ICON[engine],
      copy_value: true,
    }),
  ];
}

function providerRemoteOpenLooksAvailable(environment: DesktopEnvironmentEntry): boolean {
  if (environment.kind !== 'provider_environment' || providerPrimaryRoute(environment) !== 'remote_desktop') {
    return false;
  }
  return environment.remote_route_state === 'ready';
}

function providerRemoteLooksOffline(environment: DesktopEnvironmentEntry): boolean {
  if (environment.kind !== 'provider_environment' || providerPrimaryRoute(environment) !== 'remote_desktop') {
    return false;
  }
  return environment.remote_route_state === 'offline';
}

function providerLocalLinkLabel(environment: DesktopEnvironmentEntry): string {
  if (environment.kind !== 'provider_environment') {
    return '';
  }
  const linkedRuntime = environment.provider_linked_runtime_summary;
  if (!linkedRuntime) {
    return 'No managed runtime linked';
  }
  switch (linkedRuntime.provider_connection_state) {
    case 'connected':
      return linkedRuntime.label;
    case 'connecting':
      return `Connecting through ${linkedRuntime.label}`;
    case 'disconnecting':
      return `Disconnecting from ${linkedRuntime.label}`;
    case 'error':
      return `${linkedRuntime.label} needs attention`;
    case 'unlinked':
    case 'unsupported':
      return 'No managed runtime linked';
  }
}

function providerLocalLinkFact(environment: DesktopEnvironmentEntry): EnvironmentCardFactModel {
  const value = providerLocalLinkLabel(environment);
  const linkedRuntime = environment.kind === 'provider_environment'
    ? environment.provider_linked_runtime_summary
    : undefined;
  if (!linkedRuntime) {
    return buildEnvironmentCardFact('LOCAL LINK', value);
  }
  return buildEnvironmentCardFact('LOCAL LINK', value, {
    action: {
      kind: 'filter_runtime_target',
      runtime_target_id: linkedRuntime.runtime_target_id,
      label: `Show ${linkedRuntime.label}`,
      aria_label: `Show linked runtime ${linkedRuntime.label}`,
    },
  });
}

function providerEnvironmentIDFact(environment: DesktopEnvironmentEntry): EnvironmentCardFactModel {
  const envID = compact(environment.env_public_id) || 'UNKNOWN';
  return envID === 'UNKNOWN'
    ? buildPlaceholderEnvironmentCardFact('ENV ID', envID)
    : buildEnvironmentCardFact('ENV ID', envID, { copy_value: true });
}

export function buildEnvironmentCardFactsModel(
  environment: DesktopEnvironmentEntry,
): readonly EnvironmentCardFactModel[] {
  const endpoints = buildEnvironmentCardEndpointsModel(environment);
  const runsOnOpts = endpoints.length > 0 ? { endpoints } : undefined;

  if (environment.kind === 'local_environment') {
    return orderEnvironmentCardFacts([
      buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment), runsOnOpts),
      ...runtimePlacementFacts(environment),
      runtimeVersionFact(environment),
      buildPlaceholderEnvironmentCardFact('PROVIDER'),
    ]);
  }

  if (environment.kind === 'provider_environment') {
    return orderEnvironmentCardFacts([
      buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment), runsOnOpts),
      runtimeVersionFact(environment),
      buildEnvironmentCardFact('PROVIDER', controlPlaneDisplayLabel(environment) || 'Unavailable'),
      providerLocalLinkFact(environment),
      providerEnvironmentIDFact(environment),
    ]);
  }

  if (environment.kind === 'ssh_environment') {
    return orderEnvironmentCardFacts([
      buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment), runsOnOpts),
      ...runtimePlacementFacts(environment),
      runtimeVersionFact(environment),
    ]);
  }

  return orderEnvironmentCardFacts([
    buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment), runsOnOpts),
    ...runtimePlacementFacts(environment),
    runtimeVersionFact(environment),
  ]);
}

export function buildEnvironmentCardEndpointsModel(
  environment: DesktopEnvironmentEntry,
): readonly EnvironmentCardEndpointModel[] {
  if (environment.kind === 'local_environment') {
    const localEndpoint = compact(environment.local_ui_url) || compact(environment.local_environment_ui_bind);
    return localEndpoint !== ''
      ? [{
        label: looksLikeAbsoluteURL(localEndpoint) ? 'URL' : 'LOCAL',
        value: localEndpoint,
        monospace: shouldUseMonospaceEndpoint(localEndpoint),
        copy_label: 'Copy local endpoint',
      }]
      : [];
  }

  if (environment.kind === 'provider_environment') {
    const remoteEndpoint = compact(environment.remote_environment_url);
    return [
      remoteEndpoint !== ''
        ? {
          label: 'PROVIDER',
          value: remoteEndpoint,
          monospace: shouldUseMonospaceEndpoint(remoteEndpoint),
          copy_label: 'Copy environment URL',
        }
        : null,
    ].filter((item): item is EnvironmentCardEndpointModel => item !== null);
  }

  const card = buildEnvironmentCardModel(environment);
  const primaryLabel = environment.kind === 'ssh_environment' ? 'SSH HOST' : 'URL';
  const secondaryLabel = environment.kind === 'ssh_environment' ? 'FORWARDED URL' : 'DETAIL';
  return [
    card.target_primary !== ''
      ? {
          label: primaryLabel,
          value: card.target_primary,
          monospace: card.target_primary_monospace,
          copy_label: environment.kind === 'ssh_environment' ? 'Copy SSH host' : 'Copy endpoint',
        }
      : null,
    card.target_secondary !== ''
      ? {
          label: secondaryLabel,
          value: card.target_secondary,
          monospace: card.target_secondary_monospace,
          copy_label: environment.kind === 'ssh_environment' ? 'Copy forwarded URL' : 'Copy endpoint',
        }
      : null,
  ].filter((item): item is EnvironmentCardEndpointModel => item !== null);
}

export function splitPinnedEnvironmentEntries(
  entries: readonly DesktopEnvironmentEntry[],
): Readonly<{
  pinned_entries: readonly DesktopEnvironmentEntry[];
  regular_entries: readonly DesktopEnvironmentEntry[];
}> {
  const pinnedEntries = entries.filter((entry) => entry.pinned);
  return {
    pinned_entries: pinnedEntries,
    regular_entries: entries.filter((entry) => !entry.pinned),
  };
}

function environmentUsesDesktopUpdateHandoff(environment: DesktopEnvironmentEntry): boolean {
  return environment.runtime_operations.update.method === 'desktop_local_update_handoff';
}

function runtimeUpdatePresentation(environment: DesktopEnvironmentEntry): RuntimeUpdatePresentation {
  if (environmentUsesDesktopUpdateHandoff(environment)) {
    return {
      uses_desktop_update_handoff: true,
      status_label: 'DESKTOP UPDATE REQUIRED',
      required_title: 'Redeven Desktop update required',
      continue_title: 'Update Redeven Desktop to continue',
      blocked_detail: 'This Local Environment uses the runtime bundled with Redeven Desktop. Open becomes available after the Desktop update handoff refreshes the app and bundled local runtime.',
      recovery_detail: 'Open becomes available after the Desktop update handoff refreshes the app and bundled local runtime.',
    };
  }
  return {
    uses_desktop_update_handoff: false,
    status_label: 'RUNTIME NEEDS UPDATE',
    required_title: 'Runtime update required',
    continue_title: 'Update the runtime to continue',
    blocked_detail: '',
    recovery_detail: '',
  };
}

function runtimeStatusLabel(environment: DesktopEnvironmentEntry): string {
  if (environment.kind === 'provider_environment' && environment.control_plane_sync_state === 'auth_required') {
    return 'RECONNECT REQUIRED';
  }
  if (environment.kind === 'provider_environment' && providerPrimaryRoute(environment) === 'remote_desktop') {
    if (providerRemoteOpenLooksAvailable(environment)) {
      return 'Open';
    }
    if (providerRemoteLooksOffline(environment)) {
      return 'REMOTE OFFLINE';
    }
    switch (environment.remote_route_state) {
      case 'auth_required':
        return 'RECONNECT REQUIRED';
      case 'provider_unreachable':
        return 'SYNC FAILED';
      case 'provider_invalid':
        return 'INVALID PROVIDER';
      case 'removed':
        return 'REMOVED';
      default:
        return 'REFRESH NEEDED';
    }
  }
  if (environment.runtime_health.freshness === 'checking') {
    return 'CHECKING';
  }
  if (environment.runtime_health.freshness === 'unknown') {
    return 'NOT CHECKED';
  }
  if (environment.runtime_health.freshness === 'failed') {
    return 'CHECK FAILED';
  }
  if (environmentRuntimeMaintenance(environment)) {
    const maintenance = environmentRuntimeMaintenance(environment);
    if (desktopRuntimeMaintenanceIsStaleLock(maintenance)) {
      return 'RUNTIME OFFLINE';
    }
    if (desktopRuntimeMaintenanceRequiresUpdate(maintenance) && environmentOpenOperationAvailable(environment)) {
      return 'Open';
    }
    return desktopRuntimeMaintenanceRequiresRestart(maintenance)
      ? 'RESTART REQUIRED'
      : 'RUNTIME NEEDS UPDATE';
  }
  if (environment.runtime_health.status !== 'online') {
    if (environment.runtime_health.offline_reason_code === 'auth_required') {
      return 'MANUAL AUTH REQUIRED';
    }
    if (environment.runtime_health.offline_reason_code === 'unverified') {
      return 'UNVERIFIED';
    }
    if (environment.runtime_health.offline_reason_code === 'container_engine_unavailable') {
      return 'SETUP REQUIRED';
    }
    return 'RUNTIME OFFLINE';
  }
  if (environmentOpenOperationAvailable(environment)) {
    return runtimeServiceAllowsOpenAttempt(environmentRuntimeService(environment))
      ? 'Open'
      : 'READY TO OPEN';
  }
  if (environment.managed_runtime_open_connection_required === true) {
    return 'READY TO OPEN';
  }
  const snapshot = environmentRuntimeService(environment);
  if (runtimeServiceIsOpenable(snapshot)) {
    return 'Open';
  }
  if (snapshot?.open_readiness?.state === 'blocked' && !runtimeServiceAllowsOpenAttempt(snapshot)) {
    return runtimeServiceNeedsRuntimeUpdate(snapshot)
      ? runtimeUpdatePresentation(environment).status_label
      : 'RUNTIME BLOCKED';
  }
  return 'RUNTIME PREPARING';
}

function runtimeStatusTone(environment: DesktopEnvironmentEntry): EnvironmentCardTone {
  if (environment.kind === 'provider_environment' && environment.control_plane_sync_state === 'auth_required') {
    return 'warning';
  }
  if (environment.kind === 'provider_environment' && providerPrimaryRoute(environment) === 'remote_desktop') {
    return providerRemoteOpenLooksAvailable(environment) ? 'success' : 'warning';
  }
  if (environment.runtime_health.freshness === 'checking') {
    return 'primary';
  }
  if (environment.runtime_health.freshness === 'unknown') {
    return 'neutral';
  }
  if (environment.runtime_health.freshness === 'failed') {
    return 'warning';
  }
  return environment.runtime_health.status === 'online'
    && (runtimeServiceIsOpenable(environmentRuntimeService(environment)) || environmentOpenOperationAvailable(environment))
    ? 'success'
    : 'warning';
}

function primaryWindowAction(environment: DesktopEnvironmentEntry): EnvironmentActionModel {
  if (environment.window_state === 'open') {
    return {
      intent: 'focus',
      label: 'Open',
      enabled: true,
      variant: 'default',
    };
  }
  if (environment.window_state === 'opening') {
    return {
      intent: 'opening',
      label: 'Open',
      enabled: false,
      variant: 'default',
    };
  }
  const primaryRoute = environment.kind === 'provider_environment' ? providerPrimaryRoute(environment) : '';
  const canOpenProviderRemoteRoute = environment.kind === 'provider_environment'
    && providerRemoteOpenLooksAvailable(environment);
  return {
    intent: 'open',
    label: 'Open',
    enabled: canOpenProviderRemoteRoute
      || (environment.kind !== 'provider_environment'
        && (
          ((environment.runtime_health.status === 'online' || environment.kind === 'external_local_ui')
            && environmentOpenOperationAvailable(environment))
          || environmentOpenPreflightAvailable(environment)
        )),
    variant: 'default',
    ...(environment.kind === 'provider_environment'
      ? { route: desktopProviderEnvironmentOpenRoute() }
      : primaryRoute
      ? { route: primaryRoute }
      : {}),
  };
}

function providerPrimaryRoute(environment: DesktopEnvironmentEntry): DesktopLocalEnvironmentStateRoute | '' {
  if (environment.kind !== 'provider_environment') {
    return '';
  }
  // IMPORTANT: A Provider Environment card always opens through the provider
  // tunnel. Local/SSH runtime cards are the only surfaces that may expose direct
  // Local UI opening or runtime management.
  return desktopProviderEnvironmentOpenRoute();
}

function providerRemoteRouteMenuAction(
  environment: DesktopEnvironmentEntry,
): EnvironmentActionMenuItemModel | null {
  if (environment.kind !== 'provider_environment' || providerPrimaryRoute(environment) === 'remote_desktop') {
    return null;
  }
  if (compact(environment.open_remote_session_key) !== '') {
    return {
      id: 'focus_control_plane_window',
      label: 'Focus remote window',
      action: {
        intent: 'focus',
        label: 'Focus remote window',
        enabled: true,
        variant: 'outline',
        route: 'remote_desktop',
      },
    };
  }
  if (environment.open_remote_session_lifecycle === 'opening') {
    return {
      id: 'control_plane_window_opening',
      label: 'Remote window opening…',
      action: {
        intent: 'opening',
        label: 'Remote window opening…',
        enabled: false,
        variant: 'outline',
        route: 'remote_desktop',
      },
    };
  }
  if (environment.remote_route_state === 'ready') {
    return {
      id: 'open_via_control_plane',
      label: 'Open',
      action: {
        intent: 'open',
        label: 'Open',
        enabled: true,
        variant: 'outline',
        route: 'remote_desktop',
      },
    };
  }
  return null;
}

function runtimeProviderLinkMenuAction(
  environment: DesktopEnvironmentEntry,
): EnvironmentActionMenuItemModel | null {
  // IMPORTANT: Provider-link controls live only on Local/SSH runtime cards.
  // Provider cards represent remote access permissions, not device management.
  if (!desktopEntryKindOwnsRuntimeManagement(environment.kind)) {
    return null;
  }
  const target = environment.provider_runtime_link_target;
  if (!target) {
    return null;
  }
  switch (target.provider_connection_state) {
    case 'connected':
      return {
        id: 'disconnect_provider_runtime',
        label: 'Disconnect from provider',
        action: {
          intent: 'disconnect_provider_runtime',
          label: 'Disconnect from provider',
          enabled: target.can_disconnect_provider,
          variant: 'outline',
        },
      };
    case 'connecting':
      return {
        id: 'provider_link_connecting',
        label: 'Connecting to provider',
        action: {
          intent: 'unavailable',
          label: 'Connecting to provider',
          enabled: false,
          variant: 'outline',
        },
      };
    case 'disconnecting':
      return {
        id: 'provider_link_disconnecting',
        label: 'Disconnecting from provider',
        action: {
          intent: 'unavailable',
          label: 'Disconnecting from provider',
          enabled: false,
          variant: 'outline',
        },
      };
    case 'error':
      if (target.can_disconnect_provider) {
        return {
          id: 'disconnect_provider_runtime',
          label: 'Disconnect from provider',
          action: {
            intent: 'disconnect_provider_runtime',
            label: 'Disconnect from provider',
            enabled: true,
            variant: 'outline',
          },
        };
      }
      return {
        id: 'provider_link_needs_attention',
        label: 'Provider link needs attention',
        action: {
          intent: 'unavailable',
          label: 'Provider link needs attention',
          enabled: false,
          variant: 'outline',
        },
      };
    case 'unsupported':
      if (target.runtime_running) {
        return {
          id: 'provider_link_unavailable',
          label: 'Provider link unavailable',
          action: {
            intent: 'unavailable',
            label: 'Provider link unavailable',
            enabled: false,
            variant: 'outline',
          },
        };
      }
      break;
    case 'unlinked':
      break;
  }
  const canConnect = runtimeProviderLinkCanConnect(environment, target);
  const label = 'Connect to provider...';
  return {
    id: 'connect_provider_runtime',
    label,
    action: {
      intent: 'connect_provider_runtime',
      label,
      enabled: canConnect,
      variant: 'outline',
    },
  };
}

function runtimeProviderLinkCanConnect(
  environment: DesktopEnvironmentEntry,
  target: DesktopProviderRuntimeLinkTarget,
): boolean {
  const plans = (environment.provider_environment_candidates ?? []).map((candidate) => (
    buildDesktopProviderRuntimeLinkPlan(target, candidate)
  ));
  return plans.some((plan) => plan.can_connect)
    || plans.some((plan) => plan.state === 'provider_environment_occupied');
}

const runtimeOperationMenuOrder: readonly DesktopRuntimeOperation[] = [
  'start',
  'stop',
  'restart',
  'update',
];

function runtimeOperationIntent(operation: DesktopRuntimeOperation): EnvironmentActionIntent | null {
  switch (operation) {
    case 'start':
      return 'start_runtime';
    case 'stop':
      return 'stop_runtime';
    case 'restart':
      return 'restart_runtime';
    case 'update':
      return 'update_runtime';
    case 'refresh':
      return 'refresh_runtime';
    default:
      return null;
  }
}

function runtimeOperationMenuItem(plan: DesktopRuntimeOperationPlan | undefined): EnvironmentActionMenuItemModel | null {
  if (!plan || !desktopRuntimeOperationIsVisible(plan) || plan.menu_visibility === 'hidden') {
    return null;
  }
  if (plan.menu_visibility === 'contextual' && plan.availability === 'unavailable') {
    return null;
  }
  const intent = runtimeOperationIntent(plan.operation);
  if (!intent) {
    return null;
  }
  return {
    id: intent,
    label: plan.label,
    action: {
        intent,
        label: plan.label,
        enabled: plan.availability === 'available',
        variant: 'outline',
        runtime_operation: plan.operation,
        runtime_operation_method: plan.method,
        ...(plan.message ? { disabled_reason: plan.message } : {}),
      },
  };
}

function runtimeMenuActions(environment: DesktopEnvironmentEntry): readonly EnvironmentActionMenuItemModel[] {
  const items: EnvironmentActionMenuItemModel[] = [];
  const remoteRouteAction = providerRemoteRouteMenuAction(environment);
  const runtimeProviderLinkAction = runtimeProviderLinkMenuAction(environment);
  if (remoteRouteAction) {
    items.push(remoteRouteAction);
  }
  if (runtimeProviderLinkAction) {
    items.push(runtimeProviderLinkAction);
  }
  if (desktopEntryKindOwnsRuntimeManagement(environment.kind)) {
    for (const operation of runtimeOperationMenuOrder) {
      const item = runtimeOperationMenuItem(environment.runtime_operations[operation]);
      if (item) {
        items.push(item);
      }
    }
  }
  const refreshPlan = environment.runtime_operations.refresh;
  const refreshLabel = environment.kind === 'provider_environment' ? 'Refresh provider status' : 'Refresh runtime status';
  items.push({
    id: 'refresh_runtime',
    label: refreshLabel,
    action: {
      intent: 'refresh_runtime',
      label: refreshLabel,
      enabled: refreshPlan?.availability !== 'blocked',
      variant: 'outline',
    },
  });
  return items;
}

function blockedPrimaryActionGuidanceAction(
  environment: DesktopEnvironmentEntry,
  menuActions: readonly EnvironmentActionMenuItemModel[],
): EnvironmentGuidanceActionModel | null {
  const recoveryIntents: readonly EnvironmentActionIntent[] = [
    'start_runtime',
    'update_runtime',
    'restart_runtime',
    'connect_provider_runtime',
  ];
  const recoveryAction = recoveryIntents
    .map((intent) => menuActions.find((item) => item.action.enabled && item.action.intent === intent))
    .find((item): item is EnvironmentActionMenuItemModel => item !== undefined) ?? null;
  if (!recoveryAction) {
    return null;
  }
  return {
    label: primaryGuidanceActionLabel(recoveryAction.action),
    emphasis: 'primary',
    action: recoveryAction.action,
  };
}

function primaryGuidanceActionLabel(action: EnvironmentActionModel): string {
  switch (action.intent) {
    case 'start_runtime':
      return 'Start runtime';
    case 'update_runtime':
      return action.label;
    case 'restart_runtime':
      return 'Restart runtime';
    case 'connect_provider_runtime':
      return 'Connect to provider';
    default:
      return 'Continue';
  }
}

function blockedPrimaryActionRefreshGuidanceAction(
  menuActions: readonly EnvironmentActionMenuItemModel[],
): EnvironmentGuidanceActionModel | null {
  const refreshAction = menuActions.find((item) => item.action.intent === 'refresh_runtime');
  if (!refreshAction) {
    return null;
  }
  return {
    label: 'Refresh status',
    emphasis: 'secondary',
    action: refreshAction.action,
  };
}

function blockedRuntimePrimaryActionGuidanceActions(
  environment: DesktopEnvironmentEntry,
  menuActions: readonly EnvironmentActionMenuItemModel[],
): readonly EnvironmentGuidanceActionModel[] {
  const updateSource = menuActions.find((item) => item.action.enabled && item.action.intent === 'update_runtime');
  const restartSource = menuActions.find((item) => item.action.enabled && item.action.intent === 'restart_runtime');
  const startSource = menuActions.find((item) => item.action.enabled && item.action.intent === 'start_runtime');
  const stopSource = menuActions.find((item) => item.action.enabled && item.action.intent === 'stop_runtime');
  const refreshSource = menuActions.find((item) => item.action.intent === 'refresh_runtime');
  const maintenance = environmentRuntimeMaintenance(environment);
  const primarySource = maintenance?.recovery_action === 'start_runtime'
    ? startSource
    : maintenance?.recovery_action === 'restart_runtime'
      ? restartSource
      : maintenance?.recovery_action === 'update_runtime'
        ? updateSource
        : updateSource ?? restartSource ?? startSource ?? stopSource;
  const primaryLabel = (() => {
    if (!primarySource) {
      return '';
    }
    if (primarySource.action.intent === 'update_runtime') {
      if (primarySource.action.runtime_operation_method === 'desktop_local_update_handoff') {
        return primarySource.action.label;
      }
      return environment.runtime_health.status === 'online' || maintenance?.has_active_work === true
        ? 'Update and restart…'
        : primarySource.action.label;
    }
    if (primarySource.action.intent === 'restart_runtime') {
      return 'Restart runtime…';
    }
    if (primarySource.action.intent === 'start_runtime') {
      return 'Start runtime';
    }
    return primarySource.action.label;
  })();
  return [
    primarySource
      ? {
          label: primaryLabel,
          emphasis: 'primary',
          action: {
            ...primarySource.action,
            label: primaryLabel,
          },
        }
      : null,
    refreshSource
      ? {
          label: 'Refresh status',
          emphasis: 'secondary',
          action: refreshSource.action,
        }
      : null,
  ].filter((item): item is EnvironmentGuidanceActionModel => item !== null);
}

function runtimeMaintenanceSubject(environment: DesktopEnvironmentEntry): string {
  if (environment.managed_runtime_placement?.kind === 'container_process') {
    return environment.kind === 'ssh_environment' ? 'SSH container runtime' : 'local container runtime';
  }
  if (environment.kind === 'ssh_environment') {
    return 'SSH runtime';
  }
  if (environment.kind === 'local_environment') {
    return 'local runtime';
  }
  return 'runtime';
}

function blockedRuntimePrimaryActionTitle(
  environment: DesktopEnvironmentEntry,
  _snapshot: RuntimeServiceSnapshot | undefined,
): string {
  const maintenance = environmentRuntimeMaintenance(environment);
  if (maintenance?.kind === 'desktop_model_source_requires_runtime_update') {
    return 'Desktop model source needs update';
  }
  if (desktopRuntimeMaintenanceIsStaleLock(maintenance)) {
    return 'Start the runtime to continue';
  }
  if (desktopRuntimeMaintenanceRequiresRestart(maintenance)) {
    return 'Runtime restart required';
  }
  if (desktopRuntimeMaintenanceRequiresUpdate(maintenance)) {
    return runtimeUpdatePresentation(environment).required_title;
  }
  return 'Runtime cannot open yet';
}

function blockedRuntimePrimaryActionDetail(
  environment: DesktopEnvironmentEntry,
  snapshot: RuntimeServiceSnapshot | undefined,
): string {
  const maintenance = environmentRuntimeMaintenance(environment);
  if (maintenance) {
    if (maintenance.kind === 'desktop_model_source_requires_runtime_update') {
      return `This ${runtimeMaintenanceSubject(environment)} needs an update before Desktop can make your local model settings available here. Update and restart the runtime first; Open stays separate and becomes available after the runtime is ready.`;
    }
    if (desktopRuntimeMaintenanceIsStaleLock(maintenance)) {
      return `This ${runtimeMaintenanceSubject(environment)} is not running. Start the runtime again; Open becomes available after the runtime reports ready.`;
    }
    if (desktopRuntimeMaintenanceRequiresRestart(maintenance)) {
      return `This ${runtimeMaintenanceSubject(environment)} needs a successful restart before it can open this environment. Restart the runtime, then open it again after it reports ready.`;
    }
    const presentation = runtimeUpdatePresentation(environment);
    if (presentation.uses_desktop_update_handoff) {
      return presentation.blocked_detail;
    }
    const updateAction = environment.runtime_health.status === 'online' || maintenance.has_active_work
      ? 'Update and restart the runtime first'
      : 'Update the runtime first';
    return `This ${runtimeMaintenanceSubject(environment)} needs an update before it can open this environment. ${updateAction}; Open stays separate and becomes available after the runtime is ready.`;
  }
  return runtimeServiceOpenReadinessLabel(snapshot);
}

function blockedPrimaryActionTitle(
  environment: DesktopEnvironmentEntry,
  action: EnvironmentActionModel,
): string {
  if (action.intent === 'connect_provider_runtime') {
    return 'Connect to provider to continue';
  }
  if (action.intent === 'update_runtime') {
    if (action.runtime_operation_method === 'desktop_local_update_handoff') {
      return runtimeUpdatePresentation(environment).continue_title;
    }
    return 'Update the runtime to continue';
  }
  if (action.intent === 'restart_runtime') {
    return 'Restart the runtime to continue';
  }
  return environment.kind === 'ssh_environment'
    ? 'Start the runtime to continue'
    : 'Start the local runtime to continue';
}

function blockedPrimaryActionDetail(
  environment: DesktopEnvironmentEntry,
  action: EnvironmentActionModel,
): string {
  if (action.intent === 'connect_provider_runtime') {
    return 'Connect this runtime to a provider Environment first. Open stays separate and becomes available after the link is ready.';
  }
  if (action.intent === 'update_runtime') {
    if (action.runtime_operation_method === 'desktop_local_update_handoff') {
      return runtimeUpdatePresentation(environment).recovery_detail;
    }
    if (environment.managed_runtime_placement?.kind === 'container_process') {
      return 'Open becomes available after Desktop updates the runtime package in this running container and the runtime reports ready.';
    }
    return environment.kind === 'ssh_environment'
      ? 'Open becomes available after Desktop updates the runtime on this SSH host and it reports ready.'
      : 'Open becomes available after Desktop completes the runtime update and it reports ready.';
  }
  if (action.intent === 'restart_runtime') {
    return environment.kind === 'ssh_environment'
      ? 'Open becomes available after Desktop restarts the runtime on this SSH host and it reports ready.'
      : 'Open becomes available after Desktop restarts the runtime and it reports ready.';
  }
  if (environment.managed_runtime_placement?.kind === 'container_process') {
    return 'Open becomes available once the runtime package is ready in this running container.';
  }
  return environment.kind === 'ssh_environment'
    ? 'Open becomes available once the runtime is ready on this SSH host.'
    : 'Open becomes available once the runtime is ready on this device.';
}

function specificRuntimeOfflineReason(environment: DesktopEnvironmentEntry): string {
  const reason = compact(environment.runtime_health.offline_reason);
  if (reason === '' || reason === 'The runtime offline / unavailable') {
    return '';
  }
  return reason;
}

function primaryActionOverlay(
  environment: DesktopEnvironmentEntry,
  menuActions: readonly EnvironmentActionMenuItemModel[],
): EnvironmentPrimaryActionOverlayModel | undefined {
  if (environment.window_state !== 'closed') {
    return undefined;
  }
  if (environment.kind === 'provider_environment' && environment.control_plane_sync_state === 'auth_required') {
    return {
      kind: 'tooltip',
      tone: 'warning',
      message: 'Desktop needs fresh provider authorization before it can open or connect this provider Environment.',
    };
  }
  if (environment.kind === 'provider_environment' && providerPrimaryRoute(environment) === 'remote_desktop') {
    if (providerRemoteOpenLooksAvailable(environment)) {
      return undefined;
    }
    const refreshAction = blockedPrimaryActionRefreshGuidanceAction(menuActions);
    return {
      kind: 'popover',
      tone: 'warning',
      eyebrow: 'Remote route unavailable',
      title: providerRemoteLooksOffline(environment)
        ? 'Provider reports offline'
        : environment.remote_route_state === 'provider_unreachable'
          ? 'Provider is unreachable'
          : environment.remote_route_state === 'provider_invalid'
            ? 'Provider response is invalid'
            : environment.remote_route_state === 'removed'
              ? 'Environment removed'
              : environment.remote_route_state === 'stale'
                ? 'Provider status is stale'
                : 'Refresh provider status',
      detail: environment.remote_state_reason
        || 'Remote open is not ready yet. Open stays separate from runtime start and provider link actions.',
      actions: refreshAction ? [refreshAction] : [],
    };
  }
  if (environmentRuntimeMaintenance(environment) && !environmentOpenOperationAvailable(environment)) {
    const snapshot = environmentRuntimeService(environment);
    return {
      kind: 'popover',
      tone: 'warning',
      eyebrow: 'Runtime blocked',
      title: blockedRuntimePrimaryActionTitle(environment, snapshot),
      detail: blockedRuntimePrimaryActionDetail(environment, snapshot),
      actions: blockedRuntimePrimaryActionGuidanceActions(environment, menuActions),
    };
  }
  if (environment.runtime_health.status === 'online') {
    const snapshot = environmentRuntimeService(environment);
    if (runtimeServiceIsOpenable(snapshot) || environmentOpenOperationAvailable(environment)) {
      return undefined;
    }
    if (environmentRuntimeMaintenance(environment) || (snapshot?.open_readiness?.state === 'blocked' && !runtimeServiceAllowsOpenAttempt(snapshot))) {
      return {
        kind: 'popover',
        tone: 'warning',
        eyebrow: 'Runtime blocked',
        title: blockedRuntimePrimaryActionTitle(environment, snapshot),
        detail: blockedRuntimePrimaryActionDetail(environment, snapshot),
        actions: blockedRuntimePrimaryActionGuidanceActions(environment, menuActions),
      };
    }
    return {
      kind: 'tooltip',
      tone: 'warning',
      message: runtimeServiceOpenReadinessLabel(snapshot),
    };
  }
  if (environment.kind === 'external_local_ui' && environmentOpenOperationAvailable(environment)) {
    return undefined;
  }

  if (environmentOpenPreflightAvailable(environment)) {
    return undefined;
  }

  if (environment.runtime_health.freshness === 'unknown') {
    const refreshAction = blockedPrimaryActionRefreshGuidanceAction(menuActions);
    const recoveryAction = blockedPrimaryActionGuidanceAction(environment, menuActions);
    return {
      kind: 'popover',
      tone: 'warning',
      eyebrow: 'Status not checked',
      title: 'Refresh status to continue',
      detail: 'Desktop has not checked this runtime yet. Refresh status now, or start the runtime when you already know it is offline.',
      actions: [
        ...(refreshAction
          ? [{
              ...refreshAction,
              emphasis: 'primary' as const,
            }]
          : []),
        ...(recoveryAction
          ? [{
              ...recoveryAction,
              emphasis: 'secondary' as const,
            }]
          : []),
      ],
    };
  }

  const recoveryAction = blockedPrimaryActionGuidanceAction(environment, menuActions);
  if (recoveryAction) {
    const refreshAction = blockedPrimaryActionRefreshGuidanceAction(menuActions);
    return {
      kind: 'popover',
      tone: 'warning',
      eyebrow: 'Runtime offline',
      title: blockedPrimaryActionTitle(environment, recoveryAction.action),
      detail: blockedPrimaryActionDetail(environment, recoveryAction.action),
      actions: [
        recoveryAction,
        ...(refreshAction ? [refreshAction] : []),
      ],
    };
  }

  return {
    kind: 'tooltip',
    tone: 'warning',
    message: specificRuntimeOfflineReason(environment)
      || 'Runtime is offline or unavailable right now. Start it from its source, then refresh status.',
  };
}

export function buildProviderBackedEnvironmentActionModel(
  environment: DesktopEnvironmentEntry,
  _controlPlaneSyncState: DesktopControlPlaneSyncState = environment.control_plane_sync_state ?? 'ready',
): ProviderBackedEnvironmentActionModel {
  const syncState = _controlPlaneSyncState;
  const primaryAction = syncState === 'auth_required' && environment.kind === 'provider_environment'
    ? {
        intent: 'reconnect_provider' as const,
        label: 'Reconnect Provider',
        enabled: true,
        variant: 'default' as const,
        provider_origin: environment.provider_origin,
        provider_id: environment.provider_id,
      }
    : primaryWindowAction(environment);
  const menuActions = syncState === 'auth_required' && environment.kind === 'provider_environment'
    ? [{
        id: 'reconnect_provider',
        label: 'Reconnect Provider',
        action: primaryAction,
      }]
    : runtimeMenuActions(environment);
  return {
    status_label: runtimeStatusLabel(environment),
    status_tone: runtimeStatusTone(environment),
    action_presentation: {
      kind: 'split_button',
      primary_action: primaryAction,
      primary_action_overlay: primaryActionOverlay(environment, menuActions),
      menu_button_label: 'Runtime actions',
      menu_actions: menuActions,
    },
  };
}

export function buildControlPlaneStatusModel(
  controlPlane: DesktopControlPlaneSummary,
): ControlPlaneStatusModel {
  switch (controlPlane.sync_state) {
    case 'syncing':
      return {
        label: 'Checking',
        tone: 'primary',
        detail: 'Refreshing the latest environment status from this provider.',
      };
    case 'auth_required':
      return {
        label: 'Reconnect required',
        tone: 'warning',
        detail: 'Desktop authorization expired. Reconnect in your browser to refresh environments again.',
      };
    case 'provider_unreachable':
      return {
        label: 'Sync failed',
        tone: 'warning',
        detail: controlPlane.last_sync_error_message || 'Desktop could not reach this provider.',
      };
    case 'provider_invalid':
      return {
        label: 'Invalid response',
        tone: 'warning',
        detail: controlPlane.last_sync_error_message || 'This provider returned an invalid response.',
      };
    case 'sync_error':
      return {
        label: 'Sync failed',
        tone: 'warning',
        detail: controlPlane.last_sync_error_message || 'Desktop could not refresh this provider.',
      };
    default:
      if (controlPlane.catalog_freshness === 'stale') {
        return {
          label: 'Status stale',
          tone: 'warning',
          detail: 'The last provider sync is getting old. Refresh to confirm the latest environment status.',
        };
      }
      return {
        label: 'Authorized',
        tone: 'success',
        detail: 'Desktop has active provider authorization and a fresh environment catalog.',
      };
  }
}

export function environmentStatusLabel(environment: DesktopEnvironmentEntry): string {
  return runtimeStatusLabel(environment);
}

export function environmentStatusTone(environment: DesktopEnvironmentEntry): EnvironmentCardTone {
  return runtimeStatusTone(environment);
}

function environmentCardMeta(environment: DesktopEnvironmentEntry): readonly EnvironmentCardMetaItem[] {
  if (environment.kind === 'local_environment') {
    return [];
  }
  if (environment.kind === 'provider_environment') {
    return [
      {
        label: 'Provider',
        value: environment.provider_origin ?? '',
        monospace: true,
      },
      {
        label: 'Environment ID',
        value: environment.env_public_id ?? '',
        monospace: true,
      },
    ].filter((item) => item.value !== '');
  }
  if (environment.kind === 'ssh_environment') {
    return [
      {
        label: 'Runtime root',
        value: environment.ssh_details?.runtime_root ?? '',
        monospace: true,
      },
      {
        label: 'Bootstrap',
        value: environment.ssh_details?.bootstrap_strategy === 'desktop_upload'
          ? 'Desktop upload'
          : environment.ssh_details?.bootstrap_strategy === 'remote_install'
            ? 'Remote fallback'
            : 'Automatic',
      },
    ].filter((item) => item.value !== '');
  }
  if (environment.kind === 'external_local_ui') {
    return [
      {
        label: 'Source',
        value: environmentSourceLabel(environment),
      },
    ];
  }
  return [];
}

export function buildEnvironmentCardModel(environment: DesktopEnvironmentEntry): EnvironmentCardModel {
  if (environment.kind === 'local_environment') {
    const localEndpoint = compact(environment.local_ui_url) || compact(environment.local_environment_ui_bind);
    const targetPrimary = localEndpoint || environment.secondary_text || 'Local environment';
    return {
      kind_label: environmentKindLabel(environment),
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      runtime_started_label: environmentRuntimeStartedLabel(environment),
      target_primary: targetPrimary,
      target_secondary: '',
      target_primary_monospace: shouldUseMonospaceEndpoint(targetPrimary),
      target_secondary_monospace: false,
      meta: environmentCardMeta(environment),
    };
  }

  if (environment.kind === 'provider_environment') {
    const remoteEndpoint = compact(environment.remote_environment_url);
    const targetPrimary = remoteEndpoint
      || compact(environment.local_ui_url)
      || compact(environment.secondary_text)
      || 'Provider environment';
    return {
      kind_label: 'Provider',
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      runtime_started_label: environmentRuntimeStartedLabel(environment),
      target_primary: targetPrimary,
      target_secondary: '',
      target_primary_monospace: shouldUseMonospaceEndpoint(targetPrimary),
      target_secondary_monospace: false,
      meta: environmentCardMeta(environment),
    };
  }

  if (environment.kind === 'ssh_environment') {
    return {
      kind_label: 'SSH Host',
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      runtime_started_label: environmentRuntimeStartedLabel(environment),
      target_primary: environment.secondary_text,
      target_secondary: environment.local_ui_url,
      target_primary_monospace: true,
      target_secondary_monospace: environment.local_ui_url !== '',
      meta: environmentCardMeta(environment),
    };
  }

  return {
    kind_label: 'Redeven URL',
    status_label: environmentStatusLabel(environment),
    status_tone: environmentStatusTone(environment),
    runtime_started_label: environmentRuntimeStartedLabel(environment),
    target_primary: environment.local_ui_url || environment.secondary_text,
    target_secondary: '',
    target_primary_monospace: true,
    target_secondary_monospace: false,
    meta: environmentCardMeta(environment),
  };
}

export function environmentMatchesLibrarySearch(
  environment: DesktopEnvironmentEntry,
  query: string,
): boolean {
  const clean = query.trim().toLowerCase();
  if (!clean) {
    return true;
  }
  return [
    environment.label,
    environment.local_ui_url,
    environment.secondary_text,
    environment.control_plane_label ?? '',
    environment.provider_origin ?? '',
    environment.env_public_id ?? '',
    environment.ssh_details?.ssh_destination ?? '',
    environment.ssh_details?.runtime_root ?? '',
    environment.ssh_details?.release_base_url ?? '',
    environment.ssh_details?.bootstrap_strategy ?? '',
  ].some((value) => value.toLowerCase().includes(clean));
}

export function environmentProviderFilterValue(environment: DesktopEnvironmentEntry): string {
  const providerOrigin = compact(environment.provider_origin);
  const providerID = compact(environment.provider_id);
  if (providerOrigin === '' || providerID === '') {
    return '';
  }
  try {
    return desktopControlPlaneKey(providerOrigin, providerID);
  } catch {
    return '';
  }
}

export function runtimeTargetEnvironmentLibraryFilterValue(
  runtimeTargetID: DesktopProviderRuntimeLinkTargetID,
): string {
  const normalizedTargetID = normalizeDesktopProviderRuntimeLinkTargetID(runtimeTargetID);
  return normalizedTargetID
    ? `${RUNTIME_TARGET_ENVIRONMENT_LIBRARY_FILTER_PREFIX}${normalizedTargetID}`
    : '';
}

export function runtimeTargetEnvironmentLibraryFilterTargetID(
  providerFilter: string,
): DesktopProviderRuntimeLinkTargetID | null {
  const activeFilter = compact(providerFilter);
  if (!activeFilter.startsWith(RUNTIME_TARGET_ENVIRONMENT_LIBRARY_FILTER_PREFIX)) {
    return null;
  }
  return normalizeDesktopProviderRuntimeLinkTargetID(
    activeFilter.slice(RUNTIME_TARGET_ENVIRONMENT_LIBRARY_FILTER_PREFIX.length),
  );
}

function isVisibleEnvironmentLibraryEntry(environment: DesktopEnvironmentEntry): boolean {
  return Boolean(environment);
}

export function environmentMatchesProviderFilter(
  environment: DesktopEnvironmentEntry,
  providerFilter: string,
): boolean {
  const activeFilter = compact(providerFilter);
  if (activeFilter === '') {
    return true;
  }
  if (activeFilter.startsWith(RUNTIME_TARGET_ENVIRONMENT_LIBRARY_FILTER_PREFIX)) {
    const runtimeTargetID = runtimeTargetEnvironmentLibraryFilterTargetID(activeFilter);
    return runtimeTargetID !== null && environment.provider_runtime_link_target?.id === runtimeTargetID;
  }
  if (activeFilter === LOCAL_ENVIRONMENT_LIBRARY_FILTER) {
    return environment.kind === 'local_environment';
  }
  if (activeFilter === PROVIDER_ENVIRONMENT_LIBRARY_FILTER) {
    return environment.kind === 'provider_environment';
  }
  if (activeFilter === URL_ENVIRONMENT_LIBRARY_FILTER) {
    return environment.kind === 'external_local_ui';
  }
  if (activeFilter === SSH_ENVIRONMENT_LIBRARY_FILTER) {
    return environment.kind === 'ssh_environment';
  }
  const environmentFilter = environmentProviderFilterValue(environment);
  return environmentFilter === activeFilter;
}

export function filterEnvironmentLibrary(
  snapshot: DesktopWelcomeSnapshot,
  query = '',
  providerFilter = '',
): readonly DesktopEnvironmentEntry[] {
  return snapshot.environments.filter((environment) => (
    isVisibleEnvironmentLibraryEntry(environment)
    && (
    environmentMatchesLibrarySearch(environment, query)
    && environmentMatchesProviderFilter(environment, providerFilter)
    )
  ));
}

export function environmentLibraryCount(
  snapshot: DesktopWelcomeSnapshot,
  query = '',
  providerFilter = '',
): number {
  return filterEnvironmentLibrary(snapshot, query, providerFilter).length;
}
