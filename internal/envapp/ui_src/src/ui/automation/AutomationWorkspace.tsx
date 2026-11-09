import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import {
  Plus,
  Play,
  Pause,
  Clock,
  GitBranch,
  Bot,
  FileText,
  ChevronLeft,
  X,
  Check,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-solid";
import { useI18n } from "../i18n";
import {
  request,
  layoutNodes,
  descendants,
  latestAttempts,
  reportDocument,
  base,
  type Workflow,
  type Definition,
  type FlowNode,
  type Run,
  type RunSummary,
  type Schedule,
} from "./api";
import { readUIStorageJSON, writeUIStorageJSON } from "../services/uiStorage";
import { fetchSessionHTTP } from "../services/sessionHTTP";
import { LocalApiError, readApiJSONResponse } from "../services/localApi";
import "./automation.css";
import { starterDefinition, type Starter } from "./templates";
import { automationText } from "./messages";

export type AutomationWorkspaceProps = {
  canWrite: boolean;
  storageKey: string;
  defaultDirectory?: string;
  selectDirectory?: (current: string, onSelect: (path: string) => void) => void;
  renderFlower?: (
    threadID: string,
    workflowID: string,
    onChanged: () => void,
  ) => JSX.Element;
};
const kinds: FlowNode["kind"][] = [
  "agent",
  "parallel",
  "tool",
  "condition",
  "join",
  "render",
  "deliver",
];
const terminal = (state: string) =>
  ["completed", "failed", "partial", "canceled"].includes(state);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function AutomationWorkspace(props: AutomationWorkspaceProps) {
  const i18n = useI18n(),
    t = (key: string) => automationText(i18n.locale(), key);
  const [flows, setFlows] = createSignal<Workflow[]>([]),
    [flow, setFlow] = createSignal<Workflow>(),
    [draft, setDraft] = createSignal<Definition>();
  const [options, setOptions] = createSignal<{
    models: { id: string; label?: string }[];
    default_directory: string;
  }>({ models: [], default_directory: props.defaultDirectory ?? "" });
  const [issues, setIssues] = createSignal<
    { node_id?: string; field: string; code: string }[]
  >([]);
  const [receipts, setReceipts] = createSignal<Record<string, unknown>>({});
  const [starter, setStarter] = createSignal<Starter>("blank");
  const [baseRevision, setBaseRevision] = createSignal(0);
  const [conflict, setConflict] = createSignal(false);
  const [reviewedWorkflow, setReviewedWorkflow] = createSignal<Workflow>();
  const [selected, setSelected] = createSignal(""),
    [search, setSearch] = createSignal(""),
    [tab, setTab] = createSignal("canvas");
  const [runs, setRuns] = createSignal<RunSummary[]>([]),
    [run, setRun] = createSignal<Run>(),
    [error, setError] = createSignal(""),
    [busy, setBusy] = createSignal(false);
  const [zoom, setZoom] = createSignal(1),
    [panel, setPanel] = createSignal<
      "schedule" | "grant" | "flower" | "reviewChanges" | ""
    >(""),
    [thread, setThread] = createSignal("");
  const [history, setHistory] = createSignal<Definition[]>([]),
    [future, setFuture] = createSignal<Definition[]>([]);
  const [jsonDrafts, setJSONDrafts] = createSignal<Record<string, string>>({}),
    [jsonErrors, setJSONErrors] = createSignal<Record<string, boolean>>({});
  const [schedule, setSchedule] = createSignal<Schedule>({
    id: "",
    revision: 0,
    enabled: false,
    cadence: {
      kind: "daily",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hour: 8,
      minute: 0,
    },
    overlap: "skip",
    missed: "latest",
    queue_limit: 1,
  });
  const [allowedTools, setAllowedTools] = createSignal(
      "web_search_pages, web_fetch",
    ),
    [expires, setExpires] = createSignal(
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    ),
    [requirement, setRequirement] = createSignal("");
  const [archiveConfirm, setArchiveConfirm] = createSignal(false);
  const [preview, setPreview] = createSignal<string[]>([]);
  const [scheduleHistory, setScheduleHistory] = createSignal<
    {
      id: string;
      scheduled_at: string;
      state: string;
      outcome?: string;
      reference?: string;
    }[]
  >([]);
  const node = createMemo(() =>
    draft()?.nodes.find((n) => n.id === selected()),
  );
  const dirty = createMemo(
    () =>
      JSON.stringify(flow()?.definition) !== JSON.stringify(draft()) ||
      Object.values(jsonErrors()).some(Boolean),
  );
  const graph = createMemo(() => layoutNodes(draft()?.nodes ?? []));
  const graphWidth = createMemo(() =>
      Math.max(700, ...graph().map((p) => p.x + 270)),
    ),
    graphHeight = createMemo(() =>
      Math.max(420, ...graph().map((p) => p.y + 150)),
    );
  const filtered = createMemo(() =>
    flows().filter((f) =>
      f.definition.title
        .toLocaleLowerCase()
        .includes(search().toLocaleLowerCase()),
    ),
  );
  let viewport: HTMLDivElement | undefined,
    disposed = false,
    refreshSequence = 0,
    runSelectionSequence = 0;
  const cacheKey = (id: string) => `${props.storageKey}:automation-draft:${id}`;
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : t("loadError"));
  const action = async (fn: () => Promise<void>) => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (
        !(
          conflict() &&
          e instanceof LocalApiError &&
          e.code === "AUTOMATION_CONFLICT"
        )
      )
        fail(e);
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  async function refreshList() {
    const items = await request<Workflow[]>("/workflows");
    if (!disposed) setFlows(items);
  }
  async function refreshRuns(id = flow()?.id) {
    if (!id) return;
    const list = await request<RunSummary[]>(`/workflows/${id}/runs`);
    if (flow()?.id !== id || disposed) return;
    setRuns(list);
    const active = run();
    if (
      active &&
      list.find((r) => r.id === active.id)?.revision !== active.revision
    ) {
      const updated = await request<Run>(`/runs/${active.id}`);
      if (
        !disposed &&
        flow()?.id === id &&
        run()?.id === active.id &&
        updated.revision >= (run()?.revision ?? 0)
      )
        setRun(updated);
    }
  }
  async function selectRun(id: string) {
    const sequence = ++runSelectionSequence;
    if (!id) {
      setRun(undefined);
      return;
    }
    const workflow = flow()?.id;
    const value = await request<Run>(`/runs/${id}`);
    if (
      !disposed &&
      sequence === runSelectionSequence &&
      flow()?.id === workflow
    )
      setRun(value);
  }
  async function open(item: Workflow) {
    const sequence = ++refreshSequence;
    runSelectionSequence++;
    setFlow(item);
    const cached = readUIStorageJSON(cacheKey(item.id), null) as {
      revision?: number;
      definition?: Definition;
    } | null;
    setBaseRevision(cached?.revision ?? item.revision);
    setDraft(clone(cached?.definition ?? item.definition));
    const openingDefinition = JSON.stringify(draft());
    setAllowedTools(item.plugin ? "" : "web_search_pages, web_fetch");
    setArchiveConfirm(false);
    setSelected((cached?.definition ?? item.definition).nodes[0]?.id ?? "");
    setHistory([]);
    setFuture([]);
    setJSONDrafts({});
    setJSONErrors({});
    setRun(undefined);
    setRuns([]);
    setThread("");
    setPanel("");
    setIssues([]);
    setReceipts({});
    setError("");
    setConflict(!!cached?.revision && cached.revision !== item.revision);
    setReviewedWorkflow(undefined);
    const latest = await request<Workflow>(`/workflows/${item.id}`);
    if (sequence !== refreshSequence || disposed) return;
    const editedDuringOpen = JSON.stringify(draft()) !== openingDefinition;
    setFlow(latest);
    if (!cached?.definition && !editedDuringOpen) {
      setBaseRevision(latest.revision);
      setDraft(clone(latest.definition));
    } else if (latest.revision !== baseRevision()) {
      setConflict(true);
    }
    await refreshRuns(item.id);
  }
  createEffect(() => {
    const current = flow(),
      value = draft();
    if (current && value && dirty())
      writeUIStorageJSON(cacheKey(current.id), {
        revision: baseRevision(),
        definition: value,
      });
  });
  function edit(change: (d: Definition) => void) {
    const current = draft();
    if (!current || !props.canWrite) return;
    setHistory((h) => [...h.slice(-49), clone(current)]);
    setFuture([]);
    const next = clone(current);
    change(next);
    setDraft(next);
  }
  const patchNode = (patch: Partial<FlowNode>) =>
    edit((d) => {
      const i = d.nodes.findIndex((n) => n.id === selected());
      if (i >= 0) d.nodes[i] = { ...d.nodes[i], ...patch };
    });
  function undo() {
    const h = history();
    if (!h.length) return;
    setFuture((f) => [clone(draft()!), ...f]);
    setDraft(h[h.length - 1]);
    setHistory(h.slice(0, -1));
    setJSONDrafts({});
    setJSONErrors({});
  }
  function redo() {
    const f = future();
    if (!f.length) return;
    setHistory((h) => [...h, clone(draft()!)]);
    setDraft(f[0]);
    setFuture(f.slice(1));
    setJSONDrafts({});
    setJSONErrors({});
  }
  async function save() {
    const current = flow(),
      value = draft();
    if (!current || !value) throw new Error(t("empty"));
    if (Object.values(jsonErrors()).some(Boolean))
      throw new Error(t("parameters"));
    if (conflict()) throw new Error(t("conflict"));
    let saved: Workflow;
    try {
      saved = await request<Workflow>(`/workflows/${current.id}/save`, {
        revision: baseRevision(),
        definition: value,
      });
    } catch (e) {
      if (e instanceof LocalApiError && e.code === "AUTOMATION_CONFLICT")
        setConflict(true);
      throw e;
    }
    if (disposed || flow()?.id !== current.id) return saved;
    const editedDuringSave = JSON.stringify(draft()) !== JSON.stringify(value);
    setFlow(saved);
    setBaseRevision(saved.revision);
    if (!editedDuringSave) {
      setDraft(clone(saved.definition));
      writeUIStorageJSON(cacheKey(saved.id), null);
    }
    await refreshList();
    return saved;
  }
  async function reviewChanges() {
    const id = flow()?.id;
    if (!id) return;
    const latest = await request<Workflow>(`/workflows/${id}`);
    if (disposed || flow()?.id !== id) return;
    setReviewedWorkflow(latest);
    setPanel("reviewChanges");
    setError("");
  }
  function resolveConflict(useSaved: boolean) {
    const latest = reviewedWorkflow();
    if (!latest || latest.id !== flow()?.id) return;
    if (useSaved) {
      setHistory((h) => [...h.slice(-49), clone(draft()!)]);
      setFuture([]);
      setDraft(clone(latest.definition));
      setJSONDrafts({});
      setJSONErrors({});
      if (!latest.definition.nodes.some((n) => n.id === selected()))
        setSelected(latest.definition.nodes[0]?.id ?? "");
      writeUIStorageJSON(cacheKey(latest.id), null);
    }
    setFlow(latest);
    setBaseRevision(latest.revision);
    setConflict(false);
    setReviewedWorkflow(undefined);
    setPanel("");
    setError("");
  }
  async function syncCurrent() {
    const id = flow()?.id;
    if (!id) return;
    const latest = await request<Workflow>(`/workflows/${id}`);
    if (disposed || flow()?.id !== id) return;
    if (latest.revision === flow()?.revision) return;
    if (dirty()) {
      setConflict(true);
      return;
    }
    setFlow(latest);
    setBaseRevision(latest.revision);
    setDraft(clone(latest.definition));
    await refreshList();
  }
  async function create() {
    const d = starterDefinition(
      starter(),
      t,
      options().models[0]?.id ?? "",
      options().default_directory,
    );
    const pendingKey = `${props.storageKey}:automation-pending-create`;
    const intent = (readUIStorageJSON(pendingKey, null) as {
      request_id: string;
      definition: Definition;
    } | null) ?? { request_id: crypto.randomUUID(), definition: d };
    writeUIStorageJSON(pendingKey, intent);
    const result = await request<Workflow>("/workflows", intent);
    writeUIStorageJSON(pendingKey, null);
    await refreshList();
    await open(result);
  }
  function add() {
    const id = `step_${crypto.randomUUID().slice(0, 8)}`;
    edit((d) =>
      d.nodes.push({
        id,
        title: t("node"),
        kind: "agent",
        depends_on: selected() ? [selected()] : [],
        instruction: t("instruction"),
      }),
    );
    setSelected(id);
  }
  function remove() {
    const id = selected();
    edit((d) => {
      d.nodes = d.nodes
        .filter((n) => n.id !== id)
        .map((n) => ({
          ...n,
          depends_on: n.depends_on.filter((p) => p !== id),
          ...(n.items_from === id ? { items_from: "" } : {}),
          ...(n.condition?.node_id === id
            ? { condition: { ...n.condition, node_id: "" } }
            : {}),
        }));
    });
    setSelected(draft()?.nodes[0]?.id ?? "");
  }
  function setKind(kind: FlowNode["kind"]) {
    const original = node();
    if (!original) return;
    const base: FlowNode = {
      id: original.id,
      title: original.title,
      kind,
      depends_on: original.depends_on,
    };
    if (kind === "agent" || kind === "parallel")
      base.instruction = original.instruction ?? t("instruction");
    if (kind === "parallel") {
      base.items = [];
      base.concurrency = 2;
    }
    if (kind === "tool") {
      base.tool = "http_get";
      base.parameters = { url: "https://example.com" };
    }
    if (kind === "render")
      base.template =
        '<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;max-width:960px;margin:40px auto;line-height:1.6}</style></head><body><h1>{{.Title}}</h1><p>{{.ScheduledAt}}</p>{{range $step,$values := .Inputs}}<h2>{{$step}}</h2>{{range $values}}<pre>{{.}}</pre>{{end}}{{end}}</body></html>';
    if (kind === "deliver") {
      base.tool = "artifact.save";
      base.require_review = true;
    }
    if (kind === "condition")
      base.condition = {
        node_id: base.depends_on[0] ?? "",
        field: "ok",
        equals: true,
      };
    edit((d) => {
      d.nodes[d.nodes.findIndex((n) => n.id === base.id)] = base;
    });
    setJSONDrafts({});
    setJSONErrors({});
  }
  function jsonValue(field: string, value: unknown) {
    return (
      jsonDrafts()[`${selected()}:${field}`] ??
      JSON.stringify(value ?? {}, null, 2)
    );
  }
  function editJSON(field: string, value: string) {
    const key = `${selected()}:${field}`;
    setJSONDrafts((v) => ({ ...v, [key]: value }));
    try {
      const parsed = JSON.parse(value);
      patchNode({ [field]: parsed });
      setJSONErrors((v) => ({ ...v, [key]: false }));
    } catch {
      setJSONErrors((v) => ({ ...v, [key]: true }));
    }
  }
  async function openSchedule() {
    const id = flow()?.id;
    if (!id) return;
    const current = await request<Schedule | null>(`/workflows/${id}/schedule`);
    if (current) setSchedule(current);
    else setSchedule((s) => ({ ...s, id, revision: 0, enabled: false }));
    setPreview([]);
    setScheduleHistory(await request(`/workflows/${id}/schedule-history`));
    setPanel("schedule");
  }
  async function saveSchedule(enabled: boolean) {
    const f = flow();
    if (!f) return;
    if (!enabled) {
      await request(`/workflows/${f.id}/schedule-pause`, {});
      const paused = await request<Schedule | null>(
        `/workflows/${f.id}/schedule`,
      );
      if (paused) setSchedule(paused);
      return;
    }
    if (dirty() || f.published_revision !== f.revision)
      throw new Error(t("dirty"));
    const value = await request<Schedule>(`/workflows/${f.id}/schedule`, {
      revision: schedule().revision,
      cadence: schedule().cadence,
      overlap: schedule().overlap,
      missed: schedule().missed,
      queue_limit: schedule().queue_limit,
      enabled,
      version: enabled
        ? f.published_version
        : (schedule().version ?? f.published_version),
    });
    setSchedule(value);
  }
  async function publish() {
    const validation = await request<
      { node_id?: string; field: string; code: string }[]
    >(`/workflows/${flow()!.id}/validate`, { definition: draft() });
    setIssues(validation);
    if (validation.length) {
      if (validation[0].node_id) setSelected(validation[0].node_id);
      setTab("canvas");
      setPanel("");
      throw new Error(t("validation"));
    }
    const current = dirty() ? await save() : flow();
    if (!current) return;
    if (dirty()) throw new Error(t("dirty"));
    await request(`/workflows/${current.id}/publish`, {
      revision: current.revision,
      tools: allowedTools()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      expires_at: new Date(`${expires()}T23:59:59`).toISOString(),
    });
    const latest = await request<Workflow>(`/workflows/${current.id}`);
    const editedDuringPublish =
      JSON.stringify(draft()) !== JSON.stringify(current.definition);
    setFlow(latest);
    setBaseRevision(latest.revision);
    if (!editedDuringPublish) setDraft(clone(latest.definition));
    setPanel("");
    await refreshList();
  }
  async function runNow() {
    const current = flow();
    if (!current) return;
    if (dirty()) {
      await save();
      setPanel("grant");
      return;
    }
    if (
      !current.published_version ||
      current.published_revision !== current.revision
    ) {
      setPanel("grant");
      return;
    }
    const pendingKey = `${props.storageKey}:automation-pending-run:${current.id}`;
    type RunIntent = {
      request_id: string;
      version: number;
      purpose: string;
      scheduled_at: string;
    };
    const retained = readUIStorageJSON(pendingKey, null) as RunIntent | null;
    const intent = retained ?? {
      request_id: crypto.randomUUID(),
      version: current.published_version,
      purpose: "test",
      scheduled_at: new Date().toISOString(),
    };
    writeUIStorageJSON(pendingKey, intent);
    const value = await request<Run>(`/workflows/${current.id}/run`, intent);
    writeUIStorageJSON(pendingKey, null);
    setRun(value);
    setTab("runs");
    await refreshRuns();
  }
  async function design() {
    const current = dirty() ? await save() : flow();
    if (!current) return;
    const result = await request<{ thread_id: string }>(
      `/workflows/${current.id}/designer`,
      {},
    );
    setThread(result.thread_id);
    setPanel("flower");
  }
  async function downloadArtifact(runID: string, artifactID: string) {
    const response = await fetchSessionHTTP(
      `${base}/runs/${encodeURIComponent(runID)}/artifacts/${encodeURIComponent(artifactID)}`,
    );
    if (!response.ok) await readApiJSONResponse(response);
    const blob = await response.blob();
    if (disposed) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "report.html";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const status = (state: string) => t(`states.${state}`);
  const nodeKind = (kind: string) => t(`kinds.${kind}`);
  const stateFor = (id: string) => {
    const current = run();
    if (!current) return "";
    const values = latestAttempts(current, id);
    return (
      values.find(
        (a) =>
          a.state === "unknown" ||
          a.state === "failed" ||
          a.state === "submitted",
      )?.state ??
      values[0]?.state ??
      "pending"
    );
  };
  function fit() {
    if (viewport)
      setZoom(
        Math.max(0.35, Math.min(1, (viewport.clientWidth - 48) / graphWidth())),
      );
  }
  onMount(() => {
    void request<{
      models: { id: string; label?: string }[];
      default_directory: string;
    }>("/options")
      .then(setOptions)
      .catch(fail);
    void refreshList().catch(fail);
    const timer = setInterval(() => {
      if (flow() && !document.hidden) {
        void refreshRuns().catch(fail);
        if (panel() === "flower") void syncCurrent().catch(fail);
      }
    }, 2500);
    onCleanup(() => clearInterval(timer));
  });
  onCleanup(() => {
    disposed = true;
    refreshSequence++;
  });
  const Field = (p: { label: string; children: JSX.Element }) => (
    <label class="automation-field">
      <span>{p.label}</span>
      {p.children}
    </label>
  );
  return (
    <div class="automation-workspace" data-automation-workspace>
      <Show
        when={flow()}
        fallback={
          <section class="automation-library">
            <header>
              <div>
                <h1>{t("title")}</h1>
                <p>{t("empty")}</p>
              </div>
              <select
                aria-label={t("template")}
                value={starter()}
                onChange={(e) => setStarter(e.currentTarget.value as Starter)}
              >
                <For each={["blank", "news", "inspection"]}>
                  {(kind) => <option value={kind}>{t(kind)}</option>}
                </For>
              </select>
              <button
                class="automation-primary"
                disabled={!props.canWrite || busy()}
                onClick={() => void action(create)}
              >
                <Plus size={16} />
                {t("create")}
              </button>
            </header>
            <input
              type="search"
              aria-label={t("search")}
              placeholder={t("search")}
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
            <div class="automation-grid">
              <For each={filtered()}>
                {(item) => (
                  <button
                    class="automation-flow-card"
                    onClick={() => void action(() => open(item))}
                  >
                    <GitBranch size={22} />
                    <strong>{item.definition.title}</strong>
                    <p>{item.definition.goal}</p>
                    <footer>
                      <span>
                        {item.definition.nodes.length} {t("node")}
                      </span>
                      <span>
                        {item.published_version ? t("published") : t("draft")}
                      </span>
                    </footer>
                  </button>
                )}
              </For>
            </div>
          </section>
        }
      >
        <header class="automation-toolbar">
          <button
            aria-label={t("close")}
            disabled={busy()}
            onClick={() => {
              refreshSequence++;
              setFlow(undefined);
              setDraft(undefined);
              setPanel("");
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <input
            class="automation-title"
            aria-label={t("workflow")}
            value={draft()?.title ?? ""}
            onInput={(e) =>
              edit((d) => {
                d.title = e.currentTarget.value;
              })
            }
            disabled={!props.canWrite || !!flow()?.plugin}
          />
          <span class="automation-version">
            {dirty() ? t("dirty") : `v${flow()?.published_version ?? 0}`}
          </span>
          <div class="automation-toolbar-actions">
            <button
              disabled={busy() || !props.canWrite || !dirty() || conflict()}
              onClick={() =>
                void action(async () => {
                  await save();
                })
              }
            >
              {i18n.t("common.actions.save")}
            </button>
            <button
              disabled={busy() || !props.canWrite}
              onClick={() => setPanel("grant")}
            >
              <Check size={15} />
              {t("publish")}
            </button>
            <button
              disabled={busy() || !props.canWrite || !!flow()?.plugin}
              onClick={() => void action(openSchedule)}
            >
              <Clock size={15} />
              {t("schedule")}
            </button>
            <button
              class="automation-primary"
              disabled={busy() || !props.canWrite}
              onClick={() => void action(runNow)}
            >
              <Play size={15} />
              {t("run")}
            </button>
          </div>
        </header>
        <Show when={conflict()}>
          <div class="automation-conflict" role="status">
            <span>{t("conflict")}</span>
            <button
              disabled={busy()}
              onClick={() => void action(reviewChanges)}
            >
              {t("reviewChanges")}
            </button>
          </div>
        </Show>
        <nav class="automation-tabs" aria-label={t("workflow")}>
          <For each={["canvas", "runs", "context", "artifacts"]}>
            {(value) => (
              <button
                aria-current={tab() === value ? "page" : undefined}
                onClick={() => setTab(value)}
              >
                {t(value)}
                <Show when={value === "runs"}>
                  <span>{runs().length}</span>
                </Show>
              </button>
            )}
          </For>
          <button
            class="automation-flower-toggle"
            disabled={busy() || !props.canWrite || !!flow()?.plugin}
            onClick={() => void action(design)}
          >
            <Bot size={16} />
            {t("flower")}
          </button>
        </nav>
        <div
          class="automation-body"
          classList={{ "automation-panel-open": panel() !== "" }}
        >
          <main class="automation-main">
            <Show when={tab() === "canvas"}>
              <div class="automation-canvas-layout">
                <div class="automation-canvas" ref={viewport}>
                  <div class="automation-canvas-controls">
                    <button
                      aria-label={t("undo")}
                      disabled={!props.canWrite || !history().length}
                      onClick={undo}
                    >
                      <Undo2 size={16} />
                    </button>
                    <button
                      aria-label={t("redo")}
                      disabled={!props.canWrite || !future().length}
                      onClick={redo}
                    >
                      <Redo2 size={16} />
                    </button>
                    <button
                      disabled={!props.canWrite || !!flow()?.plugin}
                      onClick={add}
                    >
                      <Plus size={16} />
                      {t("add")}
                    </button>
                    <button
                      aria-label={t("zoomOut")}
                      onClick={() => setZoom((z) => Math.max(0.35, z - 0.1))}
                    >
                      <ZoomOut size={16} />
                    </button>
                    <button
                      aria-label={t("zoomIn")}
                      onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
                    >
                      <ZoomIn size={16} />
                    </button>
                    <button aria-label={t("fit")} onClick={fit}>
                      <Maximize2 size={16} />
                    </button>
                  </div>
                  <div
                    style={{
                      width: `${graphWidth() * zoom()}px`,
                      height: `${graphHeight() * zoom()}px`,
                    }}
                  >
                    <div
                      class="automation-graph"
                      style={{
                        width: `${graphWidth()}px`,
                        height: `${graphHeight()}px`,
                        transform: `scale(${zoom()})`,
                      }}
                    >
                      <svg
                        class="automation-edges"
                        width={graphWidth()}
                        height={graphHeight()}
                        aria-hidden="true"
                      >
                        <For each={graph()}>
                          {(point) => (
                            <For each={point.node.depends_on}>
                              {(id) => {
                                const source = () =>
                                  graph().find((p) => p.node.id === id);
                                return (
                                  <Show when={source()}>
                                    {(p) => (
                                      <path
                                        d={`M${p().x + 224},${p().y + 48} C${p().x + 252},${p().y + 48} ${point.x - 28},${point.y + 48} ${point.x},${point.y + 48}`}
                                      />
                                    )}
                                  </Show>
                                );
                              }}
                            </For>
                          )}
                        </For>
                      </svg>
                      <For each={graph()}>
                        {(point) => (
                          <button
                            class="automation-node"
                            classList={{
                              selected: selected() === point.node.id,
                            }}
                            style={{
                              left: `${point.x}px`,
                              top: `${point.y}px`,
                            }}
                            aria-pressed={selected() === point.node.id}
                            onClick={() => setSelected(point.node.id)}
                          >
                            <header>
                              <GitBranch size={15} />
                              <span>{nodeKind(point.node.kind)}</span>
                              <Show when={stateFor(point.node.id)}>
                                <span
                                  class="automation-status"
                                  data-state={stateFor(point.node.id)}
                                >
                                  {status(stateFor(point.node.id))}
                                </span>
                              </Show>
                            </header>
                            <strong>{point.node.title}</strong>
                            <footer>
                              {point.node.kind === "parallel"
                                ? `${point.node.items?.length ?? "…"} × ${point.node.concurrency ?? 1}`
                                : point.node.id}
                            </footer>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
                <aside class="automation-editor">
                  <fieldset
                    class="automation-editor-fields"
                    disabled={!props.canWrite}
                  >
                    <Show when={node()}>
                      <fieldset
                        class="automation-editor-fields"
                        disabled={!!flow()?.plugin}
                      >
                        <header>
                          <strong>{t("node")}</strong>
                          <button
                            disabled={
                              !props.canWrite || draft()!.nodes.length < 2
                            }
                            aria-label={t("remove")}
                            onClick={remove}
                          >
                            <X size={16} />
                          </button>
                        </header>
                        <Field label={t("node")}>
                          <input
                            value={node()?.title ?? ""}
                            disabled={!props.canWrite}
                            onInput={(e) =>
                              patchNode({ title: e.currentTarget.value })
                            }
                          />
                        </Field>
                        <Field label={t("kind")}>
                          <select
                            value={node()?.kind}
                            disabled={!props.canWrite}
                            onChange={(e) =>
                              setKind(e.currentTarget.value as FlowNode["kind"])
                            }
                          >
                            <For each={kinds}>
                              {(kind) => (
                                <option value={kind}>{nodeKind(kind)}</option>
                              )}
                            </For>
                          </select>
                        </Field>
                        <fieldset>
                          <legend>{t("dependencies")}</legend>
                          <For
                            each={draft()?.nodes.filter(
                              (n) =>
                                !descendants(draft()!.nodes, selected()).has(
                                  n.id,
                                ),
                            )}
                          >
                            {(other) => (
                              <label class="automation-check">
                                <input
                                  type="checkbox"
                                  checked={node()?.depends_on.includes(
                                    other.id,
                                  )}
                                  disabled={!props.canWrite}
                                  onChange={(e) =>
                                    patchNode({
                                      depends_on: e.currentTarget.checked
                                        ? [
                                            ...(node()?.depends_on ?? []),
                                            other.id,
                                          ]
                                        : (node()?.depends_on ?? []).filter(
                                            (id) => id !== other.id,
                                          ),
                                    })
                                  }
                                />
                                {other.title}
                              </label>
                            )}
                          </For>
                        </fieldset>
                        <Show
                          when={
                            node()?.kind === "agent" ||
                            node()?.kind === "parallel"
                          }
                        >
                          <Field label={t("instruction")}>
                            <textarea
                              rows={6}
                              value={node()?.instruction ?? ""}
                              onInput={(e) =>
                                patchNode({
                                  instruction: e.currentTarget.value,
                                })
                              }
                            />
                          </Field>
                          <Field label={t("schema")}>
                            <textarea
                              rows={4}
                              spellcheck={false}
                              value={jsonValue(
                                "output_schema",
                                node()?.output_schema,
                              )}
                              aria-invalid={
                                jsonErrors()[`${selected()}:output_schema`] ||
                                undefined
                              }
                              onInput={(e) =>
                                editJSON("output_schema", e.currentTarget.value)
                              }
                            />
                          </Field>
                        </Show>
                        <Show when={node()?.kind === "parallel"}>
                          <Field label={t("concurrency")}>
                            <input
                              type="number"
                              min={1}
                              max={16}
                              value={node()?.concurrency ?? 2}
                              onInput={(e) =>
                                patchNode({
                                  concurrency: e.currentTarget.valueAsNumber,
                                })
                              }
                            />
                          </Field>
                          <Field label={t("itemsFrom")}>
                            <select
                              value={node()?.items_from ?? ""}
                              onChange={(e) =>
                                patchNode({ items_from: e.currentTarget.value })
                              }
                            >
                              <option value="">—</option>
                              <For each={node()?.depends_on}>
                                {(id) => (
                                  <option value={id}>
                                    {
                                      draft()?.nodes.find((n) => n.id === id)
                                        ?.title
                                    }
                                  </option>
                                )}
                              </For>
                            </select>
                          </Field>
                          <Show when={!node()?.items_from}>
                            <Field label={t("items")}>
                              <textarea
                                rows={8}
                                spellcheck={false}
                                value={jsonValue("items", node()?.items ?? [])}
                                aria-invalid={
                                  jsonErrors()[`${selected()}:items`] ||
                                  undefined
                                }
                                onInput={(e) =>
                                  editJSON("items", e.currentTarget.value)
                                }
                              />
                            </Field>
                          </Show>
                        </Show>
                        <Show when={node()?.kind === "tool"}>
                          <Field label={t("tool")}>
                            <select
                              value={node()?.tool}
                              onChange={(e) =>
                                patchNode({ tool: e.currentTarget.value })
                              }
                            >
                              <For
                                each={[
                                  "http_get",
                                  "containers_list",
                                  "container_inspect",
                                ]}
                              >
                                {(tool) => <option>{tool}</option>}
                              </For>
                            </select>
                          </Field>
                          <Field label={t("parameters")}>
                            <textarea
                              rows={8}
                              spellcheck={false}
                              value={jsonValue(
                                "parameters",
                                node()?.parameters,
                              )}
                              aria-invalid={
                                jsonErrors()[`${selected()}:parameters`] ||
                                undefined
                              }
                              onInput={(e) =>
                                editJSON("parameters", e.currentTarget.value)
                              }
                            />
                          </Field>
                        </Show>
                        <Show when={node()?.kind === "join"}>
                          <Field label={t("partial")}>
                            <input
                              type="checkbox"
                              checked={node()?.join_policy === "partial"}
                              disabled={!props.canWrite}
                              onChange={(e) =>
                                patchNode({
                                  join_policy: e.currentTarget.checked
                                    ? "partial"
                                    : "all",
                                })
                              }
                            />
                          </Field>
                          <Show when={node()?.join_policy === "partial"}>
                            <Field label={t("minimumSuccess")}>
                              <input
                                type="number"
                                min={1}
                                max={500}
                                value={node()?.minimum_success ?? 1}
                                disabled={!props.canWrite}
                                onInput={(e) =>
                                  patchNode({
                                    minimum_success:
                                      e.currentTarget.valueAsNumber,
                                  })
                                }
                              />
                            </Field>
                          </Show>
                        </Show>
                        <Show when={node()?.kind === "render"}>
                          <Field label={t("template")}>
                            <textarea
                              rows={16}
                              spellcheck={false}
                              value={node()?.template ?? ""}
                              onInput={(e) =>
                                patchNode({ template: e.currentTarget.value })
                              }
                            />
                          </Field>
                        </Show>
                        <Show when={node()?.kind === "deliver"}>
                          <label class="automation-check">
                            <input
                              type="checkbox"
                              checked={node()?.require_review}
                              onChange={(e) =>
                                patchNode({
                                  require_review: e.currentTarget.checked,
                                })
                              }
                            />
                            {t("review")}
                          </label>
                        </Show>
                        <Show when={node()?.kind === "condition"}>
                          <Field label={t("condition")}>
                            <textarea
                              rows={6}
                              value={jsonValue("condition", node()?.condition)}
                              aria-invalid={
                                jsonErrors()[`${selected()}:condition`] ||
                                undefined
                              }
                              onInput={(e) =>
                                editJSON("condition", e.currentTarget.value)
                              }
                            />
                          </Field>
                        </Show>
                      </fieldset>
                    </Show>
                    <details class="automation-settings" open>
                      <summary>{t("workflow")}</summary>
                      <Field label={t("goal")}>
                        <textarea
                          rows={3}
                          value={draft()?.goal ?? ""}
                          disabled={!!flow()?.plugin}
                          onInput={(e) =>
                            edit((d) => {
                              d.goal = e.currentTarget.value;
                            })
                          }
                        />
                      </Field>
                      <Field label={t("model")}>
                        <select
                          aria-label={t("model")}
                          value={draft()?.model ?? ""}
                          disabled={!props.canWrite}
                          onChange={(e) =>
                            edit((d) => {
                              d.model = e.currentTarget.value;
                            })
                          }
                        >
                          <option value="">{t("model")}</option>
                          <Show
                            when={
                              draft()?.model &&
                              !options().models.some(
                                (m) => m.id === draft()?.model,
                              )
                            }
                          >
                            <option value={draft()?.model}>
                              {draft()?.model}
                            </option>
                          </Show>
                          <For each={options().models}>
                            {(m) => (
                              <option value={m.id}>{m.label ?? m.id}</option>
                            )}
                          </For>
                        </select>
                      </Field>
                      <Field label={t("directory")}>
                        <input
                          value={draft()?.working_directory ?? ""}
                          disabled={!props.canWrite}
                          onInput={(e) =>
                            edit((d) => {
                              d.working_directory = e.currentTarget.value;
                            })
                          }
                        />
                        <Show when={props.selectDirectory}>
                          <button
                            disabled={!props.canWrite}
                            onClick={() =>
                              props.selectDirectory?.(
                                draft()?.working_directory ?? "",
                                (path) =>
                                  edit((d) => {
                                    d.working_directory = path;
                                  }),
                              )
                            }
                          >
                            {t("directory")}
                          </button>
                        </Show>
                      </Field>
                      <Field label={t("concurrency")}>
                        <input
                          type="number"
                          min={1}
                          max={16}
                          disabled={!!flow()?.plugin}
                          value={draft()?.max_concurrent ?? 2}
                          onInput={(e) =>
                            edit((d) => {
                              d.max_concurrent = e.currentTarget.valueAsNumber;
                            })
                          }
                        />
                      </Field>
                      <Field label={t("timeout")}>
                        <input
                          type="number"
                          min={1}
                          max={86400}
                          disabled={!!flow()?.plugin}
                          value={draft()?.timeout_seconds ?? 1800}
                          onInput={(e) =>
                            edit((d) => {
                              d.timeout_seconds = e.currentTarget.valueAsNumber;
                            })
                          }
                        />
                      </Field>
                      <label class="automation-check">
                        <input
                          type="checkbox"
                          checked={draft()?.allow_partial}
                          disabled={!!flow()?.plugin}
                          onChange={(e) =>
                            edit((d) => {
                              d.allow_partial = e.currentTarget.checked;
                            })
                          }
                        />
                        {t("partial")}
                      </label>
                    </details>
                  </fieldset>
                </aside>
              </div>
            </Show>
            <Show when={tab() !== "canvas"}>
              <section class="automation-results">
                <div class="automation-run-picker">
                  <select
                    aria-label={t("runs")}
                    disabled={busy()}
                    value={run()?.id ?? ""}
                    onChange={(e) =>
                      void action(() => selectRun(e.currentTarget.value))
                    }
                  >
                    <option value="">{t("runs")}</option>
                    <For each={runs()}>
                      {(r) => (
                        <option value={r.id}>
                          {new Date(r.scheduled_at).toLocaleString(
                            i18n.locale(),
                          )}{" "}
                          · {status(r.status)} · v{r.definition_version}
                        </option>
                      )}
                    </For>
                  </select>
                  <button
                    aria-label={t("refresh")}
                    onClick={() => void action(() => refreshRuns())}
                  >
                    {t("refresh")}
                  </button>
                </div>
                <Show
                  when={run()}
                  fallback={<p class="automation-empty">{t("noRuns")}</p>}
                >
                  {(current) => (
                    <>
                      <header class="automation-run-header">
                        <span
                          class="automation-status"
                          data-state={current().status}
                        >
                          {status(current().status)}
                        </span>
                        <code>{current().id}</code>
                        <span>
                          {t("basis")} {current().context_revision}
                        </span>
                        <Show when={!terminal(current().status)}>
                          <button
                            disabled={busy() || !props.canWrite}
                            onClick={() =>
                              void action(async () => {
                                setRun(
                                  await request<Run>(
                                    `/runs/${current().id}/cancel`,
                                    {},
                                  ),
                                );
                              })
                            }
                          >
                            <Pause size={14} />
                            {t("stop")}
                          </button>
                        </Show>
                        <Show
                          when={
                            current().status === "failed" ||
                            current().status === "partial"
                          }
                        >
                          <button
                            disabled={busy() || !props.canWrite}
                            onClick={() =>
                              void action(async () => {
                                setRun(
                                  await request<Run>(
                                    `/runs/${current().id}/retry`,
                                    {},
                                  ),
                                );
                              })
                            }
                          >
                            {i18n.t("common.actions.retry")}
                          </button>
                        </Show>
                      </header>
                      <Show when={tab() === "runs"}>
                        <For each={current().definition.nodes}>
                          {(n) => (
                            <details class="automation-run-group" open>
                              <summary>
                                <strong>{n.title}</strong>
                                <span>
                                  {
                                    latestAttempts(current(), n.id).filter(
                                      (a) => a.state === "completed",
                                    ).length
                                  }
                                  /{latestAttempts(current(), n.id).length}
                                </span>
                              </summary>
                              <For each={latestAttempts(current(), n.id)}>
                                {(a) => (
                                  <div class="automation-attempt">
                                    <span>{a.item?.label ?? n.title}</span>
                                    <span
                                      class="automation-status"
                                      data-state={a.state}
                                    >
                                      {status(a.state)}
                                    </span>
                                    <small>
                                      {t("attempt")} {a.number} · {t("basis")}{" "}
                                      {a.context_revision}
                                    </small>
                                    <Show when={a.state === "unknown"}>
                                      <p class="automation-unknown-help">
                                        {t("unknownHelp")}
                                      </p>
                                    </Show>
                                    <Show when={a.error}>
                                      <code>{a.error}</code>
                                    </Show>
                                    <Show when={a.state === "review"}>
                                      <button
                                        disabled={!props.canWrite || busy()}
                                        onClick={() =>
                                          void action(async () => {
                                            setRun(
                                              await request<Run>(
                                                `/runs/${current().id}/approve`,
                                                { attempt_id: a.id },
                                              ),
                                            );
                                          })
                                        }
                                      >
                                        {t("approve")}
                                      </button>
                                    </Show>
                                    <Show when={a.thread_id}>
                                      <button
                                        disabled={busy()}
                                        onClick={() =>
                                          void action(async () => {
                                            const receipt = await request(
                                              `/runs/${current().id}/attempts/${a.id}/context`,
                                            );
                                            setReceipts((v) => ({
                                              ...v,
                                              [a.id]: receipt,
                                            }));
                                          })
                                        }
                                      >
                                        {t("contextReceipt")}
                                      </button>
                                      <Show when={receipts()[a.id]}>
                                        <pre>
                                          {JSON.stringify(
                                            receipts()[a.id],
                                            null,
                                            2,
                                          )}
                                        </pre>
                                      </Show>
                                    </Show>
                                    <Show when={a.result !== undefined}>
                                      <details>
                                        <summary>{t("result")}</summary>
                                        <pre>
                                          {JSON.stringify(a.result, null, 2)}
                                        </pre>
                                      </details>
                                    </Show>
                                  </div>
                                )}
                              </For>
                            </details>
                          )}
                        </For>
                      </Show>
                      <Show when={tab() === "context"}>
                        <div class="automation-context-list">
                          <For each={current().contributions}>
                            {(c) => (
                              <article
                                classList={{
                                  "automation-invalidated": c.invalidated,
                                }}
                              >
                                <header>
                                  <strong>
                                    {c.node_id ?? t("requirement")}
                                  </strong>
                                  <span>
                                    r{c.revision} ← r{c.basis}
                                  </span>
                                  <Show when={c.invalidated}>
                                    <span>{t("invalidated")}</span>
                                  </Show>
                                </header>
                                <p>{c.text}</p>
                                <Show when={c.data !== undefined}>
                                  <details>
                                    <summary>{t("result")}</summary>
                                    <pre>{JSON.stringify(c.data, null, 2)}</pre>
                                  </details>
                                </Show>
                              </article>
                            )}
                          </For>
                        </div>
                        <Show when={!terminal(current().status)}>
                          <Field label={t("requirement")}>
                            <textarea
                              rows={3}
                              value={requirement()}
                              onInput={(e) =>
                                setRequirement(e.currentTarget.value)
                              }
                            />
                          </Field>
                          <button
                            disabled={
                              !props.canWrite || !requirement().trim() || busy()
                            }
                            onClick={() =>
                              void action(async () => {
                                setRun(
                                  await request<Run>(
                                    `/runs/${current().id}/contribute`,
                                    {
                                      id: crypto.randomUUID(),
                                      text: requirement(),
                                      basis: current().context_revision,
                                    },
                                  ),
                                );
                                setRequirement("");
                              })
                            }
                          >
                            {t("contribute")}
                          </button>
                        </Show>
                      </Show>
                      <Show when={tab() === "artifacts"}>
                        <Show
                          when={current().artifacts.length}
                          fallback={
                            <p class="automation-empty">{t("noArtifacts")}</p>
                          }
                        >
                          <For each={current().artifacts}>
                            {(a) => (
                              <article
                                class="automation-artifact"
                                classList={{
                                  "automation-invalidated": a.invalidated,
                                }}
                              >
                                <header>
                                  <FileText size={18} />
                                  <Show when={a.invalidated}>
                                    <span>{t("invalidated")}</span>
                                  </Show>
                                  <strong>
                                    {
                                      current().definition.nodes.find(
                                        (n) => n.id === a.node_id,
                                      )?.title
                                    }
                                  </strong>
                                  <button
                                    disabled={busy()}
                                    onClick={() =>
                                      void action(() =>
                                        downloadArtifact(current().id, a.id),
                                      )
                                    }
                                  >
                                    {t("download")}
                                  </button>
                                </header>
                                <iframe
                                  title={t("artifacts")}
                                  sandbox=""
                                  referrerPolicy="no-referrer"
                                  srcdoc={reportDocument(a.content)}
                                />
                                <footer>
                                  <code>SHA-256 {a.digest}</code>
                                  <span>
                                    {t("basis")} {a.context_revision}
                                  </span>
                                </footer>
                              </article>
                            )}
                          </For>
                        </Show>
                      </Show>
                    </>
                  )}
                </Show>
              </section>
            </Show>
          </main>
          <Show when={panel()}>
            <aside
              class="automation-side-panel"
              aria-label={t(panel() === "grant" ? "grant" : panel())}
            >
              <header>
                <strong>{t(panel() === "grant" ? "grant" : panel())}</strong>
                <button aria-label={t("close")} onClick={() => setPanel("")}>
                  <X size={18} />
                </button>
              </header>
              <Show when={panel() === "reviewChanges" && reviewedWorkflow()}>
                <div class="automation-panel-content automation-conflict-review">
                  <p>{t("conflictHelp")}</p>
                  <section aria-label={t("savedVersion")}>
                    <h3>
                      {t("savedVersion")} · r{reviewedWorkflow()!.revision}
                    </h3>
                    <pre tabIndex={0}>
                      {JSON.stringify(reviewedWorkflow()!.definition, null, 2)}
                    </pre>
                  </section>
                  <section aria-label={t("yourDraft")}>
                    <h3>
                      {t("yourDraft")} · r{baseRevision()}
                    </h3>
                    <pre tabIndex={0}>{JSON.stringify(draft(), null, 2)}</pre>
                  </section>
                  <button
                    class="automation-primary"
                    disabled={busy() || !props.canWrite}
                    onClick={() => resolveConflict(false)}
                  >
                    {t("keepDraft")}
                  </button>
                  <button
                    disabled={busy() || !props.canWrite}
                    onClick={() => resolveConflict(true)}
                  >
                    {t("useSaved")}
                  </button>
                </div>
              </Show>
              <Show when={panel() === "grant"}>
                <div class="automation-panel-content">
                  <p>{t("grantHelp")}</p>
                  <Show when={flow()?.plugin}>
                    <p>
                      {t("pluginRequest")} · {flow()?.plugin?.work_id}
                    </p>
                  </Show>
                  <Field label={t("tools")}>
                    <textarea
                      rows={5}
                      disabled={!!flow()?.plugin}
                      value={allowedTools()}
                      onInput={(e) => setAllowedTools(e.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("expires")}>
                    <input
                      type="date"
                      value={expires()}
                      min={new Date().toISOString().slice(0, 10)}
                      onInput={(e) => setExpires(e.currentTarget.value)}
                    />
                  </Field>
                  <button
                    class="automation-primary"
                    disabled={busy() || !props.canWrite}
                    onClick={() => void action(publish)}
                  >
                    {t("publish")}
                  </button>
                  <Show when={flow()?.published_version}>
                    <button
                      disabled={busy() || !props.canWrite}
                      onClick={() =>
                        void action(async () => {
                          await request(`/workflows/${flow()!.id}/revoke`, {});
                          setPanel("");
                        })
                      }
                    >
                      {t("revoke")}
                    </button>
                  </Show>
                  <button
                    disabled={busy() || !props.canWrite}
                    onClick={() => setArchiveConfirm(true)}
                  >
                    {t("delete")}
                  </button>
                  <Show when={archiveConfirm()}>
                    <p>{t("deleteHelp")}</p>
                    <button
                      disabled={busy()}
                      onClick={() =>
                        void action(async () => {
                          await request(`/workflows/${flow()!.id}/archive`, {
                            revision: flow()!.revision,
                          });
                          setFlow(undefined);
                          setDraft(undefined);
                          setPanel("");
                          await refreshList();
                        })
                      }
                    >
                      {t("delete")}
                    </button>
                  </Show>
                </div>
              </Show>
              <Show when={panel() === "schedule"}>
                <div class="automation-panel-content">
                  <Field label={t("schedule")}>
                    <select
                      value={schedule().cadence.kind}
                      onChange={(e) =>
                        setSchedule((s) => ({
                          ...s,
                          cadence:
                            e.currentTarget.value === "daily"
                              ? {
                                  kind: "daily",
                                  timezone:
                                    Intl.DateTimeFormat().resolvedOptions()
                                      .timeZone,
                                  hour: 8,
                                  minute: 0,
                                }
                              : {
                                  kind: e.currentTarget.value,
                                  interval_ms: 3600000,
                                },
                        }))
                      }
                    >
                      <For each={["interval", "completion", "daily"]}>
                        {(kind) => <option value={kind}>{t(kind)}</option>}
                      </For>
                    </select>
                  </Field>
                  <Show
                    when={schedule().cadence.kind === "daily"}
                    fallback={
                      <Field label={t("seconds")}>
                        <input
                          type="number"
                          min={1}
                          value={
                            (schedule().cadence.interval_ms ?? 3600000) / 1000
                          }
                          onInput={(e) =>
                            setSchedule((s) => ({
                              ...s,
                              cadence: {
                                ...s.cadence,
                                interval_ms:
                                  e.currentTarget.valueAsNumber * 1000,
                              },
                            }))
                          }
                        />
                      </Field>
                    }
                  >
                    <Field label={t("timezone")}>
                      <input
                        value={schedule().cadence.timezone ?? ""}
                        onInput={(e) =>
                          setSchedule((s) => ({
                            ...s,
                            cadence: {
                              ...s.cadence,
                              timezone: e.currentTarget.value,
                            },
                          }))
                        }
                      />
                    </Field>
                    <Field label={t("time")}>
                      <input
                        type="time"
                        value={`${String(schedule().cadence.hour ?? 8).padStart(2, "0")}:${String(schedule().cadence.minute ?? 0).padStart(2, "0")}`}
                        onInput={(e) => {
                          const [hour, minute] = e.currentTarget.value
                            .split(":")
                            .map(Number);
                          setSchedule((s) => ({
                            ...s,
                            cadence: { ...s.cadence, hour, minute },
                          }));
                        }}
                      />
                    </Field>
                  </Show>
                  <Field label={t("overlap")}>
                    <select
                      value={schedule().overlap}
                      onChange={(e) =>
                        setSchedule((s) => ({
                          ...s,
                          overlap: e.currentTarget.value,
                        }))
                      }
                    >
                      <For each={["skip", "latest", "queue"]}>
                        {(mode) => <option value={mode}>{t(mode)}</option>}
                      </For>
                    </select>
                  </Field>
                  <Show when={schedule().overlap === "queue"}>
                    <Field label={t("queue")}>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={schedule().queue_limit}
                        onInput={(e) =>
                          setSchedule((s) => ({
                            ...s,
                            queue_limit: e.currentTarget.valueAsNumber,
                          }))
                        }
                      />
                    </Field>
                  </Show>
                  <Field label={t("missed")}>
                    <select
                      value={schedule().missed}
                      onChange={(e) =>
                        setSchedule((s) => ({
                          ...s,
                          missed: e.currentTarget.value,
                        }))
                      }
                    >
                      <option value="skip">{t("skip")}</option>
                      <option value="latest">{t("latest")}</option>
                    </select>
                  </Field>
                  <p>
                    {t("pinnedVersion")} · v
                    {schedule().version ?? flow()?.published_version}
                  </p>
                  <button
                    disabled={busy()}
                    onClick={() =>
                      void action(async () => {
                        setPreview(
                          await request<string[]>(
                            `/workflows/${flow()!.id}/schedule-preview`,
                            { cadence: schedule().cadence },
                          ),
                        );
                      })
                    }
                  >
                    {t("preview")}
                  </button>
                  <Show when={preview().length}>
                    <Show when={schedule().cadence.kind === "completion"}>
                      <p>{t("completionPreview")}</p>
                    </Show>
                    <ol>
                      <For each={preview()}>
                        {(at) => (
                          <li>{new Date(at).toLocaleString(i18n.locale())}</li>
                        )}
                      </For>
                    </ol>
                  </Show>
                  <details>
                    <summary>{t("scheduleHistory")}</summary>
                    <For each={scheduleHistory()}>
                      {(item) => (
                        <article class="automation-claim">
                          <time>
                            {new Date(item.scheduled_at).toLocaleString(
                              i18n.locale(),
                            )}
                          </time>
                          <span>{status(item.state)}</span>
                          <Show when={item.outcome}>
                            <code>{item.outcome}</code>
                          </Show>
                          <Show when={item.reference}>
                            <button
                              disabled={busy()}
                              onClick={() => {
                                void action(async () => {
                                  await selectRun(item.reference!);
                                  setTab("runs");
                                  setPanel("");
                                });
                              }}
                            >
                              {t("runs")}
                            </button>
                          </Show>
                        </article>
                      )}
                    </For>
                  </details>
                  <Show when={schedule().next_at}>
                    <p>
                      {t("next")} ·{" "}
                      {new Date(schedule().next_at!).toLocaleString(
                        i18n.locale(),
                      )}
                    </p>
                  </Show>
                  <button
                    class="automation-primary"
                    disabled={
                      busy() ||
                      !props.canWrite ||
                      !flow()?.published_version ||
                      flow()?.published_revision !== flow()?.revision ||
                      dirty()
                    }
                    onClick={() => void action(() => saveSchedule(true))}
                  >
                    {t("enable")}
                  </button>
                  <button
                    disabled={busy() || !props.canWrite || !schedule().enabled}
                    onClick={() => void action(() => saveSchedule(false))}
                  >
                    {t("pause")}
                  </button>
                </div>
              </Show>
              <Show when={panel() === "flower" && thread()}>
                {props.renderFlower?.(
                  thread(),
                  flow()!.id,
                  () => void syncCurrent().catch(fail),
                )}
              </Show>
            </aside>
          </Show>
        </div>
      </Show>
      <Show when={issues().length}>
        <div class="automation-validation" role="status">
          <For each={issues()}>
            {(issue) => (
              <button
                onClick={() => {
                  if (issue.node_id) setSelected(issue.node_id);
                  setTab("canvas");
                }}
              >
                {draft()?.nodes.find((n) => n.id === issue.node_id)?.title ??
                  t("workflow")}{" "}
                · {issue.field} · {issue.code}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={error()}>
        <div class="automation-error" role="alert">
          <span>{error()}</span>
          <button aria-label={t("close")} onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      </Show>
      <Show when={busy()}>
        <div
          class="automation-progress"
          role="status"
          aria-label={t("waiting")}
        />
      </Show>
    </div>
  );
}
