// @vitest-environment jsdom

import {
  LayoutProvider,
  NotificationProvider,
} from "@floegence/floe-webapp-core";
import { ProtocolProvider } from "@floegence/floe-webapp-protocol";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCommitDetail = vi.fn();
const mockGetBranchCompare = vi.fn();
const mockListWorkspacePage = vi.fn();
const mockGetDiffContent = vi.fn();

vi.mock("../protocol/redeven_v1", async () => {
  const actual = await vi.importActual<typeof import("../protocol/redeven_v1")>(
    "../protocol/redeven_v1",
  );
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getCommitDetail: mockGetCommitDetail,
        getBranchCompare: mockGetBranchCompare,
        getDiffContent: mockGetDiffContent,
        listWorkspacePage: mockListWorkspacePage,
      },
    }),
  };
});

import {
  redevenV1Contract,
  type GitBranchSummary,
} from "../protocol/redeven_v1";
import { GitBranchesPanel } from "./GitBranchesPanel";

const resizeObserverState = {
  observers: [] as Array<{
    callback: ResizeObserverCallback;
    elements: Element[];
  }>,
};

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

async function setBranchHeaderWidth(
  host: HTMLElement,
  width: number,
): Promise<HTMLElement> {
  const header = host.querySelector(
    "[data-git-branch-header-layout]",
  ) as HTMLElement | null;
  expect(header).toBeTruthy();
  defineElementWidth(header!, width);
  triggerResizeObservers();
  await flush();
  return header!;
}

async function clickDropdownMenuItem(
  trigger: HTMLButtonElement | null | undefined,
  label: string,
) {
  expect(trigger).toBeTruthy();
  trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();

  const menuItem = Array.from(
    document.body.querySelectorAll('[role="menu"] button'),
  ).find((node) => node.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined;
  expect(menuItem).toBeTruthy();
  menuItem!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();
}

beforeEach(() => {
  vi.stubGlobal("queueMicrotask", (callback: VoidFunction) => callback());
  mockGetCommitDetail.mockReset();
  mockGetBranchCompare.mockReset();
  mockListWorkspacePage.mockReset();
  mockGetDiffContent.mockReset();
  resizeObserverState.observers.length = 0;
  mockGetCommitDetail.mockResolvedValue({
    repoRootPath: "/workspace/repo",
    commit: {
      hash: "2222222222222222",
      shortHash: "22222222",
      parents: ["1111111111111111"],
      subject: "Merge feature",
    },
    files: [],
  });
  mockGetBranchCompare.mockResolvedValue({
    repoRootPath: "/workspace/repo",
    baseRef: "main",
    targetRef: "feature/demo",
    aheadCount: 1,
    behindCount: 0,
    mergeBase: "abc1234",
    commits: [],
    files: [
      {
        changeType: "modified",
        path: "src/compare.ts",
        displayPath: "src/compare.ts",
        additions: 12,
        deletions: 4,
        patchText: "@@ -1 +1 @@\n-before\n+after",
      },
    ],
  });
  mockGetDiffContent.mockResolvedValue({
    repoRootPath: "/workspace/repo",
    mode: "preview",
    file: {
      changeType: "modified",
      path: "src/compare.ts",
      displayPath: "src/compare.ts",
      additions: 12,
      deletions: 4,
      patchText: "@@ -1 +1 @@\n-before\n+after",
    },
  });
  mockListWorkspacePage.mockResolvedValue({
    repoRootPath: "/workspace/repo-linked",
    section: "changes",
    summary: {
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
    },
    totalCount: 0,
    offset: 0,
    nextOffset: 0,
    hasMore: false,
    items: [],
  });

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
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function revealTooltipForButton(
  button: HTMLButtonElement | undefined,
): Promise<HTMLElement | null> {
  const host = button?.closest(
    "[data-redeven-tooltip-anchor]",
  ) as HTMLElement | null;
  expect(host).toBeTruthy();
  host!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  await flush();
  return document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
}

describe("GitBranchesPanel interactions", () => {
  it("loads current branch status from the active worktree root", async () => {
    let checkoutCount = 0;
    let mergeCount = 0;
    let deleteCount = 0;
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: {
        stagedCount: 1,
        unstagedCount: 1,
        untrackedCount: 1,
        conflictedCount: 0,
      },
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/linked.ts",
          displayPath: "src/linked.ts",
          additions: 2,
          deletions: 1,
          patchText: "@@ -1 +1 @@",
        },
        {
          section: "untracked",
          changeType: "added",
          path: "notes.txt",
          displayPath: "notes.txt",
        },
      ],
    });

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo-linked"
                  repoSummary={{
                    repoRootPath: "/workspace/repo-linked",
                    headRef: "feature/demo",
                    headCommit: "abc1234",
                    workspaceSummary: {
                      stagedCount: 1,
                      unstagedCount: 2,
                      untrackedCount: 1,
                      conflictedCount: 0,
                    },
                  }}
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                    current: true,
                    aheadCount: 2,
                    behindCount: 1,
                    upstreamRef: "origin/feature/demo",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "feature/demo",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                      },
                      {
                        name: "feature/demo",
                        fullName: "refs/heads/feature/demo",
                        kind: "local",
                        current: true,
                      },
                    ],
                    remote: [],
                  }}
                  onCheckoutBranch={() => {
                    checkoutCount += 1;
                  }}
                  onMergeBranch={() => {
                    mergeCount += 1;
                  }}
                  onDeleteBranch={() => {
                    deleteCount += 1;
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      expect(mockListWorkspacePage).toHaveBeenCalledWith({
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain("Status");
      expect(host.textContent).toContain("History");
      expect(host.querySelector('button[aria-label="Compare"]')).toBeTruthy();
      expect(host.textContent).toContain("Checkout");
      expect(host.textContent).toContain("Merge");
      expect(host.textContent).toContain("Delete");
      expect(host.textContent).toContain("src/linked.ts");
      expect(host.textContent).toContain("notes.txt");
      expect(host.textContent).toContain("origin/feature/demo");
      expect(host.textContent).not.toContain(
        "Current · Upstream origin/feature/demo",
      );
      expect(host.textContent).toContain("Changes");
      expect(host.textContent).toContain("Staged");
      expect(host.textContent).toContain("Unstaged");
      expect(host.textContent).toContain("Untracked");
      expect(host.textContent).toContain("View Diff");
      expect(host.textContent).not.toContain(
        "Select another branch to merge into the current branch.",
      );
      expect(host.textContent).not.toContain(
        "Switch to another branch before deleting it.",
      );
      expect(host.textContent).not.toContain("pending review");
      const changesButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Changes"),
      ) as HTMLButtonElement | undefined;
      const unstagedButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Unstaged"),
      ) as HTMLButtonElement | undefined;
      const untrackedButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Untracked"),
      ) as HTMLButtonElement | undefined;
      const conflictedButton = Array.from(host.querySelectorAll("button")).find(
        (node) =>
          node.getAttribute("aria-label")?.startsWith("Conflicted:"),
      ) as HTMLButtonElement | undefined;
      const stagedButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Staged"),
      ) as HTMLButtonElement | undefined;
      const checkoutButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Checkout"),
      ) as HTMLButtonElement | undefined;
      const mergeButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Merge",
      ) as HTMLButtonElement | undefined;
      const deleteButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Delete",
      ) as HTMLButtonElement | undefined;
      expect(changesButton).toBeTruthy();
      expect(changesButton?.getAttribute("aria-pressed")).toBe("true");
      expect(changesButton?.getAttribute("aria-label")).toBe(
        "Changes: 2 files",
      );
      expect(changesButton?.className).toContain("cursor-pointer");
      expect(changesButton?.className).toContain("rounded-md");
      expect(changesButton?.className).toContain("git-browser-selection-surface");
      expect(unstagedButton).toBeFalsy();
      expect(untrackedButton).toBeFalsy();
      expect(conflictedButton?.getAttribute("aria-pressed")).toBe("false");
      expect(conflictedButton?.getAttribute("aria-label")).toBe(
        "Conflicted: No files",
      );
      expect(stagedButton?.getAttribute("aria-pressed")).toBe("false");
      expect(stagedButton?.getAttribute("aria-label")).toBe("Staged: 1 file");
      expect(checkoutButton).toBeTruthy();
      expect(mergeButton).toBeTruthy();
      expect(deleteButton).toBeTruthy();
      expect(checkoutButton?.disabled).toBe(true);
      expect(mergeButton?.disabled).toBe(true);
      expect(deleteButton?.disabled).toBe(true);
      expect(checkoutCount).toBe(0);
      expect(mergeCount).toBe(0);
      expect(deleteCount).toBe(0);
    } finally {
      dispose();
    }
  });

  it("keeps paged branch totals in footer copy without inventing unloaded scroll space", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 1,
        conflictedCount: 0,
      },
      totalCount: 40,
      offset: 0,
      nextOffset: 2,
      hasMore: true,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/linked.ts",
          displayPath: "src/linked.ts",
          additions: 2,
          deletions: 1,
          patchText: "@@ -1 +1 @@",
        },
        {
          section: "untracked",
          changeType: "added",
          path: "notes.txt",
          displayPath: "notes.txt",
        },
      ],
    });

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo-linked"
                  repoSummary={{
                    repoRootPath: "/workspace/repo-linked",
                    headRef: "feature/demo",
                    headCommit: "abc1234",
                    workspaceSummary: {
                      stagedCount: 0,
                      unstagedCount: 1,
                      untrackedCount: 1,
                      conflictedCount: 0,
                    },
                  }}
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                    current: true,
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo-linked",
                    currentRef: "feature/demo",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                      },
                      {
                        name: "feature/demo",
                        fullName: "refs/heads/feature/demo",
                        kind: "local",
                        current: true,
                      },
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      expect(host.textContent).toContain("Showing 2 of 40 files.");
      expect(host.textContent).toContain("src/linked.ts");
      expect(host.textContent).toContain("notes.txt");
      expect(host.querySelectorAll('tr[aria-hidden="true"] td')).toHaveLength(
        0,
      );
    } finally {
      dispose();
    }
  });

  it("renders semantic branch identity and status summary surfaces", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/linked.ts",
          displayPath: "src/linked.ts",
          additions: 2,
          deletions: 1,
          patchText: "@@ -1 +1 @@",
        },
      ],
    });

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo-linked"
                  repoSummary={{
                    repoRootPath: "/workspace/repo-linked",
                    headRef: "feature/demo",
                    headCommit: "abc1234",
                    workspaceSummary: {
                      stagedCount: 0,
                      unstagedCount: 1,
                      untrackedCount: 0,
                      conflictedCount: 0,
                    },
                  }}
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                    current: true,
                    upstreamRef: "origin/feature/demo",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo-linked",
                    currentRef: "feature/demo",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                      },
                      {
                        name: "feature/demo",
                        fullName: "refs/heads/feature/demo",
                        kind: "local",
                        current: true,
                      },
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      expect(host.textContent).toContain("feature/demo");
      expect(host.textContent).toContain("Current");
      expect(host.querySelector('[data-git-branch-header-layout]')).toBeTruthy();
      expect(host.querySelector('[data-git-branch-status-summary-state="ready"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it("enables checkout for a non-current remote branch", async () => {
    let checkoutBranch: string | undefined;
    let mergeBranch: string | undefined;
    let deleteBranch: string | undefined;
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "origin/feature/demo",
                    fullName: "refs/remotes/origin/feature/demo",
                    kind: "remote",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                    ],
                    remote: [
                      {
                        name: "origin/feature/demo",
                        fullName: "refs/remotes/origin/feature/demo",
                        kind: "remote",
                      },
                    ],
                  }}
                  onCheckoutBranch={(branch) => {
                    checkoutBranch = branch.name;
                  }}
                  onMergeBranch={(branch) => {
                    mergeBranch = branch.name;
                  }}
                  onDeleteBranch={(branch) => {
                    deleteBranch = branch.name;
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      expect(host.textContent).toContain("Status unavailable");
      expect(host.textContent).toContain(
        "Remote branches are not checked out in the active worktree.",
      );
      expect(host.textContent).toContain(
        "Check out this branch locally to review workspace changes.",
      );
      expect(
        host.querySelector('[data-git-branch-status-unavailable="true"]'),
      ).toBeTruthy();
      expect(
        host.querySelector('[data-git-branch-stable-placeholder="status"]'),
      ).toBeFalsy();
      expect(host.textContent).not.toContain(
        "Status is only available for checked-out local worktrees.",
      );
      expect(mockListWorkspacePage).not.toHaveBeenCalled();
      const checkoutButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Checkout"),
      ) as HTMLButtonElement | undefined;
      const mergeButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Merge",
      ) as HTMLButtonElement | undefined;
      const deleteButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Delete",
      ) as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();
      expect(mergeButton).toBeTruthy();
      expect(deleteButton).toBeFalsy();
      expect(checkoutButton?.disabled).toBe(false);
      expect(mergeButton?.disabled).toBe(false);
      checkoutButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      mergeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(checkoutBranch).toBe("origin/feature/demo");
      expect(mergeBranch).toBe("origin/feature/demo");
      expect(deleteBranch).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it("loads linked worktree branch status from the linked worktree root", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 1,
        conflictedCount: 0,
      },
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/linked.ts",
          displayPath: "src/linked.ts",
          additions: 3,
          deletions: 1,
          patchText: "@@ -1 +1 @@\n-before\n+after",
        },
        {
          section: "untracked",
          changeType: "added",
          path: "scratch.txt",
          displayPath: "scratch.txt",
          patchText: "@@ -0,0 +1 @@\n+scratch",
        },
      ],
    });

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/linked",
                    fullName: "refs/heads/feature/linked",
                    kind: "local",
                    worktreePath: "/workspace/repo-linked",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      {
                        name: "feature/linked",
                        fullName: "refs/heads/feature/linked",
                        kind: "local",
                        worktreePath: "/workspace/repo-linked",
                      },
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      expect(mockListWorkspacePage).toHaveBeenCalledWith({
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain("src/linked.ts");
      expect(host.textContent).toContain("scratch.txt");
      expect(host.textContent).toContain("Changes");
      expect(host.textContent).toContain("View Diff");

      const changesButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Changes"),
      ) as HTMLButtonElement | undefined;
      const untrackedButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Untracked"),
      ) as HTMLButtonElement | undefined;
      expect(changesButton).toBeTruthy();
      expect(untrackedButton).toBeFalsy();
    } finally {
      dispose();
    }
  });

  it("renders branch-status directory rows from the paged changes snapshot", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      directoryPath: "",
      breadcrumbs: [{ label: "repo-linked", path: "" }],
      summary: {
        stagedCount: 0,
        unstagedCount: 5,
        untrackedCount: 3,
        conflictedCount: 0,
      },
      scopeFileCount: 8,
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        {
          section: "changes",
          entryKind: "directory",
          path: "internal",
          displayPath: "internal",
          directoryPath: "internal",
          descendantFileCount: 8,
          containsUnstaged: true,
          containsUntracked: true,
        },
      ],
    });

    const branch = {
      name: "feat-workbench-appearance",
      fullName: "refs/heads/feat-workbench-appearance",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      expect(host.textContent).toContain("internal");
      expect(host.textContent).toContain("Folder");
      expect(host.textContent).toContain("8 files");
      expect(host.textContent).toContain("Open Folder");
      expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
      expect(host.textContent).not.toContain(
        "No pending files are available in this worktree.",
      );
    } finally {
      dispose();
    }
  });

  it("renders a polished branch-status empty table when the worktree has no pending files", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      directoryPath: "",
      breadcrumbs: [{ label: "repo-linked", path: "" }],
      summary: {
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      scopeFileCount: 0,
      totalCount: 0,
      offset: 0,
      nextOffset: 0,
      hasMore: false,
      items: [],
    });

    const branch = {
      name: "feature/clean-worktree",
      fullName: "refs/heads/feature/clean-worktree",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      const contentFrame = host.querySelector(
        '[data-git-branch-status-content-frame="true"]',
      );
      const emptyTable = contentFrame?.querySelector(
        '[data-git-branch-status-empty-table="true"]',
      );
      const emptyState = emptyTable?.querySelector(
        '.git-branch-status-empty-state[data-git-branch-status-empty-section="changes"]',
      );
      const emptyHeader = emptyTable?.querySelector(
        ".git-branch-status-empty-table__header",
      );

      expect(contentFrame).toBeTruthy();
      expect(emptyTable).toBeTruthy();
      expect(emptyState).toBeTruthy();
      expect(emptyHeader?.textContent).toContain("Path");
      expect(emptyHeader?.textContent).toContain("Section");
      expect(emptyHeader?.textContent).toContain("Status");
      expect(emptyHeader?.textContent).toContain("Changes");
      expect(emptyHeader?.textContent).toContain("Action");
      expect(emptyState?.textContent).toContain("No pending files");
      expect(emptyState?.textContent).toContain("This worktree is clean.");
      expect(
        emptyState?.querySelector(".git-branch-status-empty-state__mark svg"),
      ).toBeTruthy();
      expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
      expect(host.textContent).not.toContain(
        "No pending files are available in this worktree.",
      );
    } finally {
      dispose();
    }
  });

  it("renders branch-status rows as a table at narrow measured widths", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      directoryPath: "",
      breadcrumbs: [{ label: "repo-linked", path: "" }],
      summary: {
        stagedCount: 0,
        unstagedCount: 5,
        untrackedCount: 3,
        conflictedCount: 0,
      },
      scopeFileCount: 8,
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        {
          section: "changes",
          entryKind: "directory",
          path: "internal",
          displayPath: "internal",
          directoryPath: "internal",
          descendantFileCount: 8,
          containsUnstaged: true,
          containsUntracked: true,
        },
      ],
    });

    const branch = {
      name: "feat-workbench-appearance",
      fullName: "refs/heads/feat-workbench-appearance",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px] w-[420px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      const header = await setBranchHeaderWidth(host, 420);

      expect(header.dataset.gitBranchHeaderLayout).toBe("compact");
      expect(host.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
      expect(host.textContent).toContain("internal");
      expect(host.textContent).toContain("Folder");
      expect(host.textContent).toContain("Unstaged");
      expect(host.textContent).toContain("Untracked");
      expect(host.textContent).toContain("8 files");
      expect(host.textContent).toContain("Open Folder");
    } finally {
      dispose();
    }
  });

  it("drills into branch-status change directories and lets breadcrumbs navigate back out", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage
      .mockResolvedValueOnce({
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        directoryPath: "",
        breadcrumbs: [{ label: "repo-linked", path: "" }],
        summary: {
          stagedCount: 0,
          unstagedCount: 2,
          untrackedCount: 0,
          conflictedCount: 0,
        },
        scopeFileCount: 2,
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          {
            section: "changes",
            entryKind: "directory",
            path: "internal",
            displayPath: "internal",
            directoryPath: "internal",
            descendantFileCount: 2,
            containsUnstaged: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        directoryPath: "internal",
        breadcrumbs: [
          { label: "repo-linked", path: "" },
          { label: "internal", path: "internal" },
        ],
        summary: {
          stagedCount: 0,
          unstagedCount: 2,
          untrackedCount: 0,
          conflictedCount: 0,
        },
        scopeFileCount: 2,
        totalCount: 2,
        offset: 0,
        nextOffset: 2,
        hasMore: false,
        items: [
          {
            section: "unstaged",
            changeType: "modified",
            path: "internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx",
            displayPath: "internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx",
            additions: 3,
            deletions: 1,
          },
          {
            section: "unstaged",
            changeType: "modified",
            path: "internal/envapp/ui_src/src/styles/redeven.css",
            displayPath: "internal/envapp/ui_src/src/styles/redeven.css",
            additions: 10,
            deletions: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        directoryPath: "",
        breadcrumbs: [{ label: "repo-linked", path: "" }],
        summary: {
          stagedCount: 0,
          unstagedCount: 2,
          untrackedCount: 0,
          conflictedCount: 0,
        },
        scopeFileCount: 2,
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          {
            section: "changes",
            entryKind: "directory",
            path: "internal",
            displayPath: "internal",
            directoryPath: "internal",
            descendantFileCount: 2,
            containsUnstaged: true,
          },
        ],
      });

    const branch = {
      name: "feat-workbench-appearance",
      fullName: "refs/heads/feat-workbench-appearance",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      const openFolderButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Open Folder",
      ) as HTMLButtonElement | undefined;
      expect(openFolderButton).toBeTruthy();

      openFolderButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();

      expect(mockListWorkspacePage).toHaveBeenNthCalledWith(2, {
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        directoryPath: "internal",
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain("EnvWorkbenchPage.tsx");
      expect(host.textContent).toContain("redeven.css");

      const rootBreadcrumb = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "repo-linked",
      ) as HTMLButtonElement | undefined;
      expect(rootBreadcrumb).toBeTruthy();

      rootBreadcrumb!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();

      expect(mockListWorkspacePage).toHaveBeenNthCalledWith(3, {
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain("Open Folder");
    } finally {
      dispose();
    }
  });

  it("loads staged files after explicitly switching sections", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage
      .mockResolvedValueOnce({
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        summary: {
          stagedCount: 1,
          unstagedCount: 1,
          untrackedCount: 0,
          conflictedCount: 0,
        },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          {
            section: "unstaged",
            changeType: "modified",
            path: "src/pending.ts",
            displayPath: "src/pending.ts",
            additions: 3,
            deletions: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        repoRootPath: "/workspace/repo-linked",
        section: "staged",
        summary: {
          stagedCount: 1,
          unstagedCount: 1,
          untrackedCount: 0,
          conflictedCount: 0,
        },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          {
            section: "staged",
            changeType: "modified",
            path: "src/indexed.ts",
            displayPath: "src/indexed.ts",
            additions: 5,
            deletions: 2,
          },
        ],
      });

    const branch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      const stagedButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Staged"),
      ) as HTMLButtonElement | undefined;
      expect(stagedButton).toBeTruthy();
      expect(stagedButton?.getAttribute("aria-pressed")).toBe("false");
      expect(stagedButton?.getAttribute("aria-label")).toBe("Staged: 1 file");

      stagedButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockListWorkspacePage).toHaveBeenLastCalledWith({
        repoRootPath: "/workspace/repo-linked",
        section: "staged",
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain("src/indexed.ts");
      expect(host.textContent).not.toContain("src/pending.ts");
      const selectedStagedButton = Array.from(
        host.querySelectorAll("button"),
      ).find((node) => node.textContent?.includes("Staged")) as
        | HTMLButtonElement
        | undefined;
      expect(selectedStagedButton?.getAttribute("aria-pressed")).toBe("true");
    } finally {
      dispose();
    }
  });

  it("keeps an explicit staged selection even when the previous summary reported no staged files", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage
      .mockResolvedValueOnce({
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        summary: {
          stagedCount: 0,
          unstagedCount: 1,
          untrackedCount: 0,
          conflictedCount: 0,
        },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          {
            section: "unstaged",
            changeType: "modified",
            path: "src/pending.ts",
            displayPath: "src/pending.ts",
            additions: 2,
            deletions: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        repoRootPath: "/workspace/repo-linked",
        section: "staged",
        summary: {
          stagedCount: 1,
          unstagedCount: 1,
          untrackedCount: 0,
          conflictedCount: 0,
        },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          {
            section: "staged",
            changeType: "modified",
            path: "src/indexed.ts",
            displayPath: "src/indexed.ts",
            additions: 4,
            deletions: 1,
          },
        ],
      });

    const branch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      const stagedButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Staged"),
      ) as HTMLButtonElement | undefined;
      expect(stagedButton).toBeTruthy();
      expect(stagedButton?.getAttribute("aria-pressed")).toBe("false");
      expect(stagedButton?.getAttribute("aria-label")).toBe(
        "Staged: No files",
      );

      stagedButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockListWorkspacePage).toHaveBeenLastCalledWith({
        repoRootPath: "/workspace/repo-linked",
        section: "staged",
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain("src/indexed.ts");
      expect(host.textContent).not.toContain("src/pending.ts");
      const selectedStagedButton = Array.from(
        host.querySelectorAll("button"),
      ).find((node) => node.textContent?.includes("Staged")) as
        | HTMLButtonElement
        | undefined;
      expect(selectedStagedButton?.getAttribute("aria-pressed")).toBe("true");
      expect(selectedStagedButton?.getAttribute("aria-label")).toBe(
        "Staged: 1 file",
      );
    } finally {
      dispose();
    }
  });

  it("auto-focuses conflicted files when a new branch context has no pending changes", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage
      .mockResolvedValueOnce({
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        summary: {
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 0,
          conflictedCount: 1,
        },
        totalCount: 0,
        offset: 0,
        nextOffset: 0,
        hasMore: false,
        items: [],
      })
      .mockResolvedValueOnce({
        repoRootPath: "/workspace/repo-linked",
        section: "conflicted",
        summary: {
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 0,
          conflictedCount: 1,
        },
        totalCount: 1,
        offset: 0,
        nextOffset: 1,
        hasMore: false,
        items: [
          {
            section: "conflicted",
            changeType: "conflicted",
            path: "src/conflict.ts",
            displayPath: "src/conflict.ts",
            additions: 0,
            deletions: 0,
          },
        ],
      });

    const branch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockListWorkspacePage).toHaveBeenNthCalledWith(1, {
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        offset: 0,
        limit: 200,
      });
      expect(mockListWorkspacePage).toHaveBeenNthCalledWith(2, {
        repoRootPath: "/workspace/repo-linked",
        section: "conflicted",
        offset: 0,
        limit: 200,
      });
      expect(host.textContent).toContain("src/conflict.ts");
      const changesButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Changes"),
      ) as HTMLButtonElement | undefined;
      const conflictedButton = Array.from(host.querySelectorAll("button")).find(
        (node) =>
          node.getAttribute("aria-label")?.startsWith("Conflicted:"),
      ) as HTMLButtonElement | undefined;
      expect(changesButton?.getAttribute("aria-pressed")).toBe("false");
      expect(changesButton?.getAttribute("aria-label")).toBe(
        "Changes: No files",
      );
      expect(conflictedButton?.getAttribute("aria-pressed")).toBe("true");
      expect(conflictedButton?.getAttribute("aria-label")).toBe(
        "Conflicted: 1 file",
      );
    } finally {
      dispose();
    }
  });

  it("opens the stash window for a linked branch worktree from status actions", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onOpenStash = vi.fn();

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/linked.ts",
          displayPath: "src/linked.ts",
        },
      ],
    });

    const branch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                  onOpenStash={onOpenStash}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      const stashButton = host.querySelector('button[aria-label="Stash..."]') as HTMLButtonElement | null;
      expect(stashButton).toBeTruthy();
      stashButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(onOpenStash).toHaveBeenCalledWith({
        tab: "save",
        repoRootPath: "/workspace/repo-linked",
        source: "branch_status",
      });
    } finally {
      dispose();
    }
  });

  it("exposes Ask Flower, Terminal, and Files for linked branch worktrees", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onAskFlower = vi.fn();
    const onOpenInTerminal = vi.fn();
    const onBrowseFiles = vi.fn();

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 1,
        conflictedCount: 0,
      },
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/linked.ts",
          displayPath: "src/linked.ts",
          additions: 3,
          deletions: 1,
        },
        {
          section: "untracked",
          changeType: "added",
          path: "scratch.txt",
          displayPath: "scratch.txt",
        },
      ],
    });

    const branch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                  onAskFlower={onAskFlower}
                  onOpenInTerminal={onOpenInTerminal}
                  onBrowseFiles={onBrowseFiles}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      const shortcutDocks = host.querySelectorAll("[data-git-shortcut-dock]");
      const askFlowerButton = host.querySelector(
        'button[aria-label="Ask Flower"]',
      ) as HTMLButtonElement | null;
      const openInTerminalButton = host.querySelector(
        'button[aria-label="Terminal"]',
      ) as HTMLButtonElement | null;
      const browseFilesButton = host.querySelector(
        'button[aria-label="Files"]',
      ) as HTMLButtonElement | null;

      expect(shortcutDocks.length).toBeGreaterThan(0);
      expect(shortcutDocks[0]?.className).toContain("items-center");
      expect(askFlowerButton).toBeTruthy();
      expect(openInTerminalButton).toBeTruthy();
      expect(browseFilesButton).toBeTruthy();
      expect(askFlowerButton?.dataset.gitShortcutOrb).toBe("flower");
      expect(openInTerminalButton?.dataset.gitShortcutOrb).toBe("terminal");
      expect(browseFilesButton?.dataset.gitShortcutOrb).toBe("files");
      expect(askFlowerButton?.className).toContain("h-7");
      expect(openInTerminalButton?.className).toContain("h-7");
      expect(browseFilesButton?.className).toContain("h-7");
      expect(askFlowerButton?.textContent).toBe("");
      expect(openInTerminalButton?.textContent).toBe("");
      expect(browseFilesButton?.textContent).toBe("");

      const statusBrowseButton = Array.from(host.querySelectorAll('button')).find((button) => button.className.includes('hover:text-[var(--redeven-status-success)]'));
      const statusTerminalButton = Array.from(host.querySelectorAll('button')).find((button) => button.className.includes('hover:text-[var(--redeven-status-info)]'));
      expect(statusBrowseButton?.className).toContain('hover:text-[var(--redeven-status-success)]');
      expect(statusTerminalButton?.className).toContain('hover:text-[var(--redeven-status-info)]');

      askFlowerButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      openInTerminalButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      browseFilesButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(onAskFlower).toHaveBeenCalledWith({
        kind: "branch_status",
        repoRootPath: "/workspace/repo",
        worktreePath: "/workspace/repo-linked",
        branch,
        section: "changes",
        items: [
          {
            section: "unstaged",
            changeType: "modified",
            path: "src/linked.ts",
            displayPath: "src/linked.ts",
            additions: 3,
            deletions: 1,
          },
          {
            section: "untracked",
            changeType: "added",
            path: "scratch.txt",
            displayPath: "scratch.txt",
          },
        ],
      });
      expect(onOpenInTerminal).toHaveBeenCalledWith({
        path: "/workspace/repo-linked",
        preferredName: "repo-linked",
      });
      expect(onBrowseFiles).toHaveBeenCalledWith({
        path: "/workspace/repo-linked",
        preferredName: "repo-linked",
      });
    } finally {
      dispose();
    }
  });

  it("routes branch-status Files shortcuts to the active linked-worktree directory scope", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onBrowseFiles = vi.fn();

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      directoryPath: "internal/ui",
      breadcrumbs: [
        { label: "repo-linked", path: "" },
        { label: "internal", path: "internal" },
        { label: "ui", path: "internal/ui" },
      ],
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      scopeFileCount: 1,
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "internal/ui/GitChangesPanel.tsx",
          displayPath: "internal/ui/GitChangesPanel.tsx",
        },
      ],
    });

    const branch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                  onBrowseFiles={onBrowseFiles}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      const browseFilesButton = host.querySelector(
        'button[aria-label="Files"]',
      ) as HTMLButtonElement | null;
      expect(browseFilesButton).toBeTruthy();

      browseFilesButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(onBrowseFiles).toHaveBeenCalledWith({
        path: "/workspace/repo-linked/internal/ui",
        preferredName: "ui",
      });
    } finally {
      dispose();
    }
  });

  it("keeps branch-status breadcrumb navigation primary and uses the launch arrow for file-browser handoff", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onBrowseFiles = vi.fn();

    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      directoryPath: "internal/ui/dialogs",
      breadcrumbs: [
        { label: "repo-linked", path: "" },
        { label: "internal", path: "internal" },
        { label: "ui", path: "internal/ui" },
        { label: "dialogs", path: "internal/ui/dialogs" },
      ],
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      scopeFileCount: 1,
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "internal/ui/dialogs/GitChangesBreadcrumb.tsx",
          displayPath: "internal/ui/dialogs/GitChangesBreadcrumb.tsx",
        },
      ],
    });

    const branch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                  onBrowseFiles={onBrowseFiles}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      const launchButton = host.querySelector(
        'button[aria-label="Open ui in Files"]',
      ) as HTMLButtonElement | null;
      expect(launchButton).toBeTruthy();

      launchButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(onBrowseFiles).toHaveBeenCalledWith({
        path: "/workspace/repo-linked/internal/ui",
        preferredName: "ui",
      });
    } finally {
      dispose();
    }
  });

  it("shows an unavailable status message for a local branch without a checked-out worktree", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/offline",
                    fullName: "refs/heads/feature/offline",
                    kind: "local",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      {
                        name: "feature/offline",
                        fullName: "refs/heads/feature/offline",
                        kind: "local",
                      },
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      expect(host.textContent).toContain("Status unavailable");
      expect(host.textContent).toContain(
        "This branch is not checked out in the active worktree.",
      );
      expect(host.textContent).toContain(
        "Use History or Compare to inspect commits and diffs.",
      );
      expect(
        host.querySelector('[data-git-branch-status-unavailable="true"]'),
      ).toBeTruthy();
      expect(
        host.querySelector('[data-git-branch-stable-placeholder="status"]'),
      ).toBeFalsy();
      expect(host.textContent).not.toContain("Branch is not checked out");
      expect(mockListWorkspacePage).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("shows a determinate unavailable status for a remote branch", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "origin/feature/demo",
                    fullName: "refs/remotes/origin/feature/demo",
                    kind: "remote",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                    ],
                    remote: [
                      {
                        name: "origin/feature/demo",
                        fullName: "refs/remotes/origin/feature/demo",
                        kind: "remote",
                      },
                    ],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      expect(host.textContent).toContain("Status unavailable");
      expect(host.textContent).toContain(
        "Remote branches are not checked out in the active worktree.",
      );
      expect(host.textContent).toContain(
        "Check out this branch locally to review workspace changes.",
      );
      expect(
        host.querySelector('[data-git-branch-status-unavailable="true"]'),
      ).toBeTruthy();
      expect(
        host.querySelector('[data-git-branch-stable-placeholder="status"]'),
      ).toBeFalsy();
      expect(mockListWorkspacePage).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("shows tooltip reasons for disabled branch shortcuts without a checked-out worktree", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/offline",
                    fullName: "refs/heads/feature/offline",
                    kind: "local",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      {
                        name: "feature/offline",
                        fullName: "refs/heads/feature/offline",
                        kind: "local",
                      },
                    ],
                    remote: [],
                  }}
                  onAskFlower={() => {}}
                  onOpenInTerminal={() => {}}
                  onBrowseFiles={() => {}}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      const askFlowerButton = host.querySelector(
        'button[aria-label="Ask Flower"]',
      ) as HTMLButtonElement | undefined;
      const terminalButton = host.querySelector(
        'button[aria-label="Terminal"]',
      ) as HTMLButtonElement | undefined;
      const filesButton = host.querySelector('button[aria-label="Files"]') as
        | HTMLButtonElement
        | undefined;

      expect(askFlowerButton?.disabled).toBe(true);
      expect(terminalButton?.disabled).toBe(true);
      expect(filesButton?.disabled).toBe(true);

      const askTooltip = await revealTooltipForButton(askFlowerButton);
      expect(askTooltip?.textContent).toContain(
        "Open this branch in a worktree first.",
      );
      (
        askFlowerButton?.closest(
          "[data-redeven-tooltip-anchor]",
        ) as HTMLElement | null
      )?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      await flush();

      const terminalTooltip = await revealTooltipForButton(terminalButton);
      expect(terminalTooltip?.textContent).toContain(
        "Open this branch in a worktree first.",
      );
      (
        terminalButton?.closest(
          "[data-redeven-tooltip-anchor]",
        ) as HTMLElement | null
      )?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      await flush();

      const filesTooltip = await revealTooltipForButton(filesButton);
      expect(filesTooltip?.textContent).toContain(
        "Open this branch in a worktree first.",
      );
    } finally {
      dispose();
    }
  });

  it("opens linked worktree review for a linked branch and keeps delete enabled", async () => {
    let deleteCount = 0;
    const host = document.createElement("div");
    document.body.appendChild(host);

    const linkedBranch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };
    const linkedPreview = {
      repoRootPath: "/workspace/repo",
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      requiresWorktreeRemoval: true,
      requiresDiscardConfirmation: true,
      safeDeleteAllowed: true,
      safeDeleteBaseRef: "main",
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm: true,
      planFingerprint: "plan-1",
      linkedWorktree: {
        worktreePath: "/workspace/repo-linked",
        accessible: true,
        summary: {
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 1,
          conflictedCount: 0,
        },
        staged: [],
        unstaged: [],
        untracked: [
          {
            section: "untracked",
            changeType: "added",
            path: "scratch.txt",
            displayPath: "scratch.txt",
            patchText: "@@ -0,0 +1 @@\n+scratch",
          },
        ],
        conflicted: [],
      },
    };

    const dispose = render(() => {
      const [deleteReviewOpen, setDeleteReviewOpen] = createSignal(false);
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={linkedBranch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      linkedBranch,
                    ],
                    remote: [],
                  }}
                  deleteReviewOpen={deleteReviewOpen()}
                  deleteReviewBranch={linkedBranch}
                  deletePreview={deleteReviewOpen() ? linkedPreview : null}
                  onDeleteBranch={() => {
                    deleteCount += 1;
                    setDeleteReviewOpen(true);
                  }}
                  onCloseDeleteReview={() => setDeleteReviewOpen(false)}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      const deleteButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Delete",
      ) as HTMLButtonElement | undefined;
      expect(deleteButton).toBeTruthy();
      expect(deleteButton?.disabled).toBe(false);
      deleteButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();

      expect(deleteCount).toBe(1);
      expect(document.body.textContent).toContain("Delete Branch");
      expect(document.body.textContent).toContain("/workspace/repo-linked");
      expect(document.body.textContent).toContain(
        "Delete the local branch reference for",
      );
      expect(document.body.textContent).toContain(
        "Remove the linked worktree at",
      );
      expect(document.body.textContent).toContain(
        "Uncommitted changes in that worktree will be discarded (1 untracked).",
      );
      expect(document.body.textContent).not.toContain("Files discarded");
      expect(document.body.textContent).not.toContain("Safe delete ready");
      expect(document.body.textContent).not.toContain("Delete Confirmation");
      expect(document.body.textContent).not.toContain(
        "Approve permanent file discard",
      );
      expect(document.body.textContent).not.toContain("scratch.txt");
      const footer = Array.from(document.body.querySelectorAll("div")).find(
        (node) =>
          node.className.includes("border-t") &&
          node.className.includes("redeven-surface-inset") &&
          node.className.includes("px-4") &&
          node.className.includes("pt-3") &&
          node.className.includes("pb-4"),
      ) as HTMLDivElement | undefined;
      const confirmButton = Array.from(
        document.body.querySelectorAll("button"),
      ).find(
        (node) => node.textContent?.trim() === "Delete Branch and Worktree",
      ) as HTMLButtonElement | undefined;
      expect(footer).toBeTruthy();
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.className).toContain("w-full");
      expect(confirmButton?.disabled).toBe(false);
    } finally {
      dispose();
    }
  });

  it("keeps branch header controls compact without squeezing branch metadata at narrow measured widths", async () => {
    let deletedBranch = "";
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px] w-[320px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/mobile",
                    fullName: "refs/heads/feature/mobile",
                    kind: "local",
                    worktreePath: "/workspace/repo-mobile",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      {
                        name: "feature/mobile",
                        fullName: "refs/heads/feature/mobile",
                        kind: "local",
                        worktreePath: "/workspace/repo-mobile",
                      },
                    ],
                    remote: [],
                  }}
                  onCheckoutBranch={() => {}}
                  onMergeBranch={() => {}}
                  onDeleteBranch={(branch) => {
                    deletedBranch = String(branch.name ?? "");
                  }}
                  onOpenInTerminal={() => {}}
                  onBrowseFiles={() => {}}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      const commandRail = host.querySelector(
        "[data-git-branch-header-actions]",
      ) as HTMLDivElement | null;
      const mergeButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Merge",
      ) as HTMLButtonElement | undefined;
      const visibleDeleteButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Delete",
      ) as HTMLButtonElement | undefined;
      const moreButton = host.querySelector(
        'button[aria-label="More actions"]',
      ) as HTMLButtonElement | null;
      const tablist = host.querySelector(
        '[aria-label="Branch detail tabs"]',
      ) as HTMLDivElement | null;
      const tablistRow = tablist?.parentElement as HTMLDivElement | null;
      const branchHeaderTopRow = host.querySelector(
        "[data-git-branch-header-layout]",
      ) as HTMLDivElement | null;

      expect(branchHeaderTopRow).toBeTruthy();
      await setBranchHeaderWidth(host, 420);

      expect(commandRail).toBeTruthy();
      expect(commandRail?.dataset.gitBranchHeaderActions).toBe("overflow");
      expect(branchHeaderTopRow?.dataset.gitBranchHeaderLayout).toBe("compact");
      expect(commandRail?.className).not.toContain("border-t");
      expect(commandRail?.className).not.toContain("pt-2");
      expect(commandRail?.className).toContain("flex");
      expect(commandRail?.className).not.toContain("grid-cols-1");
      expect(commandRail?.className).not.toContain("bg-muted/[0.08]");
      expect(commandRail?.textContent).toContain("Merge");
      expect(commandRail?.textContent).not.toContain("Delete");
      expect(commandRail?.textContent).not.toContain("Workspace");
      expect(commandRail?.textContent).not.toContain("Actions");
      expect(mergeButton?.className).toContain("rounded-md");
      expect(mergeButton?.className).toContain("cursor-pointer");
      expect(visibleDeleteButton).toBeUndefined();
      expect(moreButton).toBeTruthy();
      await clickDropdownMenuItem(moreButton, "Delete branch");
      expect(deletedBranch).toBe("feature/mobile");
      expect(tablistRow).toBe(branchHeaderTopRow);
      expect(tablist?.className).toContain("w-full");
      expect(tablist?.className).toContain("grid");
      expect(tablist?.className).toContain("w-full");
      expect(tablist?.className).toContain("grid-cols-2");
      expect(tablist?.className).toContain("rounded-md");
      expect(tablist?.className).not.toContain("w-[12rem]");
      const activeTab = host.querySelector(
        "#git-branch-subview-tab-status",
      ) as HTMLButtonElement | null;
      const historyTab = host.querySelector(
        "#git-branch-subview-tab-history",
      ) as HTMLButtonElement | null;
      expect(activeTab?.className).toContain("cursor-pointer");
      expect(activeTab?.className).toContain("redeven-surface-segmented__item");
      expect(activeTab?.className).toContain(
        "redeven-surface-segmented__item--active",
      );
      expect(activeTab?.className).toContain("text-foreground");
      expect(activeTab?.className).not.toContain("git-browser-selection-chip");
      expect(historyTab?.className).toContain("text-muted-foreground");
    } finally {
      dispose();
    }
  });

  it("realigns the branch detail tabs inline when the measured header width becomes wide enough", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px] w-[960px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/wide-layout",
                    fullName: "refs/heads/feature/wide-layout",
                    kind: "local",
                    worktreePath: "/workspace/repo-wide",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      {
                        name: "feature/wide-layout",
                        fullName: "refs/heads/feature/wide-layout",
                        kind: "local",
                        worktreePath: "/workspace/repo-wide",
                      },
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      const tablist = host.querySelector(
        '[aria-label="Branch detail tabs"]',
      ) as HTMLDivElement | null;
      const branchHeaderTopRow = host.querySelector(
        "[data-git-branch-header-layout]",
      ) as HTMLDivElement | null;

      expect(branchHeaderTopRow).toBeTruthy();
      defineElementWidth(branchHeaderTopRow!, 1040);
      triggerResizeObservers();
      await flush();

      expect(branchHeaderTopRow?.dataset.gitBranchHeaderLayout).toBe("inline");
      expect(tablist?.className).toContain("w-full");

      defineElementWidth(branchHeaderTopRow!, 720);
      triggerResizeObservers();
      await flush();

      expect(branchHeaderTopRow?.dataset.gitBranchHeaderLayout).toBe("stacked");
      expect(tablist?.className).toContain("w-full");

      defineElementWidth(branchHeaderTopRow!, 420);
      triggerResizeObservers();
      await flush();

      expect(branchHeaderTopRow?.dataset.gitBranchHeaderLayout).toBe("compact");
      expect(tablist?.className).toContain("w-full");
    } finally {
      dispose();
    }
  });

  it("hides the empty branch summary instead of rendering no extra status copy", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px] w-[320px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/clean",
                    fullName: "refs/heads/feature/clean",
                    kind: "local",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      {
                        name: "feature/clean",
                        fullName: "refs/heads/feature/clean",
                        kind: "local",
                      },
                    ],
                    remote: [],
                  }}
                  onCheckoutBranch={() => {}}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      expect(host.textContent).toContain("feature/clean");
      expect(host.textContent).not.toContain("No extra status");
    } finally {
      dispose();
    }
  });

  it("supports keyboard navigation for the branch detail tabs", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(() => {
      const [subview, setSubview] = createSignal<"status" | "history">(
        "status",
      );
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranchSubview={subview()}
                  onSelectBranchSubview={setSubview}
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                    current: true,
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "feature/demo",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                      },
                      {
                        name: "feature/demo",
                        fullName: "refs/heads/feature/demo",
                        kind: "local",
                        current: true,
                      },
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();

      const tablist = host.querySelector(
        '[aria-label="Branch detail tabs"]',
      ) as HTMLDivElement | null;
      const statusTab = host.querySelector(
        "#git-branch-subview-tab-status",
      ) as HTMLButtonElement | null;
      const statusPanel = host.querySelector(
        "#git-branch-subview-panel-status",
      ) as HTMLDivElement | null;
      expect(tablist?.getAttribute("role")).toBe("tablist");
      expect(tablist?.getAttribute("aria-orientation")).toBe("horizontal");
      expect(statusTab?.getAttribute("role")).toBe("tab");
      expect(statusTab?.getAttribute("id")).toBe(
        "git-branch-subview-tab-status",
      );
      expect(statusTab?.getAttribute("aria-controls")).toBe(
        "git-branch-subview-panel-status",
      );
      expect(statusTab?.getAttribute("aria-selected")).toBe("true");
      expect(statusTab?.getAttribute("tabindex")).toBe("0");
      expect(statusPanel?.getAttribute("role")).toBe("tabpanel");
      expect(statusPanel?.getAttribute("aria-labelledby")).toBe(
        "git-branch-subview-tab-status",
      );
      expect(statusPanel?.hasAttribute("hidden")).toBe(false);

      statusTab!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      await Promise.resolve();

      const historyTab = host.querySelector(
        "#git-branch-subview-tab-history",
      ) as HTMLButtonElement | null;
      const historyPanel = host.querySelector(
        "#git-branch-subview-panel-history",
      ) as HTMLDivElement | null;
      expect(historyTab?.getAttribute("role")).toBe("tab");
      expect(historyTab?.getAttribute("aria-controls")).toBe(
        "git-branch-subview-panel-history",
      );
      expect(historyTab?.getAttribute("aria-selected")).toBe("true");
      expect(historyTab?.getAttribute("tabindex")).toBe("0");
      expect(document.activeElement).toBe(historyTab);
      expect(historyPanel?.getAttribute("role")).toBe("tabpanel");
      expect(historyPanel?.getAttribute("aria-labelledby")).toBe(
        "git-branch-subview-tab-history",
      );
      expect(historyPanel?.hasAttribute("hidden")).toBe(false);
      expect(
        host.querySelectorAll("#git-branch-subview-panel-history"),
      ).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it("opens a lightweight confirmation dialog before deleting a local branch", async () => {
    let requestedBranch: string | undefined;
    let confirmedBranch: string | undefined;
    const host = document.createElement("div");
    document.body.appendChild(host);

    const branch = {
      name: "feature/demo",
      fullName: "refs/heads/feature/demo",
      kind: "local" as const,
    };
    const preview = {
      repoRootPath: "/workspace/repo",
      name: "feature/demo",
      fullName: "refs/heads/feature/demo",
      kind: "local" as const,
      requiresWorktreeRemoval: false,
      requiresDiscardConfirmation: false,
      safeDeleteAllowed: true,
      safeDeleteBaseRef: "main",
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm: true,
      planFingerprint: "plan-1",
    };

    const dispose = render(() => {
      const [deleteReviewOpen, setDeleteReviewOpen] = createSignal(false);
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                  deleteReviewOpen={deleteReviewOpen()}
                  deleteReviewBranch={branch}
                  deletePreview={deleteReviewOpen() ? preview : null}
                  onDeleteBranch={(selected) => {
                    requestedBranch = selected.name;
                    setDeleteReviewOpen(true);
                  }}
                  onCloseDeleteReview={() => setDeleteReviewOpen(false)}
                  onConfirmDeleteBranch={(selected) => {
                    confirmedBranch = selected.name;
                    setDeleteReviewOpen(false);
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      const deleteButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Delete",
      ) as HTMLButtonElement | undefined;
      expect(deleteButton).toBeTruthy();
      deleteButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();

      expect(requestedBranch).toBe("feature/demo");
      expect(document.body.textContent).toContain("Delete Branch");
      expect(document.body.textContent).toContain(
        "Delete the local branch reference for",
      );
      expect(document.body.textContent).toContain(
        "Leave your current worktree and uncommitted files untouched.",
      );
      expect(document.body.textContent).not.toContain("Delete base main");
      expect(document.body.textContent).not.toContain("Files discarded");
      expect(document.body.textContent).not.toContain("Safe delete ready");
      expect(document.body.textContent).not.toContain("Delete Confirmation");
      const footer = Array.from(document.body.querySelectorAll("div")).find(
        (node) =>
          node.className.includes("border-t") &&
          node.className.includes("redeven-surface-inset") &&
          node.className.includes("px-4") &&
          node.className.includes("pt-3") &&
          node.className.includes("pb-4"),
      ) as HTMLDivElement | undefined;
      const confirmButton = Array.from(
        document.body.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Delete Branch") as
        | HTMLButtonElement
        | undefined;
      expect(footer).toBeTruthy();
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.className).toContain("w-full");
      confirmButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(confirmedBranch).toBe("feature/demo");
    } finally {
      dispose();
    }
  });

  it("shows a tooltip on the plain delete confirm button when safe delete is blocked", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const branch = {
      name: "feature/unmerged",
      fullName: "refs/heads/feature/unmerged",
      kind: "local" as const,
    };
    const blockedReason = "Branch is not fully merged into HEAD.";
    const preview = {
      repoRootPath: "/workspace/repo",
      name: "feature/unmerged",
      fullName: "refs/heads/feature/unmerged",
      kind: "local" as const,
      requiresWorktreeRemoval: false,
      requiresDiscardConfirmation: false,
      safeDeleteAllowed: false,
      safeDeleteReason: blockedReason,
      safeDeleteBaseRef: "HEAD",
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm: true,
      planFingerprint: "plan-blocked-plain",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                  deleteReviewOpen
                  deleteReviewBranch={branch}
                  deletePreview={preview}
                  onCloseDeleteReview={() => {}}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      expect(document.body.textContent).toContain("Force delete consequences");
      const confirmButton = Array.from(
        document.body.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Force Delete Branch") as
        | HTMLButtonElement
        | undefined;
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.disabled).toBe(true);
      const confirmationInput = document.body.querySelector(
        'input[type="text"]',
      ) as HTMLInputElement | null;
      expect(confirmationInput?.placeholder).toBe("feature/unmerged");
      const tooltip = await revealTooltipForButton(confirmButton);
      expect(tooltip?.textContent).toContain(
        "Type feature/unmerged to enable force delete.",
      );
      confirmationInput!.value = "feature/unmerged";
      confirmationInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
      const enabledConfirmButton = Array.from(
        document.body.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Force Delete Branch") as
        | HTMLButtonElement
        | undefined;
      expect(enabledConfirmButton?.disabled).toBe(false);
    } finally {
      dispose();
    }
  });

  it("opens merge review dialog and confirms with the preview fingerprint", async () => {
    let requestedBranch: string | undefined;
    let confirmedFingerprint: string | undefined;
    const host = document.createElement("div");
    document.body.appendChild(host);

    const branch = {
      name: "feature/demo",
      fullName: "refs/heads/feature/demo",
      kind: "local" as const,
    };
    const preview = {
      repoRootPath: "/workspace/repo",
      currentRef: "main",
      currentCommit: "abc1234",
      sourceName: "feature/demo",
      sourceFullName: "refs/heads/feature/demo",
      sourceKind: "local" as const,
      sourceCommit: "fedcba9",
      mergeBase: "abc1234",
      sourceAheadCount: 1,
      sourceBehindCount: 0,
      outcome: "fast_forward" as const,
      planFingerprint: "merge-plan-1",
      files: [
        {
          changeType: "modified",
          path: "src/merge.ts",
          displayPath: "src/merge.ts",
          additions: 5,
          deletions: 2,
          patchText: "@@ -1 +1 @@\n-before\n+after",
        },
      ],
    };

    const dispose = render(() => {
      const [mergeReviewOpen, setMergeReviewOpen] = createSignal(false);
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  repoSummary={{
                    repoRootPath: "/workspace/repo",
                    headRef: "main",
                    headCommit: "abc1234",
                    workspaceSummary: {
                      stagedCount: 0,
                      unstagedCount: 0,
                      untrackedCount: 0,
                      conflictedCount: 0,
                    },
                  }}
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                  mergeReviewOpen={mergeReviewOpen()}
                  mergeReviewBranch={branch}
                  mergePreview={mergeReviewOpen() ? preview : null}
                  onMergeBranch={(selected) => {
                    requestedBranch = selected.name;
                    setMergeReviewOpen(true);
                  }}
                  onCloseMergeReview={() => setMergeReviewOpen(false)}
                  onConfirmMergeBranch={(_selected, options) => {
                    confirmedFingerprint = options.planFingerprint;
                    setMergeReviewOpen(false);
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const mergeButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Merge",
      ) as HTMLButtonElement | undefined;
      expect(mergeButton).toBeTruthy();
      expect(mergeButton?.disabled).toBe(false);
      mergeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();

      expect(requestedBranch).toBe("feature/demo");
      expect(document.body.textContent).toContain("Merge Branch");
      expect(document.body.textContent).toContain("Fast-forward");
      expect(document.body.textContent).toContain("feature/demo");
      expect(document.body.textContent).toContain("Changed Files");
      expect(document.body.textContent).toContain("src/merge.ts");
      expect(document.body.textContent).toContain("Fast-Forward main");

      const confirmButton = Array.from(
        document.body.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Fast-Forward main") as
        | HTMLButtonElement
        | undefined;
      expect(confirmButton).toBeTruthy();
      confirmButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(confirmedFingerprint).toBe("merge-plan-1");
    } finally {
      dispose();
    }
  });

  it("keeps merge clickable for a dirty workspace and shows the blocked preview reason in the dialog", async () => {
    let requestedBranch: string | undefined;
    const onOpenStash = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);

    const branch = {
      name: "feature/blocked",
      fullName: "refs/heads/feature/blocked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-blocked",
    };
    const preview = {
      repoRootPath: "/workspace/repo",
      currentRef: "main",
      currentCommit: "abc1234",
      sourceName: "feature/blocked",
      sourceFullName: "refs/heads/feature/blocked",
      sourceKind: "local" as const,
      sourceCommit: "fedcba9",
      mergeBase: "abc1234",
      sourceAheadCount: 1,
      sourceBehindCount: 0,
      outcome: "blocked" as const,
      blocking: {
        kind: "workspace_dirty",
        reason: "Current workspace must be clean before merging (1 unstaged).",
        workspacePath: "/workspace/repo-blocked",
        workspaceSummary: {
          stagedCount: 0,
          unstagedCount: 1,
          untrackedCount: 0,
          conflictedCount: 0,
        },
        canStashWorkspace: true,
      },
      planFingerprint: "merge-plan-blocked",
      files: [],
    };

    const dispose = render(() => {
      const [mergeReviewOpen, setMergeReviewOpen] = createSignal(false);
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  repoSummary={{
                    repoRootPath: "/workspace/repo",
                    headRef: "main",
                    headCommit: "abc1234",
                    workspaceSummary: {
                      stagedCount: 0,
                      unstagedCount: 1,
                      untrackedCount: 0,
                      conflictedCount: 0,
                    },
                  }}
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                  mergeReviewOpen={mergeReviewOpen()}
                  mergeReviewBranch={branch}
                  mergePreview={mergeReviewOpen() ? preview : null}
                  onMergeBranch={(selected) => {
                    requestedBranch = selected.name;
                    setMergeReviewOpen(true);
                  }}
                  onOpenStash={onOpenStash}
                  onCloseMergeReview={() => setMergeReviewOpen(false)}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      expect(host.textContent).not.toContain(
        "Current workspace must be clean before merging.",
      );
      expect(host.textContent).not.toContain(
        "This branch is checked out in a linked worktree: /workspace/repo-blocked",
      );

      const mergeButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Merge",
      ) as HTMLButtonElement | undefined;
      expect(mergeButton).toBeTruthy();
      expect(mergeButton?.disabled).toBe(false);

      mergeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();

      expect(requestedBranch).toBe("feature/blocked");
      expect(document.body.textContent).toContain("Merge Branch");
      expect(document.body.textContent).toContain("Blocked");
      expect(document.body.textContent).toContain(
        "Current workspace must be clean before merging (1 unstaged).",
      );
      const stashShortcut = Array.from(
        document.body.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Stash current changes") as
        | HTMLButtonElement
        | undefined;
      expect(stashShortcut).toBeTruthy();
      stashShortcut!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(onOpenStash).toHaveBeenCalledWith({
        tab: "save",
        repoRootPath: "/workspace/repo-blocked",
        source: "merge_blocker",
      });

      const confirmButton = Array.from(
        document.body.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "Merge Into main") as
        | HTMLButtonElement
        | undefined;
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.disabled).toBe(true);
    } finally {
      dispose();
    }
  });

  it("reloads linked worktree status when the refresh token changes", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockListWorkspacePage.mockResolvedValue({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/linked.ts",
          displayPath: "src/linked.ts",
        },
      ],
    });

    let setRefreshToken!: (value: number) => number;
    const branch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(() => {
      const [refreshToken, updateRefreshToken] = createSignal(0);
      setRefreshToken = updateRefreshToken;
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  statusRefreshToken={refreshToken()}
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      expect(mockListWorkspacePage).toHaveBeenCalledTimes(1);

      setRefreshToken(1);
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockListWorkspacePage).toHaveBeenLastCalledWith({
        repoRootPath: "/workspace/repo-linked",
        section: "changes",
        offset: 0,
        limit: 200,
      });
    } finally {
      dispose();
    }
  });

  it("keeps the loaded branch status visible while a refresh-token revalidation is in flight", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const initialPage = {
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/linked.ts",
          displayPath: "src/linked.ts",
        },
      ],
    };
    const refreshedPage = {
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: {
        stagedCount: 0,
        unstagedCount: 2,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/linked.ts",
          displayPath: "src/linked.ts",
        },
        {
          section: "unstaged",
          changeType: "modified",
          path: "src/config.ts",
          displayPath: "src/config.ts",
        },
      ],
    };

    let resolveRefresh!: (value: typeof refreshedPage) => void;
    const refreshPromise = new Promise<typeof refreshedPage>((resolve) => {
      resolveRefresh = resolve;
    });

    mockListWorkspacePage.mockReset();
    mockListWorkspacePage
      .mockResolvedValueOnce(initialPage)
      .mockImplementationOnce(() => refreshPromise);

    let setRefreshToken!: (value: number) => number;
    const branch = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked",
    };

    const dispose = render(() => {
      const [refreshToken, updateRefreshToken] = createSignal(0);
      setRefreshToken = updateRefreshToken;
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  statusRefreshToken={refreshToken()}
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      expect(host.textContent).toContain("src/linked.ts");

      setRefreshToken(1);
      await flush();

      expect(mockListWorkspacePage).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain("src/linked.ts");
      expect(host.textContent).not.toContain("Branch status is unavailable");

      resolveRefresh(refreshedPage);
      await flush();
      expect(host.textContent).toContain("src/config.ts");
    } finally {
      dispose();
    }
  });

  it("shows a tooltip on the linked-worktree delete confirm button when safe delete is blocked", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const branch = {
      name: "feature/linked-blocked",
      fullName: "refs/heads/feature/linked-blocked",
      kind: "local" as const,
      worktreePath: "/workspace/repo-linked-blocked",
    };
    const blockedReason = "Branch is not fully merged into HEAD.";
    const preview = {
      repoRootPath: "/workspace/repo",
      name: "feature/linked-blocked",
      fullName: "refs/heads/feature/linked-blocked",
      kind: "local" as const,
      requiresWorktreeRemoval: true,
      requiresDiscardConfirmation: false,
      safeDeleteAllowed: false,
      safeDeleteReason: blockedReason,
      safeDeleteBaseRef: "HEAD",
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm: true,
      planFingerprint: "plan-blocked-linked",
      linkedWorktree: {
        worktreePath: "/workspace/repo-linked-blocked",
        accessible: true,
        summary: {
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 0,
          conflictedCount: 0,
        },
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
      },
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={branch}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      branch,
                    ],
                    remote: [],
                  }}
                  deleteReviewOpen
                  deleteReviewBranch={branch}
                  deletePreview={preview}
                  onCloseDeleteReview={() => {}}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();

      expect(document.body.textContent).toContain("Force delete consequences");
      const confirmButton = Array.from(
        document.body.querySelectorAll("button"),
      ).find(
        (node) =>
          node.textContent?.trim() === "Force Delete Branch and Worktree",
      ) as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.disabled).toBe(true);
      const confirmationInput = document.body.querySelector(
        'input[type="text"]',
      ) as HTMLInputElement | null;
      expect(confirmationInput?.placeholder).toBe("feature/linked-blocked");
      const tooltip = await revealTooltipForButton(confirmButton);
      expect(tooltip?.textContent).toContain(
        "Type feature/linked-blocked to enable force delete.",
      );
      confirmationInput!.value = "feature/linked-blocked";
      confirmationInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
      const enabledConfirmButton = Array.from(
        document.body.querySelectorAll("button"),
      ).find(
        (node) =>
          node.textContent?.trim() === "Force Delete Branch and Worktree",
      ) as HTMLButtonElement | undefined;
      expect(enabledConfirmButton?.disabled).toBe(false);
    } finally {
      dispose();
    }
  });

  it("shows expandable commit files and opens diffs from branch history", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onAskFlower = vi.fn();
    const [selectedCommitHash, setSelectedCommitHash] = createSignal(
      "2222222222222222",
    );

    mockGetCommitDetail.mockResolvedValue({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "2222222222222222",
        shortHash: "22222222",
        parents: ["1111111111111111", "9999999999999999"],
        subject: "Merge feature",
      },
      presentation: {
        mode: "first_parent",
        mergeCommit: true,
        parentCount: 2,
      },
      files: [
        {
          changeType: "modified",
          path: "src/history.ts",
          displayPath: "src/history.ts",
          additions: 8,
          deletions: 3,
          patchText: "@@ -1 +1 @@\n-history\n+history updated",
        },
      ],
    });

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                    current: true,
                    aheadCount: 1,
                    behindCount: 0,
                  }}
                  selectedBranchSubview="history"
                  commits={[
                    {
                      hash: "1111111111111111",
                      shortHash: "11111111",
                      parents: ["0000000000000000"],
                      subject: "First commit",
                      authorName: "Alice",
                      authorTimeMs: 1706000000000,
                    },
                    {
                      hash: "2222222222222222",
                      shortHash: "22222222",
                      parents: ["1111111111111111", "9999999999999999"],
                      subject: "Merge feature",
                      authorName: "Bob",
                      authorTimeMs: 1706003600000,
                    },
                  ]}
                  selectedCommitHash={selectedCommitHash()}
                  onSelectCommit={setSelectedCommitHash}
                  onAskFlower={onAskFlower}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await Promise.resolve();
      await Promise.resolve();
      await setBranchHeaderWidth(host, 1040);

      expect(host.textContent).toContain("First commit");
      expect(host.textContent).toContain("Merge feature");
      expect(host.textContent).toContain("11111111");
      expect(host.textContent).toContain("Files in Commit");
      expect(host.textContent).toContain("Merge Commit");
      expect(host.textContent).toContain(
        "Compared with first parent so the changed-file list and diff view stay aligned.",
      );
      expect(host.textContent).toContain("src/history.ts");
      expect(host.textContent).toContain("+8");
      expect(host.textContent).toContain("-3");

      const historyPanel = host.querySelector(
        "#git-branch-subview-panel-history:not([hidden])",
      ) as HTMLElement | null;
      expect(historyPanel).toBeTruthy();
      const expandedToggle = historyPanel!.querySelector(
        'button[aria-label="Collapse commit"]',
      ) as HTMLButtonElement | null;
      expect(expandedToggle?.getAttribute("aria-expanded")).toBe("true");
      const detailRow = historyPanel!.querySelector(
        "[data-git-branch-history-details-row]",
      ) as HTMLElement | null;
      expect(detailRow).toBeTruthy();
      const details = historyPanel!.querySelector(
        "[data-git-branch-history-details]",
      ) as HTMLElement | null;
      expect(details).toBeTruthy();
      expect(details?.querySelector(".redeven-surface-inset")).toBeFalsy();
      const inlineFiles = historyPanel!.querySelector(
        "[data-git-branch-commit-files-surface='inline']",
      ) as HTMLElement | null;
      expect(inlineFiles).toBeTruthy();
      expect(inlineFiles?.className).not.toContain("rounded");
      expect(inlineFiles?.querySelector("table")).toBeTruthy();
      const askFlowerButton = historyPanel!.querySelector(
        'button[aria-label="Ask Flower"]',
      ) as HTMLButtonElement | null;
      expect(askFlowerButton).toBeTruthy();
      expect(askFlowerButton?.textContent).toBe("");
      askFlowerButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(onAskFlower).toHaveBeenCalledWith({
        kind: "commit",
        repoRootPath: "/workspace/repo",
        location: "branch_history",
        branchName: "feature/demo",
        commit: {
          hash: "2222222222222222",
          shortHash: "22222222",
          parents: ["1111111111111111", "9999999999999999"],
          subject: "Merge feature",
          authorName: "Bob",
          authorTimeMs: 1706003600000,
        },
        files: [
          {
            changeType: "modified",
            path: "src/history.ts",
            displayPath: "src/history.ts",
            additions: 8,
            deletions: 3,
            patchText: "@@ -1 +1 @@\n-history\n+history updated",
          },
        ],
      });

      const diffButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("View Diff"),
      ) as HTMLButtonElement | undefined;
      expect(diffButton).toBeTruthy();
      diffButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await Promise.resolve();
      expect(document.body.textContent).toContain("Commit Diff");
      expect(document.body.textContent).toContain("Merge Commit");
      expect(document.body.textContent).toContain("history updated");

      expandedToggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      expect(selectedCommitHash()).toBe("");
      expect(
        historyPanel!
          .querySelector("[data-git-branch-history-details-row]")
          ?.getAttribute("data-state"),
      ).toBe("closing");
    } finally {
      dispose();
    }
  });

  it("shows a loading state instead of the empty selection message for branch-history commit previews", async () => {
    let resolvePreview:
      | ((value: Awaited<ReturnType<typeof mockGetDiffContent>>) => void)
      | undefined;
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "2222222222222222",
        shortHash: "22222222",
        parents: ["1111111111111111"],
        subject: "Refine history loading",
      },
      files: [
        {
          changeType: "modified",
          path: "src/history.ts",
          displayPath: "src/history.ts",
          additions: 8,
          deletions: 3,
        },
      ],
    });
    mockGetDiffContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                    current: true,
                    aheadCount: 1,
                    behindCount: 0,
                  }}
                  selectedBranchSubview="history"
                  commits={[
                    {
                      hash: "2222222222222222",
                      shortHash: "22222222",
                      parents: ["1111111111111111"],
                      subject: "Refine history loading",
                      authorName: "Bob",
                      authorTimeMs: 1706003600000,
                    },
                  ]}
                  selectedCommitHash="2222222222222222"
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 1040);

      const diffButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("View Diff"),
      ) as HTMLButtonElement | undefined;
      expect(diffButton).toBeTruthy();

      diffButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain("Loading patch preview...");
      expect(document.body.querySelector(".git-loading-indicator")).toBeTruthy();
      expect(document.body.querySelector(".floe-grid-cell")).toBeNull();
      expect(document.body.textContent).not.toContain(
        "Select a file to inspect its diff.",
      );

      expect(resolvePreview).toBeTruthy();
      resolvePreview?.({
        repoRootPath: "/workspace/repo",
        mode: "preview",
        file: {
          changeType: "modified",
          path: "src/history.ts",
          displayPath: "src/history.ts",
          additions: 8,
          deletions: 3,
          patchText: "@@ -1 +1 @@\n-history\n+history updated",
        },
      });
      await flush();
    } finally {
      dispose();
    }
  });

  it("keeps compare dialog scrolling inside the changed files table region", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                      {
                        name: "feature/demo",
                        fullName: "refs/heads/feature/demo",
                        kind: "local",
                      },
                    ],
                    remote: [],
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      const compareButton = host.querySelector('button[aria-label="Compare"]') as HTMLButtonElement | null;
      expect(compareButton).toBeTruthy();
      compareButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.body.textContent).toContain("Compare branches");
      expect(document.body.textContent).toContain("Changed Files");
      expect(document.body.textContent).toContain("src/compare.ts");

      const dialogRoot = Array.from(
        document.body.querySelectorAll('[role="dialog"]'),
      ).find((node) => node.textContent?.includes("Compare branches")) as
        | HTMLDivElement
        | undefined;
      expect(dialogRoot).toBeTruthy();
      expect(dialogRoot?.className).toContain(
        "[&>div:last-child]:!overflow-hidden",
      );
      expect(dialogRoot?.className).toContain("[&>div:last-child]:flex");
      expect(dialogRoot?.className).toContain("[&>div:last-child]:!p-0");
      const closeButton = dialogRoot?.querySelector(
        'button[aria-label="Close"]',
      ) as HTMLButtonElement | null | undefined;
      expect(closeButton).toBeTruthy();
      expect(closeButton?.className).toContain("hover:bg-error");
      expect(closeButton?.className).not.toContain("hover:bg-muted/80");

      const changedFilesScrollRegion = Array.from(
        dialogRoot?.querySelectorAll("div") ?? [],
      ).find((node) =>
        node.className.includes("min-h-0 flex-1 overflow-auto"),
      ) as HTMLDivElement | undefined;
      expect(changedFilesScrollRegion).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it("opens stable branch and status-item context actions", async () => {
    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo",
      section: "changes",
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [{
        section: "unstaged",
        changeType: "modified",
        path: "src/app.ts",
        displayPath: "src/app.ts",
      }],
    });
    const onAskFlower = vi.fn();
    const onPreviewCurrentFile = vi.fn();
    const onCopyText = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const branch: GitBranchSummary = {
      name: "main",
      fullName: "refs/heads/main",
      kind: "local",
      current: true,
    };
    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  repoSummary={{
                    repoRootPath: "/workspace/repo",
                    headRef: "main",
                    headCommit: "1111111111111111",
                    workspaceSummary: {
                      stagedCount: 0,
                      unstagedCount: 1,
                      untrackedCount: 0,
                      conflictedCount: 0,
                    },
                  }}
                  selectedBranch={branch}
                  branchDetailState={{ kind: "ready", branch }}
                  selectedBranchSubview="status"
                  onAskFlower={onAskFlower}
                  onPreviewCurrentFile={onPreviewCurrentFile}
                  onCopyText={onCopyText}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      const statusRow = Array.from(host.querySelectorAll("tbody tr")).find((row) =>
        row.textContent?.includes("src/app.ts"),
      ) as HTMLTableRowElement | undefined;
      expect(statusRow).toBeTruthy();
      statusRow!.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 90,
      }));
      await flush();
      const askFlower = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((item) =>
        item.textContent?.includes("Ask Flower"),
      ) as HTMLButtonElement | undefined;
      expect(askFlower).toBeTruthy();
      askFlower!.click();
      expect(onAskFlower).toHaveBeenCalledWith(expect.objectContaining({
        kind: "branch_status_item",
        repoRootPath: "/workspace/repo",
        item: expect.objectContaining({ path: "src/app.ts" }),
      }));

      statusRow!.focus();
      statusRow!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
      await flush();
      const preview = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((item) =>
        item.textContent?.includes("Preview Current File"),
      ) as HTMLButtonElement | undefined;
      expect(preview).toBeTruthy();
      preview!.click();
      expect(onPreviewCurrentFile).toHaveBeenCalledWith(expect.objectContaining({
        absolutePath: "/workspace/repo/src/app.ts",
        relativePath: "src/app.ts",
      }));

      const branchTarget = host.querySelector('[data-git-branch-header-layout] > div[tabindex="0"]') as HTMLElement | null;
      expect(branchTarget).toBeTruthy();
      branchTarget!.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      }));
      await flush();
      const copyBranch = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((item) =>
        item.textContent?.includes("Copy Branch Name"),
      ) as HTMLButtonElement | undefined;
      expect(copyBranch).toBeTruthy();
      copyBranch!.click();
      expect(onCopyText).toHaveBeenCalledWith("main");
    } finally {
      dispose();
    }
  });

  it("keeps unlinked branch header navigation unavailable without inventing a worktree", async () => {
    const branch: GitBranchSummary = {
      name: "origin/feature/unlinked",
      fullName: "refs/remotes/origin/feature/unlinked",
      kind: "remote",
    };
    const onOpenInTerminal = vi.fn();
    const onBrowseFiles = vi.fn();
    const onCopyText = vi.fn();
    const onCheckoutBranch = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                repoSummary={{ repoRootPath: "/workspace/repo", headRef: "main", headCommit: "11111111", workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 } }}
                selectedBranch={branch}
                branchDetailState={{ kind: "ready", branch }}
                selectedBranchSubview="history"
                onOpenInTerminal={onOpenInTerminal}
                onBrowseFiles={onBrowseFiles}
                onCopyText={onCopyText}
                onCheckoutBranch={onCheckoutBranch}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const branchTarget = host.querySelector('[data-git-branch-header-layout] > div[tabindex="0"]') as HTMLElement | null;
      expect(branchTarget).toBeTruthy();
      branchTarget!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      const actions = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const terminal = actions.find((item) => item.textContent?.includes('Open Terminal'));
      const files = actions.find((item) => item.textContent?.includes('Browse Files'));
      const checkout = actions.find((item) => item.textContent?.includes('Checkout Branch'));
      expect(terminal?.getAttribute('aria-disabled')).toBe('true');
      expect(files?.getAttribute('aria-disabled')).toBe('true');
      expect(terminal?.title).toBe('Check out this branch locally first.');
      expect(files?.title).toBe('Check out this branch locally first.');
      expect(actions.some((item) => item.textContent?.includes('Copy Worktree Path'))).toBe(false);
      expect(checkout?.getAttribute('aria-disabled')).not.toBe('true');
      checkout!.click();
      expect(onCheckoutBranch).toHaveBeenCalledWith(expect.objectContaining({
        fullName: 'refs/remotes/origin/feature/unlinked',
      }));
      terminal!.click();
      files!.click();
      expect(onOpenInTerminal).not.toHaveBeenCalled();
      expect(onBrowseFiles).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("opens branch-status scope actions for the captured directory and branch", async () => {
    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [{ section: "unstaged", changeType: "modified", path: "src/app.ts" }],
    });
    const branch: GitBranchSummary = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local",
      worktreePath: "/workspace/repo-linked",
    };
    const onAskFlower = vi.fn();
    const onOpenInTerminal = vi.fn();
    const onBrowseFiles = vi.fn();
    const onOpenStash = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                repoSummary={{ repoRootPath: "/workspace/repo", headRef: "main", headCommit: "11111111", workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 } }}
                selectedBranch={branch}
                branchDetailState={{ kind: "ready", branch }}
                selectedBranchSubview="status"
                onAskFlower={onAskFlower}
                onOpenInTerminal={onOpenInTerminal}
                onBrowseFiles={onBrowseFiles}
                onOpenStash={onOpenStash}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const scope = host.querySelector('#git-branch-subview-panel-status') as HTMLElement | null;
      expect(scope).toBeTruthy();
      const openScopeMenu = async () => {
        scope!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await flush();
        return Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      };
      let actions = await openScopeMenu();
      actions.find((item) => item.textContent?.includes('Ask Flower'))!.click();
      expect(onAskFlower).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'branch_status',
        repoRootPath: '/workspace/repo',
        worktreePath: '/workspace/repo-linked',
        branch: expect.objectContaining({ name: 'feature/linked' }),
        items: [expect.objectContaining({ path: 'src/app.ts' })],
      }));
      actions = await openScopeMenu();
      actions.find((item) => item.textContent?.includes('Open Terminal'))!.click();
      expect(onOpenInTerminal).toHaveBeenCalledWith({ path: '/workspace/repo-linked', preferredName: 'repo-linked' });
      actions = await openScopeMenu();
      actions.find((item) => item.textContent?.includes('Browse Files'))!.click();
      expect(onBrowseFiles).toHaveBeenCalledWith({ path: '/workspace/repo-linked', preferredName: 'repo-linked' });
      actions = await openScopeMenu();
      actions.find((item) => item.textContent?.includes('Stash'))!.click();
      expect(onOpenStash).toHaveBeenCalledWith({ tab: 'save', repoRootPath: '/workspace/repo-linked', source: 'branch_status' });
    } finally {
      dispose();
    }
  });

  it("keeps linked branch-status directory actions bound to canonical and live roots", async () => {
    const directoryItem = {
      section: "changes" as const,
      entryKind: "directory" as const,
      path: "internal",
      displayPath: "internal",
      directoryPath: "internal",
      descendantFileCount: 4,
      containsUnstaged: true,
    };
    mockListWorkspacePage.mockResolvedValueOnce({
      repoRootPath: "/workspace/repo-linked",
      section: "changes",
      directoryPath: "",
      breadcrumbs: [{ label: "repo-linked", path: "" }],
      summary: { stagedCount: 0, unstagedCount: 4, untrackedCount: 0, conflictedCount: 0 },
      scopeFileCount: 4,
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [directoryItem],
    });
    const branch: GitBranchSummary = {
      name: "feature/linked",
      fullName: "refs/heads/feature/linked",
      kind: "local",
      worktreePath: "/workspace/repo-linked",
    };
    const onAskFlower = vi.fn();
    const onOpenInTerminal = vi.fn();
    const onBrowseFiles = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                repoSummary={{ repoRootPath: "/workspace/repo", headRef: "main", headCommit: "11111111", workspaceSummary: { stagedCount: 0, unstagedCount: 4, untrackedCount: 0, conflictedCount: 0 } }}
                selectedBranch={branch}
                branchDetailState={{ kind: "ready", branch }}
                selectedBranchSubview="status"
                onAskFlower={onAskFlower}
                onOpenInTerminal={onOpenInTerminal}
                onBrowseFiles={onBrowseFiles}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const row = Array.from(host.querySelectorAll<HTMLTableRowElement>('tbody tr'))
        .find((candidate) => candidate.textContent?.includes('internal'));
      expect(row).toBeTruthy();
      const openMenu = async () => {
        row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await flush();
        return Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      };

      let actions = await openMenu();
      directoryItem.directoryPath = 'mutated-after-open';
      actions.find((item) => item.textContent?.includes('Ask Flower'))!.click();
      expect(onAskFlower).toHaveBeenCalledWith({
        kind: 'branch_status_item',
        repoRootPath: '/workspace/repo',
        worktreePath: '/workspace/repo-linked',
        branch,
        section: 'changes',
        item: expect.objectContaining({ directoryPath: 'internal' }),
      });

      directoryItem.directoryPath = 'internal';
      actions = await openMenu();
      directoryItem.directoryPath = 'mutated-after-open';
      actions.find((item) => item.textContent?.includes('Open Terminal'))!.click();
      expect(onOpenInTerminal).toHaveBeenCalledWith({ path: '/workspace/repo-linked/internal', preferredName: 'internal' });

      directoryItem.directoryPath = 'internal';
      actions = await openMenu();
      directoryItem.directoryPath = 'mutated-after-open';
      actions.find((item) => item.textContent?.includes('Browse Files'))!.click();
      expect(onBrowseFiles).toHaveBeenCalledWith({ path: '/workspace/repo-linked/internal', preferredName: 'internal' });

      directoryItem.directoryPath = 'internal';
      actions = await openMenu();
      directoryItem.directoryPath = 'mutated-after-open';
      actions.find((item) => item.textContent?.includes('Open Directory'))!.click();
      await flush();
      expect(mockListWorkspacePage).toHaveBeenLastCalledWith({
        repoRootPath: '/workspace/repo-linked',
        section: 'changes',
        directoryPath: 'internal',
        offset: 0,
        limit: 200,
      });
    } finally {
      dispose();
    }
  });

  it("keeps compare refs and rename paths stable across context-menu actions", async () => {
    const compareResponse = {
      repoRootPath: "/workspace/repo",
      baseRef: "main",
      targetRef: "feature/demo",
      commits: [],
      files: [
        { changeType: "renamed", oldPath: "src/old.ts", newPath: "src/new.ts" },
        { changeType: "deleted", path: "src/deleted.ts" },
      ],
    };
    mockGetBranchCompare.mockResolvedValue(compareResponse);
    const branch: GitBranchSummary = { name: "feature/demo", fullName: "refs/heads/feature/demo", kind: "local", current: true };
    const onAskFlower = vi.fn();
    const onPreviewCurrentFile = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                repoSummary={{ repoRootPath: "/workspace/repo", headRef: "feature/demo", headCommit: "22222222", workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 } }}
                branches={{ repoRootPath: "/workspace/repo", currentRef: "feature/demo", local: [branch, { name: "main", fullName: "refs/heads/main", kind: "local" }], remote: [] }}
                selectedBranch={branch}
                branchDetailState={{ kind: "ready", branch }}
                selectedBranchSubview="status"
                onAskFlower={onAskFlower}
                onPreviewCurrentFile={onPreviewCurrentFile}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const compare = host.querySelector('button[aria-label="Compare"]') as HTMLButtonElement | null;
      compare!.click();
      await flush();
      const renamedRow = Array.from(document.body.querySelectorAll('tbody tr')).find((row) => row.textContent?.includes('src/new.ts')) as HTMLTableRowElement | undefined;
      expect(renamedRow).toBeTruthy();
      renamedRow!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      compareResponse.baseRef = 'mutated-base';
      compareResponse.targetRef = 'mutated-target';
      let actions = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      actions.find((item) => item.textContent?.includes('Ask Flower'))!.click();
      expect(onAskFlower).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'compare_file',
        baseRef: 'main',
        targetRef: 'feature/demo',
        file: expect.objectContaining({ newPath: 'src/new.ts' }),
      }));

      renamedRow!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      actions = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      actions.find((item) => item.textContent?.includes('Preview Current File'))!.click();
      expect(onPreviewCurrentFile).toHaveBeenCalledWith(expect.objectContaining({
        absolutePath: '/workspace/repo/src/new.ts',
        relativePath: 'src/new.ts',
      }));

      const deletedRow = Array.from(document.body.querySelectorAll('tbody tr')).find((row) => row.textContent?.includes('src/deleted.ts')) as HTMLTableRowElement | undefined;
      deletedRow!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      expect(Array.from(document.body.querySelectorAll('[role="menuitem"]')).some((item) => item.textContent?.includes('Preview Current File'))).toBe(false);
    } finally {
      dispose();
    }
  });

  it("keeps branch-history commit and file context bound to the opened commit", async () => {
    const commit = { hash: '2222222222222222', shortHash: '22222222', parents: ['11111111'], subject: 'Stable history' };
    mockGetCommitDetail.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo-linked',
      commit,
      files: [
        { changeType: 'renamed', oldPath: 'src/old.ts', newPath: 'src/new.ts' },
        { changeType: 'deleted', path: 'src/deleted.ts' },
      ],
    });
    const branch: GitBranchSummary = { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local', worktreePath: '/workspace/repo-linked' };
    const onAskFlower = vi.fn();
    const onPreviewCurrentFile = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitBranchesPanel
                repoRootPath="/workspace/repo"
                repoSummary={{ repoRootPath: '/workspace/repo', headRef: 'main', headCommit: '11111111', workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 } }}
                selectedBranch={branch}
                branchDetailState={{ kind: 'ready', branch }}
                selectedBranchSubview="history"
                selectedCommitHash={commit.hash}
                commits={[commit]}
                onAskFlower={onAskFlower}
                onPreviewCurrentFile={onPreviewCurrentFile}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const commitRow = host.querySelector('.git-branch-history-row') as HTMLTableRowElement | null;
      commitRow!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      commit.subject = 'Mutated subject';
      let actions = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      actions.find((item) => item.textContent?.includes('Ask Flower'))!.click();
      expect(onAskFlower).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'commit',
        repoRootPath: '/workspace/repo-linked',
        branchName: 'feature/demo',
        commit: expect.objectContaining({ subject: 'Stable history' }),
        files: [expect.objectContaining({ newPath: 'src/new.ts' }), expect.objectContaining({ path: 'src/deleted.ts' })],
      }));

      const renamedRow = Array.from(host.querySelectorAll('tr[tabindex="0"]')).find((row) => row.textContent?.includes('src/new.ts')) as HTMLTableRowElement | undefined;
      expect(renamedRow).toBeTruthy();
      renamedRow!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      actions = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      actions.find((item) => item.textContent?.includes('Preview Current File'))!.click();
      expect(onPreviewCurrentFile).toHaveBeenCalledWith(expect.objectContaining({ absolutePath: '/workspace/repo-linked/src/new.ts' }));

      const deletedRow = Array.from(host.querySelectorAll('tr[tabindex="0"]')).find((row) => row.textContent?.includes('src/deleted.ts')) as HTMLTableRowElement | undefined;
      expect(deletedRow).toBeTruthy();
      deletedRow!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      expect(Array.from(document.body.querySelectorAll('[role="menuitem"]')).some((item) => item.textContent?.includes('Preview Current File'))).toBe(false);
    } finally {
      dispose();
    }
  });

  it("uses the branch empty-state copy before a branch is selected", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel repoRootPath="/workspace/repo" />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      expect(host.textContent).toContain(
        "Choose a branch from the sidebar to inspect its status or history.",
      );
    } finally {
      dispose();
    }
  });

  it("preserves loaded commit details when toggling between status and history for the same branch", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    mockGetCommitDetail.mockResolvedValue({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "2222222222222222",
        shortHash: "22222222",
        parents: ["1111111111111111"],
        subject: "Merge feature",
      },
      files: [
        {
          changeType: "modified",
          path: "src/history.ts",
          displayPath: "src/history.ts",
          additions: 8,
          deletions: 3,
          patchText: "@@ -1 +1 @@\n-history\n+history updated",
        },
      ],
    });

    const dispose = render(() => {
      const [subview, setSubview] = createSignal<"status" | "history">(
        "history",
      );
      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                    current: true,
                  }}
                  selectedBranchSubview={subview()}
                  onSelectBranchSubview={setSubview}
                  commits={[
                    {
                      hash: "2222222222222222",
                      shortHash: "22222222",
                      parents: ["1111111111111111"],
                      subject: "Merge feature",
                      authorName: "Bob",
                      authorTimeMs: 1706003600000,
                    },
                  ]}
                  selectedCommitHash="2222222222222222"
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      const initialDetailRequestCount = mockGetCommitDetail.mock.calls.length;
      expect(initialDetailRequestCount).toBeGreaterThan(0);
      expect(host.textContent).toContain("src/history.ts");

      const statusTab = host.querySelector(
        "#git-branch-subview-tab-status",
      ) as HTMLButtonElement | null;
      const historyTab = host.querySelector(
        "#git-branch-subview-tab-history",
      ) as HTMLButtonElement | null;
      expect(statusTab).toBeTruthy();
      expect(historyTab).toBeTruthy();

      statusTab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
      historyTab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      expect(mockGetCommitDetail).toHaveBeenCalledTimes(
        initialDetailRequestCount,
      );
      expect(host.textContent).toContain("src/history.ts");
    } finally {
      dispose();
    }
  });

  it("offers a branch-history action to detach HEAD at the expanded commit", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onSwitchDetached = vi.fn();
    mockGetCommitDetail.mockResolvedValue({
      repoRootPath: "/workspace/repo",
      commit: {
        hash: "2222222222222222",
        shortHash: "22222222",
        parents: ["1111111111111111"],
        subject: "Merge feature",
      },
      files: [
        {
          changeType: "modified",
          path: "src/history.ts",
          displayPath: "src/history.ts",
          additions: 8,
          deletions: 3,
          patchText: "@@ -1 +1 @@\n-history\n+history updated",
        },
      ],
    });

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
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
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                  }}
                  selectedBranchSubview="history"
                  commits={[
                    {
                      hash: "2222222222222222",
                      shortHash: "22222222",
                      parents: ["1111111111111111"],
                      subject: "Merge feature",
                      authorName: "Bob",
                      authorTimeMs: 1706003600000,
                    },
                  ]}
                  selectedCommitHash="2222222222222222"
                  onSwitchDetached={onSwitchDetached}
                />
              </div>
            </ProtocolProvider>
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

      detachButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(onSwitchDetached).toHaveBeenCalledWith({
        commitHash: "2222222222222222",
        shortHash: "22222222",
        source: "branch_history",
        branchName: "feature/demo",
      });
    } finally {
      dispose();
    }
  });

  it("offers a one-click return to the suggested reattach branch in detached branch view", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onCheckoutBranch = vi.fn();

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  repoSummary={{
                    repoRootPath: "/workspace/repo",
                    headRef: "HEAD",
                    headCommit: "1111111111111111",
                    detached: true,
                    reattachBranch: {
                      name: "main",
                      fullName: "refs/heads/main",
                      kind: "local",
                      headCommit: "aaaaaaaa",
                    },
                    workspaceSummary: {
                      stagedCount: 0,
                      unstagedCount: 0,
                      untrackedCount: 0,
                      conflictedCount: 0,
                    },
                  }}
                  selectedBranch={{
                    name: "feature/demo",
                    fullName: "refs/heads/feature/demo",
                    kind: "local",
                  }}
                  onCheckoutBranch={onCheckoutBranch}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      expect(host.textContent).toContain("Detached HEAD");
      expect(host.textContent).toContain("Viewing 11111111 without a branch");
      expect(host.textContent).toContain("Last attached: main");
      expect(host.textContent).toContain("Status unavailable");
      expect(host.textContent).toContain(
        "This branch is not checked out in the active worktree.",
      );
      expect(
        host.querySelector('[data-git-branch-detached-context="true"]'),
      ).toBeTruthy();
      expect(
        host.querySelector('[data-git-branch-status-unavailable="true"]'),
      ).toBeTruthy();
      expect(
        host.querySelector('[data-git-branch-stable-placeholder="status"]'),
      ).toBeFalsy();
      expect(host.textContent).not.toContain(
        "Checkout a local branch to reattach HEAD before pull, push, or merge.",
      );
      expect(host.textContent).not.toContain("Last attached branch: main.");
      const checkoutButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.includes("Checkout main"),
      ) as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();

      checkoutButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(onCheckoutBranch).toHaveBeenCalledWith({
        name: "main",
        fullName: "refs/heads/main",
        kind: "local",
        headCommit: "aaaaaaaa",
      });
    } finally {
      dispose();
    }
  });

  it("shows a missing branch state with recovery actions instead of loading branch status", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onRefreshSelectedBranch = vi.fn();
    const onSelectCurrentBranch = vi.fn();
    const missingBranch: GitBranchSummary = {
      name: "feature/demo",
      fullName: "refs/heads/feature/demo",
      kind: "local",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
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
                  selectedBranch={missingBranch}
                  branchDetailState={{
                    kind: "missing",
                    branch: missingBranch,
                    title: "Branch no longer exists",
                    detail:
                      "feature/demo was deleted outside Redeven. Refresh branches or switch to another branch to continue.",
                  }}
                  branches={{
                    repoRootPath: "/workspace/repo",
                    currentRef: "main",
                    local: [
                      {
                        name: "main",
                        fullName: "refs/heads/main",
                        kind: "local",
                        current: true,
                      },
                    ],
                    remote: [],
                  }}
                  onRefreshSelectedBranch={onRefreshSelectedBranch}
                  onSelectCurrentBranch={onSelectCurrentBranch}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      expect(host.textContent).toContain("Branch no longer exists");
      expect(host.textContent).toContain(
        "feature/demo was deleted outside Redeven.",
      );
      expect(host.textContent).toContain("Refresh branches");
      expect(host.textContent).toContain("View current branch");
      expect(host.querySelector(".git-branch-detail-banner")).toBeTruthy();
      expect(
        host.querySelector(
          '[data-git-branch-status-summary-state="unavailable"]',
        ),
      ).toBeTruthy();
      const placeholder = host.querySelector(
        '[data-git-branch-stable-placeholder="status"]',
      );
      expect(placeholder).toBeTruthy();
      expect(
        placeholder?.querySelector(
          '[data-git-branch-stable-placeholder-layout="status"]',
        ),
      ).toBeTruthy();
      expect(
        placeholder?.querySelectorAll(".git-branch-stable-placeholder__row"),
      ).toHaveLength(3);
      expect(host.textContent).not.toContain(
        "Branch status will appear here after this selection is available.",
      );
      expect(mockListWorkspacePage).not.toHaveBeenCalled();

      const refreshButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Refresh branches",
      ) as HTMLButtonElement | undefined;
      const currentBranchButton = Array.from(
        host.querySelectorAll("button"),
      ).find((node) => node.textContent?.trim() === "View current branch") as
        | HTMLButtonElement
        | undefined;
      expect(refreshButton).toBeTruthy();
      expect(currentBranchButton).toBeTruthy();

      refreshButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      currentBranchButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(onRefreshSelectedBranch).toHaveBeenCalledTimes(1);
      expect(onSelectCurrentBranch).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it("holds branch detail in a verifying state without fetching status payloads", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onMergeBranch = vi.fn();
    const onCheckoutBranch = vi.fn();
    const onDeleteBranch = vi.fn();
    const onOpenInTerminal = vi.fn();
    const onBrowseFiles = vi.fn();
    const verifyingBranch: GitBranchSummary = {
      name: "feature/demo",
      fullName: "refs/heads/feature/demo",
      kind: "local",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
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
                  selectedBranch={verifyingBranch}
                  branchDetailState={{
                    kind: "verifying",
                    branch: verifyingBranch,
                  }}
                  onMergeBranch={onMergeBranch}
                  onCheckoutBranch={onCheckoutBranch}
                  onDeleteBranch={onDeleteBranch}
                  onOpenInTerminal={onOpenInTerminal}
                  onBrowseFiles={onBrowseFiles}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      await setBranchHeaderWidth(host, 420);

      const header = host.querySelector(
        "[data-git-branch-header-layout]",
      ) as HTMLElement | null;
      const commandRail = host.querySelector(
        "[data-git-branch-header-actions]",
      ) as HTMLElement | null;
      const mergeButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Merge",
      ) as HTMLButtonElement | undefined;
      const moreButton = host.querySelector(
        'button[aria-label="More actions"]',
      ) as HTMLButtonElement | null;
      const inlineStatuses = Array.from(
        host.querySelectorAll(".git-inline-loading-status"),
      );
      const verificationSlot = host.querySelector(
        '[data-git-branch-verification-state="active"]',
      ) as HTMLElement | null;

      expect(header?.dataset.gitBranchHeaderLayout).toBe("compact");
      expect(commandRail?.dataset.gitBranchHeaderActions).toBe("overflow");
      expect(mergeButton).toBeTruthy();
      expect(mergeButton?.disabled).toBe(true);
      expect(mergeButton?.getAttribute("aria-busy")).toBe("true");
      expect(moreButton).toBeTruthy();
      expect(moreButton?.disabled).toBe(true);
      expect(moreButton?.getAttribute("aria-busy")).toBe("true");
      expect(verificationSlot).toBeTruthy();
      expect(inlineStatuses).toHaveLength(1);
      expect(inlineStatuses[0]?.textContent).toContain("Checking");
      expect(host.textContent).not.toContain("Checking branch...");
      expect(host.textContent).not.toContain("Checking branch selection");
      expect(host.querySelector(".git-loading-indicator")).toBeTruthy();
      expect(
        host.querySelector(
          '[data-git-branch-status-summary-state="loading"]',
        ),
      ).toBeTruthy();
      const verifyingPlaceholder = host.querySelector(
        '[data-git-branch-stable-placeholder="status"][data-git-branch-stable-placeholder-state="verifying"]',
      );
      expect(verifyingPlaceholder).toBeTruthy();
      expect(
        verifyingPlaceholder?.querySelectorAll(
          ".git-branch-stable-placeholder__row",
        ),
      ).toHaveLength(3);
      expect(host.textContent).not.toContain(
        "Status will appear here after verification.",
      );
      expect(host.querySelector("#git-branch-subview-tab-status")).toBeTruthy();
      expect(host.querySelector("#git-branch-subview-tab-history")).toBeTruthy();
      expect(host.textContent).not.toContain("Refresh branches");

      mergeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      moreButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(onMergeBranch).not.toHaveBeenCalled();
      expect(onCheckoutBranch).not.toHaveBeenCalled();
      expect(onDeleteBranch).not.toHaveBeenCalled();
      expect(onOpenInTerminal).not.toHaveBeenCalled();
      expect(onBrowseFiles).not.toHaveBeenCalled();
      expect(mockListWorkspacePage).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("renders a compact status-table skeleton while branch verification is pending", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const verifyingBranch: GitBranchSummary = {
      name: "feature/demo",
      fullName: "refs/heads/feature/demo",
      kind: "local",
      current: true,
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  selectedBranch={verifyingBranch}
                  branchDetailState={{
                    kind: "verifying",
                    branch: verifyingBranch,
                  }}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      const placeholder = host.querySelector(
        '[data-git-branch-stable-placeholder="status"][data-git-branch-stable-placeholder-state="verifying"]',
      );
      const frame = placeholder?.closest(".git-branch-stable-placeholder");
      expect(placeholder).toBeTruthy();
      expect(frame?.className).not.toContain("flex-1");
      expect(
        placeholder?.querySelector(
          '[data-git-branch-stable-placeholder-layout="status"]',
        ),
      ).toBeTruthy();
      expect(
        placeholder?.querySelector(".git-branch-stable-placeholder__header")
          ?.textContent,
      ).toContain("Path");
      expect(
        placeholder?.querySelectorAll(".git-branch-stable-placeholder__row"),
      ).toHaveLength(3);
      expect(host.textContent).not.toContain(
        "Status will appear here after verification.",
      );
      expect(mockListWorkspacePage).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("shows branch verification errors in history view and offers a retry action", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onRefreshSelectedBranch = vi.fn();
    const errorBranch: GitBranchSummary = {
      name: "feature/demo",
      fullName: "refs/heads/feature/demo",
      kind: "local",
    };

    const dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[640px]">
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
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
                  selectedBranch={errorBranch}
                  branchDetailState={{
                    kind: "error",
                    branch: errorBranch,
                    message: "Branch verification timed out.",
                  }}
                  selectedBranchSubview="history"
                  commits={[
                    {
                      hash: "2222222222222222",
                      shortHash: "22222222",
                      parents: ["1111111111111111"],
                      subject: "Merge feature",
                      authorName: "Bob",
                      authorTimeMs: 1706003600000,
                    },
                  ]}
                  onRefreshSelectedBranch={onRefreshSelectedBranch}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host,
    );

    try {
      await flush();
      expect(host.textContent).toContain("Unable to verify branch");
      expect(host.textContent).toContain("Branch verification timed out.");
      expect(host.textContent).toContain("Refresh branches");
      expect(host.textContent).not.toContain("Merge feature");
      expect(host.querySelector(".git-branch-detail-banner")).toBeTruthy();
      const historyPlaceholder = host.querySelector(
        '[data-git-branch-stable-placeholder="history"]',
      );
      expect(historyPlaceholder).toBeTruthy();
      expect(
        historyPlaceholder?.querySelector(
          '[data-git-branch-stable-placeholder-layout="history"]',
        ),
      ).toBeTruthy();
      expect(
        historyPlaceholder?.querySelectorAll(
          ".git-branch-stable-placeholder__row",
        ),
      ).toHaveLength(3);
      expect(host.textContent).not.toContain(
        "Commit history will appear here after this selection is available.",
      );
      expect(
        host.querySelectorAll("#git-branch-subview-panel-history"),
      ).toHaveLength(1);

      const refreshButton = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === "Refresh branches",
      ) as HTMLButtonElement | undefined;
      expect(refreshButton).toBeTruthy();

      refreshButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(onRefreshSelectedBranch).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });
});
