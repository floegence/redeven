import type {
  GitListWorkspacePathStatusesRequest,
  GitListWorkspacePathStatusesResponse,
  GitWorkspaceChange,
} from '../protocol/redeven_v1';
import { toWireGitListWorkspacePathStatusesRequest } from '../protocol/redeven_v1/codec/git';
import {
  isGitWorkspaceBudgetError,
  isGitWorkspaceSnapshotStale,
} from './gitWorkspaceRuntime';

export const GIT_PATH_STATUS_MAX_PATHS = 64;
export const GIT_PATH_STATUS_MAX_UTF8_BYTES = 128 * 1024;
export const GIT_PATH_STATUS_MAX_WIRE_BYTES = 736 * 1024;
export const GIT_WORKSPACE_REVISION_V1_BYTES = 64;

const utf8 = new TextEncoder();

function utf8Length(value: string): number {
  return utf8.encode(value).byteLength;
}

export function gitPathStatusWireBytes(request: GitListWorkspacePathStatusesRequest): number {
  return utf8Length(JSON.stringify(toWireGitListWorkspacePathStatusesRequest(request)));
}

function candidateFits(
  repoRootPath: string,
  paths: string[],
  expectedWorkspaceRevision?: string,
): boolean {
  return paths.length <= GIT_PATH_STATUS_MAX_PATHS
    && paths.reduce((total, path) => total + utf8Length(path), 0) <= GIT_PATH_STATUS_MAX_UTF8_BYTES
    && gitPathStatusWireBytes({ repoRootPath, paths, expectedWorkspaceRevision }) <= GIT_PATH_STATUS_MAX_WIRE_BYTES;
}

export function partitionGitPathStatusRequests(
  repoRootPath: string,
  paths: string[],
  expectedWorkspaceRevision?: string,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  for (const path of paths) {
    const candidate = [...current, path];
    if (current.length > 0 && !candidateFits(repoRootPath, candidate, expectedWorkspaceRevision)) {
      batches.push(current);
      current = [path];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export type GitPathStatusQueryResult = Readonly<{
  workspaceRevision?: string;
  items: GitWorkspaceChange[];
  degradedPaths: string[];
  preempted: boolean;
}>;

export async function queryGitWorkspacePathStatuses(params: {
  repoRootPath: string;
  paths: string[];
  expectedWorkspaceRevision?: string;
  call: (request: GitListWorkspacePathStatusesRequest) => Promise<GitListWorkspacePathStatusesResponse>;
  shouldContinue?: () => boolean;
  onSnapshotStale?: () => void;
}): Promise<GitPathStatusQueryResult> {
  const shouldContinue = params.shouldContinue ?? (() => true);

  const queryGeneration = async (
    initialWorkspaceRevision: string | undefined,
  ): Promise<GitPathStatusQueryResult> => {
    let workspaceRevision = initialWorkspaceRevision;
    const items: GitWorkspaceChange[] = [];
    const degradedPaths: string[] = [];
    const initialRevisionForBudget = workspaceRevision ?? '0'.repeat(GIT_WORKSPACE_REVISION_V1_BYTES);
    const queue = partitionGitPathStatusRequests(params.repoRootPath, params.paths, initialRevisionForBudget);

    const visit = async (paths: string[]): Promise<boolean> => {
      if (!shouldContinue()) return false;
      const revisionForBudget = workspaceRevision ?? initialRevisionForBudget;
      if (!candidateFits(params.repoRootPath, paths, revisionForBudget)) {
        if (paths.length === 1) {
          degradedPaths.push(paths[0]);
          return shouldContinue();
        }
        const middle = Math.ceil(paths.length / 2);
        return await visit(paths.slice(0, middle)) && await visit(paths.slice(middle));
      }
      try {
        const response = await params.call({
          repoRootPath: params.repoRootPath,
          paths,
          ...(workspaceRevision ? { expectedWorkspaceRevision: workspaceRevision } : {}),
        });
        if (!shouldContinue()) return false;
        const responseRevision = String(response.workspaceRevision ?? '');
        if (!responseRevision) throw new Error('Git workspace response omitted workspace_revision');
        if (workspaceRevision && responseRevision !== workspaceRevision) {
          throw new Error('Git workspace response changed workspace_revision');
        }
        workspaceRevision = responseRevision;
        items.push(...response.items);
        return true;
      } catch (error) {
        if (!isGitWorkspaceBudgetError(error)) throw error;
        if (paths.length === 1) {
          degradedPaths.push(paths[0]);
          return shouldContinue();
        }
        const middle = Math.ceil(paths.length / 2);
        return await visit(paths.slice(0, middle)) && await visit(paths.slice(middle));
      }
    };

    for (const batch of queue) {
      if (!await visit(batch)) {
        return { workspaceRevision: undefined, items: [], degradedPaths: [], preempted: true };
      }
    }
    return { workspaceRevision, items, degradedPaths, preempted: false };
  };

  try {
    return await queryGeneration(params.expectedWorkspaceRevision);
  } catch (error) {
    if (!isGitWorkspaceSnapshotStale(error)) throw error;
    params.onSnapshotStale?.();
    if (!shouldContinue()) {
      return { workspaceRevision: undefined, items: [], degradedPaths: [], preempted: true };
    }
    return queryGeneration(undefined);
  }
}
