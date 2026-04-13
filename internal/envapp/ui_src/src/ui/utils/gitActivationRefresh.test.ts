import { describe, expect, it } from "vitest";

import {
  buildGitActivationRefreshPlan,
  normalizeGitActivationSubview,
} from "./gitActivationRefresh";

describe("normalizeGitActivationSubview", () => {
  it("maps overview to changes so activation logic stays repo-browser scoped", () => {
    expect(normalizeGitActivationSubview("overview")).toBe("changes");
    expect(normalizeGitActivationSubview("branches")).toBe("branches");
    expect(normalizeGitActivationSubview("history")).toBe("history");
  });
});

describe("buildGitActivationRefreshPlan", () => {
  it("refreshes summary and workspace for the changes view", () => {
    expect(
      buildGitActivationRefreshPlan({
        subview: "changes",
        branchSubview: "status",
      }),
    ).toEqual({
      refreshRepoSummary: true,
      refreshWorkspace: true,
      refreshBranches: false,
      refreshBranchStatus: false,
    });
  });

  it("refreshes summary and branch list for the branches view", () => {
    expect(
      buildGitActivationRefreshPlan({
        subview: "branches",
        branchSubview: "status",
      }),
    ).toEqual({
      refreshRepoSummary: true,
      refreshWorkspace: false,
      refreshBranches: true,
      refreshBranchStatus: true,
    });

    expect(
      buildGitActivationRefreshPlan({
        subview: "branches",
        branchSubview: "history",
      }),
    ).toEqual({
      refreshRepoSummary: true,
      refreshWorkspace: false,
      refreshBranches: true,
      refreshBranchStatus: false,
    });
  });

  it("keeps graph activation focused on repository summary", () => {
    expect(
      buildGitActivationRefreshPlan({
        subview: "history",
        branchSubview: "status",
      }),
    ).toEqual({
      refreshRepoSummary: true,
      refreshWorkspace: false,
      refreshBranches: false,
      refreshBranchStatus: false,
    });
  });
});
