import { For, Show, createEffect, createResource, createSignal } from "solid-js";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  ConfirmDialog,
  Dialog,
  DirectoryInput,
  Input,
  LoadingOverlay,
  Panel,
  PanelContent,
  Tooltip,
  useNotification,
  type FileItem,
} from "@floegence/floe-webapp-core";
import { useProtocol } from "@floegence/floe-webapp-protocol";
import { useRedevenRpc, type FsFileInfo } from "../protocol/redeven_v1";
import { getEnvPublicIDFromSession, mintEnvEntryTicketForApp } from "../services/controlplaneApi";
import { registerSandboxWindow } from "../services/sandboxWindowRegistry";

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

const FLOE_APP_CODE = "com.floegence.redeven.code";

async function fetchGatewayJSON<T>(url: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const resp = await fetch(url, { ...init, headers, credentials: "omit", cache: "no-store" });
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`);
  if (data?.ok === false) throw new Error(String(data?.error ?? "Request failed"));
  return (data?.data ?? data) as T;
}

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

function codespaceOrigin(codeSpaceID: string): string {
  const scheme = window.location.protocol;
  const host = window.location.hostname.toLowerCase();
  const port = window.location.port ? `:${window.location.port}` : "";
  const parts = host.split(".");
  const restHost = parts.slice(1).join(".") || host;
  return `${scheme}//cs-${codeSpaceID}.${restHost}${port}`;
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

  const origin = codespaceOrigin(codeSpaceID);
  // Keep `?env=` in the final URL so users can copy/paste the link and reopen the codespace later.
  const bootURL = `${origin}/_redeven_boot/?env=${encodeURIComponent(envPublicID)}`;

  const win = window.open("about:blank", `redeven_codespace_${codeSpaceID}`);
  if (!win) throw new Error("Popup was blocked. Please allow popups and try again.");

  registerSandboxWindow(win, { origin, floe_app: FLOE_APP_CODE, code_space_id: codeSpaceID, app_path: "/" });

  try {
    setStatus("Starting codespace...");
    await fetchGatewayJSON<SpaceStatus>(`/_redeven_proxy/api/spaces/${encodeURIComponent(codeSpaceID)}/start`, { method: "POST" });

    setStatus("Requesting entry ticket...");
    const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp: FLOE_APP_CODE, codeSpaceId: codeSpaceID });

    const init = {
      v: 1,
      env_public_id: envPublicID,
      floe_app: FLOE_APP_CODE,
      code_space_id: codeSpaceID,
      app_path: "/",
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

// File tree utilities
function normalizePath(path: string): string {
  const raw = String(path ?? "").trim();
  if (!raw) return "/";
  const p = raw.startsWith("/") ? raw : `/${raw}`;
  if (p === "/") return "/";
  return p.endsWith("/") ? p.replace(/\/+$/, "") || "/" : p;
}

function extNoDot(name: string): string | undefined {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return undefined;
  return name.slice(idx + 1).toLowerCase();
}

function toFileItem(entry: FsFileInfo): FileItem {
  const isDir = !!entry.isDirectory;
  const name = String(entry.name ?? "");
  // Normalize path so it matches the comparisons inside withChildren.
  const p = normalizePath(String(entry.path ?? ""));
  const modifiedAtMs = Number(entry.modifiedAt ?? 0);
  return {
    id: p,
    name,
    type: isDir ? "folder" : "file",
    path: p,
    size: Number.isFinite(entry.size) ? entry.size : undefined,
    modifiedAt: Number.isFinite(modifiedAtMs) && modifiedAtMs > 0 ? new Date(modifiedAtMs) : undefined,
    extension: isDir ? undefined : extNoDot(name),
  };
}

function sortFileItems(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
}

function withChildren(tree: FileItem[], folderPath: string, children: FileItem[]): FileItem[] {
  const target = folderPath.trim() || "/";
  if (target === "/" || target === "") {
    return children;
  }

  const visit = (items: FileItem[]): [FileItem[], boolean] => {
    let changed = false;
    const next = items.map((it) => {
      if (it.type !== "folder") return it;
      if (it.path === target) {
        changed = true;
        return { ...it, children };
      }
      if (!it.children || it.children.length === 0) return it;
      const [nextChildren, hit] = visit(it.children);
      if (!hit) return it;
      changed = true;
      return { ...it, children: nextChildren };
    });
    return [changed ? next : items, changed];
  };

  const [next] = visit(tree);
  return next;
}

// Status badge component
function StatusBadge(props: { running: boolean; pid?: number }) {
  return (
    <Tooltip content={props.running ? `Process ID: ${props.pid}` : "Codespace is stopped"} placement="top">
      <span
        class={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
          props.running
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
        }`}
      >
        <span class={`w-1.5 h-1.5 rounded-full ${props.running ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"}`} />
        {props.running ? "Running" : "Stopped"}
      </span>
    </Tooltip>
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
  busy: boolean;
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const isRunning = () => props.space.running;

  return (
    <Card
      class={cn(
        "border transition-all duration-200",
        isRunning()
          ? "border-emerald-500/30 bg-emerald-500/[0.02] hover:border-emerald-500/50"
          : "border-border/60 opacity-75 hover:opacity-100 hover:border-border"
      )}
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
      <CardFooter class="pt-2 flex items-center justify-between gap-2 border-t border-border/50">
        <Show
          when={isRunning()}
          fallback={
            // Stopped: Start is primary action
            <div class="flex items-center gap-2 flex-1">
              <Button size="sm" variant="default" disabled={props.busy} onClick={props.onStart} class="flex-1">
                <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                  />
                </svg>
                Start
              </Button>
              <Tooltip content="Open (will auto-start)" placement="top">
                <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onOpen} class="px-2 text-muted-foreground">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </Button>
              </Tooltip>
            </div>
          }
        >
          {/* Running: Open is primary action */}
          <Button size="sm" variant="default" disabled={props.busy} onClick={props.onOpen} class="flex-1">
            <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
              />
            </svg>
            Open
          </Button>
        </Show>
        <div class="flex items-center gap-1">
          <Show when={isRunning()}>
            <Tooltip content="Stop codespace" placement="top">
              <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onStop} class="px-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
                </svg>
              </Button>
            </Tooltip>
          </Show>
          <Tooltip content="Delete codespace" placement="top">
            <Button
              size="sm"
              variant="ghost"
              disabled={props.busy}
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
          <Button size="sm" variant="outline" onClick={() => handleOpenChange(false)} disabled={props.loading}>
            Cancel
          </Button>
          <Button size="sm" variant="default" onClick={handleCreate} loading={props.loading} disabled={!selectedPath()}>
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

export function EnvCodespacesPage() {
  const notification = useNotification();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();

  const [createDialogOpen, setCreateDialogOpen] = createSignal(false);
  const [createLoading, setCreateLoading] = createSignal(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<SpaceStatus | null>(null);
  const [deleteLoading, setDeleteLoading] = createSignal(false);
  const [busyId, setBusyId] = createSignal<string | null>(null);

  // File tree for directory picker
  const [files, setFiles] = createSignal<FileItem[]>([]);
  const [homePath, setHomePath] = createSignal<string | undefined>(undefined);
  type DirCache = Map<string, FileItem[]>;
  let cache: DirCache = new Map();

  const [spaces, { refetch }] = createResource<SpaceStatus[]>(async () => {
    const out = await fetchGatewayJSON<{ spaces: SpaceStatus[] }>("/_redeven_proxy/api/spaces", { method: "GET" });
    const list = out?.spaces;
    return Array.isArray(list) ? list : [];
  });

  // Load home directory path
  createEffect(() => {
    if (!protocol.client()) return;
    void (async () => {
      try {
        const resp = await rpc.fs.getHome();
        const home = String(resp?.path ?? "").trim();
        if (home) setHomePath(home);
      } catch {
        // ignore
      }
    })();
  });

  // Load a single directory's children and update the tree.
  const loadDir = async (path: string) => {
    const client = protocol.client();
    if (!client) return;

    const p = normalizePath(path);

    // If cached, update the tree from cache.
    if (cache.has(p)) {
      setFiles((prev) => withChildren(prev, p, cache.get(p)!));
      return;
    }

    try {
      const resp = await rpc.fs.list({ path: p, showHidden: false });
      const entries = resp?.entries ?? [];
      const items = sortFileItems(entries.map(toFileItem).filter((item) => item.type === "folder"));
      cache.set(p, items);
      setFiles((prev) => withChildren(prev, p, items));
    } catch (e) {
      // ignore errors for now
    }
  };

  // Load root directory (for initialization).
  const loadRootDir = async () => {
    const client = protocol.client();
    if (!client) return;

    const p = "/";
    if (cache.has(p)) {
      // Root is cached; set directly.
      setFiles(cache.get(p)!);
      return;
    }

    try {
      const resp = await rpc.fs.list({ path: p, showHidden: false });
      const entries = resp?.entries ?? [];
      const items = sortFileItems(entries.map(toFileItem).filter((item) => item.type === "folder"));
      cache.set(p, items);
      setFiles(items);
    } catch (e) {
      // ignore errors for now
    }
  };

  const handleLoadDir = (path: string) => {
    const p = normalizePath(path);
    if (p === "/") {
      // Root: init or refresh.
      void loadRootDir();
    } else {
      // Non-root: load and update subtree.
      void loadDir(p);
    }
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
      notification.success("Codespace created", name ? `Created \"${name}\"` : "Codespace created successfully");
    } catch (e) {
      notification.error("Failed to create", e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleStart = async (space: SpaceStatus) => {
    setBusyId(space.code_space_id);
    try {
      await fetchGatewayJSON<SpaceStatus>(`/_redeven_proxy/api/spaces/${encodeURIComponent(space.code_space_id)}/start`, { method: "POST" });
      await refetch();
      notification.success("Started", `Codespace \"${space.name || space.code_space_id}\" is now running`);
    } catch (e) {
      notification.error("Failed to start", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleStop = async (space: SpaceStatus) => {
    setBusyId(space.code_space_id);
    try {
      await fetchGatewayJSON<void>(`/_redeven_proxy/api/spaces/${encodeURIComponent(space.code_space_id)}/stop`, { method: "POST" });
      await refetch();
      notification.success("Stopped", `Codespace \"${space.name || space.code_space_id}\" has been stopped`);
    } catch (e) {
      notification.error("Failed to stop", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
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
      notification.success("Deleted", `Codespace \"${target.name || target.code_space_id}\" has been deleted`);
    } catch (e) {
      notification.error("Failed to delete", e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleOpen = async (space: SpaceStatus) => {
    setBusyId(space.code_space_id);
    try {
      await openCodespace(space.code_space_id, () => {});
    } catch (e) {
      notification.error("Failed to open", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const openDeleteDialog = (space: SpaceStatus) => {
    setDeleteTarget(space);
    setDeleteDialogOpen(true);
  };

  const spaceList = () => spaces() ?? [];
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
      <Panel class="border border-border rounded-md overflow-hidden">
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
              <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={spaces.loading}>
                <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
                Refresh
              </Button>
              <Button size="sm" variant="default" onClick={() => setCreateDialogOpen(true)}>
                <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New Codespace
              </Button>
            </div>
          </div>

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
                        busy={busyId() === space.code_space_id}
                        onOpen={() => void handleOpen(space)}
                        onStart={() => void handleStart(space)}
                        onStop={() => void handleStop(space)}
                        onDelete={() => openDeleteDialog(space)}
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
      <ConfirmDialog
        open={deleteDialogOpen()}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDialogOpen(false);
            setDeleteTarget(null);
          }
        }}
        title="Delete Codespace"
        confirmText="Delete"
        variant="destructive"
        loading={deleteLoading()}
        onConfirm={handleDeleteConfirm}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Are you sure you want to delete <span class="font-semibold">"{deleteTarget()?.name || deleteTarget()?.code_space_id}"</span>?
          </p>
          <p class="text-xs text-muted-foreground">
            This will remove the codespace configuration. The directory at <span class="font-mono">{deleteTarget()?.workspace_path}</span> will not be deleted.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
