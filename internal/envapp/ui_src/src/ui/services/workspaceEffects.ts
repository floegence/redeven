import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import { executeWorkspaceEffect } from './gitWorkspaceRuntime';

type RpcMethod = (...args: never[]) => Promise<unknown>;

function wrapWorkspaceEffect<M extends RpcMethod>(
  clientIdentity: object,
  repoHint: string | undefined,
  method: M,
): (...args: Parameters<M>) => ReturnType<M> {
  return ((...args: Parameters<M>) => executeWorkspaceEffect({
    clientIdentity,
    repoHint,
    effect: () => method(...args),
  })) as (...args: Parameters<M>) => ReturnType<M>;
}

export function createWorkspaceEffectRpc(
  clientIdentity: object,
  rpc: RedevenV1Rpc,
  repoHint?: string,
) {
  return {
    get fs() {
      return {
        writeFile: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.fs.writeFile),
        mkdir: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.fs.mkdir),
        rename: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.fs.rename),
        copy: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.fs.copy),
        delete: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.fs.delete),
      };
    },
    get git() {
      return {
        stageWorkspace: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.stageWorkspace),
        unstageWorkspace: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.unstageWorkspace),
        discardWorkspace: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.discardWorkspace),
        commitWorkspace: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.commitWorkspace),
        saveStash: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.saveStash),
        applyStash: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.applyStash),
        dropStash: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.dropStash),
        fetchRepo: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.fetchRepo),
        pullRepo: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.pullRepo),
        pushRepo: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.pushRepo),
        checkoutBranch: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.checkoutBranch),
        switchDetached: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.switchDetached),
        mergeBranch: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.mergeBranch),
        deleteBranch: wrapWorkspaceEffect(clientIdentity, repoHint, rpc.git.deleteBranch),
      };
    },
  };
}
