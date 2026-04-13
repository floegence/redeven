import type { GitBranchSubview, GitWorkbenchSubview } from "./gitWorkbench";

export type GitActivationRefreshPlan = {
  refreshRepoSummary: boolean;
  refreshWorkspace: boolean;
  refreshBranches: boolean;
  refreshBranchStatus: boolean;
};

export function normalizeGitActivationSubview(
  subview: GitWorkbenchSubview,
): GitWorkbenchSubview {
  return subview === "overview" ? "changes" : subview;
}

export function buildGitActivationRefreshPlan(context: {
  subview: GitWorkbenchSubview;
  branchSubview: GitBranchSubview;
}): GitActivationRefreshPlan {
  const subview = normalizeGitActivationSubview(context.subview);
  switch (subview) {
    case "changes":
      return {
        refreshRepoSummary: true,
        refreshWorkspace: true,
        refreshBranches: false,
        refreshBranchStatus: false,
      };
    case "branches":
      return {
        refreshRepoSummary: true,
        refreshWorkspace: false,
        refreshBranches: true,
        refreshBranchStatus: context.branchSubview === "status",
      };
    case "history":
    default:
      return {
        refreshRepoSummary: true,
        refreshWorkspace: false,
        refreshBranches: false,
        refreshBranchStatus: false,
      };
  }
}
