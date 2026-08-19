import { describe, expect, it } from 'vitest';

import {
  toWireGitGetDiffContentRequest,
  toWireGitListCommitsRequest,
  toWireGitListWorkspacePageRequest,
  toWireGitListWorkspacePathStatusesRequest,
} from './git';

describe('Git request wire encoding', () => {
  it('omits absent workspace page fields from the JSON payload', () => {
    expect(toWireGitListWorkspacePageRequest({
      repoRootPath: '/workspace/repo',
      section: 'changes',
      offset: 0,
      limit: 200,
    })).toStrictEqual({
      repo_root_path: '/workspace/repo',
      section: 'changes',
      offset: 0,
      limit: 200,
    });
  });

  it('includes explicit workspace page scope and revision fields', () => {
    expect(toWireGitListWorkspacePageRequest({
      repoRootPath: '/workspace/repo',
      section: 'staged',
      directoryPath: 'internal/',
      offset: 20,
      limit: 40,
      expectedWorkspaceRevision: 'revision-1',
    })).toStrictEqual({
      repo_root_path: '/workspace/repo',
      section: 'staged',
      directory_path: 'internal/',
      offset: 20,
      limit: 40,
      expected_workspace_revision: 'revision-1',
    });
  });

  it('omits an absent workspace path-status revision from the JSON payload', () => {
    expect(toWireGitListWorkspacePathStatusesRequest({
      repoRootPath: '/workspace/repo',
      paths: ['README.md'],
    })).toStrictEqual({
      repo_root_path: '/workspace/repo',
      paths: ['README.md'],
    });
  });

  it('omits an absent commit ref from the JSON payload', () => {
    expect(toWireGitListCommitsRequest({
      repoRootPath: '/workspace/repo',
      offset: 0,
      limit: 50,
    })).toStrictEqual({
      repo_root_path: '/workspace/repo',
      offset: 0,
      limit: 50,
    });
  });

  it('omits absent commit diff fields from the JSON payload', () => {
    expect(toWireGitGetDiffContentRequest({
      repoRootPath: '/workspace/repo',
      sourceKind: 'commit',
      commit: '3a47b67b1234567890',
      mode: 'preview',
      file: {
        changeType: 'modified',
        path: 'src/app.ts',
      },
    })).toStrictEqual({
      repo_root_path: '/workspace/repo',
      source_kind: 'commit',
      commit: '3a47b67b1234567890',
      mode: 'preview',
      file: {
        change_type: 'modified',
        path: 'src/app.ts',
      },
    });
  });
});
