import { For, Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { cn, useNotification } from "@floegence/floe-webapp-core";
import { Terminal } from "@floegence/floe-webapp-core/icons";
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
  Input,
  Tag,
} from "@floegence/floe-webapp-core/ui";
import { useProtocol } from "@floegence/floe-webapp-protocol";
import { useEnvContext } from "./EnvContext";
import { FlowerContextMenuIcon } from "../icons/FlowerSoftAuraIcon";
import { useRedevenRpc, type FsFileInfo } from "../protocol/redeven_v1";
import { Tooltip } from "../primitives/Tooltip";
import {
  cancelCodeRuntimeOperation,
  codeRuntimeMissing,
  codeRuntimeOperationRunning,
  codeRuntimePrepareCopy,
  codeRuntimeReady,
  fetchCodeRuntimeStatus,
  type CodeRuntimeStatus,
} from "../services/codeRuntimeApi";
import { BrowserEditorSetupActivityPanel } from "./BrowserEditorSetupActivityPanel";
import { getEnvPublicIDFromSession, getLocalRuntime, mintEnvEntryTicketForApp } from "../services/controlplaneApi";
import { FLOE_APP_CODE } from "../services/floeproxyContract";
import { fetchGatewayJSON } from "../services/gatewayApi";
import { useI18n, type I18nHelpers } from "../i18n";
import {
  browserEditorLocalFailureFromError,
  buildBrowserEditorSetupActivity,
  type BrowserEditorSetupLocalFailure,
} from "../services/browserEditorSetupActivity";
import { appendLocalAccessResumeQuery } from "../services/localAccessAuth";
import { trustedLauncherOriginFromSandboxLocation } from "../services/sandboxOrigins";
import { registerSandboxWindow } from "../services/sandboxWindowRegistry";
import { desktopShellExternalURLOpenAvailable, openExternalURLInDesktopShell } from "../services/desktopShellBridge";
import { desktopCodeWorkspacePrepareAvailable, prepareWorkspaceEngineWithDesktop } from "../services/desktopCodeWorkspaceBridge";
import { readDesktopSessionContextSnapshot } from "../services/desktopSessionContext";
import { RedevenLoadingCurtain } from "../primitives/RedevenLoadingCurtain";
import { buildFilePathAskFlowerIntent } from "../utils/filePathAskFlower";
import { canOpenDirectoryPathInTerminal, openDirectoryInTerminal } from "../utils/openDirectoryInTerminal";
import { replacePickerChildren, sortPickerFolderItems, toPickerFolderItem, toPickerTreeAbsolutePath } from "../utils/directoryPickerTree";
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

type CodespaceContextMenuState = Readonly<{
  x: number;
  y: number;
  space: SpaceStatus;
}>;

type PendingCodespaceIntent = Readonly<{
  kind: "open" | "start";
  code_space_id: string;
  name: string;
}> | null;

type CodespaceOpenStrategy =
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

function resolveCodespaceOpenStrategy(codeSpaceID: string, popupBlockedMessage: string): CodespaceOpenStrategy {
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

async function commitCodespaceOpenStrategy(args: Readonly<{
  strategy: CodespaceOpenStrategy;
  url: string;
  sandbox?: CodespaceTrustedLauncherTarget["sandbox"];
  desktopOpenFailedMessage: string;
}>): Promise<void> {
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
  invalidUrl: string;
  missingEnvContext: string;
  opening: string;
  popupBlocked: string;
  requestingEntryTicket: string;
  starting: string;
}>;

async function openCodespace(codeSpaceID: string, setStatus: (s: string) => void, copy: OpenCodespaceCopy): Promise<void> {
  const envPublicID = getEnvPublicIDFromSession();
  if (!envPublicID) throw new Error(copy.missingEnvContext);

  const strategy = resolveCodespaceOpenStrategy(codeSpaceID, copy.popupBlocked);

  try {
    const local = await getLocalRuntime();
    setStatus(copy.starting);
    const sp = await fetchGatewayJSON<SpaceStatus>(`/_redeven_proxy/api/spaces/${encodeURIComponent(codeSpaceID)}/start`, { method: "POST" });
    const folder = String(sp?.workspace_path ?? "").trim();

    if (local) {
      const url = buildLocalCodespaceURL(codeSpaceID, folder, copy.invalidUrl);
      setStatus(copy.opening);
      await commitCodespaceOpenStrategy({ strategy, url, desktopOpenFailedMessage: copy.desktopOpenFailed });
      return;
    }

    setStatus(copy.requestingEntryTicket);
    const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp: FLOE_APP_CODE, codeSpaceId: codeSpaceID });
    const target = buildTrustedLauncherCodespaceTarget({
      envPublicID,
      codeSpaceID,
      workspacePath: folder,
      entryTicket,
    });

    setStatus(copy.opening);
    await commitCodespaceOpenStrategy({
      strategy,
      url: target.url,
      sandbox: target.sandbox,
      desktopOpenFailedMessage: copy.desktopOpenFailed,
    });
  } catch (e) {
    closeCodespaceOpenStrategyOnError(strategy);
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
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onContextMenu: (event: MouseEvent) => void;
  contextMenuOpen?: boolean;
}) {
  const isRunning = () => props.space.running;
  const isBusy = () => !!props.busyAction;
  const i18n = useI18n();

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
            // Stopped: Start is primary action
            <div class="flex items-center gap-2 flex-1">
              <Button size="sm" variant="default" disabled={isBusy()} onClick={props.onStart} class="flex-1">
                <Show
                  when={props.busyAction === "start"}
                  fallback={
                    <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                      />
                    </svg>
                  }
                >
                  <InlineButtonSnakeLoading class="mr-1" />
                </Show>
                {props.busyAction === "start" && props.busyLabel ? props.busyLabel : i18n.t("codespaces.actions.start")}
              </Button>
              <Tooltip content={i18n.t("codespaces.actions.openWillAutoStart")} placement="top">
                <Button size="sm" variant="ghost" disabled={isBusy()} onClick={props.onOpen} class="px-2 text-muted-foreground">
                  <Show
                    when={props.busyAction === "open"}
                    fallback={
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    }
                  >
                    <InlineButtonSnakeLoading />
                  </Show>
                </Button>
              </Tooltip>
            </div>
          }
        >
          {/* Running: Open is primary action */}
          <Button size="sm" variant="default" disabled={isBusy()} onClick={props.onOpen} class="flex-1">
            <Show
              when={props.busyAction === "open"}
              fallback={
                <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                  />
                </svg>
              }
            >
              <InlineButtonSnakeLoading class="mr-1" />
            </Show>
            {props.busyAction === "open" && props.busyLabel ? props.busyLabel : i18n.t("codespaces.actions.open")}
          </Button>
        </Show>
        <div class="flex items-center gap-1">
          <Show when={isRunning()}>
            <Tooltip content={i18n.t("codespaces.actions.stopTooltip")} placement="top">
              <Button size="sm" variant="outline" disabled={isBusy()} onClick={props.onStop} class={cn("px-2", redevenSurfaceRoleClass("control"))}>
                <Show
                  when={props.busyAction === "stop"}
                  fallback={
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z"
                      />
                    </svg>
                  }
                >
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
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                />
              </svg>
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
  pendingIntent: PendingCodespaceIntent;
  prepareSubmitting: boolean;
  cancelSubmitting: boolean;
  onPrepare: () => void;
  onRefresh: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const [dismissed, setDismissed] = createSignal(false);
  const i18n = useI18n();

  const activity = () => buildBrowserEditorSetupActivity({
    status: props.status,
    loading: props.loading,
    error: props.error,
    localPending: props.prepareSubmitting && !codeRuntimeOperationRunning(props.status),
    localFailure: props.localFailure,
    pendingIntent: props.pendingIntent ? { kind: props.pendingIntent.kind } : null,
  });
  const prepareCopy = () => codeRuntimePrepareCopy(props.status);
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
    <div class="grid gap-2 rounded-md border border-border bg-background/70 p-3 text-[11px] leading-5 text-muted-foreground">
      <div>{i18n.t("codespaces.prepare.sharedEditorRoot")}: <span class="font-mono text-foreground break-all">{props.status?.shared_runtime_root ?? "-"}</span></div>
      <div>{i18n.t("codespaces.prepare.selectedEditorPath")}: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix ?? "-"}</span></div>
      <Show when={props.status?.active_runtime.binary_path}>
        <div>{i18n.t("codespaces.prepare.detectedPath")}: <span class="font-mono text-foreground break-all">{props.status?.active_runtime.binary_path}</span></div>
      </Show>
      <Show when={props.pendingIntent}>
        <div>
          {i18n.t("codespaces.prepare.nextAction")}:{' '}
          <span class="text-foreground">
            {props.pendingIntent?.kind === "open" ? i18n.t("codespaces.prepare.openCodespace") : i18n.t("codespaces.prepare.startCodespace")}
          </span>
        </div>
      </Show>
    </div>
  );

  return (
    <Show when={visible()}>
      <BrowserEditorSetupActivityPanel
        activity={activity()}
        loading={props.loading}
        prepareSubmitting={props.prepareSubmitting}
        cancelSubmitting={props.cancelSubmitting}
        actionLabel={activity().can_retry ? i18n.t("codespaces.prepare.retrySetup") : prepareCopy().action_label}
        runningLabel={prepareCopy().running_label}
        onPrepare={props.onPrepare}
        onRefresh={props.onRefresh}
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
  const [runtimePrepareSubmitting, setRuntimePrepareSubmitting] = createSignal(false);
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
    const out = await fetchGatewayJSON<{ spaces: SpaceStatus[] }>("/_redeven_proxy/api/spaces", { method: "GET" });
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

      await fetchGatewayJSON<SpaceStatus>("/_redeven_proxy/api/spaces", {
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

  const startWorkspacePrepareFlow = async (reason: "open" | "start" | "settings" | "retry" = "retry") => {
    setRuntimePrepareLocalPending(true);
    setRuntimePrepareSubmitting(true);
    setRuntimePrepareLocalFailure(null);
    try {
      if (!desktopCodeWorkspacePrepareAvailable()) {
        throw new Error(i18n.t("codespaces.prepare.desktopRequired"));
      }
      const result = await prepareWorkspaceEngineWithDesktop({
        reason,
        status: runtimeStatus(),
        preferSessionUpload: readDesktopSessionContextSnapshot()?.target_route === "remote_desktop",
      });
      if (!result.ok || !result.prepared) {
        throw new Error(result.message || i18n.t("codespaces.prepare.setupDidNotFinish"));
      }
      await refetchRuntimeStatus();
      await continuePendingIntent();
    } catch (e) {
      const failure = browserEditorLocalFailureFromError(e);
      setRuntimePrepareLocalFailure(failure);
      notification.error(i18n.t("codespaces.notifications.browserEditorSetupFailedTitle"), failure.message);
      await refetchRuntimeStatus();
    } finally {
      setRuntimePrepareSubmitting(false);
      setRuntimePrepareLocalPending(false);
    }
  };

  const ensureCodeRuntimeAvailable = async (kind: "open" | "start", space: SpaceStatus): Promise<boolean> => {
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
    });
    void startWorkspacePrepareFlow(kind);
    return false;
  };

  const cancelRuntimePrepareFlow = async () => {
    setRuntimeCancelSubmitting(true);
    try {
      await cancelCodeRuntimeOperation();
      await refetchRuntimeStatus();
    } catch (e) {
      notification.error(i18n.t("codespaces.notifications.cancelPreparationFailedTitle"), e instanceof Error ? e.message : String(e));
    } finally {
      setRuntimeCancelSubmitting(false);
    }
  };

  const handleStart = async (space: SpaceStatus) => {
    if (busyActionOf(space.code_space_id)) return;
    if (!(await ensureCodeRuntimeAvailable("start", space))) return;
    setBusyAction(space.code_space_id, "start");
    try {
      await fetchGatewayJSON<SpaceStatus>(`/_redeven_proxy/api/spaces/${encodeURIComponent(space.code_space_id)}/start`, { method: "POST" });
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
      await fetchGatewayJSON<void>(`/_redeven_proxy/api/spaces/${encodeURIComponent(space.code_space_id)}/stop`, { method: "POST" });
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
      await fetchGatewayJSON<void>(`/_redeven_proxy/api/spaces/${encodeURIComponent(target.code_space_id)}`, { method: "DELETE" });
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

  const handleOpen = async (space: SpaceStatus) => {
    if (busyActionOf(space.code_space_id)) return;
    if (!(await ensureCodeRuntimeAvailable("open", space))) return;
    setBusyAction(space.code_space_id, "open");
    try {
      await openCodespace(space.code_space_id, () => {}, {
        desktopOpenFailed: i18n.t("codespaces.errors.desktopOpenFailed"),
        invalidUrl: i18n.t("codespaces.errors.invalidUrl"),
        missingEnvContext: i18n.t("codespaces.errors.missingEnvContext"),
        opening: i18n.t("codespaces.status.opening"),
        popupBlocked: i18n.t("codespaces.errors.popupBlocked"),
        requestingEntryTicket: i18n.t("codespaces.status.requestingEntryTicket"),
        starting: i18n.t("codespaces.status.starting"),
      });
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
    await handleOpen(space);
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

    const result = buildFilePathAskFlowerIntent({
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

    env.openAskFlowerComposer(result.intent, anchor);
  };

  const canOpenCodespaceInTerminal = (space: SpaceStatus): boolean => (
    Boolean(env.env()?.permissions?.can_execute)
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
    if (runtimeStatusError()) return true;
    if (runtimeStatus.loading) return true;
    if (!status) return false;
    if (codeRuntimeReady(status) && !pendingIntent()) return false;
    const prepareFlowActive = status?.operation.action !== "remove_local_environment_version";
    if (runtimePrepareLocalPending()) return true;
    if (codeRuntimeMissing(status)) return true;
    if (prepareFlowActive && (status.operation.state === "failed" || status.operation.state === "cancelled")) return true;
    if (status.active_runtime.detection_state === "unusable") return true;
    return false;
  };
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
              error={runtimeStatusError()}
              localFailure={runtimePrepareLocalFailure()}
              pendingIntent={pendingIntent()}
              prepareSubmitting={runtimePrepareSubmitting()}
              cancelSubmitting={runtimeCancelSubmitting()}
              onPrepare={() => {
                void startWorkspacePrepareFlow("retry");
              }}
              onRefresh={() => {
                void refetchRuntimeStatus();
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
                        onOpen={() => void handleOpen(space)}
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
