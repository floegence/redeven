// @vitest-environment jsdom

import {
  LayoutProvider,
  NotificationProvider,
} from "@floegence/floe-webapp-core";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitHistoryBrowser } from "./GitHistoryBrowser";

const mockGetCommitDetail = vi.hoisted(() => vi.fn());
const mockGetDiffContent = vi.hoisted(() => vi.fn());

const resizeObserverState = {
  observers: [] as Array<{
    callback: ResizeObserverCallback;
    elements: Element[];
  }>,
};

vi.mock("@floegence/floe-webapp-protocol", async () => {
  const actual = await vi.importActual<
    typeof import("@floegence/floe-webapp-protocol")
  >("@floegence/floe-webapp-protocol");
  return {
    ...actual,
    useProtocol: () => ({
      client: () => ({ connected: true }),
    }),
  };
});

vi.mock("../protocol/redeven_v1", async () => {
  const actual = await vi.importActual<typeof import("../protocol/redeven_v1")>(
    "../protocol/redeven_v1",
  );
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getCommitDetail: mockGetCommitDetail,
        getDiffContent: mockGetDiffContent,
      },
    }),
  };
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function defineElementWidth(element: Element, width: number) {
  Object.defineProperty(element, "offsetWidth", {
    configurable: true,
    get: () => width,
  });
}

function triggerResizeObservers() {
  for (const observer of resizeObserverState.observers) {
    observer.callback(
      observer.elements.map(
        (element) =>
          ({
            target: element,
            contentRect: {
              width: (element as HTMLElement).offsetWidth ?? 0,
              height: 0,
              top: 0,
              left: 0,
              bottom: 0,
              right: (element as HTMLElement).offsetWidth ?? 0,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
          }) as ResizeObserverEntry,
      ),
      {} as ResizeObserver,
    );
  }
}

async function setCommitOverviewWidth(host: HTMLElement, width: number) {
  const overview = host.querySelector(
    "[data-git-commit-overview-layout]",
  ) as HTMLElement | null;
  expect(overview).toBeTruthy();
  defineElementWidth(overview!, width);
  for (const observer of resizeObserverState.observers) {
    for (const element of observer.elements) {
      defineElementWidth(element, width);
    }
  }
  triggerResizeObservers();
  await flush();
  return host.querySelector(
    "[data-git-commit-overview-layout]",
  ) as HTMLElement;
}

beforeEach(() => {
  resizeObserverState.observers.length = 0;
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly record: {
        callback: ResizeObserverCallback;
        elements: Element[];
      };

      constructor(callback: ResizeObserverCallback) {
        this.record = {
          callback,
          elements: [],
        };
        resizeObserverState.observers.push(this.record);
      }

      observe(element: Element) {
        this.record.elements.push(element);
      }

      unobserve(element: Element) {
        this.record.elements = this.record.elements.filter(
          (entry) => entry !== element,
        );
      }

      disconnect() {
        this.record.elements = [];
      }
    },
  );

  mockGetCommitDetail.mockResolvedValue({
    repoRootPath: "/workspace/repo",
    commit: {
      hash: "3a47b67b1234567890",
      shortHash: "3a47b67b",
      parents: [],
      subject: "Refine bootstrap",
      body: ["Refine bootstrap", "", "Keep diff rendering stable."].join("\n"),
    },
    files: [
      {
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
    ],
  });
  mockGetDiffContent.mockResolvedValue({
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
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GitHistoryBrowser interactions", () => {
  it("shows the git sweep indicator while graph commit details are loading", async () => {
    mockGetCommitDetail.mockImplementationOnce(() => new Promise(() => {}));

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{
                  available: true,
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "3a47b67b1234567890",
                }}
                currentPath="/workspace/repo/src"
                selectedCommitHash="3a47b67b1234567890"
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      expect(host.textContent).toContain("Loading commit details...");
      expect(host.querySelector(".git-loading-indicator")).toBeTruthy();
      expect(host.querySelector(".floe-grid-cell")).toBeNull();
    } finally {
      dispose();
    }
  });

  it("renders merge commit presentation context alongside inline commit patches", async () => {
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "3a47b67b1234567890",
        shortHash: "3a47b67b",
        parents: ["1111111111111111", "2222222222222222"],
        subject: "Merge bootstrap fixes",
        body: ["Merge bootstrap fixes", "", "Keep diff rendering stable."].join(
          "\n",
        ),
      },
      presentation: {
        mode: "first_parent",
        mergeCommit: true,
        parentCount: 2,
      },
      files: [
        {
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
      ],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{
                  available: true,
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "3a47b67b1234567890",
                }}
                currentPath="/workspace/repo/src"
                selectedCommitHash="3a47b67b1234567890"
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      expect(host.textContent).toContain("Merge Commit");
      expect(host.textContent).toContain(
        "Compared with first parent so the changed-file list and diff view stay aligned.",
      );
      const mergeBadge = Array.from(host.querySelectorAll('span')).find((node) => node.textContent?.trim() === 'Merge Commit');
      expect(mergeBadge?.className).toContain('text-[var(--redeven-categorical-6)]');
      const fileButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("src/app.ts"),
      );
      expect(fileButton).toBeTruthy();
      fileButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      expect(document.body.textContent).toContain("Commit");
      expect(document.body.textContent).toContain("Files in Commit");
      expect(document.body.textContent).toContain("Copy Patch");
      expect(document.body.textContent).toContain("Merge Commit");
      expect(document.body.textContent).toContain("+newValue");
      expect(mockGetCommitDetail).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it("loads patch previews on demand when commit detail only returns file summaries", async () => {
    let resolvePreview:
      | ((value: Awaited<ReturnType<typeof mockGetDiffContent>>) => void)
      | undefined;
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "3a47b67b1234567890",
        shortHash: "3a47b67b",
        parents: [],
        subject: "Refine bootstrap",
        body: ["Refine bootstrap", "", "Keep diff rendering stable."].join(
          "\n",
        ),
      },
      files: [
        {
          changeType: "modified",
          path: "src/app.ts",
          displayPath: "src/app.ts",
          additions: 1,
          deletions: 1,
        },
      ],
    });
    mockGetDiffContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{
                  available: true,
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "3a47b67b1234567890",
                }}
                currentPath="/workspace/repo/src"
                selectedCommitHash="3a47b67b1234567890"
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      const fileButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("src/app.ts"),
      );
      expect(fileButton).toBeTruthy();

      fileButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

      expect(mockGetDiffContent.mock.calls[0]?.[0]).toMatchObject({
        repoRootPath: "/workspace/repo",
        sourceKind: "commit",
        commit: "3a47b67b1234567890",
        mode: "preview",
        file: {
          changeType: "modified",
          path: "src/app.ts",
        },
      });
      expect(document.body.textContent).toContain("Copy Patch");
      expect(document.body.textContent).toContain("+newValue");
    } finally {
      dispose();
    }
  });

  it("keeps the opened commit diff stable while the external graph selection changes", async () => {
    let resolvePreview:
      | ((value: Awaited<ReturnType<typeof mockGetDiffContent>>) => void)
      | undefined;
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "3a47b67b1234567890",
        shortHash: "3a47b67b",
        parents: [],
        subject: "Refine bootstrap",
        body: ["Refine bootstrap", "", "Keep diff rendering stable."].join(
          "\n",
        ),
      },
      files: [
        {
          changeType: "modified",
          path: "src/app.ts",
          displayPath: "src/app.ts",
          additions: 1,
          deletions: 1,
        },
      ],
    });
    mockGetDiffContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(() => {
      const [selectedCommitHash, setSelectedCommitHash] =
        createSignal("3a47b67b1234567890");
      return (
        <LayoutProvider>
          <NotificationProvider>
            <button type="button" onClick={() => setSelectedCommitHash("")}>
              Clear Selection
            </button>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{
                  available: true,
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "3a47b67b1234567890",
                }}
                currentPath="/workspace/repo/src"
                selectedCommitHash={selectedCommitHash()}
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      const fileButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("src/app.ts"),
      );
      expect(fileButton).toBeTruthy();

      fileButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain("Loading patch preview...");
      expect(document.body.textContent).not.toContain(
        "Select a file to inspect its diff.",
      );

      const clearButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Clear Selection"),
      );
      expect(clearButton).toBeTruthy();
      clearButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

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

      expect(document.body.textContent).toContain("Commit Diff");
      expect(document.body.textContent).toContain("+newValue");
    } finally {
      dispose();
    }
  });

  it("collapses normalized commit message details to two lines and lets the user expand them", async () => {
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "9750efa31234567890",
        shortHash: "9750efa3",
        parents: ["ef07ecc1234567890"],
        subject: "fix(region): avoid route props spread recursion",
        body: [
          "fix(region): avoid route props spread recursion",
          "",
          "Move route props out of the recursive spread path.",
          "Keep the branch shell stable during nested renders.",
          "Preserve layout hydration ordering for portal bootstrap.",
        ].join("\n"),
      },
      files: [],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{
                  available: true,
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "9750efa31234567890",
                }}
                currentPath="/workspace/repo/src"
                selectedCommitHash="9750efa31234567890"
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      const messageBlock = host.querySelector(
        "[data-git-commit-body]",
      ) as HTMLDivElement | null;
      const toggleButton = host.querySelector(
        "[data-git-commit-body-toggle]",
      ) as HTMLButtonElement | null;
      const bodyGroup = host.querySelector(
        "[data-git-commit-body-group]",
      ) as HTMLDivElement | null;

      expect(messageBlock).toBeTruthy();
      expect(bodyGroup).toBeTruthy();
      expect(toggleButton).toBeTruthy();
      expect(messageBlock?.closest("[data-git-commit-body-group]")).toBe(
        bodyGroup,
      );
      expect(toggleButton?.closest("[data-git-commit-body-group]")).toBe(
        bodyGroup,
      );
      expect(toggleButton?.parentElement?.className).toContain(
        "justify-start",
      );
      expect(toggleButton?.parentElement?.className).not.toContain(
        "justify-end",
      );
      expect(messageBlock?.textContent).not.toContain(
        "fix(region): avoid route props spread recursion",
      );
      expect(messageBlock?.getAttribute("style")).toContain(
        "-webkit-line-clamp: 2",
      );
      expect(toggleButton?.getAttribute("aria-expanded")).toBe("false");

      toggleButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      expect(toggleButton?.textContent).toContain("Show less");
      expect(toggleButton?.getAttribute("aria-expanded")).toBe("true");
      expect(messageBlock?.getAttribute("style") ?? "").not.toContain(
        "-webkit-line-clamp",
      );
    } finally {
      dispose();
    }
  });

  it("shows a commit-scoped Ask Flower action in graph detail", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onAskFlower = vi.fn();

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{
                  available: true,
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "3a47b67b1234567890",
                }}
                currentPath="/workspace/repo/src"
                selectedCommitHash="3a47b67b1234567890"
                onAskFlower={onAskFlower}
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      const askFlowerButton = host.querySelector(
        'button[aria-label="Ask Flower"]',
      ) as HTMLButtonElement | null;
      expect(askFlowerButton).toBeTruthy();
      expect(askFlowerButton?.dataset.gitShortcutOrb).toBe("flower");
      expect(askFlowerButton?.className).toContain("h-7");
      expect(askFlowerButton?.textContent).toBe("");

      askFlowerButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(onAskFlower).toHaveBeenCalledWith({
        kind: "commit",
        repoRootPath: "/workspace/repo",
        location: "graph",
        commit: {
          hash: "3a47b67b1234567890",
          shortHash: "3a47b67b",
          parents: [],
          subject: "Refine bootstrap",
          body: ["Refine bootstrap", "", "Keep diff rendering stable."].join(
            "\n",
          ),
        },
        files: [
          {
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
        ],
      });
    } finally {
      dispose();
    }
  });

  it("offers a graph action to detach HEAD at the selected commit", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onSwitchDetached = vi.fn();

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{
                  available: true,
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "3a47b67b1234567890",
                }}
                repoSummary={{
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "3a47b67b1234567890",
                  workspaceSummary: {
                    stagedCount: 0,
                    unstagedCount: 0,
                    untrackedCount: 0,
                    conflictedCount: 0,
                  },
                }}
                currentPath="/workspace/repo/src"
                selectedCommitHash="3a47b67b1234567890"
                onSwitchDetached={onSwitchDetached}
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      const detachButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Detach here"),
      ) as HTMLButtonElement | undefined;
      expect(detachButton).toBeTruthy();
      expect(detachButton?.disabled).toBe(false);

      detachButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(onSwitchDetached).toHaveBeenCalledWith({
        commitHash: "3a47b67b1234567890",
        shortHash: "3a47b67b",
        source: "graph",
      });
    } finally {
      dispose();
    }
  });

  it("switches graph commit detail between compact and inline container layouts", async () => {
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "a1b2c3d41234567890",
        shortHash: "a1b2c3d4",
        parents: ["1111111111111111"],
        subject: "fix(ui): refine branch layout",
        body: [
          "fix(ui): refine branch layout",
          "",
          "Move the commit details into a stable single-column reading flow.",
          "Keep the action rail close to the title and meta at narrow widths.",
          "Ensure the expansion control follows the body instead of floating away.",
        ].join("\n"),
      },
      files: [
        {
          changeType: "modified",
          path: "internal/envapp/ui_src/src/ui/widgets/GitBranchesPanel.tsx",
          displayPath:
            "internal/envapp/ui_src/src/ui/widgets/GitBranchesPanel.tsx",
          additions: 24,
          deletions: 8,
        },
        {
          changeType: "modified",
          path: "internal/envapp/ui_src/src/ui/widgets/GitHistoryBrowser.tsx",
          displayPath:
            "internal/envapp/ui_src/src/ui/widgets/GitHistoryBrowser.tsx",
          additions: 18,
          deletions: 6,
        },
      ],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const onSwitchDetached = vi.fn();
    const onAskFlower = vi.fn();

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <div class="h-[640px] w-[420px]">
              <GitHistoryBrowser
                repoInfo={{
                  available: true,
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "1111111111111111",
                }}
                repoSummary={{
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "1111111111111111",
                  workspaceSummary: {
                    stagedCount: 0,
                    unstagedCount: 0,
                    untrackedCount: 0,
                    conflictedCount: 0,
                  },
                }}
                currentPath="/workspace/repo/src"
                selectedCommitHash="a1b2c3d41234567890"
                onSwitchDetached={onSwitchDetached}
                onAskFlower={onAskFlower}
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      const compactOverview = await setCommitOverviewWidth(host, 420);

      const bodyGroup = host.querySelector(
        "[data-git-commit-body-group]",
      ) as HTMLElement | null;
      const toggleButton = host.querySelector(
        "[data-git-commit-body-toggle]",
      ) as HTMLButtonElement | null;
      const detachButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Detach here"),
      ) as HTMLButtonElement | undefined;

      expect(compactOverview.dataset.gitCommitOverviewLayout).toBe("compact");
      expect(detachButton?.className).not.toContain("w-full");
      expect(bodyGroup?.className).toContain("pl-0");
      expect(toggleButton).toBeTruthy();
      expect(toggleButton?.parentElement?.className).toContain(
        "justify-start",
      );
      expect(
        host.querySelector('[data-git-commit-files-list-layout="compact"]'),
      ).toBeTruthy();

      const stackedOverview = await setCommitOverviewWidth(host, 720);
      const stackedBodyGroup = host.querySelector(
        "[data-git-commit-body-group]",
      ) as HTMLElement | null;

      expect(stackedOverview.dataset.gitCommitOverviewLayout).toBe("stacked");
      expect(stackedBodyGroup?.className).toContain("pl-0");
      expect(
        host.querySelector('[data-git-commit-files-list-layout="compact"]'),
      ).toBeFalsy();
      expect(host.querySelectorAll("tbody tr")).toHaveLength(2);

      const inlineOverview = await setCommitOverviewWidth(host, 1040);
      const inlineBodyGroup = host.querySelector(
        "[data-git-commit-body-group]",
      ) as HTMLElement | null;

      expect(inlineOverview.dataset.gitCommitOverviewLayout).toBe("inline");
      expect(inlineBodyGroup?.className).toContain("pl-4");
      expect(
        host.querySelector('[data-git-commit-files-list-layout="compact"]'),
      ).toBeFalsy();
      expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  it("uses left-rail guidance before a commit is selected", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{
                  available: true,
                  repoRootPath: "/workspace/repo",
                  headRef: "main",
                  headCommit: "3a47b67b1234567890",
                }}
                currentPath="/workspace/repo/src"
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      expect(host.textContent).toContain(
        "Choose a commit from the left rail to load its details.",
      );
      expect(host.textContent).not.toContain(
        "Select a commit from the sidebar to inspect its details.",
      );
    } finally {
      dispose();
    }
  });

  it("offers commit-file handoffs from a stable history context target", async () => {
    const file = {
      changeType: "modified",
      path: "src/context.ts",
      displayPath: "src/context.ts",
      additions: 2,
      deletions: 1,
    };
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "context1234567890",
        shortHash: "context1",
        parents: ["parent123"],
        subject: "Context actions",
      },
      files: [file],
    });
    const askFlower = vi.fn();
    const openTerminal = vi.fn();
    const browseFiles = vi.fn();
    const previewCurrentFile = vi.fn();
    const copyText = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <div class="h-[640px]">
              <GitHistoryBrowser
                repoInfo={{ available: true, repoRootPath: "/workspace/repo", headRef: "main", headCommit: "context1234567890" }}
                currentPath="/workspace/repo/src"
                selectedCommitHash="context1234567890"
                onAskFlower={askFlower}
                onOpenInTerminal={openTerminal}
                onBrowseFiles={browseFiles}
                onPreviewCurrentFile={previewCurrentFile}
                onCopyText={copyText}
              />
            </div>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      const fileButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('src/context.ts'))!;
      const openMenu = async () => {
        fileButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await flush();
        return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      };

      let actions = await openMenu();
      expect(actions).toHaveLength(7);
      actions.find((action) => action.textContent?.includes('Ask Flower'))!.click();
      expect(askFlower).toHaveBeenCalledWith(expect.objectContaining({ kind: 'commit', files: [expect.objectContaining({ path: 'src/context.ts' })] }));

      actions = await openMenu();
      actions.find((action) => action.textContent?.includes('Preview Current File'))!.click();
      expect(previewCurrentFile).toHaveBeenCalledWith({
        absolutePath: '/workspace/repo/src/context.ts',
        parentDirectoryPath: '/workspace/repo/src',
        relativePath: 'src/context.ts',
        canPreviewCurrentFile: true,
      });

      actions = await openMenu();
      actions.find((action) => action.textContent?.includes('Open Terminal'))!.click();
      expect(openTerminal).toHaveBeenCalledWith({ path: '/workspace/repo/src' });

      actions = await openMenu();
      file.path = 'src/mutated.ts';
      actions.find((action) => action.textContent?.includes('Copy Absolute Path'))!.click();
      expect(copyText).toHaveBeenCalledWith('/workspace/repo/src/context.ts');
    } finally {
      dispose();
    }
  });

  it("opens the commit overview menu with stable detail and disabled detach reason", async () => {
    const detail = {
      hash: 'overview1234567890',
      shortHash: 'overview',
      parents: ['parent123'],
      subject: 'Stable overview',
      body: 'Overview body',
    };
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo',
      commit: detail,
      files: [{ changeType: 'modified', path: 'src/overview.ts' }],
    });
    const onAskFlower = vi.fn();
    const onCopyText = vi.fn();
    const onSwitchDetached = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <div class="h-[640px]">
            <GitHistoryBrowser
              repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: detail.hash }}
              repoSummary={{ repoRootPath: '/workspace/repo', detached: true, headCommit: detail.hash, workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 } }}
              currentPath="/workspace/repo"
              selectedCommitHash={detail.hash}
              onAskFlower={onAskFlower}
              onCopyText={onCopyText}
              onSwitchDetached={onSwitchDetached}
            />
          </div>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const overview = host.querySelector('[data-git-commit-overview-layout]') as HTMLElement | null;
      overview!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      detail.subject = 'Mutated overview';
      let actions = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      actions.find((item) => item.textContent?.includes('Ask Flower'))!.click();
      expect(onAskFlower).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'commit',
        commit: expect.objectContaining({ subject: 'Stable overview' }),
        files: [expect.objectContaining({ path: 'src/overview.ts' })],
      }));

      overview!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      actions = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const detach = actions.find((item) => item.textContent?.includes('Switch Detached'))!;
      expect(detach.getAttribute('aria-disabled')).toBe('true');
      expect(detach.title).toContain('Already detached');
      detach.click();
      expect(onSwitchDetached).not.toHaveBeenCalled();

      actions.find((item) => item.textContent?.includes('Copy Commit Hash'))!.click();
      expect(onCopyText).toHaveBeenCalledWith('overview1234567890');
    } finally {
      dispose();
    }
  });
});
