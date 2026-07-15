import fs from 'node:fs/promises';

import type { DesktopCodeWorkspacePackageChunkResponse } from '../shared/desktopCodeWorkspaceIPC';

export type DesktopCodeWorkspacePackageJobOperation = Readonly<{
  controller: AbortController;
}>;

export type DesktopCodeWorkspacePackageJob = Readonly<{
  jobID: string;
  archivePath: string;
  archiveSizeBytes: number;
  chunkSizeBytes: number;
  createdAtMs: number;
  operation: DesktopCodeWorkspacePackageJobOperation;
}>;

export class DesktopCodeWorkspacePackageJobStore {
  private readonly jobs = new Map<string, DesktopCodeWorkspacePackageJob>();

  constructor(private readonly options: Readonly<{
    ttlMS: number;
    now?: () => number;
    finishOperation: (operation: DesktopCodeWorkspacePackageJobOperation) => void;
  }>) {}

  add(job: DesktopCodeWorkspacePackageJob): void {
    this.prune();
    this.jobs.set(job.jobID, job);
  }

  prune(): void {
    const expiresBefore = (this.options.now ?? Date.now)() - this.options.ttlMS;
    const expiredOperations = new Set<DesktopCodeWorkspacePackageJobOperation>();
    for (const [jobID, job] of this.jobs.entries()) {
      if (job.createdAtMs >= expiresBefore) continue;
      this.jobs.delete(jobID);
      job.operation.controller.abort();
      expiredOperations.add(job.operation);
    }
    for (const operation of expiredOperations) {
      this.options.finishOperation(operation);
    }
  }

  async read(jobID: string, offsetBytes: number, lengthBytes: number): Promise<DesktopCodeWorkspacePackageChunkResponse> {
    this.prune();
    const job = this.jobs.get(jobID);
    if (!job) {
      return { ok: false, message: 'Workspace package is no longer available.' };
    }
    if (job.operation.controller.signal.aborted) {
      return { ok: false, message: 'Browser Editor package reading was canceled.' };
    }

    const offset = Math.max(0, Math.floor(offsetBytes));
    const length = Math.max(1, Math.min(Math.floor(lengthBytes), job.chunkSizeBytes));
    if (offset > job.archiveSizeBytes) {
      return { ok: false, message: 'Workspace package chunk offset is out of range.' };
    }
    const bytesToRead = Math.min(length, job.archiveSizeBytes - offset);
    if (bytesToRead <= 0) {
      return {
        ok: true,
        chunk: new Uint8Array(),
        offset_bytes: offset,
        length_bytes: 0,
        done: true,
      };
    }

    const handle = await fs.open(job.archivePath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset);
      if (job.operation.controller.signal.aborted) {
        return { ok: false, message: 'Browser Editor package reading was canceled.' };
      }
      return {
        ok: true,
        chunk: new Uint8Array(buffer.subarray(0, bytesRead)),
        offset_bytes: offset,
        length_bytes: bytesRead,
        done: offset + bytesRead >= job.archiveSizeBytes,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Desktop could not read the workspace package.',
      };
    } finally {
      await handle.close();
    }
  }

  dispose(jobID: string): boolean {
    const job = this.jobs.get(jobID);
    if (!job) return false;
    this.jobs.delete(jobID);
    this.options.finishOperation(job.operation);
    return true;
  }

  removeForOperation(operation: DesktopCodeWorkspacePackageJobOperation): number {
    let removed = 0;
    for (const [jobID, job] of this.jobs.entries()) {
      if (job.operation !== operation) continue;
      this.jobs.delete(jobID);
      removed += 1;
    }
    return removed;
  }
}
