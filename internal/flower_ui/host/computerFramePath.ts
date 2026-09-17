import type { FlowerComputerFrameSource } from '../src/contracts/flowerSurfaceContracts';

/** Shared route encoding for authenticated Env App and Desktop host adapters. */
export function computerFramePath(frame: FlowerComputerFrameSource): string {
  if (frame.private_frame) {
    const query = new URLSearchParams({ ...frame.private_frame, viewer_revision: String(frame.private_frame.viewer_revision), thread_id: frame.thread_id });
    return `/_redeven_proxy/api/ai/computer/private-frame?${query}`;
  }
  return `/_redeven_proxy/api/ai/threads/${encodeURIComponent(frame.thread_id)}/computer-media/${encodeURIComponent(frame.target_id)}/${encodeURIComponent(frame.sha256)}`;
}
