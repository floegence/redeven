import "../../index.css";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { AutomationWorkspace } from "./AutomationWorkspace";
import type { Workflow, Definition, Schedule, Run } from "./api";
import axe from "axe-core";
import { LocalApiError } from "../services/localApi";
const state = vi.hoisted(() => ({
  saved: undefined as Definition | undefined,
  revision: 1,
  schedule: undefined as Schedule | undefined,
  calls: [] as string[],
  plugin: false,
  run: undefined as Run | undefined,
  saveWait: undefined as Promise<void> | undefined,
  workflowWait: undefined as Promise<void> | undefined,
  downloads: [] as string[],
}));
vi.mock("../services/sessionHTTP", () => ({
  fetchSessionHTTP: async (path: string) => {
    state.downloads.push(path);
    return new Response("<h1>Retained report</h1>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
  fetchSessionJSON: async (
    path: string,
    options: { method: string; body?: string },
  ) => {
    state.calls.push(path);
    if (path.endsWith("/options"))
      return {
        models: [{ id: "provider/model", label: "Test model" }],
        default_directory: "/work",
      };
    const definition: Definition = state.saved ?? {
      title: "Morning research",
      goal: "Evidence from every source",
      model: "provider/model",
      working_directory: "/work",
      max_concurrent: 2,
      timeout_seconds: 600,
      allow_partial: false,
      nodes: [
        {
          id: "research",
          title: "Research",
          kind: "agent",
          depends_on: [],
          instruction: "Gather evidence",
        },
        {
          id: "render",
          title: "Report",
          kind: "render",
          depends_on: ["research"],
          template: "<h1>{{.Title}}</h1>",
        },
      ],
    };
    const workflow: Workflow = {
      id: "flow",
      revision: state.revision,
      published_version: 0,
      definition,
      created_at: "2026-11-09",
      updated_at: "2026-11-09",
      ...(state.plugin
        ? { plugin: { work_id: "analysis", request_id: "original" } }
        : {}),
    };
    if (path.endsWith("/schedule-history")) return [];
    if (path.endsWith("/schedule-pause")) {
      if (state.schedule)
        state.schedule = {
          ...state.schedule,
          enabled: false,
          revision: state.schedule.revision + 1,
        };
      return { paused: true };
    }
    if (path.endsWith("/schedule-preview"))
      return ["2026-11-10T16:00:00Z", "2026-11-11T16:00:00Z"];
    if (path.endsWith("/schedule")) {
      if (options.method === "GET") return state.schedule ?? null;
      const body = JSON.parse(options.body!);
      state.schedule = {
        ...body,
        id: "flow",
        revision: body.revision + 1,
        next_at: "2026-11-10T16:00:00Z",
      };
      return state.schedule;
    }
    if (path.endsWith("/save")) {
      const body = JSON.parse(options.body!);
      await state.saveWait;
      if (body.revision !== state.revision)
        throw new LocalApiError({
          message: "revision conflict",
          status: 409,
          code: "AUTOMATION_CONFLICT",
        });
      state.saved = body.definition;
      state.revision++;
      return { ...workflow, revision: state.revision, definition: state.saved };
    }
    if (path.endsWith("/workflows")) return [workflow];
    if (path.endsWith("/runs")) return state.run ? [state.run] : [];
    if (path.endsWith("/runs/large")) return state.run;
    if (path.endsWith("/workflows/flow")) {
      await state.workflowWait;
      return workflow;
    }
    throw new Error(path);
  },
}));
let dispose: undefined | (() => void), host: HTMLDivElement;
afterEach(() => {
  dispose?.();
  host?.remove();
  localStorage.clear();
  state.saved = undefined;
  state.revision = 1;
  state.schedule = undefined;
  state.calls = [];
  state.plugin = false;
  state.run = undefined;
  state.saveWait = undefined;
  state.workflowWait = undefined;
  state.downloads = [];
  vi.restoreAllMocks();
  document.documentElement.classList.remove("dark");
});
async function mount(width = 1200, canWrite = true) {
  await page.viewport(width, 900);
  host = document.createElement("div");
  host.style.cssText = `height:800px;width:${width}px`;
  document.body.append(host);
  dispose = render(
    () => <AutomationWorkspace canWrite={canWrite} storageKey="acceptance" />,
    host,
  );
  await page.getByRole("button", { name: /Morning research/ }).click();
  await expect
    .poll(() => host.querySelectorAll(".automation-node").length)
    .toBe(2);
}
it("saves focused input without blur, preserves node focus, and undoes an edit", async () => {
  await mount();
  const field = page.getByRole("textbox", { name: "Instruction", exact: true });
  await field.fill("Verify all original sources");
  await expect
    .poll(() => document.activeElement?.getAttribute("rows"))
    .toBe("6");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(state.saved?.nodes[0].instruction).toBe("Verify all original sources");
  await field.fill("A temporary edit");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.element(field).toHaveValue("Verify all original sources");
});
it("preserves input typed while a previous save is in flight", async () => {
  await mount();
  const field = page.getByRole("textbox", { name: "Instruction", exact: true });
  let release!: () => void;
  state.saveWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await field.fill("First saved instruction");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => state.calls.some((path) => path.endsWith("/save")))
    .toBe(true);
  await field.fill("Newer local instruction");
  release();
  await expect
    .poll(() => state.saved?.nodes[0].instruction)
    .toBe("First saved instruction");
  await expect.element(field).toHaveValue("Newer local instruction");
  state.saveWait = undefined;
  await expect
    .element(page.getByRole("button", { name: "Save", exact: true }))
    .toBeEnabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => state.saved?.nodes[0].instruction)
    .toBe("Newer local instruction");
});
it("preserves input typed while the workflow is opening", async () => {
  let release!: () => void;
  state.workflowWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mount();
  const field = page.getByRole("textbox", { name: "Instruction", exact: true });
  await field.fill("Typed before loading completed");
  release();
  await expect
    .element(page.getByRole("button", { name: "Save", exact: true }))
    .toBeEnabled();
  await expect.element(field).toHaveValue("Typed before loading completed");
});
it("recovers a stale draft only after reviewing the saved version", async () => {
  await mount();
  const instruction = () =>
    page.getByRole("textbox", { name: "Instruction", exact: true });
  await instruction().fill("Preserved draft");
  dispose?.();
  host.remove();
  state.revision = 2;
  await mount();
  await expect.element(instruction()).toHaveValue("Preserved draft");
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect
    .element(page.getByRole("region", { name: "Saved version" }))
    .toHaveTextContent("Gather evidence");
  await expect
    .element(page.getByRole("region", { name: "Your draft" }))
    .toHaveTextContent("Preserved draft");
  expect(state.saved).toBeUndefined();
  await page
    .getByRole("button", { name: "Keep my draft", exact: true })
    .click();
  expect(state.saved).toBeUndefined();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => state.saved?.nodes[0].instruction)
    .toBe("Preserved draft");
  expect(state.revision).toBe(3);
});
it("keeps revision protection when the saved workflow changes again during review", async () => {
  await mount();
  const field = page.getByRole("textbox", { name: "Instruction", exact: true });
  await field.fill("Preserved after another edit");
  state.revision = 2;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  state.revision = 3;
  await page
    .getByRole("button", { name: "Keep my draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Review changes", exact: true }))
    .toBeVisible();
  await expect.element(field).toHaveValue("Preserved after another edit");
  expect(state.saved).toBeUndefined();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keep my draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.revision).toBe(4);
});
it("can restore the saved workflow and undo that explicit choice", async () => {
  await mount(390);
  const field = page.getByRole("textbox", { name: "Instruction", exact: true });
  await field.fill("Recoverable local edit");
  state.revision = 2;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use saved version", exact: true })
    .click();
  await expect.element(field).toHaveValue("Gather evidence");
  expect(state.saved).toBeUndefined();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.element(field).toHaveValue("Recoverable local edit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => state.saved?.nodes[0].instruction)
    .toBe("Recoverable local edit");
});
it.each([390, 1200])(
  "keeps configuration and primary actions reachable at %i px",
  async (width) => {
    await mount(width);
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await expect
      .poll(() => host.querySelectorAll(".automation-node").length)
      .toBe(3);
    const nodes = [
      ...host.querySelectorAll<HTMLButtonElement>(".automation-node"),
    ];
    nodes[2].focus();
    expect(document.activeElement).toBe(nodes[2]);
    await page
      .getByRole("button", { name: "Publish & authorize", exact: true })
      .click();
    await expect
      .element(page.getByText("Execution authorization", { exact: true }))
      .toBeVisible();
    expect(host.getBoundingClientRect().width).toBeLessThanOrEqual(width);
  },
);

it("shows schedule previews without silently enabling a plan", async () => {
  await mount();
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview next runs", exact: true })
    .click();
  await expect
    .poll(() => host.querySelectorAll(".automation-panel-content ol li").length)
    .toBe(2);
  expect(state.schedule).toBeUndefined();
  expect(state.calls.some((p) => p.endsWith("/schedule-history"))).toBe(true);
});
it("disables every editor input for a read-only viewer", async () => {
  await mount(1200, false);
  for (const control of host.querySelectorAll<HTMLInputElement>(
    ".automation-editor input,.automation-editor textarea,.automation-editor select",
  ))
    expect(control.matches(":disabled")).toBe(true);
  expect(state.saved).toBeUndefined();
});
it("pauses an existing schedule while retaining an unsaved draft", async () => {
  state.schedule = {
    id: "flow",
    revision: 1,
    enabled: true,
    version: 1,
    cadence: { kind: "interval", interval_ms: 3600000 },
    overlap: "skip",
    missed: "latest",
    queue_limit: 1,
  };
  await mount();
  await page
    .getByRole("textbox", { name: "Instruction", exact: true })
    .fill("Unsaved requirement");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause schedule", exact: true })
    .click();
  await expect.poll(() => state.schedule?.enabled).toBe(false);
  expect(state.saved).toBeUndefined();
  await expect
    .element(page.getByRole("textbox", { name: "Instruction", exact: true }))
    .toHaveValue("Unsaved requirement");
});
it("restricts plugin analysis to host model and directory review", async () => {
  state.plugin = true;
  await mount();
  await expect
    .element(page.getByRole("textbox", { name: "Workflow", exact: true }))
    .toBeDisabled();
  await expect
    .element(page.getByRole("button", { name: "Add step", exact: true }))
    .toBeDisabled();
  await expect
    .element(page.getByRole("button", { name: "Schedule", exact: true }))
    .toBeDisabled();
  await expect
    .element(page.getByRole("textbox", { name: "Instruction", exact: true }))
    .toBeDisabled();
});
it("keeps 500 parallel item identities inspectable with reachable controls", async () => {
  const definition: Definition = {
    title: "Cluster fleet",
    goal: "Inspect every target",
    model: "provider/model",
    working_directory: "/work",
    max_concurrent: 8,
    timeout_seconds: 3600,
    allow_partial: false,
    nodes: [
      {
        id: "fleet",
        title: "Fleet",
        kind: "parallel",
        depends_on: [],
        concurrency: 8,
      },
    ],
  };
  state.run = {
    id: "large",
    workflow_id: "flow",
    definition_version: 1,
    definition,
    status: "running",
    revision: 501,
    context_revision: 493,
    scheduled_at: "2026-11-09T12:00:00Z",
    contributions: [],
    artifacts: [],
    attempts: Array.from({ length: 500 }, (_, i) => ({
      id: `attempt_${i}`,
      node_id: "fleet",
      item: { id: `cluster_${i}`, label: `Cluster ${i}` },
      number: 1,
      state: i < 492 ? "completed" : "submitted",
      context_revision: 1,
    })),
  };
  await mount();
  await page.getByRole("button", { name: /^Runs/ }).click();
  await page
    .getByRole("combobox", { name: "Runs", exact: true })
    .selectOptions("large");
  await expect
    .poll(() => host.querySelectorAll(".automation-attempt").length)
    .toBe(500);
  expect(host.querySelector(".automation-attempt")?.textContent).toContain(
    "Cluster 0",
  );
  expect(
    host.querySelectorAll(".automation-attempt")[499].textContent,
  ).toContain("Cluster 499");
  await expect
    .element(page.getByRole("button", { name: "Stop run", exact: true }))
    .toBeVisible();
  await page
    .getByRole("button", { name: "Shared context", exact: true })
    .click();
  await expect
    .element(page.getByRole("button", { name: "Stop run", exact: true }))
    .toBeVisible();
});
it("downloads retained reports through the environment session transport", async () => {
  state.run = {
    id: "large",
    workflow_id: "flow",
    definition_version: 1,
    definition: {
      title: "Report",
      goal: "Retain evidence",
      model: "",
      working_directory: "",
      max_concurrent: 1,
      timeout_seconds: 60,
      allow_partial: false,
      nodes: [],
    },
    status: "completed",
    revision: 3,
    context_revision: 2,
    scheduled_at: "2026-11-09T12:00:00Z",
    contributions: [],
    attempts: [],
    artifacts: [
      {
        id: "report",
        node_id: "render",
        media_type: "text/html",
        content: "<h1>Retained report</h1>",
        digest: "digest",
        context_revision: 2,
      },
    ],
  };
  const clicked: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this.href);
  });
  await mount();
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Runs", exact: true })
    .selectOptions("large");
  await page.getByText("Download HTML", { exact: true }).click();
  await expect
    .poll(() => state.downloads)
    .toEqual(["/_redeven_proxy/api/automation/runs/large/artifacts/report"]);
  expect(clicked).toHaveLength(1);
  expect(clicked[0]).toMatch(/^blob:/);
});
it.each(["light", "dark"])(
  "renders an accessible %s canvas at desktop and narrow widths",
  async (theme) => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    await mount();
    const result = await axe.run(host, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      element: host,
      path: "__screenshots__/automation-canvas-" + theme + ".png",
    });
    await page.viewport(390, 900);
    host.style.width = "390px";
    await page.screenshot({
      element: host,
      path: "__screenshots__/automation-canvas-" + theme + "-390.png",
    });
    expect(host.scrollWidth).toBeLessThanOrEqual(390);
    for (const button of host.querySelectorAll<HTMLButtonElement>(
      ".automation-toolbar-actions button,.automation-tabs button",
    )) {
      const bounds = button.getBoundingClientRect();
      const container = host.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(container.left);
      expect(bounds.right).toBeLessThanOrEqual(container.right);
    }
  },
);
