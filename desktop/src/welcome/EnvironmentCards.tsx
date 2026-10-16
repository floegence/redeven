import { environmentInteractionIdentity } from './environmentInteractionIdentity';
import {RuntimeCloudConnections} from './RuntimeCloudConnections';
import { RuntimeGatewaySetupDialog } from './RuntimeGatewaySetupDialog';
import { runtimeGatewayAccessPresentation } from '../shared/runtimeGatewayAccessPresentation';
import { RuntimeGatewayConnectionsDialog } from './RuntimeGatewayConnectionsDialog';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { RuntimeServiceCloudLinkBinding } from '../shared/runtimeService';
import type { RuntimeGatewayMembership } from '../shared/runtimeService';
import type { GatewayEnrollmentPurpose } from '../shared/gatewayJoin';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';
import { environmentAccessPresentation } from './environmentAccessPresentation';
import { RuntimeGatewayPublicationStatus } from './RuntimeGatewayPublicationStatus';
import type { AddressRecoveryTarget } from '../shared/desktopEnvironmentConnection';
import { For, Show, batch, createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, type JSX } from 'solid-js';
import { cn, useTheme } from '@floegence/floe-webapp-core';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, Tag, Tabs, TabPanel, KeyedFor } from '@floegence/floe-webapp-core/ui';
import { Clock, Cloud, MonitorPointer, Pin, Refresh, Search, Settings, Terminal, Trash, Link } from '@floegence/floe-webapp-core/icons';
import { FlowerSoftAuraIcon, type FlowerTurnLauncherAnchor } from '../../../internal/flower_ui/src';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { normalizeDesktopRuntimeLinuxDistribution, type DesktopRuntimePlatform } from '../shared/desktopRuntimePlatform';
import type { DesktopI18n } from '../shared/i18n';
import type { DesktopEnvironmentEntry, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import type { EnvironmentCardFactsBlock, EnvironmentSplitActionButton, EnvironmentProgressPanel } from './App';
import { CloudConnectionStatus, cloudConnectionState, cloudConnectionTitleKey } from './CloudConnectionStatus';
import type { DesktopControlPlaneSummary } from '../shared/cloud';
import { DesktopTooltip } from './DesktopTooltip';
import { ConsoleActionIconButton, EnvironmentStatusIndicator } from './environmentCardPrimitives';
import { buildEnvironmentLibraryLayoutModel, buildProviderBackedEnvironmentActionModel, environmentControlPlaneLabel,
  type EnvironmentActionModel, type EnvironmentCardModel, type EnvironmentCardFactModel, type EnvironmentActionPresentation, type EnvironmentCardFactActionModel } from './viewModel';
import { splitPinnedEnvironmentGroupIDs, type EnvironmentLibraryDisplayGroup } from './environmentLibraryProjection';
import { busyStateMatchesEnvironment, environmentOperationState, progressForEnvironmentFocusRequest, type DesktopLauncherBusyState } from './launcherBusyState';
import { closeEnvironmentLibraryOverlayState, closedEnvironmentLibraryOverlayState, environmentEndpointOverlaySelectedIDFor, environmentLibraryOverlayOpenFor,
  openEnvironmentLibraryOverlayState, selectEnvironmentEndpointOverlayState } from './environmentLibraryOverlayState';
import { guidanceSessionShouldAutoDismiss, isEnvironmentGuidancePendingIntent, openEnvironmentGuidanceSession,
  startEnvironmentGuidanceIntent, type EnvironmentGuidanceSessionState } from './environmentGuidanceSession';
import { settleEnvironmentLifecycleDisclosureAttempt, beginEnvironmentLifecycleDisclosure, bindEnvironmentLifecycleDisclosureOperation, closeEnvironmentLifecycleDisclosure,
  isEnvironmentLifecycleDisclosureIntent, createEnvironmentLifecycleAttempt, environmentActionStartsLifecycleDisclosure,  focusEnvironmentLifecycleDisclosure,
  reconcileEnvironmentLifecycleDisclosure, reopenEnvironmentLifecycleDisclosure, visibleEnvironmentLifecycleProgress, type EnvironmentLifecycleDisclosureIntent,
  type EnvironmentLifecycleDisclosureState, type EnvironmentLifecycleAttempt, type EnvironmentSettingsRestartSource } from './environmentLifecycleDisclosure';

const environmentPlatformAssets: Record<DesktopRuntimePlatform, { url: string; darkUrl?: string; name: string }> = {
  macos: { url: new URL('./assets/environment-platform-icons/apple.svg', import.meta.url).href,
    darkUrl: new URL('./assets/environment-platform-icons/apple-dark.svg', import.meta.url).href, name: 'macOS' },
  linux: { url: new URL('./assets/environment-platform-icons/linux.svg', import.meta.url).href, name: 'Linux' },
  windows: { url: new URL('./assets/environment-platform-icons/windows.svg', import.meta.url).href, name: 'Windows' },
};
const defaultEnvironmentDeviceIcon = new URL('./assets/environment-platform-icons/default-device.svg', import.meta.url).href;

// Original theSVG colors and exact os-release identities; never match ID_LIKE.
const distributionAssets: Record<string, { url: string; name: string }> = {
  ubuntu: { url: new URL('./assets/environment-platform-icons/ubuntu.svg', import.meta.url).href, name: 'Ubuntu' },
  debian: { url: new URL('./assets/environment-platform-icons/debian.svg', import.meta.url).href, name: 'Debian' },
  fedora: { url: new URL('./assets/environment-platform-icons/fedora.svg', import.meta.url).href, name: 'Fedora' },
  arch: { url: new URL('./assets/environment-platform-icons/arch-linux.svg', import.meta.url).href, name: 'Arch Linux' },
  alpine: { url: new URL('./assets/environment-platform-icons/alpine-linux.svg', import.meta.url).href, name: 'Alpine Linux' },
  centos: { url: new URL('./assets/environment-platform-icons/centos.svg', import.meta.url).href, name: 'CentOS' },
  almalinux: { url: new URL('./assets/environment-platform-icons/almalinux.svg', import.meta.url).href, name: 'AlmaLinux' },
  rocky: { url: new URL('./assets/environment-platform-icons/rocky-linux.svg', import.meta.url).href, name: 'Rocky Linux' },
  rhel: { url: new URL('./assets/environment-platform-icons/red-hat.svg', import.meta.url).href, name: 'Red Hat Enterprise Linux' },
  linuxmint: { url: new URL('./assets/environment-platform-icons/linux-mint.svg', import.meta.url).href, name: 'Linux Mint' },
  manjaro: { url: new URL('./assets/environment-platform-icons/manjaro.svg', import.meta.url).href, name: 'Manjaro' },
  nixos: { url: new URL('./assets/environment-platform-icons/nixos.svg', import.meta.url).href, name: 'NixOS' },
  opensuse: { url: new URL('./assets/environment-platform-icons/opensuse.svg', import.meta.url).href, name: 'openSUSE' },
  sles: { url: new URL('./assets/environment-platform-icons/suse.svg', import.meta.url).href, name: 'SUSE Linux Enterprise' },
  kali: { url: new URL('./assets/environment-platform-icons/kali-linux.svg', import.meta.url).href, name: 'Kali Linux' },
  gentoo: { url: new URL('./assets/environment-platform-icons/gentoo.svg', import.meta.url).href, name: 'Gentoo' },
  pop: { url: new URL('./assets/environment-platform-icons/pop-os.svg', import.meta.url).href, name: 'Pop!_OS' },
  raspbian: { url: new URL('./assets/environment-platform-icons/raspberry-pi.svg', import.meta.url).href, name: 'Raspberry Pi OS' },
};
const distributionAliases: Record<string, string> = {
  'opensuse-leap': 'opensuse', 'opensuse-tumbleweed': 'opensuse', sled: 'sles',
};

function environmentLinuxDistributionAsset(id: string | undefined) {
  if (!id) return undefined;
  const key = Object.hasOwn(distributionAliases, id) ? distributionAliases[id] : id;
  return Object.hasOwn(distributionAssets, key) ? distributionAssets[key] : undefined;
}

export function EnvironmentPlatformIcon(props: Readonly<{ platform?: DesktopRuntimePlatform; linuxDistribution?: string; i18n: DesktopI18n }>) {
  const theme = useTheme();
  const distribution = () => normalizeDesktopRuntimeLinuxDistribution(props.linuxDistribution, props.platform);
  const asset = (): { url: string; darkUrl?: string; name: string } | undefined => {
    const linux = environmentLinuxDistributionAsset(distribution());
    return linux ?? (props.platform ? environmentPlatformAssets[props.platform] : undefined);
  };
  const url = () => {
    const current = asset();
    return theme.resolvedTheme() === 'dark' && current?.darkUrl ? current.darkUrl : current?.url ?? defaultEnvironmentDeviceIcon;
  };
  const label = () => {
    const current = asset();
    return current ? props.i18n.t('environmentCenter.runtimePlatform', { platform: current.name })
      : props.i18n.t('environmentCenter.runtimePlatformUnknown');
  };
  return (
    <span class="redeven-environment-platform-slot" data-runtime-platform-slot>
      <img class="redeven-environment-platform-icon" src={url()} alt={label()} title={label()} draggable={false}
        data-runtime-platform={props.platform ?? 'unknown'} data-runtime-linux-distribution={distribution()} />
    </span>
  );
}

export type EnvironmentGuidanceActionResolution = Readonly<{ close_panel: boolean; next_session: EnvironmentGuidanceSessionState }>;

export type EnvironmentOwnerPresentation = Readonly<{
  card: (entry: DesktopEnvironmentEntry) => Omit<EnvironmentCardModel, 'kind_label'> & { kind_label: string };
  facts: (entry: DesktopEnvironmentEntry) => readonly EnvironmentCardFactModel[];
  actions: (model: Extract<EnvironmentActionPresentation, { kind: 'split_button' }>) => Extract<EnvironmentActionPresentation, { kind: 'split_button' }>;
}>;
export type LifecycleProgressFocusRequest = Readonly<{
  request_id: number; operation_key: string; started_at_unix_ms?: number;
  subject_kind: 'environment' | 'gateway'; subject_id: string;
  intent?: EnvironmentLifecycleDisclosureIntent;
  canReveal?: () => boolean;
  settingsRestart?: EnvironmentSettingsRestartSource;
}>;
const GUIDANCE_SUCCESS_DISMISS_MS = 720;
const GUIDANCE_SESSION_CLEAR_MS = 220;

function environmentKindTagVariant(kind: string): 'neutral' | 'primary' | 'success' {
  switch (kind) {
    case 'local_environment':
      return 'primary';
    case 'provider_environment':
      return 'neutral';
    case 'ssh_environment':
      return 'success';
    default:
      return 'neutral';
  }
}

export function environmentActionUsesLifecycleOwner(action: EnvironmentActionModel): boolean {
  return (
    isEnvironmentLifecycleDisclosureIntent(action.intent) ||
    action.intent === 'open' ||
    action.intent === 'open_with_preflight' ||
    action.intent === 'start_and_open'
  );
}

function readMeasuredElementWidth(element: HTMLElement | undefined): number {
  if (!element) {
    return 0;
  }
  return Math.max(0, Math.round(element.getBoundingClientRect().width || element.clientWidth || element.offsetWidth));
}

function readDocumentRootFontSizePx(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 16;
  }
  const value = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  if (!Number.isFinite(value) || value <= 0) {
    return 16;
  }
  return value;
}

export function EnvironmentCardsPanel(
  props: Readonly<{
    i18n: DesktopI18n;
    gateways?: readonly DesktopGatewaySource[];
    groups: readonly EnvironmentLibraryDisplayGroup[];
    allGroups: readonly EnvironmentLibraryDisplayGroup[];
    viewScope: string;
    defaultCloud?: boolean;
    controlPlanes: readonly DesktopControlPlaneSummary[];
    reconnectControlPlane: (source: DesktopControlPlaneSummary) => Promise<void>;
    presentation: EnvironmentOwnerPresentation;
    Facts: typeof EnvironmentCardFactsBlock;
    Actions: typeof EnvironmentSplitActionButton;
    Progress: typeof EnvironmentProgressPanel;
    newCard: JSX.Element;
    showQuickAddCards: boolean;
    visibleCardCount: number;
    layoutReferenceCardCount: number;
    busyState: DesktopLauncherBusyState;
    actionProgress: readonly DesktopLauncherActionProgress[];
    lifecycleProgressFocusRequest: LifecycleProgressFocusRequest | null;
    consumeLifecycleProgressFocusRequest: (requestID: number) => void;
    runLocalEnvironmentAction: (
      environment: DesktopEnvironmentEntry,
      action: EnvironmentActionModel,
      errorTarget?: 'connect' | 'dialog' | 'settings',
      attempt?: EnvironmentLifecycleAttempt,
      bindOperation?: (operation: EnvironmentLifecycleAttempt) => void,
    ) => Promise<boolean>;
    refreshEnvironmentRuntime: (
      environment: DesktopEnvironmentEntry,
      errorTarget?: 'connect' | 'dialog' | 'settings',
    ) => Promise<boolean>;
    openEnvironmentFlowerSurface: (environment: DesktopEnvironmentEntry, anchor?: FlowerTurnLauncherAnchor) => void;
    runEnvironmentGuidanceAction: (
      environment: DesktopEnvironmentEntry,
      action: EnvironmentActionModel,
      updateSession?: (state: EnvironmentGuidanceSessionState) => void,
      attempt?: EnvironmentLifecycleAttempt,
    ) => Promise<EnvironmentGuidanceActionResolution>;
    runDesktopUpdateHandoff: (environmentID: string, label?: string) => Promise<void>;
    runEnvironmentCardFactAction: (action: EnvironmentCardFactActionModel) => void;
    toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
    openInBrowser: (url: string) => Promise<void>;
    copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
    editEnvironment: (environment: DesktopEnvironmentEntry, recovery?: AddressRecoveryTarget) => void;
    deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
    cancelOperation: (progress: DesktopLauncherActionProgress) => void;
    dismissOperation: (progress: DesktopLauncherActionProgress) => void;
    copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  }>,
) {
  const [environmentLibraryElement, setEnvironmentLibraryElement] = createSignal<HTMLDivElement>();
  const [environmentLibraryWidthPx, setEnvironmentLibraryWidthPx] = createSignal(0);
  const [rootFontSizePx, setRootFontSizePx] = createSignal(16);
  const [activeEnvironmentOverlayState, setActiveEnvironmentOverlayState] = createSignal(
    closedEnvironmentLibraryOverlayState(),
  );
  const [guidanceSessionState, setGuidanceSessionState] = createSignal<EnvironmentGuidanceSessionState>(null);
  const [lifecycleDisclosureState, setLifecycleDisclosureState] =
    createSignal<EnvironmentLifecycleDisclosureState>(null);
  // Render relation cards by stable group id so snapshot refreshes update data in place instead of remounting the card subtree.
  const [sessionOwners, setSessionOwners] = createSignal<ReadonlySet<string>>(new Set());
  const heldOwners = createMemo(() => {
    const owners = new Set(sessionOwners());
    const overlay = activeEnvironmentOverlayState();
    if (overlay.kind !== 'none') owners.add(overlay.environment_id);
    return owners;
  });
  // Retained data supplies presentation only. Submission authority always comes from allGroups.
  const renderedGroups = createMemo<readonly EnvironmentLibraryDisplayGroup[]>(previous => {
    const held = heldOwners();
    const locked = (previous ?? []).filter(group => (group.owner_ids ?? group.member_ids).some(id => held.has(id)));
    const reserved = new Set(locked.flatMap(group => [...group.member_ids, ...(group.owner_ids ?? [])]));
    const latest = new Map(props.allGroups.flatMap(group => group.member_entries).map(entry => [entry.id, entry]));
    // IMPORTANT: An open owner keeps one host across regrouping; observations update facts, not topology.
    const retained: readonly EnvironmentLibraryDisplayGroup[] = locked.map(group => ({ ...group,
      primary_entry: latest.get(group.primary_entry.id) ?? group.primary_entry,
      provider_entry: group.provider_entry && (latest.get(group.provider_entry.id) ?? group.provider_entry),
      member_entries: group.member_entries.map(entry => latest.get(entry.id) ?? entry),
      gateway_entries: group.gateway_entries?.map(entry => latest.get(entry.id) ?? entry),
    }));
    const next = props.groups.flatMap<EnvironmentLibraryDisplayGroup>(group => {
      const host = retained.find(item => item.id === group.id);
      if (host) return [host];
      if (reserved.has(group.primary_entry.id)) return [];
      const entries = group.member_entries.filter(entry => !reserved.has(entry.id));
      return [{ ...group, member_entries: entries, member_ids: entries.map(entry => entry.id),
        provider_entry: group.provider_entry && !reserved.has(group.provider_entry.id) ? group.provider_entry : undefined,
        owner_ids: (group.owner_ids ?? group.member_ids).filter(id => !reserved.has(id)),
      }];
    });
    return [...next, ...retained.filter(group => !next.some(item => item.id === group.id))];
  }, []);
  const projectedEntries = createMemo(() => renderedGroups().flatMap((group) => group.member_entries));
  const projectedGroupsByID = createMemo(() => Object.fromEntries(
    renderedGroups().map((group) => [group.id, group] as const),
  ) as Readonly<Record<string, EnvironmentLibraryDisplayGroup>>);
  const groupedGroupIDs = createMemo(() => splitPinnedEnvironmentGroupIDs(renderedGroups()));
  const projectedEntriesByID = createMemo(() => Object.fromEntries(projectedEntries().map(entry => [entry.id, entry])));
  const [selectedOwnerIDs, setSelectedOwnerIDs] = createSignal<Readonly<Record<string, string>>>({});
  const viewScope = createMemo(() => props.viewScope);
  createEffect(on(viewScope, () => {
    setSelectedOwnerIDs({});
    setActiveEnvironmentOverlayState(closedEnvironmentLibraryOverlayState());
  }));
  const activeOwnerID = (group: EnvironmentLibraryDisplayGroup) => {
    const selected = selectedOwnerIDs()[group.id];
    return selected && (group.owner_ids ?? group.member_ids).includes(selected) ? selected
      : props.defaultCloud && group.provider_entry ? group.provider_entry.id : group.primary_entry.id;
  };
  const selectOwner = (group: EnvironmentLibraryDisplayGroup, ownerID: string) => {
    if (!(group.owner_ids ?? group.member_ids).includes(ownerID)) return;
    setActiveEnvironmentOverlayState(closedEnvironmentLibraryOverlayState());
    setSelectedOwnerIDs(current => ({ ...current, [group.id]: ownerID }));
  };
  // Keep transient provider/search filters from collapsing the shared environment column system.
  const layoutModel = createMemo(() =>
    buildEnvironmentLibraryLayoutModel({
      visible_card_count: props.visibleCardCount,
      layout_reference_count: props.layoutReferenceCardCount,
      container_width_px: environmentLibraryWidthPx(),
      root_font_size_px: rootFontSizePx(),
    }),
  );
  const environmentGridStyle = createMemo<JSX.CSSProperties>(() => ({
    '--redeven-environment-grid-columns': String(layoutModel().column_count),
  }));

  createEffect(() => {
    setLifecycleDisclosureState((current) =>
      reconcileEnvironmentLifecycleDisclosure(current, props.allGroups.flatMap(group => group.member_entries), props.actionProgress),
    );
  });

  createEffect(() => {
    const session = guidanceSessionState();
    if (!guidanceSessionShouldAutoDismiss(session) || typeof window === 'undefined') {
      return;
    }
    let clearHandle: number | undefined;
    const handle = window.setTimeout(() => {
      if (guidanceSessionState() !== session) return;
      setActiveEnvironmentOverlayState((current) =>
        session
          ? closeEnvironmentLibraryOverlayState(current, 'primary_action_guidance', session.environment_id)
          : current,
      );
      clearHandle = window.setTimeout(() => {
        setGuidanceSessionState((current) => (current === session ? null : current));
      }, GUIDANCE_SESSION_CLEAR_MS);
    }, GUIDANCE_SUCCESS_DISMISS_MS);
    onCleanup(() => {
      window.clearTimeout(handle);
      if (clearHandle !== undefined) {
        window.clearTimeout(clearHandle);
      }
    });
  });

  const setRuntimeMenuOpen = (environmentID: string, open: boolean) => {
    if (open) {
      setLifecycleDisclosureState((current) => closeEnvironmentLifecycleDisclosure(current, environmentID));
    }
    setActiveEnvironmentOverlayState((current) =>
      open
        ? openEnvironmentLibraryOverlayState('runtime_menu', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'runtime_menu', environmentID),
    );
  };

  const setPrimaryActionGuidanceOpen = (environmentID: string, open: boolean) => {
    if (open) {
      setLifecycleDisclosureState((current) => closeEnvironmentLifecycleDisclosure(current, environmentID));
    }
    setActiveEnvironmentOverlayState((current) => {
      const nextState = open
        ? openEnvironmentLibraryOverlayState('primary_action_guidance', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'primary_action_guidance', environmentID);
      setGuidanceSessionState((session) => {
        if (open) {
          return openEnvironmentGuidanceSession(environmentID);
        }
        return session?.environment_id === environmentID ? null : session;
      });
      return nextState;
    });
  };

  const setLifecycleProgressOpen = (environmentID: string, open: boolean) => {
    const focusRequest = props.lifecycleProgressFocusRequest;
    if (!open && focusRequest?.subject_kind === 'environment' && focusRequest.subject_id === environmentID) {
      props.consumeLifecycleProgressFocusRequest(focusRequest.request_id);
    }
    setActiveEnvironmentOverlayState((current) =>
      open
        ? openEnvironmentLibraryOverlayState('lifecycle_progress', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'lifecycle_progress', environmentID),
    );
    setLifecycleDisclosureState((current) => {
      if (!open) return closeEnvironmentLifecycleDisclosure(current, environmentID);
      if (current?.environment_id === environmentID) return reopenEnvironmentLifecycleDisclosure(current, environmentID);
      const environment = projectedEntriesByID()[environmentID];
      const progress = environment && environmentOperationState(environment, props.actionProgress, props.busyState).panelProgress;
      const disclosure = progress && focusEnvironmentLifecycleDisclosure(null, environmentID, progress);
      return disclosure ? { ...disclosure, authority_key: environmentInteractionIdentity(environment) } : current;
    });
  };

  const settleLifecycleProgressDisclosure = (environmentID: string, attempt: EnvironmentLifecycleAttempt, accepted: boolean) => {
    setLifecycleDisclosureState(current => settleEnvironmentLifecycleDisclosureAttempt(current, environmentID, attempt, accepted));
  };

  const bindLifecycleProgressDisclosure = (
    environmentID: string,
    attempt: EnvironmentLifecycleAttempt,
    operation: EnvironmentLifecycleAttempt,
  ) => {
    setLifecycleDisclosureState((current) =>
      bindEnvironmentLifecycleDisclosureOperation(current, environmentID, attempt, operation),
    );
  };

  let handledLifecycleProgressFocusRequestID = 0;
  let preparedLifecycleProgressFocusRequestID = 0;
  createEffect(() => {
    const request = props.lifecycleProgressFocusRequest;
    if (
      !request ||
      request.subject_kind !== 'environment' ||
      request.request_id === handledLifecycleProgressFocusRequestID
    ) {
      return;
    }
    const environment = projectedEntries().find((entry) => entry.id === request.subject_id);
    if (!environment) {
      return;
    }
    const progress = progressForEnvironmentFocusRequest(environment, props.actionProgress, request);
    if (request.intent && request.started_at_unix_ms !== undefined && preparedLifecycleProgressFocusRequestID !== request.request_id) {
      preparedLifecycleProgressFocusRequestID = request.request_id;
      setLifecycleDisclosureState({
        ...beginEnvironmentLifecycleDisclosure(null, environment.id, request.intent, {
          operation_key: request.operation_key, started_at_unix_ms: request.started_at_unix_ms,
        })!,
        visibility: 'open', settings_restart: request.settingsRestart, authority_key: environmentInteractionIdentity(environment),
        ...(progress ? { last_progress: progress } : {}),
      });
    }
    if (request.canReveal && !request.canReveal()) return;
    if (!request.intent && !progress) return;
    const group = props.groups.find(group => group.member_ids.includes(environment.id));
    if (group) selectOwner(group, (group.owner_ids ?? group.member_ids).includes(environment.id) ? environment.id : group.primary_entry.id);
    handledLifecycleProgressFocusRequestID = request.request_id;
    if (progress) {
      const disclosure = focusEnvironmentLifecycleDisclosure(null, environment.id, progress);
      setLifecycleDisclosureState(disclosure ? { ...disclosure, settings_restart: request.settingsRestart, authority_key: environmentInteractionIdentity(environment) } : null);
    }
    setLifecycleProgressOpen(environment.id, true);
    const owner = environmentLibraryElement()?.querySelector<HTMLElement>(`[data-owner-id="${CSS.escape(environment.id)}"]`);
    owner?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    props.consumeLifecycleProgressFocusRequest(request.request_id);
  });

  const beginLifecycleProgressDisclosure = (
    environmentID: string,
    intent: EnvironmentLifecycleDisclosureIntent,
    attempt: EnvironmentLifecycleAttempt,
  ) => {
    // IMPORTANT: Register the attempt and show its operation surface before any asynchronous admission.
    batch(() => {
      setGuidanceSessionState((current) => (current?.environment_id === environmentID ? null : current));
      setLifecycleDisclosureState((current) => ({ ...beginEnvironmentLifecycleDisclosure(current, environmentID, intent, attempt)!,
        authority_key: environmentInteractionIdentity(projectedEntriesByID()[environmentID]!),
      }));
      setActiveEnvironmentOverlayState(openEnvironmentLibraryOverlayState('lifecycle_progress', environmentID));
    });
  };

  const setEndpointPopoverOpen = (environmentID: string, open: boolean) => {
    if (open) {
      setLifecycleDisclosureState((current) => closeEnvironmentLifecycleDisclosure(current, environmentID));
    }
    setActiveEnvironmentOverlayState((current) =>
      open
        ? openEnvironmentLibraryOverlayState('endpoints', environmentID)
        : closeEnvironmentLibraryOverlayState(current, 'endpoints', environmentID),
    );
  };

  const selectEndpointForQRCode = (environmentID: string, endpointID: string) => {
    setActiveEnvironmentOverlayState(selectEnvironmentEndpointOverlayState(environmentID, endpointID));
  };

  const projectedGroup = (groupID: string): EnvironmentLibraryDisplayGroup =>
    projectedGroupsByID()[groupID]!;
  const guidanceSessionForEnvironment = (environmentID: string): EnvironmentGuidanceSessionState =>
    guidanceSessionState()?.environment_id === environmentID ? guidanceSessionState() : null;
  createEffect(() => {
    const element = environmentLibraryElement();
    if (!element) {
      return;
    }

    const updateLayoutMetrics = () => {
      const width = readMeasuredElementWidth(element);
      // A retained page reports zero while hidden; keep its last visible layout.
      if (width <= 0) return;
      setEnvironmentLibraryWidthPx(width);
      setRootFontSizePx(readDocumentRootFontSizePx());
    };

    updateLayoutMetrics();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updateLayoutMetrics());
    resizeObserver?.observe(element);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateLayoutMetrics);
    }

    onCleanup(() => {
      resizeObserver?.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', updateLayoutMetrics);
      }
    });
  });

  const disclosureForEnvironment = (environmentID: string) => {
    const disclosure = lifecycleDisclosureState();
    return disclosure?.environment_id === environmentID ? disclosure : null;
  };
  const renderOwner = (environmentID: string, groupID: string, gatewayView?: Readonly<{entry: () => DesktopEnvironmentEntry; member: () => RuntimeGatewayMembership | undefined; selector: JSX.Element}>) => {
    const group = createMemo<EnvironmentLibraryDisplayGroup>(previous => projectedGroupsByID()[groupID] ?? previous);
    const entry = createMemo<DesktopEnvironmentEntry>(previous => gatewayView?.entry() ?? projectedEntriesByID()[environmentID] ?? previous);
    return <EnvironmentOwnerSurface
      gateways={props.gateways}
      i18n={props.i18n}
      presentation={props.presentation}
      Facts={props.Facts}
      ownerAvailable={props.allGroups.some(group => group.member_ids.includes(environmentID) || group.gateway_tab_id === environmentID)}
      onInteractionActive={active => setSessionOwners(current => {
        if (current.has(environmentID) === active) return current;
        const next = new Set(current); if (active) next.add(environmentID); else next.delete(environmentID); return next;
      })}
      Actions={props.Actions}
      Progress={props.Progress}
      environment={entry()}
      managementEnvironment={group().primary_entry}
      gatewayPerspective={!!gatewayView}
      gatewayMember={gatewayView?.member()}
      gatewaySelector={gatewayView?.selector}
      relationshipRole={(entry()).kind === 'provider_environment' ? 'cloud' : group().provider_entry ? 'runtime' : undefined}
      paired={!!group().provider_entry}
      connectionStatus={() => (
        <CloudConnectionStatus runtime={group().primary_entry}
          cloud={group().provider_entry!} i18n={props.i18n}
          active={activeOwnerID(group()) === environmentID}
          busy={environmentOperationState(group().primary_entry, props.actionProgress, props.busyState).actionsDisabled}
          onRuntimeAction={action => {
            // Keep management on the exact Runtime owner, including its existing review.
            const runtime = group().primary_entry;
            selectOwner(group(), runtime.id);
            void props.runLocalEnvironmentAction(runtime, action, 'connect');
          }}
          onSignIn={() => {
            const cloud = group().provider_entry!;
            const source = props.controlPlanes.find(source => source.cloud.cloud_origin === cloud.cloud_origin
              && source.cloud.cloud_id === cloud.cloud_id);
            if (source) void props.reconnectControlPlane(source);
          }} />
      )}
      otherPinnedOwner={group().member_entries.find(entry => entry.id !== environmentID && entry.pinned)}
      busyState={props.busyState}
      actionProgress={props.actionProgress}
      lifecycleDisclosure={disclosureForEnvironment(environmentID)}
      runtimeMenuOpen={environmentLibraryOverlayOpenFor(
        activeEnvironmentOverlayState(),
        'runtime_menu',
        environmentID,
      )}
      onRuntimeMenuOpenChange={(open) => setRuntimeMenuOpen(environmentID, open)}
      primaryActionGuidanceOpen={environmentLibraryOverlayOpenFor(
        activeEnvironmentOverlayState(),
        'primary_action_guidance',
        environmentID,
      )}
      onPrimaryActionGuidanceOpenChange={(open) => setPrimaryActionGuidanceOpen(environmentID, open)}
      lifecycleProgressOpen={environmentLibraryOverlayOpenFor(
        activeEnvironmentOverlayState(),
        'lifecycle_progress',
        environmentID,
      )}
      onLifecycleProgressOpenChange={(open) => setLifecycleProgressOpen(environmentID, open)}
      endpointPopoverOpen={environmentLibraryOverlayOpenFor(
        activeEnvironmentOverlayState(),
        'endpoints',
        environmentID,
      )}
      onEndpointPopoverOpenChange={(open) => setEndpointPopoverOpen(environmentID, open)}
      selectedEndpointID={environmentEndpointOverlaySelectedIDFor(
        activeEnvironmentOverlayState(),
        environmentID,
      )}
      selectEndpointForQRCode={(endpointID) => selectEndpointForQRCode(environmentID, endpointID)}
      guidanceSession={guidanceSessionForEnvironment(environmentID)}
      runLocalEnvironmentAction={props.runLocalEnvironmentAction}
      refreshEnvironmentRuntime={props.refreshEnvironmentRuntime}
      openEnvironmentFlowerSurface={props.openEnvironmentFlowerSurface}
      runEnvironmentGuidanceAction={props.runEnvironmentGuidanceAction}
      runDesktopUpdateHandoff={props.runDesktopUpdateHandoff}
      runEnvironmentCardFactAction={props.runEnvironmentCardFactAction}
      toggleEnvironmentPinned={props.toggleEnvironmentPinned}
      openInBrowser={props.openInBrowser} copyEnvironmentValue={props.copyEnvironmentValue}
      editEnvironment={props.editEnvironment}
      deleteEnvironment={props.deleteEnvironment}
      cancelOperation={props.cancelOperation}
      dismissOperation={props.dismissOperation}
      copyOperationDiagnostics={props.copyOperationDiagnostics}
      setGuidanceSession={(nextSession) => setGuidanceSessionState(nextSession)}
      guidanceCurrent={(session) => guidanceSessionState() === session}
      beginLifecycleDisclosure={(intent, attempt) =>
        beginLifecycleProgressDisclosure(environmentID, intent, attempt)
      }
      settleLifecycleDisclosure={(attempt, accepted) => settleLifecycleProgressDisclosure(environmentID, attempt, accepted)}
      bindLifecycleDisclosure={(attempt, operation) =>
        bindLifecycleProgressDisclosure(environmentID, attempt, operation)
      }
    />;
  };
  const RelationCard = (cardProps: { groupID: string }) => {
    const group = createMemo<EnvironmentLibraryDisplayGroup>(previous => projectedGroup(cardProps.groupID) ?? previous);
    const relationID = createUniqueId();
    const tabID = (ownerID: string) => `${relationID}-tab-${encodeURIComponent(ownerID)}`;
    const panelID = (ownerID: string) => `${relationID}-panel-${encodeURIComponent(ownerID)}`;
    const hasTabs = () => Boolean(group().provider_entry || group().gateway_tab_id);
    const active = () => activeOwnerID(group());
    const memberIDs = createMemo(() => group().owner_ids ?? group().member_ids, undefined, {
      equals: (left, right) => left.length === right.length && left.every((id, index) => id === right[index]),
    });
    const gatewayTabID = createMemo(() => group().gateway_tab_id);
    const [selectedGateway,setSelectedGateway] = createSignal('');
    const gatewayMembers = () => group().primary_entry.runtime_service?.gateway_memberships ?? [];
    createEffect(() => {
      const selected = selectedGateway();
      if (selected && !gatewayMembers().some(member => member.gateway_id === selected)
        && !heldOwners().has(group().gateway_tab_id ?? '')) setSelectedGateway('');
    });
    const gatewayMember = createMemo<RuntimeGatewayMembership | undefined>(previous => {
      const selected = selectedGateway();
      return selected ? gatewayMembers().find(item => item.gateway_id === selected) ?? (previous?.gateway_id === selected ? previous : undefined)
        : gatewayMembers()[0] ?? previous;
    });
    const gatewayEntry = () => group().gateway_entries?.find(entry => entry.gateway_env_id === gatewayMember()?.member_id
      && entry.gateway_identity_fingerprint === gatewayMember()?.identity_fingerprint
      && entry.gateway_member?.runtime_public_id === gatewayMember()?.runtime_public_id) ?? group().primary_entry;
    const gatewaySelector = <Show when={gatewayMembers().length > 1}><label class="mb-2 flex min-w-0 items-center gap-2 text-xs"><span class="shrink-0 text-muted-foreground">{props.i18n.t('gatewayConnections.tab')}</span><select class="min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs" aria-label={props.i18n.t('gatewayConnections.select')} value={gatewayMember()?.gateway_id} onChange={event => {setSelectedGateway(event.currentTarget.value);setActiveEnvironmentOverlayState(closedEnvironmentLibraryOverlayState());}}><KeyedFor each={gatewayMembers()} by={member => member.gateway_id}>{member => <option value={member().gateway_id}>{member().gateway_name || member().gateway_id}</option>}</KeyedFor></select></label></Show>;
    const items = createMemo(() => memberIDs().map(ownerID => {
      if (ownerID === gatewayTabID()) return {id:ownerID, domId:tabID(ownerID), panelId:panelID(ownerID), label:props.i18n.t('environmentCenter.accessTabs.gateway'), fullName:props.i18n.t('gatewayConnections.tab'), icon:(
        <span class="redeven-owner-tab-icon" role="img" title={props.i18n.t('gatewayConnections.tab')} aria-label={props.i18n.t('environmentCenter.accessTabStatus', { name: props.i18n.t('gatewayConnections.tab'), status: props.i18n.t(`gatewayMembership.${gatewayMember()?.phase ?? 'not_joined'}`) })}>
          <Link aria-hidden="true" />
        </span>
      )};
      const entry = () => projectedEntriesByID()[ownerID]!;
      const model = () => props.presentation.card(entry());
      const busy = () => environmentOperationState(entry(), props.actionProgress, props.busyState).actionsDisabled;
      const cloudState = () => entry().kind === 'provider_environment' ? cloudConnectionState(group().primary_entry, entry()) : undefined;
      const progressing = () => busy() || ['connecting', 'restoring', 'retrying'].includes(cloudState() ?? '');
      const warning = () => model().status_tone === 'warning' || (cloudState() !== undefined && cloudState() !== 'connected');
      const status = () => busy() ? props.i18n.t('environmentCenter.ownerOperationRunning')
        : cloudState() !== undefined && cloudState() !== 'connected' ? props.i18n.t(cloudConnectionTitleKey(group().primary_entry, entry())) : model().status_label;
      const fullName = () => entry().kind === 'provider_environment' ? props.i18n.t('environmentCenter.providerFilter') : model().kind_label;
      return { id: ownerID,
        domId: tabID(ownerID), panelId: panelID(ownerID),
        get label() {
          if (entry().kind === 'provider_environment') return props.i18n.t('environmentCenter.accessTabs.cloud');
          if (entry().kind === 'local_environment') return props.i18n.t('environmentCenter.accessTabs.local');
          if (entry().kind === 'ssh_environment') return props.i18n.t('environmentCenter.accessTabs.ssh');
          return model().kind_label;
        },
        get fullName() { return fullName(); },
        icon: (
          <span class="redeven-owner-tab-icon" role="img" title={props.i18n.t('environmentCenter.accessTabStatus', { name: fullName(), status: status() })} aria-label={props.i18n.t('environmentCenter.accessTabStatus', { name: fullName(), status: status() })}>
            <Show when={progressing()} fallback={
              <Show when={entry().kind === 'provider_environment'} fallback={
                <Show when={entry().kind === 'local_environment'} fallback={<Terminal aria-hidden="true" />}>
                  <MonitorPointer aria-hidden="true" />
                </Show>
              }>
                <Cloud aria-hidden="true" />
              </Show>
            }>
              <Refresh aria-hidden="true" class="motion-safe:animate-spin" />
            </Show>
            <Show when={!progressing() && warning()}>
              <span class="redeven-owner-tab-status" aria-hidden="true" />
            </Show>
          </span>
        ),
      };
    }));
    return (
      <Card class={cn("redeven-environment-card overflow-hidden", (active() === group().gateway_tab_id
        ? gatewayEntry().is_open : group().member_entries.find(entry => entry.id === active())?.is_open) && "redeven-environment-card--open")} data-environment-group={cardProps.groupID}>
        <div class="redeven-environment-access-heading">
          <Show when={hasTabs()} fallback={
            <Tag variant={environmentKindTagVariant(group().primary_entry.kind)} tone="soft" size="sm" class="redeven-environment-kind-tag cursor-default whitespace-nowrap" title={props.presentation.card(group().primary_entry).kind_label}>
              <span class="redeven-control-label">{props.presentation.card(group().primary_entry).kind_label}</span>
            </Tag>
          }>
            <Tabs
              items={items()}
              activeId={active()}
              onChange={id => selectOwner(group(), id)}
              ariaLabel={props.i18n.t('environmentCenter.accessPerspective')}
              size="sm"
              features={{ indicator: { mode: 'none' }, containerBorder: false, scrollButtons: 'never' }}
              class="redeven-environment-owner-tabs"
              title={items().map(item => item.fullName).join(' / ')}
              slotClassNames={{ scrollContainer: 'redeven-environment-owner-tablist', tab: 'redeven-environment-owner-tab' }}
            />
          </Show>
        </div>
        <div class="redeven-environment-owner-stack">
          <For each={memberIDs().filter(id => id !== group().gateway_tab_id)}>
            {ownerID => (
              <TabPanel
                id={panelID(ownerID)}
                labelledBy={hasTabs() ? tabID(ownerID) : undefined}
                active={active() === ownerID}
                keepMounted
                inert={active() !== ownerID}
                aria-label={props.presentation.card(projectedEntriesByID()[ownerID]!).kind_label}
                class="redeven-environment-owner-panel"
              >
                {renderOwner(ownerID, cardProps.groupID)}
              </TabPanel>
            )}
          </For>
          <Show when={group().gateway_tab_id}>{id => <TabPanel id={panelID(id())} labelledBy={hasTabs() ? tabID(id()) : undefined} active={active()===id()} keepMounted inert={active()!==id()} aria-label={props.i18n.t('gatewayConnections.tab')} class="redeven-environment-owner-panel">{renderOwner(id(),cardProps.groupID,{entry:gatewayEntry,member:gatewayMember,selector:gatewaySelector})}</TabPanel>}</Show>
        </div>
      </Card>
    );
  };

  return (
    <div class="space-y-3">
      <Show
        when={renderedGroups().length > 0 || props.showQuickAddCards}
        fallback={
          <div class="redeven-console-empty flex flex-col items-center justify-center gap-3 rounded-lg px-6 py-8 text-center">
            <Search class="h-8 w-8 text-muted-foreground/50" />
            <div class="space-y-1">
              <div class="text-[length:var(--floe-type-body)] font-medium text-foreground">
                {props.i18n.t('environmentCenter.noMatchingEnvironmentsTitle')}
              </div>
              <div class="text-xs text-muted-foreground">
                {props.i18n.t('environmentCenter.noMatchingEnvironmentsDescription')}
              </div>
            </div>
          </div>
        }
      >
        <div
          ref={setEnvironmentLibraryElement}
          class="redeven-environment-library space-y-3"
          data-density={layoutModel().density}
          style={environmentGridStyle()}
        >
          <Show when={groupedGroupIDs().pinned_group_ids.length > 0}>
            <EnvironmentLibrarySection title={props.i18n.t('environmentCenter.pinnedSection')}>
              <For each={groupedGroupIDs().pinned_group_ids}>
                {(groupID) => (
                  <RelationCard groupID={groupID} />
                )}
              </For>
            </EnvironmentLibrarySection>
          </Show>
          <Show when={groupedGroupIDs().regular_group_ids.length > 0 || props.showQuickAddCards}>
            <EnvironmentLibrarySection
              title={
                groupedGroupIDs().pinned_group_ids.length > 0
                  ? props.i18n.t('environmentCenter.environmentsSection')
                  : undefined
              }
            >
              <For each={groupedGroupIDs().regular_group_ids}>
                {(groupID) => (
                  <RelationCard groupID={groupID} />
                )}
              </For>
              <Show when={props.showQuickAddCards}>
                {props.newCard}
              </Show>
            </EnvironmentLibrarySection>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function EnvironmentLibrarySection(props: Readonly<{
  title?: string;
  children: JSX.Element;
}>) {
  return (
    <section class="space-y-2.5">
      <Show when={props.title}>
        {(title) => (
          <div class="px-1">
            <h2 class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title()}</h2>
          </div>
        )}
      </Show>
      <div class="redeven-environment-grid">
        {props.children}
      </div>
    </section>
  );
}

function EnvironmentOwnerSurface(
  props: Readonly<{
    ownerAvailable: boolean;
    onInteractionActive: (active: boolean) => void;
    i18n: DesktopI18n;
    gateways?: readonly DesktopGatewaySource[];
    presentation: EnvironmentOwnerPresentation;
    Facts: typeof EnvironmentCardFactsBlock;
    Actions: typeof EnvironmentSplitActionButton;
    Progress: typeof EnvironmentProgressPanel;
    environment: DesktopEnvironmentEntry;
    relationshipRole?: 'runtime' | 'cloud';
    managementEnvironment?: DesktopEnvironmentEntry;
    gatewayPerspective?: boolean;
    gatewayMember?: RuntimeGatewayMembership;
    gatewaySelector?: JSX.Element;
    paired: boolean;
    connectionStatus: () => JSX.Element;
    otherPinnedOwner?: DesktopEnvironmentEntry;
    busyState: DesktopLauncherBusyState;
    actionProgress: readonly DesktopLauncherActionProgress[];
    lifecycleDisclosure: EnvironmentLifecycleDisclosureState;
    runtimeMenuOpen: boolean;
    onRuntimeMenuOpenChange: (open: boolean) => void;
    primaryActionGuidanceOpen: boolean;
    onPrimaryActionGuidanceOpenChange: (open: boolean) => void;
    lifecycleProgressOpen: boolean;
    onLifecycleProgressOpenChange: (open: boolean) => void;
    endpointPopoverOpen: boolean;
    onEndpointPopoverOpenChange: (open: boolean) => void;
    selectedEndpointID?: string;
    selectEndpointForQRCode: (endpointID: string) => void;
    guidanceSession: EnvironmentGuidanceSessionState;
    setGuidanceSession: (state: EnvironmentGuidanceSessionState) => void;
    guidanceCurrent: (session: EnvironmentGuidanceSessionState) => boolean;
    beginLifecycleDisclosure: (
      intent: EnvironmentLifecycleDisclosureIntent,
      attempt: EnvironmentLifecycleAttempt,
    ) => void;
    settleLifecycleDisclosure: (attempt: EnvironmentLifecycleAttempt, accepted: boolean) => void;
    bindLifecycleDisclosure: (attempt: EnvironmentLifecycleAttempt, operation: EnvironmentLifecycleAttempt) => void;
    runLocalEnvironmentAction: (
      environment: DesktopEnvironmentEntry,
      action: EnvironmentActionModel,
      errorTarget?: 'connect' | 'dialog' | 'settings',
      attempt?: EnvironmentLifecycleAttempt,
      bindOperation?: (operation: EnvironmentLifecycleAttempt) => void,
    ) => Promise<boolean>;
    refreshEnvironmentRuntime: (
      environment: DesktopEnvironmentEntry,
      errorTarget?: 'connect' | 'dialog' | 'settings',
    ) => Promise<boolean>;
    openEnvironmentFlowerSurface: (environment: DesktopEnvironmentEntry, anchor?: FlowerTurnLauncherAnchor) => void;
    runEnvironmentGuidanceAction: (
      environment: DesktopEnvironmentEntry,
      action: EnvironmentActionModel,
      updateSession?: (state: EnvironmentGuidanceSessionState) => void,
      attempt?: EnvironmentLifecycleAttempt,
    ) => Promise<EnvironmentGuidanceActionResolution>;
    runDesktopUpdateHandoff: (environmentID: string, label?: string) => Promise<void>;
    runEnvironmentCardFactAction: (action: EnvironmentCardFactActionModel) => void;
    toggleEnvironmentPinned: (environment: DesktopEnvironmentEntry) => Promise<void>;
    openInBrowser: (url: string) => Promise<void>;
    copyEnvironmentValue: (value: string, copyLabel: string) => Promise<void>;
    editEnvironment: (environment: DesktopEnvironmentEntry, recovery?: AddressRecoveryTarget) => void;
    deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
    cancelOperation: (progress: DesktopLauncherActionProgress) => void;
    dismissOperation: (progress: DesktopLauncherActionProgress) => void;
    copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  }>,
) {
  const runtime = () => props.managementEnvironment ?? props.environment;
  const gatewayOperationState = createMemo(() => environmentOperationState(runtime(), props.actionProgress, props.busyState));
  const card = createMemo(() => {
    const original = props.presentation.card(props.environment);
    return props.gatewayPerspective && props.gatewayMember ? {...original,status_label:props.i18n.t(`gatewayMembership.${props.gatewayMember.phase}`),status_tone:['joined','accessible'].includes(props.gatewayMember.phase) ? 'success' as const : 'warning' as const} : original;
  });
  const facts = createMemo(() => props.gatewayPerspective ? [
    ...((runtime().runtime_service?.gateway_memberships?.length ?? 0) > 1 ? [] : [
      {id:'gateway-name',label:props.i18n.t('gatewayConnections.tab'),value:props.gatewayMember?.gateway_name || props.gatewayMember?.gateway_id || '',value_tone:'default' as const},
    ]),
    {id:'gateway-address',label:props.i18n.t('gatewayJoin.address'),value:props.gatewayMember?.endpoints[0]?.address ?? '',value_tone:'default' as const,copy_value:true as const},
  ] : props.presentation.facts(props.environment).filter(fact => !props.paired || fact.id !== 'cloud-connection'));
  const environmentActionModel = createMemo(() => buildProviderBackedEnvironmentActionModel(props.environment));
  const ownerLabel = createMemo(() => props.paired
    ? props.i18n.t('environmentCenter.relationshipOwnerLabel', {
      label: props.environment.label,
      owner: props.i18n.t(props.relationshipRole === 'cloud' ? 'environmentCenter.providerFilter' : 'environmentCenter.runtimeOwner'),
    }) : props.environment.label);
  const refreshLabel = createMemo(() => props.environment.kind === 'provider_environment'
    ? props.i18n.t('environmentCenter.refreshCloudStatus')
    : props.i18n.t('environmentCenter.refreshRuntimeStatus'));
  const environmentActionPresentation = createMemo(() => {
    const presentation = environmentAccessPresentation(props.environment, props.presentation.actions(environmentActionModel().action_presentation), props.i18n);
    if (props.gatewayPerspective && props.environment.kind !== 'gateway_environment') return {...presentation,primary_action:{...presentation.primary_action,enabled:false,disabled_reason:props.i18n.t('gatewayConnections.unavailable')},menu_actions:[]};
    return props.environment.kind === 'provider_environment' ? {
      ...presentation,
      primary_action: { ...presentation.primary_action, label: props.i18n.t(
        props.environment.window_state === 'open' ? 'environmentCenter.showCloudEnvApp' : 'environmentCenter.openCloudEnvApp',
      ) },
    } : presentation;
  });
  const operationState = createMemo(() => {
    const state = environmentOperationState(props.environment, props.actionProgress, props.busyState);
    if (!props.lifecycleDisclosure) return state;
    return { ...state, panelProgress: visibleEnvironmentLifecycleProgress({ environment: props.environment,
      selectedProgress: state.panelProgress, disclosure: props.lifecycleDisclosure, busyState: props.busyState }) };
  });
  const isPinBusy = createMemo(() =>
    busyStateMatchesEnvironment(props.busyState, props.environment.id, [
      'set_provider_environment_pinned',
      'set_environment_registration_pinned',
    ]),
  );
  let ownerElement: HTMLElement | undefined;
  const deleteTitle = createMemo(() => props.i18n.t('environmentCenter.removeEnvironment'));
  const runOpenWithPreflight = async (action: EnvironmentActionModel): Promise<void> => {
    const nextSession = startEnvironmentGuidanceIntent(
      props.guidanceSession,
      props.environment.id,
      'open_with_preflight',
    );
    props.onPrimaryActionGuidanceOpenChange(true);
    props.setGuidanceSession(nextSession);
    let current = nextSession as EnvironmentGuidanceSessionState;
    const publish = (next: EnvironmentGuidanceSessionState) => { if (props.guidanceCurrent(current)) { props.setGuidanceSession(next); current = next; } };
    const resolution = await props.runEnvironmentGuidanceAction(props.environment, action, publish);
    if (!props.guidanceCurrent(current)) return;
    publish(resolution.next_session);
    if (resolution.close_panel) {
      props.onPrimaryActionGuidanceOpenChange(false);
    }
  };

  const [gatewaySetupOpen, setGatewaySetupOpen] = createSignal(false);
  const [joinOpen, setJoinOpen] = createSignal(false);
  const [cloudOpen, setCloudOpen] = createSignal(false);
  const [gatewayJoinOpenRequest, setGatewayJoinOpenRequest] = createSignal(0);
  const [gatewayJoinPurpose, setGatewayJoinPurpose] = createSignal<GatewayEnrollmentPurpose>('join');
  const [gatewayJoinAddress, setGatewayJoinAddress] = createSignal('');
  const openGatewayEnrollment = (purpose: GatewayEnrollmentPurpose) => {
    setJoinOpen(true);
    setGatewayJoinPurpose(purpose);
    setGatewayJoinAddress(purpose === 'update-endpoints' ? props.gatewayMember?.endpoints[0]?.address ?? '' : '');
    setGatewayJoinOpenRequest(value => value + 1);
  };
  const [gatewayMode,setGatewayMode]=createSignal<'leave'|'publish'>();
  const [gatewayActionID, setGatewayActionID] = createSignal<string>();
  createEffect(() => props.onInteractionActive(gatewaySetupOpen() || joinOpen() || cloudOpen() || !!gatewayMode()));
  const openGatewayConfirmation = (mode: 'leave' | 'publish') => {
    setGatewayActionID(props.gatewayPerspective ? props.gatewayMember?.gateway_id : undefined);
    setGatewayMode(mode);
  };
  const targetID = createMemo<DesktopCloudRuntimeLinkTargetID | undefined>(previous => runtime().provider_runtime_link_target?.id ?? previous);
  const targetAvailable = () => props.ownerAvailable && runtime().provider_runtime_link_target?.id === targetID();
  const cloudBinding = createMemo<RuntimeServiceCloudLinkBinding | undefined>(previous => runtime().runtime_service?.bindings?.cloud_link ?? previous);
  const gatewayActions = createMemo(() => {
    if (runtimeGatewayAccessPresentation(runtime())) {
      return [{
        id: 'gateway-setup',
        label: props.i18n.t('gatewayJoin.menuAction'),
        disabled: gatewayOperationState().actionsDisabled,
        onRun: (): void => { setGatewaySetupOpen(true); },
      }, ...(runtime().runtime_service?.gateway_memberships?.length ? [
       {id:'gateway-update-endpoints',label:props.i18n.t('gatewayJoin.updateEndpoints')+'…',disabled:operationState().actionsDisabled,onRun:()=>openGatewayEnrollment('update-endpoints')},
       {id:'gateway-leave',label:props.i18n.t('gatewayConnections.unpairTitle')+'…',tone:'danger' as const,disabled:operationState().actionsDisabled,onRun:()=>openGatewayConfirmation('leave')},
       {id:'gateway-publish',label:props.i18n.t('gatewayConnections.publishTitle')+'…',disabled:operationState().actionsDisabled,onRun:()=>openGatewayConfirmation('publish')},
      ] : [])];
    }
    return [];
  });

  const gatewaySetupEnvironment = createMemo(() => gatewaySetupOpen() ? runtime() : undefined);
  return (
    <section
      ref={ownerElement}
      tabIndex={-1}
      class="redeven-environment-owner"
      data-owner-id={props.environment.id}
      data-owner-role={props.relationshipRole ?? 'standalone'}
      aria-label={ownerLabel()}
    >
      <RuntimeGatewaySetupDialog gateways={props.gateways} environment={gatewaySetupEnvironment()} i18n={props.i18n}
        available={props.ownerAvailable} operationBusy={gatewayOperationState().actionsDisabled}
        progress={gatewayOperationState().activeProgress}
        close={() => { setGatewaySetupOpen(false); queueMicrotask(() => (ownerElement?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? ownerElement)?.focus()); }}
        edit={environment => { setGatewaySetupOpen(false); props.editEnvironment(environment); }}
        refresh={environment => props.refreshEnvironmentRuntime(environment, 'dialog')}
        recover={(environment, recovery) => props.runLocalEnvironmentAction(environment, {
          intent: recovery === 'start' ? 'start_runtime' : recovery === 'restart' ? 'restart_runtime' : 'update_runtime',
          label: props.i18n.t(recovery === 'start' ? 'gatewayJoin.startAndContinue' : recovery === 'restart' ? 'environmentAction.restartRuntime' : 'environmentAction.updateRuntime'),
          enabled: true, variant: 'default',
        }, 'dialog')} />
      <Show when={!props.ownerAvailable}><p role="alert" class="px-4 text-sm text-warning">{props.i18n.t('interactionContinuity.unavailable')}</p></Show>
      <CardHeader class="redeven-environment-owner-heading">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="redeven-environment-title-row">
              <EnvironmentPlatformIcon platform={runtime().runtime_platform} linuxDistribution={runtime().runtime_linux_distribution} i18n={props.i18n} />
              <CardTitle
                class="redeven-environment-title truncate select-text text-[length:var(--floe-type-control)] font-medium leading-5"
                title={runtime().label}
              >
                {runtime().label}
              </CardTitle>
            </div>
          </div>
          <DesktopTooltip content={refreshLabel()} placement="top">
            <span>
              <ConsoleActionIconButton
                title={refreshLabel()}
                aria-label={props.i18n.t(props.environment.kind === 'provider_environment' ? 'environmentCenter.cloudRefreshForLabel' : 'environmentCenter.refreshRuntimeStatusForLabel', {
                  label: ownerLabel(),
                })}
                disabled={operationState().actionsDisabled}
                onClick={() => {
                  void props.refreshEnvironmentRuntime(props.environment, 'connect');
                }}
              >
                <Refresh class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </span>
          </DesktopTooltip>
          <DesktopTooltip
            content={props.i18n.t('environmentCenter.askFlowerForLabel', {
              label: ownerLabel(),
            })}
            placement="top"
          >
            <button
              type="button"
              class="redeven-environment-card__flower-button"
              disabled={props.gatewayPerspective && props.environment.kind !== 'gateway_environment'}
              aria-label={props.i18n.t('environmentCenter.askFlowerForLabel', {
                label: ownerLabel(),
              })}
              title={props.i18n.t('environmentCenter.askFlowerForLabel', {
                label: ownerLabel(),
              })}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                props.openEnvironmentFlowerSurface(props.environment, {
                  x: rect.right,
                  y: rect.bottom,
                });
              }}
            >
              <FlowerSoftAuraIcon
                class="redeven-environment-card__flower-aura"
                iconClass="redeven-environment-card__flower-icon"
              />
            </button>
          </DesktopTooltip>
        </div>
        <div class="redeven-environment-owner-status">
          <EnvironmentStatusIndicator tone={card().status_tone} title={card().status_label}>{card().status_label}</EnvironmentStatusIndicator>
          <Show when={props.relationshipRole !== 'cloud'}>
            <span class="redeven-card-runtime-age" title={card().runtime_started_label}>
              <Clock aria-hidden="true" />
              <span>{card().runtime_started_label}</span>
            </span>
            <Show when={!props.paired && (!props.gatewayPerspective || !!props.environment.runtime_service?.bindings?.cloud_link.cloud) && environmentControlPlaneLabel(props.environment)}>
              {(label) => (
                <span class="redeven-card-cloud-affiliation" title={label()}>
                  <Cloud aria-hidden="true" />
                  <span>{label()}</span>
                </span>
              )}
            </Show>
          </Show>
        </div>
      </CardHeader>
      <CardContent class="flex flex-col px-4 pb-3 redeven-environment-owner-facts">
        {props.gatewaySelector}
        <props.Facts
          environmentID={props.environment.id} i18n={props.i18n} facts={facts()}
          environmentLabel={props.environment.label} minRows={props.gatewayPerspective && (runtime().runtime_service?.gateway_memberships?.length ?? 0) > 1 ? 1 : props.paired ? 2 : 3}
          onFactAction={props.runEnvironmentCardFactAction}
          configureAddress={props.environment.can_edit ? target => props.editEnvironment(props.environment, target) : undefined}
          openInBrowser={props.openInBrowser} copyEnvironmentValue={props.copyEnvironmentValue}
          endpointPopoverOpen={props.endpointPopoverOpen} onEndpointPopoverOpenChange={props.onEndpointPopoverOpenChange}
          selectedEndpointID={props.selectedEndpointID} selectEndpointForQRCode={props.selectEndpointForQRCode}
        />
        <Show when={props.paired && props.relationshipRole === 'cloud' && !runtime().runtime_service?.bindings?.cloud_link.cloud}>{props.connectionStatus()}</Show>
        <Show when={targetID() && cloudBinding()}>
          <RuntimeCloudConnections targetID={targetID()!} binding={cloudBinding()!} available={targetAvailable() && !!runtime().runtime_service?.bindings?.cloud_link.cloud} onOpenChange={setCloudOpen}
            memberships={runtime().runtime_service?.gateway_memberships ?? []} i18n={props.i18n} openInBrowser={props.openInBrowser}
            onChanged={async () => { if (!await props.refreshEnvironmentRuntime(runtime(), 'connect')) throw new Error('Runtime status could not be refreshed'); }} />
        </Show>
        <Show when={runtime().kind !== 'provider_environment' && targetID()}>
          <RuntimeGatewayJoinPanel gateways={props.gateways} targetLabel={runtime().provider_runtime_link_target?.label ?? runtime().label} focusOwner={() => ownerElement?.focus()} targetID={targetID()!} i18n={props.i18n} purpose={gatewayJoinPurpose()} address={gatewayJoinAddress()} openRequest={gatewayJoinOpenRequest()} authorityKey={JSON.stringify([targetAvailable(), environmentInteractionIdentity(runtime()), !!runtime().runtime_service?.capabilities?.runtime_gateway?.supported])} submissionBlocked={!targetAvailable() || !runtime().runtime_service?.capabilities?.runtime_gateway?.supported} hideTrigger onClose={()=>{setJoinOpen(false);void props.refreshEnvironmentRuntime(runtime(),'connect');}} />
          <RuntimeGatewayConnectionsDialog targetID={targetID()!} mode={gatewayMode()} available={targetAvailable() && !!runtime().runtime_service?.capabilities?.runtime_gateway?.supported}
            gatewayID={gatewayActionID()} authorityKey={JSON.stringify([environmentInteractionIdentity(runtime()), (runtime().runtime_service?.gateway_memberships ?? []).map(member => [member.gateway_id, member.member_id, member.identity_fingerprint, member.runtime_public_id])])}
            i18n={props.i18n} onClose={()=>setGatewayMode(undefined)} onChanged={()=>void props.refreshEnvironmentRuntime(runtime(),'connect')} focusOwner={()=>ownerElement?.focus()} />
        </Show>
        <Show when={props.environment.runtime_service?.gateway_publication}>{access => <RuntimeGatewayPublicationStatus access={access()} i18n={props.i18n} openInBrowser={props.openInBrowser} />}</Show>
      </CardContent>
      <Show when={!props.environment.pinned && props.otherPinnedOwner}>
        <div class="redeven-other-owner-pin"><Pin class="h-3 w-3" />
          <span class="redeven-control-label" title={props.i18n.t('environmentCenter.pinnedThroughOwner', { owner: props.otherPinnedOwner?.kind === 'provider_environment'
            ? props.i18n.t('environmentCenter.providerFilter') : props.i18n.t('environmentCenter.runtimeOwner') })}>{props.i18n.t('environmentCenter.pinnedThroughOwner', { owner: props.otherPinnedOwner?.kind === 'provider_environment'
            ? props.i18n.t('environmentCenter.providerFilter') : props.i18n.t('environmentCenter.runtimeOwner') })}</span>
        </div>
      </Show>
      <CardFooter class="redeven-environment-owner-footer mt-auto flex items-center gap-2 border-t border-border/60 px-4 pt-3 pb-2.5">
        <props.Actions
          i18n={props.i18n}
          presentation={environmentActionPresentation()}
          environmentID={props.environment.id}
          environmentLabel={props.environment.label}
          menuOpen={props.runtimeMenuOpen}
          onMenuOpenChange={props.onRuntimeMenuOpenChange}
          guidanceOpen={props.primaryActionGuidanceOpen}
          onGuidanceOpenChange={props.onPrimaryActionGuidanceOpenChange}
          progressOpen={props.lifecycleProgressOpen}
          onProgressOpenChange={props.onLifecycleProgressOpenChange}
          guidanceSession={props.guidanceSession}
          busyState={props.busyState}
          operationState={operationState()}
          settingsRestart={props.lifecycleDisclosure?.settings_restart}
          lifecycleDisclosure={props.lifecycleDisclosure}
          ownerAvailable={props.ownerAvailable}
          cancelOperation={props.cancelOperation}
          dismissOperation={props.dismissOperation}
          copyOperationDiagnostics={props.copyOperationDiagnostics}
          gatewayActions={gatewayActions()}
          refreshEnvironmentRuntime={() => {
            void props.refreshEnvironmentRuntime(props.environment, 'connect');
          }}
          runDesktopUpdateHandoff={async (environmentID, label) => {
            await props.runDesktopUpdateHandoff(environmentID, label);
          }}
          onRunAction={(action) => {
            void (async () => {
              if (!props.ownerAvailable || !action.enabled || action.preflight_id && props.lifecycleDisclosure?.authority_revoked) return;
              if ((operationState().actionsDisabled || props.lifecycleDisclosure?.submission === 'pending' && !operationState().panelProgress) && environmentActionUsesLifecycleOwner(action)) {
                if (operationState().activeProgress) {
                  props.onLifecycleProgressOpenChange(true);
                }
                return;
              }
              if (action.continue_open_after_completion) {
                await runOpenWithPreflight({
                  intent: 'open_with_preflight',
                  label: props.i18n.t('environmentAction.open'),
                  enabled: true,
                  variant: 'default',
                });
                return;
              }
              if (action.intent === 'update_desktop') {
                props.setGuidanceSession(null);
                props.onPrimaryActionGuidanceOpenChange(false);
              }
              if (action.intent === 'open_with_preflight') {
                await runOpenWithPreflight(action);
                return;
              }
              let lifecycleAttempt: EnvironmentLifecycleAttempt | undefined;
              if (environmentActionStartsLifecycleDisclosure(action)) {
                lifecycleAttempt = createEnvironmentLifecycleAttempt(props.environment.id, action.intent);
                props.beginLifecycleDisclosure(action.intent, lifecycleAttempt);
              } else if (isEnvironmentGuidancePendingIntent(action.intent)) {
                props.setGuidanceSession(
                  startEnvironmentGuidanceIntent(props.guidanceSession, props.environment.id, action.intent),
                );
                props.onPrimaryActionGuidanceOpenChange(true);
              }
              let completed = false;
              try { completed = await props.runLocalEnvironmentAction(
                props.environment,
                action,
                'connect',
                lifecycleAttempt,
                lifecycleAttempt
                  ? (operation) => props.bindLifecycleDisclosure(lifecycleAttempt, operation)
                  : undefined,
              ); } catch { /* Admission failure remains in the current operation surface. */ }
              if (lifecycleAttempt) props.settleLifecycleDisclosure(lifecycleAttempt, completed);
            })();
          }}
          onRunGuidanceAction={(action) => {
            if (!props.ownerAvailable || !action.enabled) return;
            void (async () => {
              let lifecycleAttempt: EnvironmentLifecycleAttempt | undefined;
              if (environmentActionStartsLifecycleDisclosure(action)) {
                lifecycleAttempt = createEnvironmentLifecycleAttempt(props.environment.id, action.intent);
                props.beginLifecycleDisclosure(action.intent, lifecycleAttempt);
              } else if (isEnvironmentGuidancePendingIntent(action.intent)) {
                props.setGuidanceSession(
                  startEnvironmentGuidanceIntent(props.guidanceSession, props.environment.id, action.intent),
                );
              }
              let current = props.guidanceSession;
              const publish = (next: EnvironmentGuidanceSessionState) => { if (props.guidanceCurrent(current)) { props.setGuidanceSession(next); current = next; } };
              try {
                const resolution = await props.runEnvironmentGuidanceAction(props.environment, action, publish, lifecycleAttempt);
                if (lifecycleAttempt) props.settleLifecycleDisclosure(lifecycleAttempt, resolution.close_panel);
                if (!props.guidanceCurrent(current)) return;
                publish(lifecycleAttempt ? null : resolution.next_session);
                if (resolution.close_panel && !lifecycleAttempt) props.onPrimaryActionGuidanceOpenChange(false);
              } catch {
                if (lifecycleAttempt) props.settleLifecycleDisclosure(lifecycleAttempt, false);
              }
            })();
          }}
        />
        <div class="flex items-center gap-0.5">
          <Show when={props.environment.kind !== 'gateway_environment'}>
            <DesktopTooltip
              content={
                props.environment.pinned
                  ? props.i18n.t('environmentCenter.unpinLabel', { label: ownerLabel() })
                  : props.i18n.t('environmentCenter.pinLabel', { label: ownerLabel() })
              }
              placement="top"
            >
              <ConsoleActionIconButton
                title={
                  props.environment.pinned
                    ? props.i18n.t('environmentCenter.unpinLabel', { label: ownerLabel() })
                    : props.i18n.t('environmentCenter.pinLabel', { label: ownerLabel() })
                }
                aria-label={
                  props.environment.pinned
                    ? props.i18n.t('environmentCenter.unpinLabel', {
                        label: ownerLabel(),
                      })
                    : props.i18n.t('environmentCenter.pinLabel', {
                        label: ownerLabel(),
                      })
                }
                active={props.environment.pinned}
                disabled={isPinBusy()}
                onClick={() => {
                  void props.toggleEnvironmentPinned(props.environment);
                }}
              >
                <Pin class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
          <Show when={props.environment.can_edit && (!props.gatewayPerspective || props.environment.kind === 'gateway_environment')}>
            <DesktopTooltip content={props.i18n.t('common.settings')} placement="top">
              <ConsoleActionIconButton
                title={props.i18n.t('environmentCenter.environmentSettings')}
                aria-label={props.i18n.t('environmentCenter.settingsForLabel', { label: ownerLabel() })}
                disabled={!props.environment.can_edit && (props.environment.access_routes?.length ?? 0) < 2 && !props.environment.default_access_route_missing}
                onClick={() => props.editEnvironment(props.environment)}
              >
                <Settings class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
          <Show when={props.environment.can_delete && !props.gatewayPerspective}>
            <DesktopTooltip content={props.i18n.t('common.delete')} placement="top">
              <ConsoleActionIconButton
                title={deleteTitle()}
                aria-label={props.i18n.t('environmentCenter.removeLabel', {
                  label: ownerLabel(),
                })}
                danger
                onClick={() => props.deleteEnvironment(props.environment)}
              >
                <Trash class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
        </div>
      </CardFooter>
    </section>
  );
}
