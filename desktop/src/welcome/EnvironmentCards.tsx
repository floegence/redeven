import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { Motion } from 'solid-motionone';
import { cn } from '@floegence/floe-webapp-core';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, Tag, Tabs, TabPanel } from '@floegence/floe-webapp-core/ui';
import { AlertTriangle, Clock, Cloud, MonitorPointer, Pin, Refresh, Search, Settings, Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import { FlowerSoftAuraIcon, type FlowerTurnLauncherAnchor } from '../../../internal/flower_ui/src';
import type { DesktopI18n } from '../shared/i18n';
import type { DesktopEnvironmentEntry, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import type { EnvironmentCardFactsBlock, EnvironmentSplitActionButton } from './App';
import { DesktopTooltip } from './DesktopTooltip';
import { ConsoleActionIconButton, EnvironmentStatusIndicator } from './environmentCardPrimitives';
import { buildEnvironmentLibraryLayoutModel, buildProviderBackedEnvironmentActionModel, environmentControlPlaneLabel,
  type EnvironmentActionModel, type EnvironmentCardModel, type EnvironmentCardFactModel, type EnvironmentActionPresentation, type EnvironmentCardFactActionModel } from './viewModel';
import { splitPinnedEnvironmentGroupIDs, type EnvironmentLibraryDisplayGroup } from './environmentLibraryProjection';
import { busyStateMatchesEnvironment, environmentOperationState, progressForEnvironmentFocusRequest, type DesktopLauncherBusyState } from './launcherBusyState';
import { closeEnvironmentLibraryOverlayState, closedEnvironmentLibraryOverlayState, environmentEndpointOverlaySelectedIDFor, environmentLibraryOverlayOpenFor,
  openEnvironmentLibraryOverlayState, reconcileEnvironmentLibraryOverlayState, selectEnvironmentEndpointOverlayState } from './environmentLibraryOverlayState';
import { guidanceSessionKeepsPopoverOpen, guidanceSessionShouldAutoDismiss, isEnvironmentGuidancePendingIntent, openEnvironmentGuidanceSession,
  reconcileEnvironmentGuidanceSession, startEnvironmentGuidanceIntent, type EnvironmentGuidanceSessionState } from './environmentGuidanceSession';
import { abandonEnvironmentLifecycleDisclosureAttempt, beginEnvironmentLifecycleDisclosure, bindEnvironmentLifecycleDisclosureOperation, closeEnvironmentLifecycleDisclosure,
  isEnvironmentLifecycleDisclosureIntent, createEnvironmentLifecycleAttempt, environmentActionStartsLifecycleDisclosure, environmentLifecycleDisclosureHasPendingRequest, focusEnvironmentLifecycleDisclosure,
  reconcileEnvironmentLifecycleDisclosure, reopenEnvironmentLifecycleDisclosure, visibleEnvironmentLifecycleProgress, type EnvironmentLifecycleDisclosureIntent,
  type EnvironmentLifecycleDisclosureState, type EnvironmentLifecycleAttempt, type EnvironmentSettingsRestartSource } from './environmentLifecycleDisclosure';

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
    groups: readonly EnvironmentLibraryDisplayGroup[];
    allGroups: readonly EnvironmentLibraryDisplayGroup[];
    viewScope: string;
    defaultCloud?: boolean;
    presentation: EnvironmentOwnerPresentation;
    Facts: typeof EnvironmentCardFactsBlock;
    Actions: typeof EnvironmentSplitActionButton;
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
    editEnvironment: (environment: DesktopEnvironmentEntry) => void;
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
  const projectedEntries = createMemo(() => props.groups.flatMap((group) => group.member_entries));
  const projectedGroupsByID = createMemo(() => Object.fromEntries(
    props.groups.map((group) => [group.id, group] as const),
  ) as Readonly<Record<string, EnvironmentLibraryDisplayGroup>>);
  const groupedGroupIDs = createMemo(() => splitPinnedEnvironmentGroupIDs(props.groups));
  const projectedEntriesByID = createMemo(() => Object.fromEntries(projectedEntries().map(entry => [entry.id, entry])));
  const [selectedOwnerIDs, setSelectedOwnerIDs] = createSignal<Readonly<Record<string, string>>>({});
  createEffect(on(() => props.viewScope, () => {
    setSelectedOwnerIDs({});
    setActiveEnvironmentOverlayState(closedEnvironmentLibraryOverlayState());
  }));
  createEffect(() => {
    const groups = props.allGroups;
    setSelectedOwnerIDs(current => Object.fromEntries(Object.entries(current)
      .filter(([groupID, ownerID]) => groups.some(group => group.id === groupID && group.member_ids.includes(ownerID)))));
  });
  const activeOwnerID = (group: EnvironmentLibraryDisplayGroup) => {
    const selected = selectedOwnerIDs()[group.id];
    return selected && group.member_ids.includes(selected) ? selected
      : props.defaultCloud && group.provider_entry ? group.provider_entry.id : group.primary_entry.id;
  };
  const selectOwner = (group: EnvironmentLibraryDisplayGroup, ownerID: string) => {
    if (!group.member_ids.includes(ownerID)) return;
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
      reconcileEnvironmentLifecycleDisclosure(current, projectedEntries(), props.actionProgress),
    );
  });

  createEffect(() => {
    setActiveEnvironmentOverlayState((current) => {
      const session = guidanceSessionState();
      const lifecycleDisclosure = lifecycleDisclosureState();
      if (current.kind === 'lifecycle_progress') {
        const environment = projectedEntries().find((entry) => entry.id === current.environment_id);
        const operationState = environment
          ? environmentOperationState(environment, props.actionProgress, props.busyState)
          : null;
        const progressStillVisible = Boolean(operationState?.panelProgress) || operationState?.isSubmitting === true
          || (lifecycleDisclosure?.environment_id === current.environment_id
            && Boolean(lifecycleDisclosure.settings_restart));
        const pendingDisclosureVisible =
          lifecycleDisclosure?.environment_id === current.environment_id &&
          lifecycleDisclosure.visibility === 'open' &&
          environmentLifecycleDisclosureHasPendingRequest(lifecycleDisclosure, props.busyState);
        return pendingDisclosureVisible || progressStillVisible ? current : closedEnvironmentLibraryOverlayState();
      }
      if (
        current.kind === 'primary_action_guidance' &&
        session?.environment_id === current.environment_id &&
        guidanceSessionKeepsPopoverOpen(session)
      ) {
        return current;
      }
      return reconcileEnvironmentLibraryOverlayState(current, projectedEntries());
    });
    setGuidanceSessionState((current) => reconcileEnvironmentGuidanceSession(current, projectedEntries()));
  });

  createEffect(() => {
    const session = guidanceSessionState();
    if (!guidanceSessionShouldAutoDismiss(session) || typeof window === 'undefined') {
      return;
    }
    let clearHandle: number | undefined;
    const handle = window.setTimeout(() => {
      setActiveEnvironmentOverlayState((current) =>
        session
          ? closeEnvironmentLibraryOverlayState(current, 'primary_action_guidance', session.environment_id)
          : current,
      );
      clearHandle = window.setTimeout(() => {
        setGuidanceSessionState((current) => (current?.environment_id === session?.environment_id ? null : current));
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
    setLifecycleDisclosureState((current) =>
      open
        ? reopenEnvironmentLifecycleDisclosure(current, environmentID)
        : closeEnvironmentLifecycleDisclosure(current, environmentID),
    );
  };

  const abandonLifecycleProgressDisclosure = (environmentID: string, attempt: EnvironmentLifecycleAttempt) => {
    const current = lifecycleDisclosureState();
    const next = abandonEnvironmentLifecycleDisclosureAttempt(current, environmentID, attempt);
    if (next === current) {
      return;
    }
    setLifecycleDisclosureState(next);
    setActiveEnvironmentOverlayState((overlay) =>
      closeEnvironmentLibraryOverlayState(overlay, 'lifecycle_progress', environmentID),
    );
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
        visibility: 'open', settings_restart: request.settingsRestart,
        ...(progress ? { last_progress: progress } : {}),
      });
    }
    if (request.canReveal && !request.canReveal()) return;
    if (!request.intent && !progress) return;
    const group = props.groups.find(group => group.member_ids.includes(environment.id));
    if (group) selectOwner(group, environment.id);
    handledLifecycleProgressFocusRequestID = request.request_id;
    if (progress) {
      const disclosure = focusEnvironmentLifecycleDisclosure(null, environment.id, progress);
      setLifecycleDisclosureState(disclosure ? { ...disclosure, settings_restart: request.settingsRestart } : null);
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
    setGuidanceSessionState((current) => (current?.environment_id === environmentID ? null : current));
    setLifecycleDisclosureState((current) =>
      beginEnvironmentLifecycleDisclosure(current, environmentID, intent, attempt),
    );
    setActiveEnvironmentOverlayState(openEnvironmentLibraryOverlayState('lifecycle_progress', environmentID));
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
  const renderOwner = (environmentID: string, groupID: string) => (
    <EnvironmentOwnerSurface
      i18n={props.i18n}
      presentation={props.presentation}
      Facts={props.Facts}
      Actions={props.Actions}
      environment={projectedEntriesByID()[environmentID]!}
      relationshipRole={projectedEntriesByID()[environmentID]!.kind === 'provider_environment' ? 'cloud' : projectedGroup(groupID).provider_entry ? 'runtime' : undefined}
      paired={!!projectedGroup(groupID).provider_entry}
      otherPinnedOwner={projectedGroup(groupID).member_entries.find(entry => entry.id !== environmentID && entry.pinned)}
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
      beginLifecycleDisclosure={(intent, attempt) =>
        beginLifecycleProgressDisclosure(environmentID, intent, attempt)
      }
      abandonLifecycleDisclosure={(attempt) => abandonLifecycleProgressDisclosure(environmentID, attempt)}
      bindLifecycleDisclosure={(attempt, operation) =>
        bindLifecycleProgressDisclosure(environmentID, attempt, operation)
      }
    />
  );
  const RelationCard = (cardProps: { groupID: string }) => {
    const group = () => projectedGroup(cardProps.groupID);
    const active = () => activeOwnerID(group());
    const memberIDs = createMemo(() => group().member_ids, undefined, {
      equals: (left, right) => left.length === right.length && left.every((id, index) => id === right[index]),
    });
    const items = createMemo(() => memberIDs().map(ownerID => {
      const entry = () => projectedEntriesByID()[ownerID]!;
      const model = () => props.presentation.card(entry());
      const busy = () => environmentOperationState(entry(), props.actionProgress, props.busyState).actionsDisabled;
      const status = () => busy() ? props.i18n.t('environmentCenter.ownerOperationRunning') : model().status_label;
      return { id: ownerID,
        get label() {
          const name = entry().kind === 'provider_environment' ? props.i18n.t('environmentCenter.providerFilter') : model().kind_label;
          return name;
        },
        icon: (
          <span class="redeven-owner-tab-icon" role="img" title={status()} aria-label={status()}>
            <Show when={entry().kind === 'provider_environment'} fallback={
              <Show when={entry().kind === 'local_environment'} fallback={<Terminal aria-hidden="true" />}>
                <MonitorPointer aria-hidden="true" />
              </Show>
            }>
              <Cloud aria-hidden="true" />
            </Show>
            <Show when={busy() || model().status_tone === 'warning'}>
              <span class="redeven-owner-tab-status" data-tone={busy() ? 'primary' : 'warning'} aria-hidden="true">
                <Show when={busy()} fallback={<AlertTriangle />}>
                  <Refresh class="motion-safe:animate-spin" />
                </Show>
              </span>
            </Show>
          </span>
        ),
      };
    }));
    return (
      <Card class={cn("redeven-environment-card overflow-hidden", group().member_entries.find(entry => entry.id === active())?.is_open && "redeven-environment-card--open")} data-environment-group={cardProps.groupID}>
        <div class="redeven-environment-access-heading">
          <Show when={group().provider_entry} fallback={
            <Tag variant={environmentKindTagVariant(group().primary_entry.kind)} tone="soft" size="sm" class="cursor-default whitespace-nowrap">
              {props.presentation.card(group().primary_entry).kind_label}
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
              slotClassNames={{ scrollContainer: 'redeven-environment-owner-tablist', tab: 'redeven-environment-owner-tab' }}
            />
          </Show>
        </div>
        <div class="redeven-environment-owner-stack">
          <For each={memberIDs()}>
            {ownerID => (
              <TabPanel
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
        </div>
      </Card>
    );
  };

  return (
    <div class="space-y-3">
      <Show
        when={props.groups.length > 0 || props.showQuickAddCards}
        fallback={
          <Motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div class="redeven-console-empty flex flex-col items-center justify-center gap-3 rounded-lg px-6 py-8 text-center">
              <Search class="h-8 w-8 text-muted-foreground/50" />
              <div class="space-y-1">
                <div class="text-sm font-medium text-foreground">
                  {props.i18n.t('environmentCenter.noMatchingEnvironmentsTitle')}
                </div>
                <div class="text-xs text-muted-foreground">
                  {props.i18n.t('environmentCenter.noMatchingEnvironmentsDescription')}
                </div>
              </div>
            </div>
          </Motion.div>
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
            <h2 class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title()}</h2>
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
    i18n: DesktopI18n;
    presentation: EnvironmentOwnerPresentation;
    Facts: typeof EnvironmentCardFactsBlock;
    Actions: typeof EnvironmentSplitActionButton;
    environment: DesktopEnvironmentEntry;
    relationshipRole?: 'runtime' | 'cloud';
    paired: boolean;
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
    beginLifecycleDisclosure: (
      intent: EnvironmentLifecycleDisclosureIntent,
      attempt: EnvironmentLifecycleAttempt,
    ) => void;
    abandonLifecycleDisclosure: (attempt: EnvironmentLifecycleAttempt) => void;
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
    editEnvironment: (environment: DesktopEnvironmentEntry) => void;
    deleteEnvironment: (environment: DesktopEnvironmentEntry) => void;
    cancelOperation: (progress: DesktopLauncherActionProgress) => void;
    dismissOperation: (progress: DesktopLauncherActionProgress) => void;
    copyOperationDiagnostics: (progress: DesktopLauncherActionProgress) => void;
  }>,
) {
  const card = createMemo(() => props.presentation.card(props.environment));
  const facts = createMemo(() => props.presentation.facts(props.environment));
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
    const presentation = props.presentation.actions(environmentActionModel().action_presentation);
    return props.environment.kind === 'provider_environment' ? {
      ...presentation,
      primary_action: { ...presentation.primary_action, label: props.i18n.t(
        props.environment.window_state === 'open' ? 'environmentCenter.showCloudEnvApp' : 'environmentCenter.openCloudEnvApp',
      ) },
    } : presentation;
  });
  const operationState = createMemo(() => {
    const state = environmentOperationState(props.environment, props.actionProgress, props.busyState);
    if (!props.lifecycleDisclosure?.settings_restart) return state;
    return { ...state, panelProgress: visibleEnvironmentLifecycleProgress({ environment: props.environment,
      selectedProgress: state.panelProgress, disclosure: props.lifecycleDisclosure, busyState: props.busyState }) };
  });
  const isPinBusy = createMemo(() =>
    busyStateMatchesEnvironment(props.busyState, props.environment.id, [
      'set_provider_environment_pinned',
      'set_environment_registration_pinned',
    ]),
  );
  const deleteTitle = createMemo(() => props.i18n.t('environmentCenter.removeEnvironment'));
  const runOpenWithPreflight = async (action: EnvironmentActionModel): Promise<void> => {
    const nextSession = startEnvironmentGuidanceIntent(
      props.guidanceSession,
      props.environment.id,
      'open_with_preflight',
    );
    props.onPrimaryActionGuidanceOpenChange(true);
    props.setGuidanceSession(nextSession);
    const resolution = await props.runEnvironmentGuidanceAction(props.environment, action, props.setGuidanceSession);
    props.setGuidanceSession(resolution.next_session);
    if (resolution.close_panel) {
      props.onPrimaryActionGuidanceOpenChange(false);
    }
  };

  return (
    <section
      class="redeven-environment-owner"
      data-owner-id={props.environment.id}
      data-owner-role={props.relationshipRole ?? 'standalone'}
      aria-label={ownerLabel()}
    >
      <CardHeader class="px-4 pb-2.5 pt-1">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <CardTitle
              class="truncate pt-1 text-sm font-semibold leading-5 tracking-[0.01em]"
              title={props.environment.label}
            >
              {props.environment.label}
            </CardTitle>
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
          <EnvironmentStatusIndicator tone={card().status_tone}>{card().status_label}</EnvironmentStatusIndicator>
          <Show when={props.relationshipRole !== 'cloud'}>
            <span class="redeven-card-runtime-age" title={card().runtime_started_label}>
              <Clock aria-hidden="true" />
              <span>{card().runtime_started_label}</span>
            </span>
            <Show when={!props.paired && environmentControlPlaneLabel(props.environment)}>
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
        <props.Facts
          environmentID={props.environment.id} i18n={props.i18n} facts={facts()}
          environmentLabel={props.environment.label} minRows={3}
          onFactAction={props.runEnvironmentCardFactAction}
          openInBrowser={props.openInBrowser} copyEnvironmentValue={props.copyEnvironmentValue}
          endpointPopoverOpen={props.endpointPopoverOpen} onEndpointPopoverOpenChange={props.onEndpointPopoverOpenChange}
          selectedEndpointID={props.selectedEndpointID} selectEndpointForQRCode={props.selectEndpointForQRCode}
        />
      </CardContent>
      <Show when={!props.environment.pinned && props.otherPinnedOwner}>
        <div class="redeven-other-owner-pin"><Pin class="h-3 w-3" />
          {props.i18n.t('environmentCenter.pinnedThroughOwner', { owner: props.otherPinnedOwner?.kind === 'provider_environment'
            ? props.i18n.t('environmentCenter.providerFilter') : props.i18n.t('environmentCenter.runtimeOwner') })}
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
          cancelOperation={props.cancelOperation}
          dismissOperation={props.dismissOperation}
          copyOperationDiagnostics={props.copyOperationDiagnostics}
          refreshEnvironmentRuntime={() => {
            void props.refreshEnvironmentRuntime(props.environment, 'connect');
          }}
          runDesktopUpdateHandoff={async (environmentID, label) => {
            await props.runDesktopUpdateHandoff(environmentID, label);
          }}
          onRunAction={(action) => {
            void (async () => {
              if (operationState().actionsDisabled && environmentActionUsesLifecycleOwner(action)) {
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
              const completed = await props.runLocalEnvironmentAction(
                props.environment,
                action,
                'connect',
                lifecycleAttempt,
                lifecycleAttempt
                  ? (operation) => props.bindLifecycleDisclosure(lifecycleAttempt, operation)
                  : undefined,
              );
              if (!completed && lifecycleAttempt) {
                props.abandonLifecycleDisclosure(lifecycleAttempt);
              }
            })();
          }}
          onRunGuidanceAction={(action) => {
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
              const resolution = await props.runEnvironmentGuidanceAction(
                props.environment,
                action,
                props.setGuidanceSession,
                lifecycleAttempt,
              );
              props.setGuidanceSession(lifecycleAttempt ? null : resolution.next_session);
              if (resolution.close_panel) {
                props.onPrimaryActionGuidanceOpenChange(false);
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
          <Show when={props.environment.can_edit}>
            <DesktopTooltip content={props.i18n.t('common.settings')} placement="top">
              <ConsoleActionIconButton
                title={props.i18n.t('environmentCenter.environmentSettings')}
                aria-label={props.i18n.t('environmentCenter.settingsForLabel', { label: ownerLabel() })}
                onClick={() => props.editEnvironment(props.environment)}
              >
                <Settings class="h-3.5 w-3.5" />
              </ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
          <Show when={props.environment.can_delete}>
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
