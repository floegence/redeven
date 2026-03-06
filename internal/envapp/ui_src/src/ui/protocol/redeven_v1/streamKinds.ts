export const redevenV1StreamKinds = {
  fs: {
    readFile: 'fs/read_file',
  },
  git: {
    readCommitPatch: 'git/read_commit_patch',
    readWorkspacePatch: 'git/read_workspace_patch',
    readComparePatch: 'git/read_compare_patch',
  },
} as const;
