import { For, Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { cn, useNotification } from "@floegence/floe-webapp-core";
import { AlertTriangle, ChevronDown, ExternalLink, Maximize, Play, RefreshIcon, Stop, Terminal, Trash } from "@floegence/floe-webapp-core/icons";
import type { FileItem } from "@floegence/floe-webapp-core/file-browser";
import { Panel, PanelContent } from "@floegence/floe-webapp-core/layout";
import { SnakeLoader } from "@floegence/floe-webapp-core/loading";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DirectoryInput,
  Dropdown,
  Input,
  Tag,
  type DropdownItem,
} from "@floegence/floe-webapp-core/ui";
import { useProtocol } from "@floegence/floe-webapp-protocol";
import { useEnvContext } from "./EnvContext";
import { FlowerContextMenuIcon } from "../icons/FlowerSoftAuraIcon";
import { useRedevenRpc, type FsFileInfo } from "../protocol/redeven_v1";
import { Tooltip } from "../primitives/Tooltip";
import {
  codeRuntimeMissing,
  codeRuntimeOperationRunning,
  codeRuntimePrepareIntent,
  codeRuntimeReady,
  fetchCodeRuntimeStatus,
  type BrowserEditorInstallMethod,
  type CodeRuntimeStatus,
} from "../services/codeRuntimeApi";
import { BrowserEditorSetupActivityPanel } from "./BrowserEditorSetupActivityPanel";
import { getEnvPublicIDFromSession, getLocalRuntime, mintEnvEntryTicketForApp } from "../services/controlplaneApi";
import { FLOE_APP_CODE } from "../services/floeproxyContract";
import { fetchLocalApiJSON } from "../services/localApi";
import { useI18n, type I18nHelpers } from "../i18n";
import {
  browserEditorLocalFailureFromError,
  browserEditorPlatformLabel,
  buildBrowserEditorSetupActivity,
  localizeBrowserEditorPrepareCopy,
  localizeBrowserEditorSetupActivity,
  type BrowserEditorSetupLocalFailure,
} from "../services/browserEditorSetupActivity";
import { appendLocalAccessResumeQuery } from "../services/localAccessAuth";
import { trustedLauncherOriginFromSandboxLocation } from "../services/sandboxOrigins";
import { registerSandboxWindow } from "../services/sandboxWindowRegistry";
import {
  desktopShellCodespaceWindowOpenAvailable,
  desktopShellExternalURLOpenAvailable,
  openCodespaceWindowInDesktopShell,
  openExternalURLInDesktopShell,
} from "../services/desktopShellBridge";
import { desktopCodeWorkspacePrepareAvailable } from "../services/desktopCodeWorkspaceBridge";
import {
  cancelBrowserEditorSetup,
  defaultBrowserEditorInstallMethod,
  prepareBrowserEditorSetup,
} from "../services/browserEditorSetup";
import {
  createBrowserEditorSetupOperationID,
  type BrowserEditorSetupProgress,
} from "../services/browserEditorSetupProgress";
import { RedevenLoadingCurtain } from "../primitives/RedevenLoadingCurtain";
import { buildFilePathFlowerTurnLauncherIntent } from "../utils/filePathAskFlower";
import { canOpenDirectoryPathInTerminal, openDirectoryInTerminal } from "../utils/openDirectoryInTerminal";
import { canLaunchProcess } from "../utils/permission";
import { replacePickerChildren, sortPickerFolderItems, toPickerFolderItem, toPickerTreeAbsolutePath } from "../../../../../flower_ui/src/filePicker/directoryPickerTree";
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from "../utils/redevenSurfaceRoles";
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from "../workbench/surface/workbenchWheelInteractive";
import { FloatingContextMenu, type FloatingContextMenuItem } from "../widgets/FloatingContextMenu";

type SpaceStatus = Readonly<{
  code_space_id: string;
  name: string;
  description: string;
  workspace_path: string;
  code_port: number;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  last_opened_at_unix_ms: number;
  running: boolean;
  pid: number;
}>;

type CodespaceBusyAction = "open" | "start" | "stop";
type CodespaceOpenTarget = "desktop_window" | "system_browser";

type CodespaceContextMenuState = Readonly<{
  x: number;
  y: number;
  space: SpaceStatus;
}>;

type PendingCodespaceIntent = Readonly<{
  kind: "open" | "start";
  code_space_id: string;
  name: string;
  open_target?: CodespaceOpenTarget;
}> | null;

type CodespaceOpenStrategy =
  | Readonly<{ kind: "desktop_codespace_window" }>
  | Readonly<{ kind: "desktop_external_browser" }>
  | Readonly<{ kind: "browser_popup"; win: Window }>;

type CodespaceTrustedLauncherTarget = Readonly<{
  url: string;
  sandbox: Readonly<{
    origin: string;
    floe_app: typeof FLOE_APP_CODE;
    code_space_id: string;
    app_path: string;
  }>;
}>;

type CodespaceI18n = Pick<I18nHelpers, "formatDateTime" | "formatRelativeTime" | "t">;

function fmtTime(ms: number, i18n: CodespaceI18n): string {
  if (!ms) return i18n.t("codespaces.time.never");
  try {
    return i18n.formatDateTime(ms);
  } catch {
    return String(ms);
  }
}

function fmtRelativeTime(ms: number, i18n: CodespaceI18n): string {
  if (!ms) return i18n.t("codespaces.time.never");
  try {
    return i18n.formatRelativeTime(ms);
  } catch {
    return String(ms);
  }
}

function codespaceOrigin(codeSpaceID: string): string {
  return trustedLauncherOriginFromSandboxLocation(window.location, "cs", codeSpaceID);
}

function absoluteURLFromCurrentLocation(rawURL: string, invalidURLMessage: string): string {
  const raw = String(rawURL ?? "").trim();
  if (!raw) throw new Error(invalidURLMessage);
  return new URL(raw, window.location.href).toString();
}

function base64UrlEncode(raw: string): string {
  const b64 = btoa(raw);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function runeLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function validateMeta(name: string, description: string, i18n: Pick<I18nHelpers, "t">): string | null {
  const n = runeLen(name.trim());
  if (n > 64) return i18n.t("codespaces.errors.nameTooLong");
  const d = runeLen(description.trim());
  if (d > 256) return i18n.t("codespaces.errors.descriptionTooLong");
  return null;
}

function resolveCodespaceOpenStrategy(target: CodespaceOpenTarget, codeSpaceID: string, desktopWindowOpenFailedMessage: string, popupBlockedMessage: string): CodespaceOpenStrategy {
  if (target === "desktop_window") {
    if (!desktopShellCodespaceWindowOpenAvailable()) {
      throw new Error(desktopWindowOpenFailedMessage);
    }
    return { kind: "desktop_codespace_window" };
  }

  if (desktopShellExternalURLOpenAvailable()) {
    return { kind: "desktop_external_browser" };
  }

  const win = window.open("about:blank", `redeven_codespace_${codeSpaceID}`);
  if (!win) throw new Error(popupBlockedMessage);
  return { kind: "browser_popup", win };
}

function closeCodespaceOpenStrategyOnError(strategy: CodespaceOpenStrategy): void {
  if (strategy.kind !== "browser_popup") {
    return;
  }
  try {
    strategy.win.close();
  } catch {
    // ignore
  }
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type DesktopCodespaceLoadingWindowCopy = Readonly<{
  loadingTitle: string;
  loadingDetail: string;
  failedTitle: string;
  failedDetail: (message: string) => string;
  desktopWindowOpenFailed: string;
}>;

async function openDesktopCodespaceLoadingWindow(
  codeSpaceID: string,
  copy: DesktopCodespaceLoadingWindowCopy,
): Promise<void> {
  const out = await openCodespaceWindowInDesktopShell({
    mode: "loading",
    code_space_id: codeSpaceID,
    title: copy.loadingTitle,
    detail: copy.loadingDetail,
  });
  if (!out?.ok) {
    throw new Error(out?.message || copy.desktopWindowOpenFailed);
  }
}

async function showDesktopCodespaceOpenFailure(
  codeSpaceID: string,
  copy: DesktopCodespaceLoadingWindowCopy,
  error: unknown,
): Promise<void> {
  const message = messageFromUnknown(error);
  try {
    await openCodespaceWindowInDesktopShell({
      mode: "loading",
      state: "error",
      code_space_id: codeSpaceID,
      title: copy.failedTitle,
      detail: copy.failedDetail(message),
    });
  } catch {
    // The Env App notification remains the source of truth if the shell window is gone.
  }
}

async function commitCodespaceOpenStrategy(args: Readonly<{
  strategy: CodespaceOpenStrategy;
  url: string;
  codeSpaceID: string;
  sandbox?: CodespaceTrustedLauncherTarget["sandbox"];
  desktopOpenFailedMessage: string;
  desktopWindowOpenFailedMessage: string;
}>): Promise<void> {
  if (args.strategy.kind === "desktop_codespace_window") {
    const out = await openCodespaceWindowInDesktopShell({ mode: "navigate", url: args.url, code_space_id: args.codeSpaceID });
    if (!out?.ok) {
      throw new Error(out?.message || args.desktopWindowOpenFailedMessage);
    }
    return;
  }

  if (args.strategy.kind === "desktop_external_browser") {
    const out = await openExternalURLInDesktopShell(args.url);
    if (!out?.ok) {
      throw new Error(out?.message || args.desktopOpenFailedMessage);
    }
    return;
  }

  if (args.sandbox) {
    registerSandboxWindow(args.strategy.win, args.sandbox);
  }
  args.strategy.win.location.assign(args.url);
}

function buildLocalCodespaceURL(codeSpaceID: string, workspacePath: string, invalidURLMessage: string): string {
  const folder = String(workspacePath ?? "").trim();
  const basePath = `/cs/${encodeURIComponent(codeSpaceID)}/`;
  const rawURL = appendLocalAccessResumeQuery(folder ? `${basePath}?folder=${encodeURIComponent(folder)}` : basePath);
  return absoluteURLFromCurrentLocation(rawURL, invalidURLMessage);
}

function buildTrustedLauncherCodespaceTarget(args: Readonly<{
  envPublicID: string;
  codeSpaceID: string;
  workspacePath: string;
  entryTicket: string;
}>): CodespaceTrustedLauncherTarget {
  const origin = codespaceOrigin(args.codeSpaceID);
  const bootURL = `${origin}/_redeven_boot/?env=${encodeURIComponent(args.envPublicID)}`;
  const folder = String(args.workspacePath ?? "").trim();
  const appPath = folder ? `/?folder=${encodeURIComponent(folder)}` : "/";
  const init = {
    v: 2,
    env_public_id: args.envPublicID,
    floe_app: FLOE_APP_CODE,
    code_space_id: args.codeSpaceID,
    app_path: appPath,
    entry_ticket: args.entryTicket,
  };
  const encoded = base64UrlEncode(JSON.stringify(init));

  return {
    url: `${bootURL}#redeven=${encoded}`,
    sandbox: {
      origin,
      floe_app: FLOE_APP_CODE,
      code_space_id: args.codeSpaceID,
      app_path: appPath,
    },
  };
}

type OpenCodespaceCopy = Readonly<{
  desktopOpenFailed: string;
  desktopWindowLoading: DesktopCodespaceLoadingWindowCopy;
  desktopWindowOpenFailed: string;
  invalidUrl: string;
  missingEnvContext: string;
  opening: string;
  popupBlocked: string;
  requestingEntryTicket: string;
  starting: string;
}>;

async function openCodespace(
  codeSpaceID: string,
  openTarget: CodespaceOpenTarget,
  setStatus: (s: string) => void,
  copy: OpenCodespaceCopy,
  options: Readonly<{ desktopLoadingWindowOpened?: boolean }> = {},
): Promise<void> {
  const envPublicID = getEnvPublicIDFromSession();
  if (!envPublicID) throw new Error(copy.missingEnvContext);

  const strategy = resolveCodespaceOpenStrategy(openTarget, codeSpaceID, copy.desktopWindowOpenFailed, copy.popupBlocked);
  let desktopLoadingWindowOpened = options.desktopLoadingWindowOpened === true;

  try {
    if (strategy.kind === "desktop_codespace_window" && !desktopLoadingWindowOpened) {
      await openDesktopCodespaceLoadingWindow(codeSpaceID, copy.desktopWindowLoading);
      desktopLoadingWindowOpened = true;
    }

    const local = await getLocalRuntime();
    setStatus(copy.starting);
    const sp = await fetchLocalApiJSON<SpaceStatus>(`/_redeven_proxy/api/spaces/${encodeURIComponent(codeSpaceID)}/start`, { method: "POST" });
    const folder = String(sp?.workspace_path ?? "").trim();

    if (local) {
      const url = buildLocalCodespaceURL(codeSpaceID, folder, copy.invalidUrl);
      setStatus(copy.opening);
      await commitCodespaceOpenStrategy({
        strategy,
        url,
        codeSpaceID,
        desktopOpenFailedMessage: copy.desktopOpenFailed,
        desktopWindowOpenFailedMessage: copy.desktopWindowOpenFailed,
      });
      return;
    }

    setStatus(copy.requestingEntryTicket);
    const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp: FLOE_APP_CODE, codeSpaceId: codeSpaceID });
    const launcherTarget = buildTrustedLauncherCodespaceTarget({
      envPublicID,
      codeSpaceID,
      workspacePath: folder,
      entryTicket,
    });

    setStatus(copy.opening);
    await commitCodespaceOpenStrategy({
      strategy,
      url: launcherTarget.url,
      codeSpaceID,
      sandbox: launcherTarget.sandbox,
      desktopOpenFailedMessage: copy.desktopOpenFailed,
      desktopWindowOpenFailedMessage: copy.desktopWindowOpenFailed,
    });
  } catch (e) {
    closeCodespaceOpenStrategyOnError(strategy);
    if (strategy.kind === "desktop_codespace_window" && desktopLoadingWindowOpened) {
      await showDesktopCodespaceOpenFailure(codeSpaceID, copy.desktopWindowLoading, e);
    }
    throw e;
  }
}

// Status badge component
function StatusBadge(props: { running: boolean; pid?: number }) {
  const i18n = useI18n();

  return (
    <Tooltip
      content={props.running ? i18n.t("codespaces.status.processID", { pid: props.pid ?? 0 }) : i18n.t("codespaces.status.stoppedTooltip")}
      placement="top"
    >
      <Tag
        variant={props.running ? "success" : "neutral"}
        tone="soft"
        size="sm"
        dot
        class="cursor-default"
      >
        {props.running ? i18n.t("codespaces.status.running") : i18n.t("codespaces.status.stopped")}
      </Tag>
    </Tooltip>
  );
}

function InlineButtonSnakeLoading(props: { class?: string }) {
  return (
    <span class={cn("relative inline-flex w-4 h-4 shrink-0", props.class)} aria-hidden="true">
      <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[0.66] origin-center">
        <SnakeLoader size="sm" />
      </span>
    </span>
  );
}

function CodespaceActionButtonShimmer(props: { active: boolean }) {
  return (
    <Show when={props.active}>
      <span class="redeven-loading-shimmer-overlay" aria-hidden="true" />
    </Show>
  );
}

// Empty state component
function EmptyState(props: { onCreateClick: () => void }) {
  const i18n = useI18n();

  return (
    <div class="flex flex-col items-center justify-center py-12 px-4">
      <div class="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <svg class="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
          />
        </svg>
      </div>
      <h3 class="text-sm font-medium text-foreground mb-1">{i18n.t("codespaces.empty.title")}</h3>
      <p class="text-xs text-muted-foreground text-center max-w-xs mb-4">
        {i18n.t("codespaces.empty.description")}
      </p>
      <Button size="sm" variant="default" onClick={props.onCreateClick}>
        {i18n.t("codespaces.empty.createAction")}
      </Button>
    </div>
  );
}

// Codespace card component
function CodespaceCard(props: {
  space: SpaceStatus;
  busyAction?: CodespaceBusyAction;
  busyLabel?: string;
  desktopOpenAvailable: boolean;
  onOpen: (target: CodespaceOpenTarget) => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onContextMenu: (event: MouseEvent) => void;
  contextMenuOpen?: boolean;
}) {
  const isRunning = () => props.space.running;
  const isBusy = () => !!props.busyAction;
  const i18n = useI18n();
  const primaryOpenTarget = (): CodespaceOpenTarget => props.desktopOpenAvailable ? "desktop_window" : "system_browser";
  const primaryOpenLabel = () => props.desktopOpenAvailable ? i18n.t("codespaces.actions.openInDesktop") : i18n.t("codespaces.actions.open");
  const busyActionLabel = () => {
    if (props.busyLabel) return props.busyLabel;
    if (props.busyAction === "start") return i18n.t("codespaces.actions.starting");
    if (props.busyAction === "open") return i18n.t("codespaces.actions.opening");
    return undefined;
  };
  const openDropdownItems = (): DropdownItem[] => (
    isRunning()
      ? [
          {
            id: "system_browser",
            label: i18n.t("codespaces.actions.openInBrowser"),
            icon: ExternalLink,
          },
        ]
      : [
          {
            id: "desktop_window",
            label: i18n.t("codespaces.actions.openInDesktop"),
            icon: Maximize,
          },
          {
            id: "system_browser",
            label: i18n.t("codespaces.actions.openInBrowser"),
            icon: ExternalLink,
          },
        ]
  );
  const handleOpenMenuSelect = (id: string) => {
    if (id === "desktop_window" || id === "system_browser") {
      props.onOpen(id);
    }
  };

  return (
    <Card
      class={cn(
        "border transition-all duration-200",
        isRunning()
          ? "border-emerald-500/30 bg-emerald-500/[0.02] hover:border-emerald-500/50"
          : cn(redevenSurfaceRoleClass("panelInteractive"), "opacity-75 hover:opacity-100"),
        props.contextMenuOpen ? "ring-1 ring-primary/40" : undefined,
      )}
      onContextMenu={props.onContextMenu}
    >
      <CardHeader class="pb-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <CardTitle class="text-sm truncate">{props.space.name || props.space.code_space_id}</CardTitle>
            <CardDescription class="text-xs truncate mt-0.5" title={props.space.description}>
              {props.space.description}
            </CardDescription>
          </div>
          <StatusBadge running={props.space.running} pid={props.space.pid} />
        </div>
      </CardHeader>
      <CardContent class="pb-2">
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <div class="text-muted-foreground">{i18n.t("codespaces.fields.id")}</div>
          <div class="font-mono truncate text-right" title={props.space.code_space_id}>
            {props.space.code_space_id}
          </div>
          <div class="text-muted-foreground">{i18n.t("codespaces.fields.path")}</div>
          <div class="font-mono truncate text-right" title={props.space.workspace_path}>
            {props.space.workspace_path}
          </div>
          <div class="text-muted-foreground">{i18n.t("codespaces.fields.port")}</div>
          <div class="font-mono text-right">{props.space.code_port || "-"}</div>
          <div class="text-muted-foreground">{i18n.t("codespaces.fields.lastOpened")}</div>
          <Tooltip content={fmtTime(props.space.last_opened_at_unix_ms, i18n)} placement="top">
            <div class="text-right cursor-default">{fmtRelativeTime(props.space.last_opened_at_unix_ms, i18n)}</div>
          </Tooltip>
        </div>
      </CardContent>
      <CardFooter class={cn("pt-2 flex items-center justify-between gap-2 border-t", redevenDividerRoleClass())}>
        <Show
          when={isRunning()}
          fallback={
            <div class="flex items-center gap-2 flex-1">
              <Button
                size="sm"
                variant="default"
                disabled={isBusy()}
                onClick={props.onStart}
                class="relative flex-1 overflow-hidden"
                aria-busy={props.busyAction === "start" ? "true" : undefined}
              >
                <Show
                  when={props.busyAction === "start"}
                  fallback={<Play class="w-3.5 h-3.5 mr-1" />}
                >
                  <InlineButtonSnakeLoading class="mr-1" />
                </Show>
                {props.busyAction === "start" ? busyActionLabel() : i18n.t("codespaces.actions.start")}
                <CodespaceActionButtonShimmer active={props.busyAction === "start"} />
              </Button>
              <Show
                when={props.desktopOpenAvailable}
                fallback={
                  <Tooltip content={i18n.t("codespaces.actions.openWillAutoStart")} placement="top">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy()}
                      onClick={() => props.onOpen("system_browser")}
                      class="px-2 text-muted-foreground"
                    >
                      <Show when={props.busyAction === "open"} fallback={<ExternalLink class="w-4 h-4" />}>
                        <InlineButtonSnakeLoading />
                      </Show>
                    </Button>
                  </Tooltip>
                }
              >
                <Dropdown
                  align="end"
                  disabled={isBusy()}
                  triggerAriaLabel={i18n.t("codespaces.actions.open")}
                  items={openDropdownItems()}
                  onSelect={handleOpenMenuSelect}
                  trigger={
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy()}
                      class={cn("relative gap-1 overflow-hidden px-2", redevenSurfaceRoleClass("control"))}
                      aria-busy={props.busyAction === "open" ? "true" : undefined}
                    >
                      <Show when={props.busyAction === "open"} fallback={<ExternalLink class="w-3.5 h-3.5" />}>
                        <InlineButtonSnakeLoading />
                      </Show>
                      <span class="hidden sm:inline">{props.busyAction === "open" ? busyActionLabel() : i18n.t("codespaces.actions.open")}</span>
                      <ChevronDown class="w-3 h-3 text-muted-foreground" />
                      <CodespaceActionButtonShimmer active={props.busyAction === "open"} />
                    </Button>
                  }
                />
              </Show>
            </div>
          }
        >
          <div class="flex flex-1 min-w-0">
            <Button
              size="sm"
              variant="default"
              disabled={isBusy()}
              onClick={() => props.onOpen(primaryOpenTarget())}
              class={cn("relative flex-1 min-w-0 overflow-hidden", props.desktopOpenAvailable ? "rounded-r-none" : undefined)}
              aria-busy={props.busyAction === "open" ? "true" : undefined}
            >
              <Show
                when={props.busyAction === "open"}
                fallback={props.desktopOpenAvailable ? <Maximize class="w-3.5 h-3.5 mr-1" /> : <ExternalLink class="w-3.5 h-3.5 mr-1" />}
              >
                <InlineButtonSnakeLoading class="mr-1" />
              </Show>
              <span class="truncate">{props.busyAction === "open" ? busyActionLabel() : primaryOpenLabel()}</span>
              <CodespaceActionButtonShimmer active={props.busyAction === "open"} />
            </Button>
            <Show when={props.desktopOpenAvailable}>
              <Dropdown
                align="end"
                disabled={isBusy()}
                triggerAriaLabel={i18n.t("codespaces.actions.openInBrowser")}
                items={openDropdownItems()}
                onSelect={handleOpenMenuSelect}
                trigger={
                  <Button size="sm" variant="default" disabled={isBusy()} class="rounded-l-none border-l border-primary-foreground/20 px-2">
                    <ChevronDown class="w-3.5 h-3.5" />
                  </Button>
                }
              />
            </Show>
          </div>
        </Show>
        <div class="flex items-center gap-1">
          <Show when={isRunning()}>
            <Tooltip content={i18n.t("codespaces.actions.stopTooltip")} placement="top">
              <Button size="sm" variant="outline" disabled={isBusy()} onClick={props.onStop} class={cn("px-2", redevenSurfaceRoleClass("control"))}>
                <Show when={props.busyAction === "stop"} fallback={<Stop class="w-4 h-4" />}>
                  <InlineButtonSnakeLoading />
                </Show>
              </Button>
            </Tooltip>
          </Show>
          <Tooltip content={i18n.t("codespaces.actions.deleteTooltip")} placement="top">
            <Button
              size="sm"
              variant="ghost"
              disabled={isBusy()}
              onClick={props.onDelete}
              class="px-2 text-muted-foreground hover:text-destructive"
            >
              <Trash class="w-4 h-4" />
            </Button>
          </Tooltip>
        </div>
      </CardFooter>
    </Card>
  );
}

// Simple Create Codespace dialog - single dialog with DirectoryInput
function CreateCodespaceDialog(props: {
  open: boolean;
  loading: boolean;
  files: FileItem[];
  homePath?: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (path: string, name: string, description: string) => void;
  onLoadDir: (path: string) => void;
}) {
  const [selectedPath, setSelectedPath] = createSignal("");
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const outlineControlClass = redevenSurfaceRoleClass("control");
  const i18n = useI18n();

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedPath("");
      setName("");
      setDescription("");
    }
    props.onOpenChange(open);
  };

  const handlePathChange = (path: string) => {
    setSelectedPath(path);
    // Auto-fill name and description from selected directory
    const segments = path.split("/").filter(Boolean);
    const defaultName = segments[segments.length - 1] || "";
    setName(defaultName);
    setDescription(i18n.t("codespaces.dialog.autoDescription", { path }));
  };

  const handleCreate = () => {
    if (!selectedPath()) return;
    props.onCreate(selectedPath(), name().trim(), description().trim());
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title={i18n.t("codespaces.dialog.createTitle")}
      footer={
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => handleOpenChange(false)} disabled={props.loading} class={outlineControlClass}>
            {i18n.t("codespaces.actions.cancel")}
          </Button>
          <Button size="sm" variant="default" onClick={handleCreate} disabled={props.loading || !selectedPath()}>
            <Show when={props.loading}>
              <InlineButtonSnakeLoading class="mr-1" />
            </Show>
            {i18n.t("codespaces.actions.create")}
          </Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium mb-1">{i18n.t("codespaces.fields.directory")}</label>
          <DirectoryInput
            value={selectedPath()}
            onChange={handlePathChange}
            files={props.files}
            onExpand={props.onLoadDir}
            placeholder={i18n.t("codespaces.dialog.directoryPlaceholder")}
            homePath={props.homePath}
            homeLabel={i18n.t("codespaces.fields.home")}
            size="sm"
          />
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">{i18n.t("codespaces.fields.name")}</label>
          <Input
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder={i18n.t("codespaces.dialog.namePlaceholder")}
            size="sm"
            class="w-full"
          />
          <p class="text-[11px] text-muted-foreground mt-1">{i18n.t("codespaces.dialog.nameHelp")}</p>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">{i18n.t("codespaces.fields.description")}</label>
          <Input
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder={i18n.t("codespaces.dialog.descriptionPlaceholder")}
            size="sm"
            class="w-full"
          />
          <p class="text-[11px] text-muted-foreground mt-1">{i18n.t("codespaces.dialog.descriptionHelp")}</p>
        </div>
      </div>
    </Dialog>
  );
}

function CodeRuntimePreparePanel(props: {
  status: CodeRuntimeStatus | null | undefined;
  loading: boolean;
  error?: string | null;
  localFailure?: BrowserEditorSetupLocalFailure | null;
  localCancelled: boolean;
  localProgress?: BrowserEditorSetupProgress | null;
  pendingIntent: PendingCodespaceIntent;
  prepareSubmitting: boolean;
  cancelSubmitting: boolean;
  installMethod: BrowserEditorInstallMethod;
  desktopTransferAvailable: boolean;
  onInstallMethodChange: (method: BrowserEditorInstallMethod) => void;
  onPrepare: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const [dismissed, setDismissed] = createSignal(false);
  const i18n = useI18n();

  const localPending = () => props.prepareSubmitting && !codeRuntimeOperationRunning(props.status);
  const pendingActivityIntent = () => (props.pendingIntent ? { kind: props.pendingIntent.kind } as const : null);
  const rawActivity = () => buildBrowserEditorSetupActivity({
    status: props.status,
    loading: props.loading,
    error: props.error,
    localPending: localPending(),
    localFailure: props.localFailure,
    localCancelled: props.localCancelled,
    localProgress: props.localProgress,
    installMethod: props.installMethod,
    pendingIntent: pendingActivityIntent(),
  });
  const prepareCopy = () => localizeBrowserEditorPrepareCopy(codeRuntimePrepareIntent(props.status), props.installMethod, i18n);
  const activity = () => localizeBrowserEditorSetupActivity(rawActivity(), {
    status: props.status,
    loading: props.loading,
    error: props.error,
    localPending: localPending(),
    localFailure: props.localFailure,
    localCancelled: props.localCancelled,
    localProgress: props.localProgress,
    installMethod: props.installMethod,
    pendingIntent: pendingActivityIntent(),
  }, i18n);
  const runtimeReady = () => codeRuntimeReady(props.status);

  createEffect(() => {
    const state = activity().state;
    if (state === "preparing") {
      setDismissed(false);
    }
  });

  createEffect(() => {
    if (!runtimeReady()) setDismissed(false);
  });

  const alreadyReadyAndIdle = () => activity().state === "ready" && !props.pendingIntent;
  const visible = () => !dismissed() && !alreadyReadyAndIdle();

  const extraDetails = () => (
    <dl class="browser-editor-setup__detail-list">
      <div class="browser-editor-setup__detail-row">
        <dt>{i18n.t("codeRuntime.activity.platform.environmentPlatform")}</dt>
        <dd data-mono="true">{browserEditorPlatformLabel(props.status?.platform)}</dd>
      </div>
      <Show when={activity().error_code}>
        {(errorCode) => (
          <div class="browser-editor-setup__detail-row">
            <dt>{i18n.t("codeRuntime.activity.platform.errorCode")}</dt>
            <dd data-mono="true">{errorCode()}</dd>
          </div>
        )}
      </Show>
      <div class="browser-editor-setup__detail-row">
        <dt>{i18n.t("codespaces.prepare.sharedEditorRoot")}</dt>
        <dd data-mono="true">{props.status?.shared_runtime_root ?? "-"}</dd>
      </div>
      <div class="browser-editor-setup__detail-row">
        <dt>{i18n.t("codespaces.prepare.selectedEditorPath")}</dt>
        <dd data-mono="true">{props.status?.managed_prefix ?? "-"}</dd>
      </div>
      <Show when={props.status?.active_runtime.binary_path}>
        {(binaryPath) => (
          <div class="browser-editor-setup__detail-row">
            <dt>{i18n.t("codespaces.prepare.detectedPath")}</dt>
            <dd data-mono="true">{binaryPath()}</dd>
          </div>
        )}
      </Show>
      <Show when={props.pendingIntent}>
        <div class="browser-editor-setup__detail-row">
          <dt>{i18n.t("codespaces.prepare.nextAction")}</dt>
          <dd>
            {props.pendingIntent?.kind === "open" ? i18n.t("codespaces.prepare.openCodespace") : i18n.t("codespaces.prepare.startCodespace")}
          </dd>
        </div>
      </Show>
    </dl>
  );

  return (
    <Show when={visible()}>
      <BrowserEditorSetupActivityPanel
        activity={activity()}
        layout="wide"
        loading={props.loading}
        prepareSubmitting={props.prepareSubmitting}
        cancelSubmitting={props.cancelSubmitting}
        actionLabel={activity().can_retry ? i18n.t("codespaces.prepare.retrySetup") : prepareCopy().actionLabel}
        runningLabel={prepareCopy().runningLabel}
        installMethod={props.installMethod}
        desktopTransferAvailable={props.desktopTransferAvailable}
        installMethodLocked={props.prepareSubmitting || activity().state === "preparing"}
        onInstallMethodChange={props.onInstallMethodChange}
        onPrepare={props.onPrepare}
        onCancel={props.onCancel}
        onContinue={props.onContinue}
        onDismiss={() => {
          setDismissed(true);
          props.onDismiss();
        }}
        extraDetails={activity().state === "missing" || activity().state === "checking" ? undefined : extraDetails()}
      />
    </Show>
  );
}

function BrowserEditorReadinessInlineStatus(props: {
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
}) {
  const i18n = useI18n();
  const label = () => (props.error ? i18n.t("common.actions.retry") : i18n.t("common.status.checking"));
  const title = () => {
    if (!props.error) return i18n.t("codeRuntime.activity.checkingReadiness");
    return `${i18n.t("codeRuntime.activity.failure.runtimeStatus")} ${props.error}`;
  };

  return (
    <Show when={props.loading || props.error}>
      <button
        type="button"
        data-testid="browser-editor-readiness-inline-status"
        class={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          props.error
            ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-700 hover:bg-amber-500/[0.1] dark:text-amber-300"
            : "border-border bg-background/70 text-muted-foreground",
        )}
        onClick={() => {
          if (!props.loading) props.onRefresh();
        }}
        disabled={props.loading}
        title={title()}
        aria-label={title()}
        aria-live="polite"
      >
        <Show when={props.error} fallback={<RefreshIcon class="h-3.5 w-3.5 animate-spin" />}>
          <AlertTriangle class="h-3.5 w-3.5" />
        </Show>
        <span class="hidden lg:inline">{label()}</span>
      </button>
    </Show>
  );
}

export function EnvCodespacesPage() {
  const notification = useNotification();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const env = useEnvContext();
  const i18n = useI18n();

  const [createDialogOpen, setCreateDialogOpen] = createSignal(false);
  const [createLoading, setCreateLoading] = createSignal(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<SpaceStatus | null>(null);
  const [deleteLoading, setDeleteLoading] = createSignal(false);
  const [pendingIntent, setPendingIntent] = createSignal<PendingCodespaceIntent>(null);
  const [runtimePrepareLocalPending, setRuntimePrepareLocalPending] = createSignal(false);
  const [runtimePrepareLocalFailure, setRuntimePrepareLocalFailure] = createSignal<BrowserEditorSetupLocalFailure | null>(null);
  const [runtimePrepareLocalCancelled, setRuntimePrepareLocalCancelled] = createSignal(false);
  const [runtimePrepareProgress, setRuntimePrepareProgress] = createSignal<BrowserEditorSetupProgress | null>(null);
  const [runtimePrepareOperationID, setRuntimePrepareOperationID] = createSignal<string | null>(null);
  const [runtimePrepareCancelRequestedID, setRuntimePrepareCancelRequestedID] = createSignal<string | null>(null);
  const [runtimePrepareSubmitting, setRuntimePrepareSubmitting] = createSignal(false);
  const [runtimeInstallMethod, setRuntimeInstallMethod] = createSignal<BrowserEditorInstallMethod>(defaultBrowserEditorInstallMethod());
  const [runtimePrepareActiveMethod, setRuntimePrepareActiveMethod] = createSignal<BrowserEditorInstallMethod | null>(null);
  let runtimePrepareAbortController: AbortController | null = null;
  const [runtimeCancelSubmitting, setRuntimeCancelSubmitting] = createSignal(false);
  const [busyActions, setBusyActions] = createSignal<Record<string, CodespaceBusyAction | undefined>>({});
  const [codespaceContextMenu, setCodespaceContextMenu] = createSignal<CodespaceContextMenuState | null>(null);
  let codespaceContextMenuEl: HTMLDivElement | null = null;

  const busyActionOf = (codeSpaceID: string): CodespaceBusyAction | undefined => {
    const action = busyActions()[codeSpaceID];
    if (action) return action;
    const intent = pendingIntent();
    if (
      intent?.code_space_id === codeSpaceID
      && (runtimePrepareSubmitting() || runtimePrepareLocalPending() || codeRuntimeOperationRunning(runtimeStatus()))
    ) {
      return intent.kind;
    }
    return undefined;
  };
  const busyLabelOf = (codeSpaceID: string): string | undefined => {
    const intent = pendingIntent();
    if (
      intent?.code_space_id === codeSpaceID
      && (runtimePrepareSubmitting() || runtimePrepareLocalPending() || codeRuntimeOperationRunning(runtimeStatus()))
    ) {
      return i18n.t("codespaces.status.settingUpEditor");
    }
    return undefined;
  };

  const setBusyAction = (codeSpaceID: string, action: CodespaceBusyAction) => {
    setBusyActions((prev) => ({ ...prev, [codeSpaceID]: action }));
  };

  const clearBusyAction = (codeSpaceID: string) => {
    setBusyActions((prev) => {
      if (!prev[codeSpaceID]) return prev;
      const next = { ...prev };
      delete next[codeSpaceID];
      return next;
    });
  };

  // File tree for directory picker
  const [files, setFiles] = createSignal<FileItem[]>([]);
  const [homePath, setHomePath] = createSignal<string | undefined>(undefined);
  const outlineControlClass = redevenSurfaceRoleClass("control");
  type DirCache = Map<string, FileItem[]>;
  let cache: DirCache = new Map();

  const [spaces, { refetch }] = createResource<SpaceStatus[]>(async () => {
    const out = await fetchLocalApiJSON<{ spaces: SpaceStatus[] }>("/_redeven_proxy/api/spaces", { method: "GET" });
    const list = out?.spaces;
    return Array.isArray(list) ? list : [];
  });
  const [runtimeStatus, { refetch: refetchRuntimeStatus }] = createResource<CodeRuntimeStatus>(fetchCodeRuntimeStatus);

  // Load home directory path
  createEffect(() => {
    if (!protocol.client()) return;
    void (async () => {
      try {
        const resp = await rpc.fs.getPathContext();
        const home = String(resp?.agentHomePathAbs ?? "").trim();
        if (home) setHomePath(home);
      } catch {
        // ignore
      }
    })();
  });

  createEffect(() => {
    homePath();
    cache = new Map();
    setFiles([]);
  });

  createEffect(() => {
    const status = runtimeStatus();
    if (!codeRuntimeOperationRunning(status)) return;
    setRuntimePrepareLocalPending(false);
    setRuntimePrepareLocalFailure(null);

    const timer = window.setInterval(() => {
      void refetchRuntimeStatus();
    }, 1000);
    onCleanup(() => {
      window.clearInterval(timer);
    });
  });

  createEffect(() => {
    if (codeRuntimeReady(runtimeStatus())) {
      setRuntimePrepareLocalFailure(null);
      setRuntimePrepareLocalCancelled(false);
    }
  });

  createEffect(() => {
    const menu = codespaceContextMenu();
    if (!menu) return;

    const closeMenu = () => {
      setCodespaceContextMenu(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && codespaceContextMenuEl?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  const loadPickerDir = async (pickerPath: string) => {
    if (!protocol.client()) return;

    const absolutePath = toPickerTreeAbsolutePath(pickerPath, homePath());
    if (!absolutePath) return;

    if (cache.has(absolutePath)) {
      setFiles((prev) => replacePickerChildren(prev, pickerPath, cache.get(absolutePath)!));
      return;
    }

    try {
      const resp = await rpc.fs.list({ path: absolutePath, showHidden: false });
      const entries = resp?.entries ?? [];
      const items = sortPickerFolderItems(
        entries.map((entry) => toPickerFolderItem(entry as FsFileInfo, homePath())).filter((item): item is FileItem => !!item)
      );
      cache.set(absolutePath, items);
      setFiles((prev) => replacePickerChildren(prev, pickerPath, items));
    } catch {
      // ignore
    }
  };

  const handleLoadDir = (path: string) => {
    void loadPickerDir(path);
  };

  const handleCreate = async (path: string, name: string, description: string) => {
    setCreateLoading(true);
    try {
      const metaErr = validateMeta(name, description, i18n);
      if (metaErr) throw new Error(metaErr);

      await fetchLocalApiJSON<SpaceStatus>("/_redeven_proxy/api/spaces", {
        method: "POST",
        body: JSON.stringify({
          path: path,
          name: name || undefined,
          description: description || undefined,
        }),
      });
      await refetch();
      setCreateDialogOpen(false);
      notification.success(
        i18n.t("codespaces.notifications.createdTitle"),
        name ? i18n.t("codespaces.notifications.createdMessageWithName", { name }) : i18n.t("codespaces.notifications.createdMessage"),
      );
    } catch (e) {
      notification.error(i18n.t("codespaces.notifications.failedToCreateTitle"), e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
    }
  };

  const openPreparePanel = (intent: PendingCodespaceIntent = null) => {
    setPendingIntent(intent);
  };

  const startWorkspacePrepareFlow = async () => {
    const operationID = createBrowserEditorSetupOperationID();
    const installMethod = runtimeInstallMethod();
    const abortController = new AbortController();
    runtimePrepareAbortController = abortController;
    setRuntimePrepareOperationID(operationID);
    setRuntimePrepareActiveMethod(installMethod);
    setRuntimePrepareCancelRequestedID(null);
    setRuntimePrepareLocalPending(true);
    setRuntimePrepareSubmitting(true);
    setRuntimePrepareLocalFailure(null);
    setRuntimePrepareLocalCancelled(false);
    setRuntimePrepareProgress({
      operation_id: operationID,
      phase: "lookup",
      state: "running",
      updated_at_unix_ms: Date.now(),
    });
    try {
      const result = await prepareBrowserEditorSetup({
        status: runtimeStatus(),
        operationID,
        installMethod,
        signal: abortController.signal,
        onProgress: (progress) => {
          if (runtimePrepareOperationID() === operationID) setRuntimePrepareProgress(progress);
        },
      });
      if (result.cancelled || runtimePrepareCancelRequestedID() === operationID) {
        setRuntimePrepareLocalCancelled(true);
        return;
      }
      if (!result.ok || !result.prepared) {
        throw new Error(result.message || i18n.t("codespaces.prepare.setupDidNotFinish"));
      }
      await refetchRuntimeStatus();
      await continuePendingIntent();
    } catch (e) {
      if (runtimePrepareCancelRequestedID() === operationID) {
        setRuntimePrepareLocalCancelled(true);
        return;
      }
      const failure = browserEditorLocalFailureFromError(e, installMethod);
      const intent = pendingIntent();
      setRuntimePrepareLocalFailure(failure);
      notification.error(i18n.t("codespaces.notifications.browserEditorSetupFailedTitle"), failure.message);
      if (intent?.kind === "open" && intent.open_target === "desktop_window") {
        await showDesktopCodespaceOpenFailure(intent.code_space_id, {
          loadingTitle: i18n.t("codespaces.desktopWindow.loadingTitle"),
          loadingDetail: i18n.t("codespaces.desktopWindow.loadingDetail"),
          failedTitle: i18n.t("codespaces.desktopWindow.failedTitle"),
          failedDetail: (message) => i18n.t("codespaces.desktopWindow.failedDetail", { message }),
          desktopWindowOpenFailed: i18n.t("codespaces.errors.desktopWindowOpenFailed"),
        }, failure);
      }
      await refetchRuntimeStatus();
    } finally {
      if (runtimePrepareOperationID() === operationID) {
        runtimePrepareAbortController = null;
        setRuntimePrepareOperationID(null);
        setRuntimePrepareActiveMethod(null);
        setRuntimePrepareSubmitting(false);
        setRuntimePrepareLocalPending(false);
        setRuntimeInstallMethod(defaultBrowserEditorInstallMethod());
      }
    }
  };

  const ensureCodeRuntimeAvailable = async (kind: "open" | "start", space: SpaceStatus, openTarget?: CodespaceOpenTarget): Promise<boolean> => {
    const current = runtimeStatus();
    if (codeRuntimeReady(current)) return true;
    try {
      const latest = await fetchCodeRuntimeStatus();
      await refetchRuntimeStatus();
      if (codeRuntimeReady(latest)) return true;
    } catch {
      // Ignore and use the explicit Browser Editor setup flow below.
    }
    openPreparePanel({
      kind,
      code_space_id: space.code_space_id,
      name: space.name || space.code_space_id,
      ...(kind === "open" && openTarget ? { open_target: openTarget } : {}),
    });
    return false;
  };

  const cancelRuntimePrepareFlow = async () => {
    const operationID = runtimePrepareOperationID();
    const installMethod = runtimePrepareActiveMethod();
    if (operationID) setRuntimePrepareCancelRequestedID(operationID);
    runtimePrepareAbortController?.abort();
    setRuntimeCancelSubmitting(true);
    try {
      if (operationID && installMethod) {
        await cancelBrowserEditorSetup(operationID, installMethod);
      }
      if (operationID) setRuntimePrepareLocalCancelled(true);
      await refetchRuntimeStatus();
    } catch (e) {
      notification.error(i18n.t("codespaces.notifications.cancelPreparationFailedTitle"), e instanceof Error ? e.message : String(e));
    } finally {
      setRuntimeCancelSubmitting(false);
    }
  };

  const handleStart = async (space: SpaceStatus) => {
    if (busyActionOf(space.code_space_id)) return;
    setBusyAction(space.code_space_id, "start");
    if (!(await ensureCodeRuntimeAvailable("start", space))) {
      clearBusyAction(space.code_space_id);
      return;
    }
    try {
      await fetchLocalApiJSON<SpaceStatus>(`/_redeven_proxy/api/spaces/${encodeURIComponent(space.code_space_id)}/start`, { method: "POST" });
      await refetch();
      notification.success(
        i18n.t("codespaces.notifications.startedTitle"),
        i18n.t("codespaces.notifications.startedMessage", { name: space.name || space.code_space_id }),
      );
    } catch (e) {
      notification.error(i18n.t("codespaces.notifications.failedToStartTitle"), e instanceof Error ? e.message : String(e));
    } finally {
      clearBusyAction(space.code_space_id);
    }
  };

  const handleStop = async (space: SpaceStatus) => {
    if (busyActionOf(space.code_space_id)) return;
    setBusyAction(space.code_space_id, "stop");
    try {
      await fetchLocalApiJSON<void>(`/_redeven_proxy/api/spaces/${encodeURIComponent(space.code_space_id)}/stop`, { method: "POST" });
      await refetch();
      notification.success(
        i18n.t("codespaces.notifications.stoppedTitle"),
        i18n.t("codespaces.notifications.stoppedMessage", { name: space.name || space.code_space_id }),
      );
    } catch (e) {
      notification.error(i18n.t("codespaces.notifications.failedToStopTitle"), e instanceof Error ? e.message : String(e));
    } finally {
      clearBusyAction(space.code_space_id);
    }
  };

  const handleDeleteConfirm = async () => {
    const target = deleteTarget();
    if (!target) return;

    setDeleteLoading(true);
    try {
      await fetchLocalApiJSON<void>(`/_redeven_proxy/api/spaces/${encodeURIComponent(target.code_space_id)}`, { method: "DELETE" });
      await refetch();
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      notification.success(
        i18n.t("codespaces.notifications.deletedTitle"),
        i18n.t("codespaces.notifications.deletedMessage", { name: target.name || target.code_space_id }),
      );
    } catch (e) {
      notification.error(i18n.t("codespaces.notifications.failedToDeleteTitle"), e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleOpen = async (space: SpaceStatus, openTarget: CodespaceOpenTarget) => {
    if (busyActionOf(space.code_space_id)) return;
    setBusyAction(space.code_space_id, "open");
    const desktopWindowLoading = {
      loadingTitle: i18n.t("codespaces.desktopWindow.loadingTitle"),
      loadingDetail: i18n.t("codespaces.desktopWindow.loadingDetail"),
      failedTitle: i18n.t("codespaces.desktopWindow.failedTitle"),
      failedDetail: (message: string) => i18n.t("codespaces.desktopWindow.failedDetail", { message }),
      desktopWindowOpenFailed: i18n.t("codespaces.errors.desktopWindowOpenFailed"),
    };
    let desktopLoadingWindowOpened = false;
    try {
      if (openTarget === "desktop_window") {
        await openDesktopCodespaceLoadingWindow(space.code_space_id, desktopWindowLoading);
        desktopLoadingWindowOpened = true;
      }
      if (!(await ensureCodeRuntimeAvailable("open", space, openTarget))) return;
      await openCodespace(space.code_space_id, openTarget, () => {}, {
        desktopOpenFailed: i18n.t("codespaces.errors.desktopOpenFailed"),
        desktopWindowLoading,
        desktopWindowOpenFailed: i18n.t("codespaces.errors.desktopWindowOpenFailed"),
        invalidUrl: i18n.t("codespaces.errors.invalidUrl"),
        missingEnvContext: i18n.t("codespaces.errors.missingEnvContext"),
        opening: i18n.t("codespaces.status.opening"),
        popupBlocked: i18n.t("codespaces.errors.popupBlocked"),
        requestingEntryTicket: i18n.t("codespaces.status.requestingEntryTicket"),
        starting: i18n.t("codespaces.status.starting"),
      }, { desktopLoadingWindowOpened });
      await refetch();
    } catch (e) {
      notification.error(i18n.t("codespaces.notifications.failedToOpenTitle"), e instanceof Error ? e.message : String(e));
    } finally {
      clearBusyAction(space.code_space_id);
    }
  };

  const continuePendingIntent = async () => {
    const intent = pendingIntent();
    if (!intent) return;
    const space = spaceList().find((item) => item.code_space_id === intent.code_space_id);
    setPendingIntent(null);
    if (!space) {
      notification.error(
        i18n.t("codespaces.notifications.missingCodespaceTitle"),
        i18n.t("codespaces.notifications.missingCodespaceMessage", { name: intent.name }),
      );
      return;
    }
    if (intent.kind === "start") {
      await handleStart(space);
      return;
    }
    await handleOpen(space, intent.open_target ?? (desktopShellCodespaceWindowOpenAvailable() ? "desktop_window" : "system_browser"));
  };

  const openDeleteDialog = (space: SpaceStatus) => {
    setDeleteTarget(space);
    setDeleteDialogOpen(true);
  };

  const openCodespaceContextMenu = (event: MouseEvent, space: SpaceStatus) => {
    event.preventDefault();
    event.stopPropagation();
    setCodespaceContextMenu({
      x: event.clientX,
      y: event.clientY,
      space,
    });
  };

  const handleAskFlowerFromCodespace = () => {
    const menu = codespaceContextMenu();
    if (!menu) return;

    const anchor = { x: menu.x, y: menu.y };
    setCodespaceContextMenu(null);

    const result = buildFilePathFlowerTurnLauncherIntent({
      items: [
        {
          path: menu.space.workspace_path,
          isDirectory: true,
        },
      ],
      fallbackWorkingDirAbs: menu.space.workspace_path,
    });
    if (!result.intent) {
      notification.error(
        i18n.t("codespaces.notifications.askFlowerUnavailableTitle"),
        result.error ?? i18n.t("codespaces.notifications.askFlowerPathError"),
      );
      return;
    }

    env.openFlowerTurnLauncher(result.intent, anchor);
  };

  const canOpenCodespaceInTerminal = (space: SpaceStatus): boolean => (
    canLaunchProcess(env.env()?.permissions)
    && canOpenDirectoryPathInTerminal(space.workspace_path)
  );

  const handleOpenCodespaceInTerminal = () => {
    const menu = codespaceContextMenu();
    if (!menu) return;

    setCodespaceContextMenu(null);
    openDirectoryInTerminal({
      path: menu.space.workspace_path,
      preferredName: menu.space.name || menu.space.code_space_id,
      workbenchAnchor: { clientX: menu.x, clientY: menu.y },
      openTerminalInDirectory: env.openTerminalInDirectory,
      onInvalidDirectory: () => {
        notification.error(i18n.t("codespaces.notifications.invalidDirectoryTitle"), i18n.t("codespaces.notifications.invalidTerminalDirectory"));
      },
    });
  };

  const buildCodespaceContextMenuItems = (space: SpaceStatus): FloatingContextMenuItem[] => {
    const items: FloatingContextMenuItem[] = [
      {
        id: "ask-flower",
        kind: "action",
        label: i18n.t("codespaces.actions.askFlower"),
        icon: FlowerContextMenuIcon,
        onSelect: handleAskFlowerFromCodespace,
      },
    ];

    if (canOpenCodespaceInTerminal(space)) {
      items.push({
        id: "open-in-terminal",
        kind: "action",
        label: i18n.t("codespaces.actions.openInTerminal"),
        icon: Terminal,
        onSelect: handleOpenCodespaceInTerminal,
      });
    }

    return items;
  };

  const spaceList = () => spaces() ?? [];
  const runtimeStatusError = () => {
    const err = runtimeStatus.error;
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return null;
  };
  const showWizard = () => {
    const status = runtimeStatus();
    if (runtimePrepareLocalFailure()) return true;
    if (!status) return false;
    if (codeRuntimeReady(status) && !pendingIntent()) return false;
    const prepareFlowActive = status?.operation.action !== "remove_local_environment_version";
    if (runtimePrepareLocalPending()) return true;
    if (codeRuntimeMissing(status)) return true;
    if (prepareFlowActive && (status.operation.state === "failed" || status.operation.state === "cancelled")) return true;
    if (status.active_runtime.detection_state === "unusable") return true;
    return false;
  };
  const showCompactRuntimeStatus = () => !showWizard() && (runtimeStatus.loading || Boolean(runtimeStatusError()));
  const handleRefreshAll = async () => {
    await Promise.all([refetch(), refetchRuntimeStatus()]);
  };
  const sortedSpaces = () => {
    return [...spaceList()].sort((a, b) => {
      // Running spaces first
      if (a.running !== b.running) return a.running ? -1 : 1;
      // Recently opened first
      return (b.last_opened_at_unix_ms || 0) - (a.last_opened_at_unix_ms || 0);
    });
  };

  return (
    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class={cn("h-full min-h-0 overflow-auto", redevenSurfaceRoleClass("main"))}>
      <Panel class={cn("overflow-hidden", redevenSurfaceRoleClass("panelStrong"))} data-testid="codespaces-panel">
        <PanelContent class="p-4 space-y-4">
          {/* Page header */}
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-1">
              <div class="text-sm font-semibold">{i18n.t("codespaces.title")}</div>
              <div class="text-xs text-muted-foreground">
                {i18n.t("codespaces.description")}
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <Show when={showCompactRuntimeStatus()}>
                <BrowserEditorReadinessInlineStatus
                  loading={runtimeStatus.loading}
                  error={runtimeStatusError()}
                  onRefresh={() => {
                    void refetchRuntimeStatus();
                  }}
                />
              </Show>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleRefreshAll()}
                disabled={spaces.loading || runtimeStatus.loading}
                aria-label={i18n.t("codespaces.actions.refresh")}
                title={i18n.t("codespaces.actions.refresh")}
                class={outlineControlClass}
              >
                <svg class="w-3.5 h-3.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
                <span class="hidden sm:inline">{i18n.t("codespaces.actions.refresh")}</span>
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => setCreateDialogOpen(true)}
                aria-label={i18n.t("codespaces.actions.newCodespace")}
                title={i18n.t("codespaces.actions.newCodespace")}
              >
                <svg class="w-3.5 h-3.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span class="hidden sm:inline">{i18n.t("codespaces.actions.newCodespace")}</span>
              </Button>
            </div>
          </div>

          <Show when={showWizard()}>
            <CodeRuntimePreparePanel
              status={runtimeStatus()}
              loading={runtimeStatus.loading}
              error={null}
              localFailure={runtimePrepareLocalFailure()}
              localCancelled={runtimePrepareLocalCancelled()}
              localProgress={runtimePrepareProgress()}
              pendingIntent={pendingIntent()}
              prepareSubmitting={runtimePrepareSubmitting()}
              cancelSubmitting={runtimeCancelSubmitting()}
              installMethod={runtimeInstallMethod()}
              desktopTransferAvailable={desktopCodeWorkspacePrepareAvailable()}
              onInstallMethodChange={(method) => setRuntimeInstallMethod(method)}
              onPrepare={() => {
                void startWorkspacePrepareFlow();
              }}
              onCancel={() => {
                void cancelRuntimePrepareFlow();
              }}
              onContinue={() => {
                void continuePendingIntent();
              }}
              onDismiss={() => {
                setPendingIntent(null);
              }}
            />
          </Show>

          {/* Codespaces list */}
          <div class="relative" style={{ "min-height": "200px" }}>
            <RedevenLoadingCurtain visible={spaces.loading} eyebrow={i18n.t("codespaces.loadingEyebrow")} message={i18n.t("codespaces.loadingMessage")} />
            <Show when={!spaces.loading}>
              <Show when={spaceList().length > 0} fallback={<EmptyState onCreateClick={() => setCreateDialogOpen(true)} />}>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <For each={sortedSpaces()}>
                    {(space) => (
                      <CodespaceCard
                        space={space}
                        busyAction={busyActionOf(space.code_space_id)}
                        busyLabel={busyLabelOf(space.code_space_id)}
                        desktopOpenAvailable={desktopShellCodespaceWindowOpenAvailable()}
                        onOpen={(target) => void handleOpen(space, target)}
                        onStart={() => void handleStart(space)}
                        onStop={() => void handleStop(space)}
                        onDelete={() => openDeleteDialog(space)}
                        onContextMenu={(event) => openCodespaceContextMenu(event, space)}
                        contextMenuOpen={codespaceContextMenu()?.space.code_space_id === space.code_space_id}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </PanelContent>
      </Panel>

      {/* Create dialog */}
      <CreateCodespaceDialog
        open={createDialogOpen()}
        loading={createLoading()}
        files={files()}
        homePath={homePath()}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreate}
        onLoadDir={handleLoadDir}
      />

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen()}
        onOpenChange={(open) => {
          if (deleteLoading()) return;
          if (!open) {
            setDeleteDialogOpen(false);
            setDeleteTarget(null);
          }
        }}
        title={i18n.t("codespaces.dialog.deleteTitle")}
        footer={
          <div class="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleteLoading()} class={outlineControlClass}>
              {i18n.t("codespaces.actions.cancel")}
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDeleteConfirm} disabled={deleteLoading()}>
              <Show when={deleteLoading()}>
                <InlineButtonSnakeLoading class="mr-1" />
              </Show>
              {i18n.t("codespaces.actions.delete")}
            </Button>
          </div>
        }
      >
        <div class="space-y-2">
          <p class="text-sm">
            {i18n.t("codespaces.dialog.deleteQuestionPrefix")} <span class="font-semibold">"{deleteTarget()?.name || deleteTarget()?.code_space_id}"</span>?
          </p>
          <p class="text-xs text-muted-foreground">
            {i18n.t("codespaces.dialog.deleteNotePrefix")} <span class="font-mono">{deleteTarget()?.workspace_path}</span> {i18n.t("codespaces.dialog.deleteNoteSuffix")}
          </p>
        </div>
      </Dialog>

      <Show when={codespaceContextMenu()} keyed>
        {(menu) => (
          <FloatingContextMenu
            x={menu.x}
            y={menu.y}
            items={buildCodespaceContextMenuItems(menu.space)}
            menuRef={(el) => {
              codespaceContextMenuEl = el;
            }}
          />
        )}
      </Show>
    </div>
  );
}
