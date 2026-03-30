import { For, Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { cn, useNotification } from "@floegence/floe-webapp-core";
import { Sparkles, Terminal } from "@floegence/floe-webapp-core/icons";
import type { FileItem } from "@floegence/floe-webapp-core/file-browser";
import { Panel, PanelContent } from "@floegence/floe-webapp-core/layout";
import { LoadingOverlay, SnakeLoader } from "@floegence/floe-webapp-core/loading";
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
  HighlightBlock,
  Input,
  Tag,
} from "@floegence/floe-webapp-core/ui";
import { useProtocol } from "@floegence/floe-webapp-protocol";
import { useEnvContext } from "./EnvContext";
import { useRedevenRpc, type FsFileInfo } from "../protocol/redeven_v1";
import { Tooltip } from "../primitives/Tooltip";
import {
  cancelCodeRuntimeOperation,
  codeRuntimeManagedActionLabel,
  codeRuntimeMissing,
  codeRuntimeOperationRunning,
  codeRuntimeReady,
  codeRuntimeStageLabel,
  fetchCodeRuntimeStatus,
  installCodeRuntime,
  type CodeRuntimeStatus,
} from "../services/codeRuntimeApi";
import { getEnvPublicIDFromSession, getLocalRuntime, mintEnvEntryTicketForApp } from "../services/controlplaneApi";
import { FLOE_APP_CODE } from "../services/floeproxyContract";
import { fetchGatewayJSON } from "../services/gatewayApi";
import { appendLocalAccessResumeQuery } from "../services/localAccessAuth";
import { trustedLauncherOriginFromSandboxLocation } from "../services/sandboxOrigins";
import { registerSandboxWindow } from "../services/sandboxWindowRegistry";
import { buildFilePathAskFlowerIntent } from "../utils/filePathAskFlower";
import { canOpenDirectoryPathInTerminal, openDirectoryInTerminal } from "../utils/openDirectoryInTerminal";
import { replacePickerChildren, sortPickerFolderItems, toPickerFolderItem, toPickerTreeAbsolutePath } from "../utils/directoryPickerTree";
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from "../utils/redevenSurfaceRoles";
import { FLOATING_CONTEXT_MENU_WIDTH_PX, FloatingContextMenu, estimateFloatingContextMenuHeight, type FloatingContextMenuItem } from "../widgets/FloatingContextMenu";

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

function fmtTime(ms: number): string {
  if (!ms) return "Never";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function fmtRelativeTime(ms: number): string {
  if (!ms) return "Never";
  try {
    const now = Date.now();
    const diff = now - ms;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  } catch {
    return String(ms);
  }
}

function clampCodespaceContextMenuPosition(x: number, y: number): { x: number; y: number } {
  if (typeof window === "undefined") return { x, y };

  const margin = 8;
  const menuWidth = FLOATING_CONTEXT_MENU_WIDTH_PX;
  const menuHeight = estimateFloatingContextMenuHeight(2);
  const maxX = Math.max(margin, window.innerWidth - menuWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - menuHeight - margin);

  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
}

function codespaceOrigin(codeSpaceID: string): string {
  return trustedLauncherOriginFromSandboxLocation(window.location, "cs", codeSpaceID);
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

function validateMeta(name: string, description: string): string | null {
  const n = runeLen(name.trim());
  if (n > 64) return "Name must be at most 64 characters.";
  const d = runeLen(description.trim());
  if (d > 256) return "Description must be at most 256 characters.";
  return null;
}

async function openCodespace(codeSpaceID: string, setStatus: (s: string) => void): Promise<void> {
  const envPublicID = getEnvPublicIDFromSession();
  if (!envPublicID) throw new Error("Missing env context. Please reopen from the Redeven Portal.");

  const local = await getLocalRuntime();
  if (local) {
    const win = window.open("about:blank", `redeven_codespace_${codeSpaceID}`);
    if (!win) throw new Error("Popup was blocked. Please allow popups and try again.");

    try {
      setStatus("Starting codespace...");
      const sp = await fetchGatewayJSON<SpaceStatus>(`/_redeven_proxy/api/spaces/${encodeURIComponent(codeSpaceID)}/start`, { method: "POST" });
      const folder = String(sp?.workspace_path ?? "").trim();
      const basePath = `/cs/${encodeURIComponent(codeSpaceID)}/`;
      const url = appendLocalAccessResumeQuery(folder ? `${basePath}?folder=${encodeURIComponent(folder)}` : basePath);
      setStatus("Opening...");
      win.location.assign(url);
      return;
    } catch (e) {
      try {
        win.close();
      } catch {
        // ignore
      }
      throw e;
    }
  }

  const origin = codespaceOrigin(codeSpaceID);
  // Keep `?env=` in the final URL so users can copy/paste the link and reopen the codespace later.
  const bootURL = `${origin}/_redeven_boot/?env=${encodeURIComponent(envPublicID)}`;

  const win = window.open("about:blank", `redeven_codespace_${codeSpaceID}`);
  if (!win) throw new Error("Popup was blocked. Please allow popups and try again.");

  try {
    setStatus("Starting codespace...");
    const sp = await fetchGatewayJSON<SpaceStatus>(`/_redeven_proxy/api/spaces/${encodeURIComponent(codeSpaceID)}/start`, { method: "POST" });

    const folder = String(sp?.workspace_path ?? "").trim();
    const appPath = folder ? `/?folder=${encodeURIComponent(folder)}` : "/";
    registerSandboxWindow(win, { origin, floe_app: FLOE_APP_CODE, code_space_id: codeSpaceID, app_path: appPath });

    setStatus("Requesting entry ticket...");
    const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp: FLOE_APP_CODE, codeSpaceId: codeSpaceID });

    const init = {
      v: 2,
      env_public_id: envPublicID,
      floe_app: FLOE_APP_CODE,
      code_space_id: codeSpaceID,
      app_path: appPath,
      entry_ticket: entryTicket,
    };
    const encoded = base64UrlEncode(JSON.stringify(init));

    setStatus("Opening...");
    win.location.assign(`${bootURL}#redeven=${encoded}`);
  } catch (e) {
    try {
      win.close();
    } catch {
      // ignore
    }
    throw e;
  }
}

// Status badge component
function StatusBadge(props: { running: boolean; pid?: number }) {
  return (
    <Tooltip content={props.running ? `Process ID: ${props.pid}` : "Codespace is stopped"} placement="top">
      <Tag
        variant={props.running ? "success" : "neutral"}
        tone="soft"
        size="sm"
        dot
        class="cursor-default"
      >
        {props.running ? "Running" : "Stopped"}
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
      <h3 class="text-sm font-medium text-foreground mb-1">No codespaces yet</h3>
      <p class="text-xs text-muted-foreground text-center max-w-xs mb-4">
        Create a codespace to start coding with VS Code in the browser. Your code stays on your machine.
      </p>
      <Button size="sm" variant="default" onClick={props.onCreateClick}>
        Create Codespace
      </Button>
    </div>
  );
}

// Codespace card component
function CodespaceCard(props: {
  space: SpaceStatus;
  busyAction?: CodespaceBusyAction;
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onContextMenu: (event: MouseEvent) => void;
  contextMenuOpen?: boolean;
}) {
  const isRunning = () => props.space.running;
  const isBusy = () => !!props.busyAction;

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
          <div class="text-muted-foreground">ID</div>
          <div class="font-mono truncate text-right" title={props.space.code_space_id}>
            {props.space.code_space_id}
          </div>
          <div class="text-muted-foreground">Path</div>
          <div class="font-mono truncate text-right" title={props.space.workspace_path}>
            {props.space.workspace_path}
          </div>
          <div class="text-muted-foreground">Port</div>
          <div class="font-mono text-right">{props.space.code_port || "-"}</div>
          <div class="text-muted-foreground">Last opened</div>
          <Tooltip content={fmtTime(props.space.last_opened_at_unix_ms)} placement="top">
            <div class="text-right cursor-default">{fmtRelativeTime(props.space.last_opened_at_unix_ms)}</div>
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
                Start
              </Button>
              <Tooltip content="Open (will auto-start)" placement="top">
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
            Open
          </Button>
        </Show>
        <div class="flex items-center gap-1">
          <Show when={isRunning()}>
            <Tooltip content="Stop codespace" placement="top">
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
          <Tooltip content="Delete codespace" placement="top">
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
    setDescription(`codespace at ${path}`);
  };

  const handleCreate = () => {
    if (!selectedPath()) return;
    props.onCreate(selectedPath(), name().trim(), description().trim());
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title="Create Codespace"
      footer={
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => handleOpenChange(false)} disabled={props.loading} class={outlineControlClass}>
            Cancel
          </Button>
          <Button size="sm" variant="default" onClick={handleCreate} disabled={props.loading || !selectedPath()}>
            <Show when={props.loading}>
              <InlineButtonSnakeLoading class="mr-1" />
            </Show>
            Create
          </Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium mb-1">Directory</label>
          <DirectoryInput
            value={selectedPath()}
            onChange={handlePathChange}
            files={props.files}
            onExpand={props.onLoadDir}
            placeholder="Click to select a directory..."
            homePath={props.homePath}
            homeLabel="Home"
            size="sm"
          />
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Name</label>
          <Input
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="My Project"
            size="sm"
            class="w-full"
          />
          <p class="text-[11px] text-muted-foreground mt-1">Display name for the codespace.</p>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Description</label>
          <Input
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="codespace at /path/to/project"
            size="sm"
            class="w-full"
          />
          <p class="text-[11px] text-muted-foreground mt-1">Optional description for the codespace.</p>
        </div>
      </div>
    </Dialog>
  );
}

function runtimeRequirementLabel(status: CodeRuntimeStatus | null | undefined): string {
  if (!status) return "code-server is required for Codespaces on this host.";
  if (status.operation.state === "running") return codeRuntimeStageLabel(status.operation.stage, status.operation.action);
  if (status.active_runtime.detection_state === "unusable") {
    return status.active_runtime.error_message || "Redeven detected a code-server runtime, but it is not usable for Codespaces on this host.";
  }
  return "Redeven can install or update the latest stable code-server release for this host using the official installer.";
}

type CodeRuntimeBannerMode = "inline" | "floating";

function CodeRuntimeBanner(props: {
  status: CodeRuntimeStatus | null | undefined;
  loading: boolean;
  error?: string | null;
  mode: CodeRuntimeBannerMode;
  onInstall: () => void;
  onRefresh: () => void;
  onViewDetails: () => void;
}) {
  const isFloating = () => props.mode === "floating";
  const showDetailsAction = () =>
    props.status?.operation.state === "running"
    || props.status?.operation.state === "failed"
    || props.status?.operation.state === "cancelled";
  const showInstallAction = () => !props.error && !props.loading && !showDetailsAction();
  const inlineVariant = () => {
    if (props.error || props.status?.operation.state === "failed") return "error" as const;
    if (
      props.status?.operation.state === "cancelled"
      || props.status?.active_runtime.detection_state === "unusable"
      || props.status?.active_runtime.detection_state === "missing"
    ) return "warning" as const;
    return "note" as const;
  };

  const badgeText = () => {
    const status = props.status;
    if (props.loading) return "Checking runtime";
    if (!status) return "Runtime unavailable";
    if (status.operation.state === "running") return status.operation.action === "uninstall" ? "Removing" : "Installing";
    if (status.operation.state === "failed") return status.operation.action === "uninstall" ? "Uninstall failed" : "Install failed";
    if (status.operation.state === "cancelled") return status.operation.action === "uninstall" ? "Uninstall cancelled" : "Install cancelled";
    if (status.active_runtime.detection_state === "unusable") return "Needs attention";
    return "Not installed";
  };

  if (isFloating()) {
    return (
      <div
        data-testid="code-runtime-banner"
        data-banner-mode="floating"
        class="fixed bottom-3 right-3 z-[70] w-[min(28rem,calc(100vw-1.5rem))] sm:bottom-4 sm:right-4"
      >
        <div
          class={cn(
            "rounded-xl border border-border/70 bg-background/95 p-4 shadow-[0_24px_48px_-32px_rgba(15,23,42,0.45)] backdrop-blur",
            redevenSurfaceRoleClass("panelStrong"),
          )}
        >
          <div class="flex items-start gap-3">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span class="origin-center scale-[0.72]">
                <SnakeLoader size="sm" />
              </span>
            </div>
            <div class="min-w-0 flex-1 space-y-3">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-sm font-semibold text-foreground">code-server runtime</div>
                <Tag variant="neutral" tone="soft" size="sm" class="cursor-default">
                  {badgeText()}
                </Tag>
              </div>
              <div class="text-xs leading-relaxed text-muted-foreground">
                {props.error ? props.error : runtimeRequirementLabel(props.status)}
              </div>
              <Show when={props.status?.operation.state === "running"}>
                <div class="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={props.onRefresh} disabled={props.loading}>
                    Refresh status
                  </Button>
                  <Button size="sm" variant="default" onClick={props.onViewDetails}>
                    View install
                  </Button>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="code-runtime-banner" data-banner-mode="inline">
      <HighlightBlock
        variant={inlineVariant()}
        title="code-server runtime"
        class={cn("border-0 shadow-none", redevenSurfaceRoleClass("panelStrong"))}
      >
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <Tag variant="neutral" tone="soft" size="sm" class="cursor-default">
              {badgeText()}
            </Tag>
          </div>
          <div class="text-xs text-muted-foreground">
            {props.error ? props.error : runtimeRequirementLabel(props.status)}
          </div>
          <div class="grid gap-1 text-[11px] text-muted-foreground">
            <Show when={props.status?.active_runtime.binary_path}>
              <div>Detected path: <span class="font-mono break-all">{props.status?.active_runtime.binary_path}</span></div>
            </Show>
            <Show when={props.status?.managed_prefix}>
              <div>Managed location: <span class="font-mono break-all">{props.status?.managed_prefix}</span></div>
            </Show>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={props.onRefresh} disabled={props.loading}>
              Refresh status
            </Button>
            <Show
              when={showDetailsAction()}
              fallback={
                <Show when={showInstallAction()}>
                  <Button size="sm" variant="default" onClick={props.onInstall}>
                    {codeRuntimeManagedActionLabel(props.status)}
                  </Button>
                </Show>
              }
            >
              <Button size="sm" variant="default" onClick={props.onViewDetails}>
                <Show when={props.status?.operation.state === "running"} fallback="View details">
                  View install
                </Show>
              </Button>
            </Show>
          </div>
        </div>
      </HighlightBlock>
    </div>
  );
}

function CodeRuntimeInstallDialog(props: {
  open: boolean;
  status: CodeRuntimeStatus | null | undefined;
  loading: boolean;
  installSubmitting: boolean;
  cancelSubmitting: boolean;
  pendingIntent: PendingCodespaceIntent;
  onOpenChange: (open: boolean) => void;
  onInstall: () => void;
  onCancelInstall: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onContinue: () => void;
}) {
  const installRunning = () => codeRuntimeOperationRunning(props.status);
  const installFailed = () => props.status?.operation.state === "failed";
  const installCancelled = () => props.status?.operation.state === "cancelled";
  const runtimeReady = () => codeRuntimeReady(props.status);
  const pendingActionLabel = () => {
    if (props.pendingIntent?.kind === "open") return "Continue to open codespace";
    if (props.pendingIntent?.kind === "start") return "Continue to start codespace";
    return "Done";
  };
  const installActionLabel = () => codeRuntimeManagedActionLabel(props.status);
  const dialogTitle = () => {
    if (installRunning()) return "Installing code-server";
    if (runtimeReady()) return "code-server is ready";
    if (installFailed()) return "Unable to install or update code-server";
    if (installCancelled()) return "Install or update cancelled";
    return installActionLabel();
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && (installRunning() || props.installSubmitting || props.cancelSubmitting)) return;
        props.onOpenChange(open);
      }}
      title={dialogTitle()}
      footer={
        <div class="flex justify-end gap-2">
          <Show
            when={installRunning()}
            fallback={
              <Show
                when={runtimeReady()}
                fallback={
                  <Show
                    when={installFailed() || installCancelled()}
                    fallback={
                      <>
                        <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.installSubmitting}>
                          Close
                        </Button>
                        <Button size="sm" variant="default" onClick={props.onInstall} disabled={props.installSubmitting}>
                          <Show when={props.installSubmitting}>
                            <InlineButtonSnakeLoading class="mr-1" />
                          </Show>
                          {installActionLabel()}
                        </Button>
                      </>
                    }
                  >
                    <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.installSubmitting}>
                      Close
                    </Button>
                    <Button size="sm" variant="default" onClick={props.onRetry} disabled={props.installSubmitting}>
                      <Show when={props.installSubmitting}>
                        <InlineButtonSnakeLoading class="mr-1" />
                      </Show>
                      Retry
                    </Button>
                  </Show>
                }
              >
                <Button size="sm" variant="outline" onClick={props.onOpenChange.bind(null, false)}>
                  Close
                </Button>
                <Button size="sm" variant="default" onClick={props.onContinue}>
                  {pendingActionLabel()}
                </Button>
              </Show>
            }
          >
            <Button size="sm" variant="outline" onClick={props.onCancelInstall} disabled={props.cancelSubmitting}>
              <Show when={props.cancelSubmitting}>
                <InlineButtonSnakeLoading class="mr-1" />
              </Show>
              Cancel install
            </Button>
          </Show>
        </div>
      }
    >
      <div class="space-y-4">
        <div class="space-y-1">
          <div class="text-sm text-foreground">
            Redeven installs or updates a managed <span class="font-mono">code-server</span> runtime only after you explicitly confirm it here.
          </div>
          <div class="text-xs text-muted-foreground">
            Installer source: official <span class="font-mono">code-server install.sh</span> latest-stable flow.
          </div>
        </div>

        <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
          <div>Managed location: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix ?? "-"}</span></div>
          <div>Installer URL: <span class="font-mono text-foreground break-all">{props.status?.installer_script_url ?? "-"}</span></div>
          <Show when={props.pendingIntent}>
            <div>Pending action: <span class="text-foreground">{props.pendingIntent?.kind === "open" ? "Open codespace after install" : "Start codespace after install"}</span></div>
          </Show>
        </div>

        <Show when={installRunning()}>
          <div class="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <div class="text-sm font-medium text-foreground">{codeRuntimeStageLabel(props.status?.operation.stage, props.status?.operation.action)}</div>
            <div class="text-xs text-muted-foreground">
              This install was explicitly requested by you. Redeven will not retry automatically if it fails.
            </div>
          </div>
        </Show>

        <Show when={runtimeReady()}>
          <div class="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] p-3 space-y-1">
            <div class="text-sm font-medium text-foreground">Managed runtime is ready.</div>
            <div class="text-xs text-muted-foreground">
              Binary path: <span class="font-mono text-foreground break-all">{props.status?.managed_runtime.binary_path ?? "-"}</span>.
            </div>
          </div>
        </Show>

        <Show when={installFailed() || installCancelled()}>
          <div class="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
            <div class="text-sm font-medium text-foreground">
              <Show when={installCancelled()} fallback="Install failed">
                Install cancelled
              </Show>
            </div>
            <div class="text-xs text-muted-foreground">
              <Show when={installCancelled()} fallback={props.status?.operation.last_error || "The official installer did not finish successfully."}>
                The install was cancelled before the managed runtime was promoted.
              </Show>
            </div>
          </div>
        </Show>

        <div class="flex items-center justify-between">
          <div class="text-xs font-medium text-muted-foreground">Recent install output</div>
          <Button size="sm" variant="ghost" onClick={props.onRefresh} disabled={props.loading}>
            Refresh
          </Button>
        </div>
        <pre
          data-testid="code-runtime-log-tail"
          class="max-h-48 overflow-auto rounded-lg border border-border bg-background/80 p-3 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words"
        >
          {(props.status?.operation.log_tail?.length ?? 0) > 0
            ? props.status?.operation.log_tail?.join("\n")
            : "No install output yet."}
        </pre>
      </div>
    </Dialog>
  );
}

export function EnvCodespacesPage() {
  const notification = useNotification();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const env = useEnvContext();

  const [createDialogOpen, setCreateDialogOpen] = createSignal(false);
  const [createLoading, setCreateLoading] = createSignal(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<SpaceStatus | null>(null);
  const [deleteLoading, setDeleteLoading] = createSignal(false);
  const [installDialogOpen, setInstallDialogOpen] = createSignal(false);
  const [pendingIntent, setPendingIntent] = createSignal<PendingCodespaceIntent>(null);
  const [runtimeInstallSubmitting, setRuntimeInstallSubmitting] = createSignal(false);
  const [runtimeCancelSubmitting, setRuntimeCancelSubmitting] = createSignal(false);
  const [busyActions, setBusyActions] = createSignal<Record<string, CodespaceBusyAction | undefined>>({});
  const [codespaceContextMenu, setCodespaceContextMenu] = createSignal<CodespaceContextMenuState | null>(null);
  let codespaceContextMenuEl: HTMLDivElement | null = null;

  const busyActionOf = (codeSpaceID: string): CodespaceBusyAction | undefined => busyActions()[codeSpaceID];

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

    const timer = window.setInterval(() => {
      void refetchRuntimeStatus();
    }, 1000);
    onCleanup(() => {
      window.clearInterval(timer);
    });
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
      const metaErr = validateMeta(name, description);
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
      notification.success("Codespace created", name ? `Created "${name}"` : "Codespace created successfully");
    } catch (e) {
      notification.error("Failed to create", e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
    }
  };

  const openInstallDialog = (intent: PendingCodespaceIntent = null) => {
    setPendingIntent(intent);
    setInstallDialogOpen(true);
  };

  const ensureCodeRuntimeAvailable = async (kind: "open" | "start", space: SpaceStatus): Promise<boolean> => {
    const current = runtimeStatus();
    if (codeRuntimeReady(current)) return true;
    try {
      const latest = await fetchCodeRuntimeStatus();
      await refetchRuntimeStatus();
      if (codeRuntimeReady(latest)) return true;
    } catch {
      // Ignore and fall back to the explicit install dialog.
    }
    openInstallDialog({
      kind,
      code_space_id: space.code_space_id,
      name: space.name || space.code_space_id,
    });
    return false;
  };

  const startRuntimeInstall = async () => {
    setRuntimeInstallSubmitting(true);
    try {
      await installCodeRuntime();
      await refetchRuntimeStatus();
    } catch (e) {
      notification.error("Failed to start install", e instanceof Error ? e.message : String(e));
    } finally {
      setRuntimeInstallSubmitting(false);
    }
  };

  const cancelRuntimeInstallFlow = async () => {
    setRuntimeCancelSubmitting(true);
    try {
      await cancelCodeRuntimeOperation();
      await refetchRuntimeStatus();
    } catch (e) {
      notification.error("Failed to cancel install", e instanceof Error ? e.message : String(e));
    } finally {
      setRuntimeCancelSubmitting(false);
    }
  };

  const handleStart = async (space: SpaceStatus) => {
    if (!(await ensureCodeRuntimeAvailable("start", space))) return;
    if (busyActionOf(space.code_space_id)) return;
    setBusyAction(space.code_space_id, "start");
    try {
      await fetchGatewayJSON<SpaceStatus>(`/_redeven_proxy/api/spaces/${encodeURIComponent(space.code_space_id)}/start`, { method: "POST" });
      await refetch();
      notification.success("Started", `Codespace "${space.name || space.code_space_id}" is now running`);
    } catch (e) {
      notification.error("Failed to start", e instanceof Error ? e.message : String(e));
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
      notification.success("Stopped", `Codespace "${space.name || space.code_space_id}" has been stopped`);
    } catch (e) {
      notification.error("Failed to stop", e instanceof Error ? e.message : String(e));
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
      notification.success("Deleted", `Codespace "${target.name || target.code_space_id}" has been deleted`);
    } catch (e) {
      notification.error("Failed to delete", e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleOpen = async (space: SpaceStatus) => {
    if (!(await ensureCodeRuntimeAvailable("open", space))) return;
    if (busyActionOf(space.code_space_id)) return;
    setBusyAction(space.code_space_id, "open");
    try {
      await openCodespace(space.code_space_id, () => {});
      await refetch();
    } catch (e) {
      notification.error("Failed to open", e instanceof Error ? e.message : String(e));
    } finally {
      clearBusyAction(space.code_space_id);
    }
  };

  const continuePendingIntent = async () => {
    const intent = pendingIntent();
    if (!intent) {
      setInstallDialogOpen(false);
      return;
    }
    const space = spaceList().find((item) => item.code_space_id === intent.code_space_id);
    setPendingIntent(null);
    setInstallDialogOpen(false);
    if (!space) {
      notification.error("Codespace missing", `Could not find "${intent.name}" anymore.`);
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
    const pos = clampCodespaceContextMenuPosition(event.clientX, event.clientY);
    setCodespaceContextMenu({
      x: pos.x,
      y: pos.y,
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
      notification.error("Ask Flower unavailable", result.error ?? "Failed to resolve codespace workspace path.");
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
      openTerminalInDirectory: env.openTerminalInDirectory,
      onInvalidDirectory: () => {
        notification.error("Invalid directory", "Could not resolve a terminal working directory.");
      },
    });
  };

  const buildCodespaceContextMenuItems = (space: SpaceStatus): FloatingContextMenuItem[] => {
    const items: FloatingContextMenuItem[] = [
      {
        id: "ask-flower",
        kind: "action",
        label: "Ask Flower",
        icon: Sparkles,
        onSelect: handleAskFlowerFromCodespace,
      },
    ];

    if (canOpenCodespaceInTerminal(space)) {
      items.push({
        id: "open-in-terminal",
        kind: "action",
        label: "Open in Terminal",
        icon: Terminal,
        onSelect: handleOpenCodespaceInTerminal,
      });
    }

    return items;
  };

  const spaceList = () => spaces() ?? [];
  const runtimeBannerError = () => {
    const err = runtimeStatus.error;
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return null;
  };
  const runtimeBannerMode = (): CodeRuntimeBannerMode | null => {
    const status = runtimeStatus();
    if (runtimeBannerError()) return "inline";
    if (runtimeStatus.loading || status?.operation.state === "running") return "floating";
    if (!status) return null;
    if (
      codeRuntimeMissing(status)
      || status.operation.state === "failed"
      || status.operation.state === "cancelled"
    ) {
      return "inline";
    }
    return null;
  };
  const closeInstallDialog = (open: boolean) => {
    if (!open) {
      setInstallDialogOpen(false);
      setPendingIntent(null);
      return;
    }
    setInstallDialogOpen(true);
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
    <div class="h-full min-h-0 overflow-auto">
      <Panel class={cn("border rounded-md overflow-hidden", redevenSurfaceRoleClass("panelStrong"))} data-testid="codespaces-panel">
        <PanelContent class="p-4 space-y-4">
          {/* Page header */}
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-1">
              <div class="text-sm font-semibold">Codespaces</div>
              <div class="text-xs text-muted-foreground">
                Create and manage local VS Code instances in your browser. All code stays securely on your machine.
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" onClick={() => void handleRefreshAll()} disabled={spaces.loading || runtimeStatus.loading} aria-label="Refresh" title="Refresh" class={outlineControlClass}>
                <svg class="w-3.5 h-3.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
                <span class="hidden sm:inline">Refresh</span>
              </Button>
              <Button size="sm" variant="default" onClick={() => setCreateDialogOpen(true)} aria-label="New Codespace" title="New Codespace">
                <svg class="w-3.5 h-3.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span class="hidden sm:inline">New Codespace</span>
              </Button>
            </div>
          </div>

          <Show when={runtimeBannerMode() === "inline"}>
            <CodeRuntimeBanner
              status={runtimeStatus()}
              loading={runtimeStatus.loading}
              error={runtimeBannerError()}
              mode="inline"
              onInstall={() => openInstallDialog()}
              onRefresh={() => {
                void refetchRuntimeStatus();
              }}
              onViewDetails={() => openInstallDialog(pendingIntent())}
            />
          </Show>

          {/* Codespaces list */}
          <div class="relative" style={{ "min-height": "200px" }}>
            <LoadingOverlay visible={spaces.loading} message="Loading codespaces..." />
            <Show when={!spaces.loading}>
              <Show when={spaceList().length > 0} fallback={<EmptyState onCreateClick={() => setCreateDialogOpen(true)} />}>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <For each={sortedSpaces()}>
                    {(space) => (
                      <CodespaceCard
                        space={space}
                        busyAction={busyActionOf(space.code_space_id)}
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

      <Show when={runtimeBannerMode() === "floating"}>
        <CodeRuntimeBanner
          status={runtimeStatus()}
          loading={runtimeStatus.loading}
          error={runtimeBannerError()}
          mode="floating"
          onInstall={() => openInstallDialog()}
          onRefresh={() => {
            void refetchRuntimeStatus();
          }}
          onViewDetails={() => openInstallDialog(pendingIntent())}
        />
      </Show>

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

      <CodeRuntimeInstallDialog
        open={installDialogOpen()}
        status={runtimeStatus()}
        loading={runtimeStatus.loading}
        installSubmitting={runtimeInstallSubmitting()}
        cancelSubmitting={runtimeCancelSubmitting()}
        pendingIntent={pendingIntent()}
        onOpenChange={closeInstallDialog}
        onInstall={() => {
          void startRuntimeInstall();
        }}
        onCancelInstall={() => {
          void cancelRuntimeInstallFlow();
        }}
        onRetry={() => {
          void startRuntimeInstall();
        }}
        onRefresh={() => {
          void refetchRuntimeStatus();
        }}
        onContinue={() => {
          void continuePendingIntent();
        }}
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
        title="Delete Codespace"
        footer={
          <div class="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleteLoading()} class={outlineControlClass}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDeleteConfirm} disabled={deleteLoading()}>
              <Show when={deleteLoading()}>
                <InlineButtonSnakeLoading class="mr-1" />
              </Show>
              Delete
            </Button>
          </div>
        }
      >
        <div class="space-y-2">
          <p class="text-sm">
            Are you sure you want to delete <span class="font-semibold">"{deleteTarget()?.name || deleteTarget()?.code_space_id}"</span>?
          </p>
          <p class="text-xs text-muted-foreground">
            This will remove the codespace configuration. The directory at <span class="font-mono">{deleteTarget()?.workspace_path}</span> will not be deleted.
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
