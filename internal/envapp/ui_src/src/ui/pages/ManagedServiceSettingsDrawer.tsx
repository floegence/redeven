import {
  ErrorBoundary,
  For,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
} from "solid-js";
import type { CodeEditorProps } from "@floegence/floe-webapp-core/editor";
import { cn, useNotification } from "@floegence/floe-webapp-core";
import {
  AlertTriangle,
  FolderOpen,
  Lock,
  Plus,
  Refresh,
  Trash,
} from "@floegence/floe-webapp-core/icons";
import {
  Button,
  Checkbox,
  DirectoryPicker,
  Input,
  Textarea,
} from "@floegence/floe-webapp-core/ui";

import { createFilesystemPickerDataSource } from "../../../../../flower_ui/src/filePicker/createFilesystemPickerDataSource";
import { EnvAppDrawer } from "../primitives/EnvAppDrawer";
import { fetchLocalApiJSON } from "../services/localApi";
import { useProtocol } from "@floegence/floe-webapp-protocol";
import { useRedevenRpc } from "../protocol/redeven_v1";
import { useI18n, type EnvAppTranslationKey } from "../i18n";
import { ManagedServiceShapingOrb } from "./ManagedServiceShapingOrb";

const CodeEditor = lazy(async () => {
  const module = await import("@floegence/floe-webapp-core/editor");
  return { default: module.CodeEditor };
});

type AccessMode = "unified_proxy" | "desktop_loopback";
type EnvironmentSetting = {
  name: string;
  value?: string;
  secret?: boolean;
  has_value?: boolean;
  clear?: boolean;
};
type MountSetting = {
  resource_id: string;
  type: "workspace" | "bind" | "volume" | "tmpfs";
  source?: string;
  target: string;
  read_only?: boolean;
  tmpfs_options?: string[];
};
type PortSetting = {
  resource_id: string;
  container_port: number;
  host_port?: number;
  host_ip?: string;
  protocol?: "tcp" | "udp";
};
type DeviceSetting = {
  resource_id: string;
  host_path: string;
  container_path: string;
  permissions?: string;
};

type ContainerSettings = {
  entrypoint?: string;
  command?: string[];
  environment?: EnvironmentSetting[];
  labels?: Record<string, string>;
  restart_policy?: string;
  network_mode?: string;
  pid_mode?: string;
  ipc_mode?: string;
  ports?: PortSetting[];
  mounts?: MountSetting[];
  cpus?: number;
  memory_bytes?: number;
  pids_limit?: number;
  shm_size_bytes?: number;
  cap_add?: string[];
  cap_drop?: string[];
  devices?: DeviceSetting[];
  privileged?: boolean;
  read_only_root: boolean;
  security_opts?: string[];
  user?: string;
};

type HostSettings = {
  install_script?: string;
  start_script: string;
  stop_script?: string;
  uninstall_script?: string;
};
type RuntimeSettings = {
  container?: ContainerSettings;
  compose?: Record<string, ContainerSettings>;
  host?: HostSettings;
};
type SettingsView = {
  service_id: string;
  name: string;
  description?: string;
  access_mode: AccessMode;
  deployment: "host" | "container" | "compose";
  template_source: "builtin" | "custom";
  observed_state: string;
  configuration_revision: number;
  configuration_sha256: string;
  parameters?: Record<string, string>;
  runtime: RuntimeSettings;
  locked?: Array<{ path: string; reason: string; duplicate_to_edit?: boolean }>;
};

export type ManagedServiceReconfigureDraft = {
  configuration_revision: number;
  parameters: Record<string, string>;
  runtime: RuntimeSettings;
};
type ReconfigurePlan = {
  configuration_revision: number;
  plan_digest: string;
  changed_sections: string[];
  risks?: Array<{
    id: string;
    title: string;
    description: string;
    requires_admin: boolean;
  }>;
  requires_rebuild: boolean;
};

type SectionID =
  | "general"
  | "parameters"
  | "environment"
  | "storage"
  | "resources"
  | "network"
  | "security"
  | "lifecycle";
const sections: SectionID[] = [
  "general",
  "parameters",
  "environment",
  "storage",
  "resources",
  "network",
  "security",
  "lifecycle",
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function lines(value: string[] | undefined): string {
  return (value ?? []).join("\n");
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function NumberField(props: {
  label: string;
  value?: number;
  min?: number;
  step?: string;
  onInput: (value: number) => void;
}) {
  return (
    <label class="block">
      <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
        {props.label}
      </span>
      <Input
        type="number"
        min={props.min ?? 0}
        step={props.step ?? "1"}
        value={props.value ?? 0}
        onInput={(event) =>
          props.onInput(Number(event.currentTarget.value) || 0)
        }
        class="h-8 font-mono text-xs"
      />
    </label>
  );
}

function TextListField(props: {
  label: string;
  value?: string[];
  placeholder?: string;
  disabled?: boolean;
  onInput: (value: string[]) => void;
}) {
  return (
    <label class="block">
      <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
        {props.label}
      </span>
      <Textarea
        rows={4}
        value={lines(props.value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onInput={(event) =>
          props.onInput(splitLines(event.currentTarget.value))
        }
        class="font-mono text-xs"
      />
    </label>
  );
}

export function ManagedServiceSettingsDrawer(props: {
  open: boolean;
  serviceID: string;
  serviceName: string;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onRequestStop: () => void;
  onDuplicateTemplate: () => void;
  onApply: (request: {
    draft: ManagedServiceReconfigureDraft;
    plan_digest: string;
    accepted_risk_ids: string[];
  }) => Promise<void>;
}) {
  const i18n = useI18n();
  const notify = useNotification();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const settingText = (key: string, values?: Record<string, string | number>) =>
    i18n.t(
      `webServices.managed.settings.${key}` as EnvAppTranslationKey,
      values,
    );
  const sectionTitle = (id: SectionID) => settingText(`section.${id}`);
  const [loaded, setLoaded] = createSignal<SettingsView | null>(null);
  const [draft, setDraft] = createSignal<SettingsView | null>(null);
  const [section, setSection] = createSignal<SectionID>("general");
  const [composeService, setComposeService] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [savingMetadata, setSavingMetadata] = createSignal(false);
  const [applying, setApplying] = createSignal(false);
  const [error, setError] = createSignal("");
  const [plan, setPlan] = createSignal<ReconfigurePlan | null>(null);
  const [acceptedRisks, setAcceptedRisks] = createSignal<
    Record<string, boolean>
  >({});
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerTarget, setPickerTarget] = createSignal<{
    service?: string;
    resourceID: string;
  } | null>(null);
  const [scriptName, setScriptName] =
    createSignal<keyof HostSettings>("start_script");

  const picker = createFilesystemPickerDataSource({
    homePath: () => "/",
    listDirectory: async (absolutePath) => {
      if (!protocol.session?.()) return [];
      const response = await rpc.fs.list({
        path: absolutePath,
        showHidden: false,
      });
      return response.entries ?? [];
    },
  });

  const load = async () => {
    if (!props.open || !props.serviceID) return;
    setLoading(true);
    setError("");
    try {
      const value = await fetchLocalApiJSON<SettingsView>(
        `/_redeven_proxy/api/managed-web-services/${encodeURIComponent(props.serviceID)}/settings`,
        { method: "GET" },
      );
      setLoaded(clone(value));
      setDraft(clone(value));
      setComposeService(
        Object.keys(value.runtime.compose ?? {}).sort()[0] ?? "",
      );
      setPlan(null);
      setAcceptedRisks({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (!props.open) return;
    void load();
  });

  const runtimeDraft = createMemo<ManagedServiceReconfigureDraft | null>(() => {
    const value = draft();
    if (!value) return null;
    return {
      configuration_revision: value.configuration_revision,
      parameters: clone(value.parameters ?? {}),
      runtime: clone(value.runtime),
    };
  });
  const metadataDirty = () =>
    Boolean(
      loaded() &&
        draft() &&
        (loaded()!.name !== draft()!.name ||
          (loaded()!.description ?? "") !== (draft()!.description ?? "") ||
          loaded()!.access_mode !== draft()!.access_mode),
    );
  const runtimeDirty = () =>
    Boolean(
      loaded() &&
        draft() &&
        stable({
          parameters: loaded()!.parameters ?? {},
          runtime: loaded()!.runtime,
        }) !==
          stable({
            parameters: draft()!.parameters ?? {},
            runtime: draft()!.runtime,
          }),
    );
  const dirtyCount = () => Number(metadataDirty()) + Number(runtimeDirty());
  const stopped = () => draft()?.observed_state === "stopped";
  const runtimeConfigurationEditable = () =>
    ["host", "container", "compose"].includes(draft()?.deployment ?? "");
  const currentContainer = (): ContainerSettings | null => {
    const value = draft();
    if (!value) return null;
    if (value.deployment === "container")
      return value.runtime.container ?? null;
    if (value.deployment === "compose")
      return value.runtime.compose?.[composeService()] ?? null;
    return null;
  };
  const loadedContainer = (): ContainerSettings | null => {
    const value = loaded();
    if (!value) return null;
    if (value.deployment === "container")
      return value.runtime.container ?? null;
    if (value.deployment === "compose")
      return value.runtime.compose?.[composeService()] ?? null;
    return null;
  };
  const managedMountLocked = (resourceID: string) =>
    Boolean(
      loadedContainer()?.mounts?.some(
        (mount) =>
          mount.resource_id === resourceID &&
          (mount.type === "volume" || mount.type === "workspace"),
      ),
    );
  const updateContainer = (mutate: (value: ContainerSettings) => void) => {
    const next = clone(draft());
    if (!next) return;
    const value =
      next.deployment === "container"
        ? next.runtime.container
        : next.runtime.compose?.[composeService()];
    if (!value) return;
    mutate(value);
    setDraft(next);
    setPlan(null);
    setAcceptedRisks({});
  };
  const updateDraft = (
    mutate: (value: SettingsView) => void,
    runtime = true,
  ) => {
    const next = clone(draft());
    if (!next) return;
    mutate(next);
    setDraft(next);
    if (runtime) {
      setPlan(null);
      setAcceptedRisks({});
    }
  };

  const saveMetadata = async () => {
    const value = draft();
    if (!value || !value.name.trim() || !metadataDirty()) return;
    setSavingMetadata(true);
    setError("");
    try {
      const updated = await fetchLocalApiJSON<SettingsView>(
        `/_redeven_proxy/api/managed-web-services/${encodeURIComponent(props.serviceID)}/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: value.name.trim(),
            description: (value.description ?? "").trim(),
            access_mode: value.access_mode,
          }),
        },
      );
      setLoaded((current) =>
        current
          ? {
              ...current,
              name: updated.name,
              description: updated.description,
              access_mode: updated.access_mode,
            }
          : current,
      );
      setDraft((current) =>
        current
          ? {
              ...current,
              name: updated.name,
              description: updated.description,
              access_mode: updated.access_mode,
            }
          : current,
      );
      props.onChanged();
      notify.success(settingText("savedTitle"), settingText("detailsSaved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingMetadata(false);
    }
  };

  const preflight = async () => {
    const value = runtimeDraft();
    if (!value || !runtimeDirty()) return;
    setApplying(true);
    setError("");
    try {
      const next = await fetchLocalApiJSON<ReconfigurePlan>(
        `/_redeven_proxy/api/managed-web-services/${encodeURIComponent(props.serviceID)}/reconfigure/preflight`,
        { method: "POST", body: JSON.stringify(value) },
      );
      setPlan(next);
      setAcceptedRisks({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setApplying(false);
    }
  };

  const apply = async () => {
    const value = runtimeDraft();
    const checked = plan();
    if (!value || !checked) return;
    if ((checked.risks ?? []).some((risk) => !acceptedRisks()[risk.id])) return;
    setApplying(true);
    setError("");
    try {
      await props.onApply({
        draft: value,
        plan_digest: checked.plan_digest,
        accepted_risk_ids: (checked.risks ?? []).map((risk) => risk.id),
      });
      props.onChanged();
      props.onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setApplying(false);
    }
  };

  const resetSection = () => {
    const original = loaded();
    if (!original) return;
    const active = section();
    updateDraft((value) => {
      if (active === "general") {
        value.name = original.name;
        value.description = original.description;
        value.access_mode = original.access_mode;
      } else if (active === "parameters")
        value.parameters = clone(original.parameters ?? {});
      else if (active === "lifecycle")
        value.runtime.host = clone(original.runtime.host);
      else value.runtime = clone(original.runtime);
    }, active !== "general");
  };

  const openPathPicker = (resourceID: string) => {
    picker.reset();
    setPickerTarget({
      service: draft()?.deployment === "compose" ? composeService() : undefined,
      resourceID,
    });
    setPickerOpen(true);
    void picker.ensureRootLoaded();
  };

  const sectionVisible = (id: SectionID) => {
    if (id === "lifecycle") return draft()?.deployment === "host";
    if (id === "parameters") return runtimeConfigurationEditable();
    if (
      ["environment", "storage", "resources", "network", "security"].includes(
        id,
      )
    )
      return ["container", "compose"].includes(draft()?.deployment ?? "");
    return true;
  };

  const footer = () => (
    <div class="flex w-full flex-wrap items-center gap-2">
      <span class="mr-auto text-xs text-muted-foreground">
        {dirtyCount()
          ? settingText("unsavedCount", { count: dirtyCount() })
          : settingText("noUnsavedChanges")}
      </span>
      <Button
        size="sm"
        variant="ghost"
        class="cursor-pointer"
        onClick={resetSection}
        disabled={!dirtyCount() || loading()}
      >
        <Refresh class="mr-1.5 h-3.5 w-3.5" />
        {settingText("resetSection")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        class="cursor-pointer"
        onClick={() => {
          if (loaded()) setDraft(clone(loaded()));
          setPlan(null);
        }}
        disabled={!dirtyCount() || loading()}
      >
        {settingText("resetAll")}
      </Button>
      <Show when={metadataDirty()}>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void saveMetadata()}
          disabled={!props.canManage || savingMetadata()}
        >
          {settingText("saveDetails")}
        </Button>
      </Show>
      <Show when={runtimeDirty()}>
        <Show
          when={stopped()}
          fallback={
            <Button
              size="sm"
              variant="default"
              onClick={props.onRequestStop}
              disabled={!props.canManage}
            >
              {settingText("stopBeforeApply")}
            </Button>
          }
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => void preflight()}
            disabled={!props.canManage || applying()}
          >
            {settingText("preflight")}
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => void apply()}
            disabled={
              !props.canManage ||
              applying() ||
              !plan() ||
              (plan()?.risks ?? []).some((risk) => !acceptedRisks()[risk.id])
            }
          >
            {settingText("apply")}
          </Button>
        </Show>
      </Show>
    </div>
  );

  return (
    <>
      <EnvAppDrawer
        open={props.open}
        onOpenChange={(open) => {
          if (!applying() && !savingMetadata())
            props.onOpenChange(open);
        }}
        class="managed-service-settings-drawer"
        bodyClass="flex min-h-0 h-full flex-col"
        title={settingText("title", { name: props.serviceName })}
        description={settingText("description")}
        footer={footer()}
      >
        <Show
          when={!loading() && draft()}
          fallback={
            <div class="flex min-h-[20rem] items-center justify-center gap-2 text-sm text-muted-foreground">
              <ManagedServiceShapingOrb />
              <span>{settingText("loading")}</span>
            </div>
          }
        >
          {(resolved) => (
            <div
              class="flex min-h-0 flex-1 overflow-hidden"
              data-testid="managed-service-settings"
            >
              <nav
                class="w-40 shrink-0 border-r px-2 py-3"
                aria-label={settingText("sections")}
              >
                <For each={sections.filter(sectionVisible)}>
                  {(id) => (
                    <button
                      type="button"
                      class={cn(
                        "mb-0.5 flex h-8 w-full cursor-pointer items-center rounded-md px-2.5 text-left text-xs font-medium transition-colors",
                        section() === id
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                      onClick={() => setSection(id)}
                    >
                      {settingText(`section.${id}`)}
                    </button>
                  )}
                </For>
              </nav>
              <div class="min-w-0 flex-1 overflow-auto px-5 py-4">
                <Show when={resolved().deployment === "compose"}>
                  <div
                    class="mb-4 flex items-center gap-1 border-b pb-2"
                    role="tablist"
                    aria-label={settingText("composeServices")}
                  >
                    <For
                      each={Object.keys(
                        resolved().runtime.compose ?? {},
                      ).sort()}
                    >
                      {(name) => (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={composeService() === name}
                          onClick={() => setComposeService(name)}
                          class={cn(
                            "cursor-pointer rounded-md px-3 py-1.5 font-mono text-xs",
                            composeService() === name
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {name}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={error()}>
                  <div
                    class="mb-4 rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive"
                    role="alert"
                  >
                    {error()}
                  </div>
                </Show>

                <Show when={section() === "general"}>
                  <section class="max-w-3xl space-y-4">
                    <header>
                      <h3 class="text-sm font-semibold">
                        {sectionTitle("general")}
                      </h3>
                      <p class="mt-1 text-xs text-muted-foreground">
                        {settingText("generalHelp")}
                      </p>
                    </header>
                    <div class="grid gap-4 sm:grid-cols-2">
                      <label>
                        <span class="mb-1 block text-xs font-medium">
                          {settingText("name")}{" "}
                          <span class="text-destructive">*</span>
                        </span>
                        <Input
                          value={resolved().name}
                          maxlength={80}
                          onInput={(event) =>
                            updateDraft((value) => {
                              value.name = event.currentTarget.value;
                            }, false)
                          }
                        />
                        <span class="mt-1 block min-h-4 text-[11px] text-muted-foreground">
                          {settingText("nameHelp")}
                        </span>
                      </label>
                      <label>
                        <span class="mb-1 block text-xs font-medium">
                          {settingText("accessMode")}
                        </span>
                        <select
                          class="h-9 w-full cursor-pointer rounded-md border bg-background px-2 text-xs"
                          value={resolved().access_mode}
                          onChange={(event) =>
                            updateDraft((value) => {
                              value.access_mode = event.currentTarget
                                .value as AccessMode;
                            }, false)
                          }
                        >
                          <option value="unified_proxy">
                            {settingText("unifiedProxy")}
                          </option>
                          <option value="desktop_loopback">
                            {settingText("desktopLoopback")}
                          </option>
                        </select>
                        <span class="mt-1 block min-h-4 text-[11px] text-muted-foreground">
                          {settingText("accessModeHelp")}
                        </span>
                      </label>
                    </div>
                    <label class="block">
                      <span class="mb-1 block text-xs font-medium">
                        {settingText("serviceDescription")}
                      </span>
                      <Textarea
                        rows={4}
                        value={resolved().description ?? ""}
                        maxlength={4000}
                        onInput={(event) =>
                          updateDraft((value) => {
                            value.description = event.currentTarget.value;
                          }, false)
                        }
                      />
                      <span class="mt-1 block min-h-4 text-[11px] text-muted-foreground">
                        {settingText("descriptionHelp")}
                      </span>
                    </label>
                    <For
                      each={resolved().locked?.filter(
                        (item) =>
                          item.path === "runtime.identity" ||
                          item.path === "runtime.image" ||
                          (!runtimeConfigurationEditable() &&
                            item.duplicate_to_edit),
                      )}
                    >
                      {(item) => (
                        <div class="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2">
                          <Lock class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <div class="min-w-0">
                            <div class="text-xs font-medium">{item.path}</div>
                            <p class="mt-0.5 text-[11px] text-muted-foreground">
                              {item.reason}
                            </p>
                            <Show when={item.duplicate_to_edit}>
                              <Button
                                size="sm"
                                variant="ghost"
                                class="mt-1 h-auto cursor-pointer p-0 text-xs text-primary hover:bg-transparent"
                                onClick={props.onDuplicateTemplate}
                              >
                                {settingText("duplicateToEdit")}
                              </Button>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </section>
                </Show>

                <Show when={section() === "parameters"}>
                  <section class="max-w-4xl space-y-5">
                    <header>
                      <h3 class="text-sm font-semibold">
                        {settingText("section.parameters")}
                      </h3>
                      <p class="mt-1 text-xs text-muted-foreground">
                        {settingText("parametersHelp")}
                      </p>
                    </header>
                    <Show when={currentContainer()} keyed>
                      {(container) => (
                        <div class="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
                          <label>
                            <span class="mb-1 block text-xs font-medium">
                              {settingText("entrypoint")}
                            </span>
                            <Input
                              class="h-8 font-mono text-xs"
                              value={container.entrypoint ?? ""}
                              placeholder="/usr/local/bin/start"
                              onInput={(event) =>
                                updateContainer((value) => {
                                  value.entrypoint = event.currentTarget.value;
                                })
                              }
                            />
                          </label>
                          <label>
                            <span class="mb-1 block text-xs font-medium">
                              {settingText("restartPolicy")}
                            </span>
                            <select
                              class="h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs"
                              value={container.restart_policy ?? "no"}
                              onChange={(event) =>
                                updateContainer((value) => {
                                  value.restart_policy =
                                    event.currentTarget.value;
                                })
                              }
                            >
                              <option value="no">no</option>
                              <option value="unless-stopped">
                                unless-stopped
                              </option>
                              <option value="always">always</option>
                              <option value="on-failure">on-failure</option>
                            </select>
                          </label>
                          <div class="sm:col-span-2">
                            <TextListField
                              label={settingText("commandArguments")}
                              value={container.command}
                              placeholder={"--listen\n0.0.0.0"}
                              onInput={(value) =>
                                updateContainer((next) => {
                                  next.command = value;
                                })
                              }
                            />
                          </div>
                        </div>
                      )}
                    </Show>
                    <div>
                      <div class="mb-2 flex items-center justify-between">
                        <h4 class="text-xs font-semibold">
                          {settingText("templateParameters")}
                        </h4>
                      </div>
                      <div class="divide-y overflow-hidden rounded-lg border">
                        <For each={Object.entries(resolved().parameters ?? {})}>
                          {([name, value]) => (
                            <div class="grid grid-cols-[minmax(10rem,0.7fr)_1fr] items-center gap-3 px-3 py-2">
                              <code class="truncate text-xs">{name}</code>
                              <Input
                                class="h-8"
                                value={value}
                                onInput={(event) =>
                                  updateDraft((next) => {
                                    next.parameters = {
                                      ...(next.parameters ?? {}),
                                      [name]: event.currentTarget.value,
                                    };
                                  })
                                }
                              />
                            </div>
                          )}
                        </For>
                        <Show
                          when={
                            Object.keys(resolved().parameters ?? {}).length ===
                            0
                          }
                        >
                          <p class="px-3 py-6 text-center text-xs text-muted-foreground">
                            {settingText("noParameters")}
                          </p>
                        </Show>
                      </div>
                    </div>
                    <Show when={currentContainer()} keyed>
                      {(container) => (
                        <div>
                          <div class="mb-2 flex items-center justify-between">
                            <h4 class="text-xs font-semibold">
                              {settingText("labels")}
                            </h4>
                            <Button
                              size="sm"
                              variant="outline"
                              class="cursor-pointer"
                              onClick={() =>
                                updateContainer((value) => {
                                  value.labels = {
                                    ...(value.labels ?? {}),
                                    "": "",
                                  };
                                })
                              }
                            >
                              <Plus class="mr-1 h-3.5 w-3.5" />
                              {settingText("addLabel")}
                            </Button>
                          </div>
                          <div class="space-y-2">
                            <For each={Object.entries(container.labels ?? {})}>
                              {([name, value]) => (
                                <div class="grid grid-cols-[1fr_1fr_auto] gap-2">
                                  <Input
                                    class="h-8 font-mono text-xs"
                                    value={name}
                                    placeholder="com.example.role"
                                    onInput={(event) =>
                                      updateContainer((next) => {
                                        const labels = {
                                          ...(next.labels ?? {}),
                                        };
                                        delete labels[name];
                                        labels[event.currentTarget.value] =
                                          value;
                                        next.labels = labels;
                                      })
                                    }
                                  />
                                  <Input
                                    class="h-8 font-mono text-xs"
                                    value={value}
                                    placeholder={settingText("labelValue")}
                                    onInput={(event) =>
                                      updateContainer((next) => {
                                        next.labels = {
                                          ...(next.labels ?? {}),
                                          [name]: event.currentTarget.value,
                                        };
                                      })
                                    }
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    class="h-8 w-8 cursor-pointer px-0"
                                    aria-label={settingText("remove")}
                                    onClick={() =>
                                      updateContainer((next) => {
                                        const labels = {
                                          ...(next.labels ?? {}),
                                        };
                                        delete labels[name];
                                        next.labels = labels;
                                      })
                                    }
                                  >
                                    <Trash class="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      )}
                    </Show>
                  </section>
                </Show>

                <Show
                  when={section() === "environment" && currentContainer()}
                  keyed
                >
                  {(container) => (
                    <section class="max-w-4xl">
                      <header class="flex items-end justify-between gap-3">
                        <div>
                          <h3 class="text-sm font-semibold">
                            {settingText("section.environment")}
                          </h3>
                          <p class="mt-1 text-xs text-muted-foreground">
                            {settingText("environmentHelp")}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          class="cursor-pointer"
                          onClick={() =>
                            updateContainer((value) => {
                              value.environment = [
                                ...(value.environment ?? []),
                                { name: "", value: "" },
                              ];
                            })
                          }
                        >
                          <Plus class="mr-1 h-3.5 w-3.5" />
                          {settingText("addVariable")}
                        </Button>
                      </header>
                      <div class="mt-4 space-y-2">
                        <For each={container.environment ?? []}>
                          {(item, index) => (
                            <div class="grid grid-cols-[minmax(8rem,0.65fr)_minmax(10rem,1fr)_auto_auto] items-center gap-2">
                              <Input
                                class="h-8 font-mono text-xs"
                                value={item.name}
                                placeholder="API_BASE_URL"
                                onInput={(event) =>
                                  updateContainer((value) => {
                                    value.environment![index()].name =
                                      event.currentTarget.value;
                                  })
                                }
                              />
                              <Input
                                class="h-8 font-mono text-xs"
                                type={item.secret ? "password" : "text"}
                                value={item.value ?? ""}
                                placeholder={
                                  item.secret && item.has_value
                                    ? settingText("secretConfigured")
                                    : settingText("variableValue")
                                }
                                onInput={(event) =>
                                  updateContainer((value) => {
                                    value.environment![index()].value =
                                      event.currentTarget.value;
                                    value.environment![index()].clear = false;
                                  })
                                }
                              />
                              <label class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs">
                                <Checkbox
                                  checked={Boolean(item.secret)}
                                  onChange={(checked) =>
                                    updateContainer((value) => {
                                      value.environment![index()].secret =
                                        checked;
                                      value.environment![index()].value = "";
                                    })
                                  }
                                />
                                {settingText("secret")}
                              </label>
                              <Button
                                size="sm"
                                variant="ghost"
                                class="h-8 w-8 cursor-pointer px-0"
                                aria-label={settingText("remove")}
                                onClick={() =>
                                  updateContainer((value) => {
                                    value.environment =
                                      value.environment!.filter(
                                        (_, position) => position !== index(),
                                      );
                                  })
                                }
                              >
                                <Trash class="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </Show>

                <Show
                  when={section() === "storage" && currentContainer()}
                  keyed
                >
                  {(container) => (
                    <section class="max-w-5xl">
                      <header class="flex items-end justify-between">
                        <div>
                          <h3 class="text-sm font-semibold">
                            {settingText("section.storage")}
                          </h3>
                          <p class="mt-1 text-xs text-muted-foreground">
                            {settingText("storageHelp")}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          class="cursor-pointer"
                          disabled={resolved().template_source === "builtin"}
                          onClick={() =>
                            updateContainer((value) => {
                              value.mounts = [
                                ...(value.mounts ?? []),
                                {
                                  resource_id: `mount-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
                                  type: "bind",
                                  source: "",
                                  target: "/data",
                                },
                              ];
                            })
                          }
                        >
                          <Plus class="mr-1 h-3.5 w-3.5" />
                          {settingText("addMount")}
                        </Button>
                      </header>
                      <div class="mt-4 overflow-hidden rounded-lg border">
                        <For each={container.mounts ?? []}>
                          {(mount, index) => (
                            <div class="grid grid-cols-[7rem_minmax(9rem,1fr)_minmax(8rem,0.8fr)_auto_auto] items-center gap-2 border-b px-3 py-2 last:border-b-0">
                              <select
                                class="h-8 cursor-pointer rounded-md border bg-background px-2 text-xs"
                                value={mount.type}
                                disabled={managedMountLocked(
                                  mount.resource_id,
                                )}
                                onChange={(event) =>
                                  updateContainer((value) => {
                                    const nextType = event.currentTarget
                                      .value as MountSetting["type"];
                                    const next = value.mounts![index()];
                                    next.type = nextType;
                                    next.source =
                                      nextType === "volume"
                                        ? `service-${next.resource_id}`
                                        : "";
                                    next.tmpfs_options =
                                      nextType === "tmpfs"
                                        ? [
                                            "rw",
                                            "noexec",
                                            "nosuid",
                                            "nodev",
                                            "size=536870912",
                                          ]
                                        : undefined;
                                  })
                                }
                              >
                                <option value="workspace">workspace</option>
                                <option value="bind">bind</option>
                                <option value="volume">volume</option>
                                <option value="tmpfs">tmpfs</option>
                              </select>
                              <div class="flex min-w-0 items-center gap-1">
                                <Input
                                  class="h-8 min-w-0 font-mono text-xs"
                                  value={
                                    mount.type === "tmpfs"
                                      ? (mount.tmpfs_options ?? []).join(",")
                                      : (mount.source ?? "")
                                  }
                                  disabled={
                                    mount.type === "workspace" ||
                                    managedMountLocked(mount.resource_id)
                                  }
                                  placeholder={
                                    mount.type === "bind"
                                      ? "/host/path"
                                      : mount.type === "volume"
                                        ? "service-data"
                                        : mount.type === "tmpfs"
                                          ? "rw,noexec,nosuid,nodev,size=536870912"
                                          : mount.resource_id
                                  }
                                  onInput={(event) =>
                                    updateContainer((value) => {
                                      const next = value.mounts![index()];
                                      if (next.type === "tmpfs") {
                                        next.tmpfs_options = event.currentTarget.value
                                          .split(",")
                                          .map((item) => item.trim())
                                          .filter(Boolean);
                                      } else {
                                        next.source = event.currentTarget.value;
                                      }
                                    })
                                  }
                                />
                                <Show when={mount.type === "bind"}>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    class="h-8 w-8 shrink-0 cursor-pointer px-0"
                                    onClick={() =>
                                      openPathPicker(mount.resource_id)
                                    }
                                  >
                                    <FolderOpen class="h-3.5 w-3.5" />
                                  </Button>
                                </Show>
                              </div>
                              <Input
                                class="h-8 font-mono text-xs"
                                value={mount.target}
                                disabled={managedMountLocked(
                                  mount.resource_id,
                                )}
                                placeholder="/workspace"
                                onInput={(event) =>
                                  updateContainer((value) => {
                                    value.mounts![index()].target =
                                      event.currentTarget.value;
                                  })
                                }
                              />
                              <label class="flex cursor-pointer items-center gap-1 text-xs">
                                <Checkbox
                                  checked={Boolean(mount.read_only)}
                                  onChange={(checked) =>
                                    updateContainer((value) => {
                                      value.mounts![index()].read_only =
                                        checked;
                                    })
                                  }
                                />
                                RO
                              </label>
                              <Button
                                size="sm"
                                variant="ghost"
                                class="h-8 w-8 cursor-pointer px-0"
                                disabled={
                                  managedMountLocked(mount.resource_id)
                                }
                                onClick={() =>
                                  updateContainer((value) => {
                                    value.mounts = value.mounts!.filter(
                                      (_, position) => position !== index(),
                                    );
                                  })
                                }
                              >
                                <Trash class="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </Show>

                <Show
                  when={section() === "resources" && currentContainer()}
                  keyed
                >
                  {(container) => (
                    <section class="max-w-3xl">
                      <header>
                        <h3 class="text-sm font-semibold">
                          {settingText("section.resources")}
                        </h3>
                        <p class="mt-1 text-xs text-muted-foreground">
                          {settingText("resourcesHelp")}
                        </p>
                      </header>
                      <div class="mt-4 grid gap-4 sm:grid-cols-2">
                        <NumberField
                          label={settingText("cpus")}
                          value={container.cpus}
                          step="0.25"
                          onInput={(value) =>
                            updateContainer((next) => {
                              next.cpus = value;
                            })
                          }
                        />
                        <NumberField
                          label={settingText("memoryBytes")}
                          value={container.memory_bytes}
                          onInput={(value) =>
                            updateContainer((next) => {
                              next.memory_bytes = value;
                            })
                          }
                        />
                        <NumberField
                          label={settingText("pidsLimit")}
                          value={container.pids_limit}
                          onInput={(value) =>
                            updateContainer((next) => {
                              next.pids_limit = value;
                            })
                          }
                        />
                        <NumberField
                          label={settingText("sharedMemoryBytes")}
                          value={container.shm_size_bytes}
                          onInput={(value) =>
                            updateContainer((next) => {
                              next.shm_size_bytes = value;
                            })
                          }
                        />
                      </div>
                    </section>
                  )}
                </Show>

                <Show
                  when={section() === "network" && currentContainer()}
                  keyed
                >
                  {(container) => (
                    <section class="max-w-5xl">
                      <header>
                        <h3 class="text-sm font-semibold">
                          {settingText("section.network")}
                        </h3>
                        <p class="mt-1 text-xs text-muted-foreground">
                          {settingText("networkHelp")}
                        </p>
                      </header>
                      <div class="mt-4 grid gap-4 sm:grid-cols-3">
                        <label class="text-xs">
                          {settingText("networkMode")}
                          <Input
                            class="mt-1 h-8 font-mono"
                            value={container.network_mode ?? ""}
                            disabled={resolved().template_source === "builtin"}
                            placeholder="bridge"
                            onInput={(event) =>
                              updateContainer((value) => {
                                value.network_mode = event.currentTarget.value;
                              })
                            }
                          />
                        </label>
                        <label class="text-xs">
                          {settingText("pidMode")}
                          <Input
                            class="mt-1 h-8 font-mono"
                            value={container.pid_mode ?? ""}
                            disabled={resolved().template_source === "builtin"}
                            placeholder="private"
                            onInput={(event) =>
                              updateContainer((value) => {
                                value.pid_mode = event.currentTarget.value;
                              })
                            }
                          />
                        </label>
                        <label class="text-xs">
                          {settingText("ipcMode")}
                          <Input
                            class="mt-1 h-8 font-mono"
                            value={container.ipc_mode ?? ""}
                            disabled={resolved().template_source === "builtin"}
                            placeholder="private"
                            onInput={(event) =>
                              updateContainer((value) => {
                                value.ipc_mode = event.currentTarget.value;
                              })
                            }
                          />
                        </label>
                      </div>
                      <div class="mt-5 flex items-center justify-between">
                        <h4 class="text-xs font-semibold">
                          {settingText("additionalPorts")}
                        </h4>
                        <Button
                          size="sm"
                          variant="outline"
                          class="cursor-pointer"
                          disabled={resolved().template_source === "builtin"}
                          onClick={() =>
                            updateContainer((value) => {
                              value.ports = [
                                ...(value.ports ?? []),
                                {
                                  resource_id: `port-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
                                  container_port: 3000,
                                  host_port: 0,
                                  host_ip: "127.0.0.1",
                                  protocol: "tcp",
                                },
                              ];
                            })
                          }
                        >
                          <Plus class="mr-1 h-3.5 w-3.5" />
                          {settingText("addPort")}
                        </Button>
                      </div>
                      <div class="mt-2 space-y-2">
                        <For each={container.ports ?? []}>
                          {(port, index) => (
                            <div class="grid grid-cols-[1fr_1fr_1fr_6rem_auto] gap-2">
                              <Input
                                class="h-8 font-mono text-xs"
                                value={port.host_ip ?? ""}
                                placeholder="127.0.0.1"
                                onInput={(event) =>
                                  updateContainer((value) => {
                                    value.ports![index()].host_ip =
                                      event.currentTarget.value;
                                  })
                                }
                              />
                              <Input
                                class="h-8 font-mono text-xs"
                                type="number"
                                value={port.host_port ?? 0}
                                onInput={(event) =>
                                  updateContainer((value) => {
                                    value.ports![index()].host_port = Number(
                                      event.currentTarget.value,
                                    );
                                  })
                                }
                              />
                              <Input
                                class="h-8 font-mono text-xs"
                                type="number"
                                value={port.container_port}
                                onInput={(event) =>
                                  updateContainer((value) => {
                                    value.ports![index()].container_port =
                                      Number(event.currentTarget.value);
                                  })
                                }
                              />
                              <select
                                class="h-8 cursor-pointer rounded-md border bg-background px-2 text-xs"
                                value={port.protocol ?? "tcp"}
                                onChange={(event) =>
                                  updateContainer((value) => {
                                    value.ports![index()].protocol = event
                                      .currentTarget.value as "tcp" | "udp";
                                  })
                                }
                              >
                                <option>tcp</option>
                                <option>udp</option>
                              </select>
                              <Button
                                size="sm"
                                variant="ghost"
                                class="h-8 w-8 cursor-pointer px-0"
                                onClick={() =>
                                  updateContainer((value) => {
                                    value.ports = value.ports!.filter(
                                      (_, position) => position !== index(),
                                    );
                                  })
                                }
                              >
                                <Trash class="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </Show>

                <Show
                  when={section() === "security" && currentContainer()}
                  keyed
                >
                  {(container) => (
                    <section class="max-w-4xl">
                      <header>
                        <h3 class="text-sm font-semibold">
                          {settingText("section.security")}
                        </h3>
                        <p class="mt-1 text-xs text-muted-foreground">
                          {settingText("securityHelp")}
                        </p>
                      </header>
                      <div class="mt-4 grid gap-3 sm:grid-cols-2">
                        <label class="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs">
                          <Checkbox
                            checked={Boolean(container.privileged)}
                            disabled={resolved().template_source === "builtin"}
                            onChange={(checked) =>
                              updateContainer((value) => {
                                value.privileged = checked;
                              })
                            }
                          />
                          {settingText("privileged")}
                        </label>
                        <label class="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs">
                          <Checkbox
                            checked={container.read_only_root}
                            disabled={resolved().template_source === "builtin"}
                            onChange={(checked) =>
                              updateContainer((value) => {
                                value.read_only_root = checked;
                              })
                            }
                          />
                          {settingText("readOnlyRoot")}
                        </label>
                        <label class="sm:col-span-2">
                          <span class="mb-1 block text-xs">
                            {settingText("containerUser")}
                          </span>
                          <Input
                            class="h-8 font-mono text-xs"
                            value={container.user ?? ""}
                            placeholder="1000:1000"
                            onInput={(event) =>
                              updateContainer((value) => {
                                value.user = event.currentTarget.value;
                              })
                            }
                          />
                        </label>
                        <TextListField
                          label={settingText("capAdd")}
                          value={container.cap_add}
                          disabled={resolved().template_source === "builtin"}
                          placeholder="NET_ADMIN"
                          onInput={(value) =>
                            updateContainer((next) => {
                              next.cap_add = value;
                            })
                          }
                        />
                        <TextListField
                          label={settingText("capDrop")}
                          value={container.cap_drop}
                          disabled={resolved().template_source === "builtin"}
                          placeholder="ALL"
                          onInput={(value) =>
                            updateContainer((next) => {
                              next.cap_drop = value;
                            })
                          }
                        />
                        <TextListField
                          label={settingText("securityOptions")}
                          value={container.security_opts}
                          disabled={resolved().template_source === "builtin"}
                          placeholder="no-new-privileges:true"
                          onInput={(value) =>
                            updateContainer((next) => {
                              next.security_opts = value;
                            })
                          }
                        />
                      </div>
                      <div class="mt-5">
                        <div class="mb-2 flex items-center justify-between">
                          <h4 class="text-xs font-semibold">
                            {settingText("devices")}
                          </h4>
                          <Button
                            size="sm"
                            variant="outline"
                            class="cursor-pointer"
                            disabled={resolved().template_source === "builtin"}
                            onClick={() =>
                              updateContainer((value) => {
                                value.devices = [
                                  ...(value.devices ?? []),
                                  {
                                    resource_id: `device-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
                                    host_path: "",
                                    container_path: "",
                                    permissions: "rwm",
                                  },
                                ];
                              })
                            }
                          >
                            <Plus class="mr-1 h-3.5 w-3.5" />
                            {settingText("addDevice")}
                          </Button>
                        </div>
                        <div class="space-y-2">
                          <For each={container.devices ?? []}>
                            {(device, index) => (
                              <div class="grid grid-cols-[1fr_1fr_6rem_auto] gap-2">
                                <Input
                                  class="h-8 font-mono text-xs"
                                  value={device.host_path}
                                  placeholder="/dev/dri"
                                  disabled={
                                    resolved().template_source === "builtin"
                                  }
                                  onInput={(event) =>
                                    updateContainer((value) => {
                                      value.devices![index()].host_path =
                                        event.currentTarget.value;
                                    })
                                  }
                                />
                                <Input
                                  class="h-8 font-mono text-xs"
                                  value={device.container_path}
                                  placeholder="/dev/dri"
                                  disabled={
                                    resolved().template_source === "builtin"
                                  }
                                  onInput={(event) =>
                                    updateContainer((value) => {
                                      value.devices![index()].container_path =
                                        event.currentTarget.value;
                                    })
                                  }
                                />
                                <Input
                                  class="h-8 font-mono text-xs"
                                  value={device.permissions ?? "rwm"}
                                  placeholder="rwm"
                                  disabled={
                                    resolved().template_source === "builtin"
                                  }
                                  onInput={(event) =>
                                    updateContainer((value) => {
                                      value.devices![index()].permissions =
                                        event.currentTarget.value;
                                    })
                                  }
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  class="h-8 w-8 cursor-pointer px-0"
                                  disabled={
                                    resolved().template_source === "builtin"
                                  }
                                  onClick={() =>
                                    updateContainer((value) => {
                                      value.devices = value.devices!.filter(
                                        (_, position) => position !== index(),
                                      );
                                    })
                                  }
                                >
                                  <Trash class="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                      <Show when={resolved().template_source === "builtin"}>
                        <div class="mt-4 flex items-start gap-2 rounded-md border border-warning/25 bg-warning/[0.05] px-3 py-2">
                          <Lock class="mt-0.5 h-3.5 w-3.5 text-warning" />
                          <div>
                            <p class="text-xs font-medium">
                              {settingText("builtInSecurityLocked")}
                            </p>
                            <p class="mt-0.5 text-[11px] text-muted-foreground">
                              {settingText("builtInSecurityLockedHelp")}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="mt-1 h-auto cursor-pointer p-0 text-xs text-primary hover:bg-transparent"
                              onClick={props.onDuplicateTemplate}
                            >
                              {settingText("duplicateToEdit")}
                            </Button>
                          </div>
                        </div>
                      </Show>
                    </section>
                  )}
                </Show>

                <Show
                  when={section() === "lifecycle" && resolved().runtime.host}
                  keyed
                >
                  {(host) => (
                    <section class="flex h-full min-h-[32rem] max-w-5xl flex-col">
                      <header>
                        <h3 class="text-sm font-semibold">
                          {settingText("section.lifecycle")}
                        </h3>
                        <p class="mt-1 text-xs text-muted-foreground">
                          {resolved().template_source === "builtin"
                            ? settingText("lifecycleLockedHelp")
                            : settingText("lifecycleHelp")}
                        </p>
                      </header>
                      <div class="mt-4 flex gap-1 border-b pb-2">
                        <For
                          each={
                            [
                              "install_script",
                              "start_script",
                              "stop_script",
                              "uninstall_script",
                            ] as Array<keyof HostSettings>
                          }
                        >
                          {(name) => (
                            <button
                              type="button"
                              class={cn(
                                "cursor-pointer rounded-md px-3 py-1.5 text-xs",
                                scriptName() === name
                                  ? "bg-accent text-foreground"
                                  : "text-muted-foreground",
                              )}
                              onClick={() => setScriptName(name)}
                            >
                              {settingText(name)}
                            </button>
                          )}
                        </For>
                      </div>
                      <div class="mt-3 min-h-[22rem] flex-1 overflow-hidden rounded-md border">
                        <Show
                          when={resolved().template_source !== "builtin"}
                          fallback={
                            <pre class="h-full overflow-auto p-3 font-mono text-xs text-muted-foreground">
                              {host[scriptName()] ?? ""}
                            </pre>
                          }
                        >
                          <ErrorBoundary
                            fallback={
                              <Textarea
                                class="h-full min-h-[22rem] font-mono text-xs"
                                value={host[scriptName()] ?? ""}
                                onInput={(event) =>
                                  updateDraft((value) => {
                                    if (value.runtime.host)
                                      value.runtime.host[scriptName()] =
                                        event.currentTarget.value;
                                  })
                                }
                              />
                            }
                          >
                            <Suspense
                              fallback={
                                <div class="p-4 text-xs text-muted-foreground">
                                  {settingText("editorLoading")}
                                </div>
                              }
                            >
                              <CodeEditor
                                path={`managed-service-${props.serviceID}-${scriptName()}.sh`}
                                language="shell"
                                value={host[scriptName()] ?? ""}
                                options={{
                                  wordWrap: "on",
                                  minimap: { enabled: false },
                                  lineNumbers: "on",
                                }}
                                runtimeOptions={
                                  { profile: "editor_full" } as NonNullable<
                                    CodeEditorProps["runtimeOptions"]
                                  >
                                }
                                onChange={(value: string) =>
                                  updateDraft((next) => {
                                    if (next.runtime.host)
                                      next.runtime.host[scriptName()] = value;
                                  })
                                }
                                class="h-full"
                              />
                            </Suspense>
                          </ErrorBoundary>
                        </Show>
                      </div>
                    </section>
                  )}
                </Show>

                <Show when={plan()} keyed>
                  {(checked) => (
                    <section class="mt-6 max-w-4xl rounded-lg border px-4 py-3">
                      <div class="flex items-center gap-2">
                        <ManagedServiceShapingOrb running={false} />
                        <h3 class="text-xs font-semibold">
                          {settingText("preflightReady")}
                        </h3>
                      </div>
                      <p class="mt-1 text-[11px] text-muted-foreground">
                        {settingText("preflightReadyHelp")}
                      </p>
                      <For each={checked.risks ?? []}>
                        {(risk) => (
                          <label class="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-warning/25 bg-warning/[0.04] px-3 py-2">
                            <Checkbox
                              checked={Boolean(acceptedRisks()[risk.id])}
                              onChange={(accepted) =>
                                setAcceptedRisks((current) => ({
                                  ...current,
                                  [risk.id]: accepted,
                                }))
                              }
                            />
                            <span>
                              <span class="flex items-center gap-1.5 text-xs font-medium">
                                <AlertTriangle class="h-3.5 w-3.5 text-warning" />
                                {risk.title}
                              </span>
                              <span class="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                                {risk.description}
                              </span>
                            </span>
                          </label>
                        )}
                      </For>
                    </section>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>
      </EnvAppDrawer>
      <DirectoryPicker
        open={pickerOpen()}
        onOpenChange={setPickerOpen}
        files={picker.files()}
        initialPath="/"
        homePath="/"
        title={settingText("selectDirectory")}
        confirmText={settingText("choose")}
        cancelText={settingText("cancel")}
        onExpand={picker.expandPath}
        ensurePath={picker.ensurePath}
        onSelect={(path) => {
          const target = pickerTarget();
          if (!target) return;
          updateContainer((value) => {
            const mount = value.mounts?.find(
              (item) => item.resource_id === target.resourceID,
            );
            if (mount) mount.source = path;
          });
          setPickerOpen(false);
        }}
      />
    </>
  );
}
