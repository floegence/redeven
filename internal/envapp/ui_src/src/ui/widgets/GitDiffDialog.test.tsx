// @vitest-environment jsdom

import {
  LayoutProvider,
  NotificationProvider,
} from "@floegence/floe-webapp-core";
import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDiffContent = vi.hoisted(() => vi.fn());
const previewWindowRenderStore = vi.hoisted(() => ({
  snapshots: [] as Array<{
    open: boolean;
    title: string;
    zIndex: number;
  }>,
}));

vi.mock("../protocol/redeven_v1", async () => {
  const actual = await vi.importActual<typeof import("../protocol/redeven_v1")>(
    "../protocol/redeven_v1",
  );
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getDiffContent: mockGetDiffContent,
      },
    }),
  };
});

vi.mock("./PreviewWindow", () => ({
  PreviewWindow: (props: {
    open?: boolean;
    title?: string;
    zIndex?: number;
    children?: JSX.Element;
  }) => {
    previewWindowRenderStore.snapshots.push({
      open: Boolean(props.open),
      title: String(props.title ?? ""),
      zIndex: Number(props.zIndex ?? 0),
    });
    return props.open ? (
      <div
        data-testid="preview-window"
        data-title={String(props.title ?? "")}
        data-z-index={String(props.zIndex ?? "")}
      >
        {props.children}
      </div>
    ) : null;
  },
}));

import { GitDiffDialog } from "./GitDiffDialog";

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });

  mockGetDiffContent.mockReset();
  previewWindowRenderStore.snapshots = [];
  mockGetDiffContent.mockResolvedValue({
    repoRootPath: "/workspace/repo",
    mode: "full",
    file: {
      changeType: "modified",
      path: "src/app.ts",
      displayPath: "src/app.ts",
      additions: 1,
      deletions: 1,
      patchText: [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,5 +1,5 @@",
        " context-before",
        " stable-line",
        "-oldMiddle();",
        "+newMiddle();",
        " context-after",
        " trailing-line",
      ].join("\n"),
    },
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("GitDiffDialog", () => {
  it("renders through an elevated desktop window when requested", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={{
                changeType: "modified",
                path: "src/app.ts",
                displayPath: "src/app.ts",
                patchText: [
                  "@@ -4,1 +4,1 @@",
                  "-oldMiddle();",
                  "+newMiddle();",
                ].join("\n"),
              }}
              source={{
                kind: "stash",
                repoRootPath: "/workspace/repo",
                stashId: "stash-1",
              }}
              title="Stash Diff"
              description="src/app.ts"
              emptyMessage="Select a file to inspect its diff."
              desktopWindowZIndex={220}
            />
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      const previewWindow = document.querySelector(
        '[data-testid="preview-window"]',
      ) as HTMLDivElement | null;
      expect(previewWindow).toBeTruthy();
      expect(previewWindow?.dataset.title).toBe("Stash Diff");
      expect(previewWindow?.dataset.zIndex).toBe("220");
      expect(document.body.textContent).toContain("src/app.ts");
      expect(document.body.textContent).toContain("Patch");
      expect(previewWindowRenderStore.snapshots.at(-1)).toMatchObject({
        open: true,
        title: "Stash Diff",
        zIndex: 220,
      });
    } finally {
      dispose();
    }
  });

  it("keeps patch mode as the default and fetches full context only on demand", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={{
                changeType: "modified",
                path: "src/app.ts",
                displayPath: "src/app.ts",
                additions: 1,
                deletions: 1,
                patchText: [
                  "@@ -4,1 +4,1 @@",
                  "-oldMiddle();",
                  "+newMiddle();",
                ].join("\n"),
              }}
              source={{
                kind: "commit",
                repoRootPath: "/workspace/repo",
                commit: "abc123",
              }}
              title="Commit Diff"
              emptyMessage="Select a file to inspect its diff."
            />
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      expect(document.body.textContent).toContain("Patch");
      expect(document.body.textContent).toContain("Full Context");
      expect(document.body.textContent).toContain(
        "Loads a single-file patch on demand.",
      );
      expect(document.body.textContent).toContain("newMiddle();");
      expect(mockGetDiffContent).not.toHaveBeenCalled();

      const patchButton = Array.from(document.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Patch",
      );
      const fullContextButton = Array.from(
        document.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Full Context");
      expect(patchButton).toBeTruthy();
      expect(fullContextButton).toBeTruthy();
      expect(patchButton!.className).toContain("cursor-pointer");
      expect(fullContextButton!.className).toContain("cursor-pointer");
      expect(fullContextButton!.className).toContain(
        "disabled:cursor-not-allowed",
      );
      fullContextButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(mockGetDiffContent.mock.calls[0]?.[0]).toMatchObject({
        repoRootPath: "/workspace/repo",
        sourceKind: "commit",
        commit: "abc123",
        mode: "full",
        file: {
          changeType: "modified",
          path: "src/app.ts",
        },
      });
      expect(document.body.textContent).toContain(
        "Includes unchanged lines for broader review context.",
      );
      expect(document.body.textContent).toContain("context-before");
      expect(document.body.textContent).toContain("trailing-line");
    } finally {
      dispose();
    }
  });

  it("shows merge first-parent context for commit diffs without changing the request payload", async () => {
    mockGetDiffContent.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo",
      mode: "full",
      presentation: {
        mode: "first_parent",
        mergeCommit: true,
        parentCount: 2,
      },
      file: {
        changeType: "modified",
        path: "src/app.ts",
        displayPath: "src/app.ts",
        additions: 1,
        deletions: 1,
        patchText: [
          "diff --git a/src/app.ts b/src/app.ts",
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1 +1 @@",
          "-oldValue",
          "+newValue",
        ].join("\n"),
      },
    });

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={{
                changeType: "modified",
                path: "src/app.ts",
                displayPath: "src/app.ts",
                additions: 1,
                deletions: 1,
                patchText: ["@@ -1 +1 @@", "-oldValue", "+newValue"].join("\n"),
              }}
              source={{
                kind: "commit",
                repoRootPath: "/workspace/repo",
                commit: "abc123",
                presentation: {
                  mode: "first_parent",
                  mergeCommit: true,
                  parentCount: 2,
                },
              }}
              title="Commit Diff"
              emptyMessage="Select a file to inspect its diff."
            />
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      expect(document.body.textContent).toContain("Merge Commit");
      expect(document.body.textContent).toContain(
        "Compared with first parent so the changed-file list and diff view stay aligned.",
      );

      const fullContextButton = Array.from(
        document.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Full Context");
      expect(fullContextButton).toBeTruthy();
      fullContextButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(mockGetDiffContent.mock.calls[0]?.[0]).toEqual({
        repoRootPath: "/workspace/repo",
        sourceKind: "commit",
        commit: "abc123",
        mode: "full",
        file: {
          changeType: "modified",
          path: "src/app.ts",
          oldPath: undefined,
          newPath: undefined,
        },
      });
      expect(document.body.textContent).toContain("newValue");
    } finally {
      dispose();
    }
  });

  it("keeps the existing patch preview visible while full context is loading", async () => {
    let resolveFullContext:
      | ((value: Awaited<ReturnType<typeof mockGetDiffContent>>) => void)
      | undefined;
    mockGetDiffContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFullContext = resolve;
        }),
    );

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={{
                changeType: "modified",
                path: "src/app.ts",
                displayPath: "src/app.ts",
                additions: 1,
                deletions: 1,
                patchText: [
                  "@@ -4,1 +4,1 @@",
                  "-oldMiddle();",
                  "+newMiddle();",
                ].join("\n"),
              }}
              source={{
                kind: "commit",
                repoRootPath: "/workspace/repo",
                commit: "abc123",
              }}
              title="Commit Diff"
              emptyMessage="Select a file to inspect its diff."
            />
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      const fullContextButton = Array.from(
        document.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Full Context");
      expect(fullContextButton).toBeTruthy();
      fullContextButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(
        "Loading full-context diff...",
      );
      expect(document.body.textContent).toContain("newMiddle();");
      expect(resolveFullContext).toBeTruthy();

      resolveFullContext!({
        repoRootPath: "/workspace/repo",
        file: {
          changeType: "modified",
          path: "src/app.ts",
          displayPath: "src/app.ts",
          additions: 1,
          deletions: 1,
          patchText: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1,5 +1,5 @@",
            " context-before",
            " stable-line",
            "-oldMiddle();",
            "+newMiddle();",
            " context-after",
            " trailing-line",
          ].join("\n"),
        },
      });
      await flush();

      expect(document.body.textContent).toContain(
        "Includes unchanged lines for broader review context.",
      );
      expect(document.body.textContent).toContain("context-before");
      expect(document.body.textContent).not.toContain(
        "Loading full-context diff...",
      );
    } finally {
      dispose();
    }
  });

  it("shows a loading state instead of the empty selection message while the first patch preview is pending", async () => {
    let resolvePreview:
      | ((value: Awaited<ReturnType<typeof mockGetDiffContent>>) => void)
      | undefined;
    mockGetDiffContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(() => {
      const [open, setOpen] = createSignal(false);
      return (
        <LayoutProvider>
          <NotificationProvider>
            <button type="button" onClick={() => setOpen(true)}>
              Open Diff
            </button>
            <GitDiffDialog
              open={open()}
              onOpenChange={() => {}}
              item={{
                changeType: "modified",
                path: "src/app.ts",
                displayPath: "src/app.ts",
                additions: 1,
                deletions: 1,
              }}
              source={{
                kind: "commit",
                repoRootPath: "/workspace/repo",
                commit: "abc123",
              }}
              title="Commit Diff"
              emptyMessage="Select a file to inspect its diff."
            />
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const openButton = Array.from(document.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Open Diff",
      );
      expect(openButton).toBeTruthy();

      openButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain("Loading patch preview...");
      expect(document.body.textContent).not.toContain(
        "Select a file to inspect its diff.",
      );

      resolvePreview?.({
        repoRootPath: "/workspace/repo",
        mode: "preview",
        file: {
          changeType: "modified",
          path: "src/app.ts",
          displayPath: "src/app.ts",
          additions: 1,
          deletions: 1,
          patchText: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-oldValue",
            "+newValue",
          ].join("\n"),
        },
      });
      await flush();

      expect(document.body.textContent).toContain("+newValue");
    } finally {
      dispose();
    }
  });

  it("keeps unavailable full-context mode visibly disabled with a non-clickable cursor affordance", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={{
                changeType: "modified",
                path: "src/app.ts",
                displayPath: "src/app.ts",
                patchText: [
                  "@@ -4,1 +4,1 @@",
                  "-oldMiddle();",
                  "+newMiddle();",
                ].join("\n"),
              }}
              title="Workspace Diff"
              emptyMessage="Select a file to inspect its diff."
            />
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      const patchButton = Array.from(document.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Patch",
      );
      const fullContextButton = Array.from(
        document.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Full Context") as
        | HTMLButtonElement
        | undefined;
      expect(patchButton).toBeTruthy();
      expect(fullContextButton).toBeTruthy();
      expect(patchButton!.className).toContain("cursor-pointer");
      expect(fullContextButton!.className).toContain("cursor-pointer");
      expect(fullContextButton!.className).toContain(
        "disabled:cursor-not-allowed",
      );
      expect(fullContextButton!.disabled).toBe(true);
    } finally {
      dispose();
    }
  });

  it("resets back to patch mode when the selected file changes", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(() => {
      const [selection, setSelection] = createSignal<"first" | "second">(
        "first",
      );
      return (
        <LayoutProvider>
          <NotificationProvider>
            <button type="button" onClick={() => setSelection("second")}>
              Swap File
            </button>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={
                selection() === "first"
                  ? {
                      changeType: "modified",
                      path: "src/app.ts",
                      displayPath: "src/app.ts",
                      patchText: [
                        "@@ -4,1 +4,1 @@",
                        "-oldMiddle();",
                        "+newMiddle();",
                      ].join("\n"),
                    }
                  : {
                      changeType: "modified",
                      path: "src/other.ts",
                      displayPath: "src/other.ts",
                      patchText: [
                        "@@ -2,1 +2,1 @@",
                        "-beforeSwap();",
                        "+afterSwap();",
                      ].join("\n"),
                    }
              }
              source={
                selection() === "first"
                  ? {
                      kind: "commit",
                      repoRootPath: "/workspace/repo",
                      commit: "abc123",
                    }
                  : {
                      kind: "commit",
                      repoRootPath: "/workspace/repo",
                      commit: "def456",
                    }
              }
              title="Commit Diff"
              emptyMessage="Select a file to inspect its diff."
            />
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const fullContextButton = Array.from(
        document.querySelectorAll("button"),
      ).find((node) => node.textContent?.includes("Full Context"));
      expect(fullContextButton).toBeTruthy();
      fullContextButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain("context-before");

      const swapButton = Array.from(document.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Swap File"),
      );
      expect(swapButton).toBeTruthy();
      swapButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      expect(document.body.textContent).toContain(
        "Loads a single-file patch on demand.",
      );
      expect(document.body.textContent).toContain("afterSwap();");
      expect(document.body.textContent).not.toContain("context-before");
      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it("shows an error state when the full-context request fails", async () => {
    mockGetDiffContent.mockRejectedValueOnce(new Error("full context failed"));

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={{
                changeType: "modified",
                path: "src/app.ts",
                displayPath: "src/app.ts",
                patchText: [
                  "@@ -4,1 +4,1 @@",
                  "-oldMiddle();",
                  "+newMiddle();",
                ].join("\n"),
              }}
              source={{
                kind: "compare",
                repoRootPath: "/workspace/repo",
                baseRef: "main",
                targetRef: "feature/demo",
              }}
              title="Compare Diff"
              emptyMessage="Select a file to inspect its diff."
            />
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      const fullContextButton = Array.from(
        document.querySelectorAll("button"),
      ).find((node) => node.textContent?.includes("Full Context"));
      expect(fullContextButton).toBeTruthy();
      fullContextButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain("full context failed");
    } finally {
      dispose();
    }
  });

  it("supports caller-formatted stash diff errors without leaking raw git output", async () => {
    mockGetDiffContent.mockRejectedValueOnce(
      new Error(
        "git stash show --patch stash@{0} -- src/app.ts failed: Too many revisions specified",
      ),
    );

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={{
                changeType: "modified",
                path: "src/app.ts",
                displayPath: "src/app.ts",
                patchText: [
                  "@@ -4,1 +4,1 @@",
                  "-oldMiddle();",
                  "+newMiddle();",
                ].join("\n"),
              }}
              source={{
                kind: "stash",
                repoRootPath: "/workspace/repo",
                stashId: "stash-1",
              }}
              title="Stash Diff"
              emptyMessage="Select a file to inspect its diff."
              errorFormatter={() => ({
                message: "Could not load the selected stash patch.",
                detail: "Refresh the stash list and try again.",
              })}
            />
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      const fullContextButton = Array.from(
        document.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Full Context");
      expect(fullContextButton).toBeTruthy();
      fullContextButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(
        "Could not load the selected stash patch.",
      );
      expect(document.body.textContent).toContain(
        "Refresh the stash list and try again.",
      );
      expect(document.body.textContent).not.toContain(
        "Too many revisions specified",
      );
      expect(document.body.textContent).not.toContain("git stash show");
    } finally {
      dispose();
    }
  });

  it("shows directory placeholders as unavailable without requesting diff content", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <GitDiffDialog
              open
              onOpenChange={() => {}}
              item={{
                changeType: "added",
                path: "node_modules/",
                displayPath: "node_modules/",
                additions: 0,
                deletions: 0,
              }}
              source={{
                kind: "workspace",
                repoRootPath: "/workspace/repo",
                workspaceSection: "untracked",
              }}
              title="Workspace Diff"
              emptyMessage="Select a file to inspect its diff."
            />
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      expect(mockGetDiffContent).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain(
        "Directory entries do not expose a single-file diff preview.",
      );
      expect(document.body.textContent).toContain(
        "Diff preview is unavailable for directory entries.",
      );

      const fullContextButton = Array.from(
        document.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Full Context") as
        | HTMLButtonElement
        | undefined;
      expect(fullContextButton).toBeTruthy();
      expect(fullContextButton!.disabled).toBe(true);
    } finally {
      dispose();
    }
  });
});
