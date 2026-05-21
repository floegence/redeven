import {
  normalizeDesktopDownloadActionResponse,
  normalizeDesktopDownloadCompleteResponse,
  normalizeDesktopDownloadPrepareResponse,
  type DesktopDownloadAbortRequest,
  type DesktopDownloadActionRequest,
  type DesktopDownloadActionResponse,
  type DesktopDownloadCompleteRequest,
  type DesktopDownloadCompleteResponse,
  type DesktopDownloadPrepareRequest,
  type DesktopDownloadPrepareResponse,
  type DesktopDownloadWriteRequest,
} from '../../../../../../desktop/src/shared/desktopDownloadIPC';

export interface DesktopDownloadsBridge {
  prepare?: (request: DesktopDownloadPrepareRequest) => Promise<DesktopDownloadPrepareResponse>;
  write?: (request: DesktopDownloadWriteRequest) => Promise<DesktopDownloadActionResponse>;
  complete?: (request: DesktopDownloadCompleteRequest) => Promise<DesktopDownloadCompleteResponse>;
  abort?: (request: DesktopDownloadAbortRequest) => Promise<DesktopDownloadActionResponse>;
  reveal?: (request: DesktopDownloadActionRequest) => Promise<DesktopDownloadActionResponse>;
  open?: (request: DesktopDownloadActionRequest) => Promise<DesktopDownloadActionResponse>;
}

declare global {
  interface Window {
    redevenDesktopDownloads?: DesktopDownloadsBridge;
  }
}

export function desktopDownloadsBridge(): DesktopDownloadsBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const candidate = window.redevenDesktopDownloads;
  if (
    !candidate
    || typeof candidate.prepare !== 'function'
    || typeof candidate.write !== 'function'
    || typeof candidate.complete !== 'function'
    || typeof candidate.abort !== 'function'
  ) {
    return null;
  }
  return candidate;
}

export async function prepareDesktopDownload(
  bridge: DesktopDownloadsBridge,
  request: DesktopDownloadPrepareRequest,
): Promise<DesktopDownloadPrepareResponse> {
  return normalizeDesktopDownloadPrepareResponse(await bridge.prepare?.(request));
}

export async function writeDesktopDownload(
  bridge: DesktopDownloadsBridge,
  request: DesktopDownloadWriteRequest,
): Promise<DesktopDownloadActionResponse> {
  return normalizeDesktopDownloadActionResponse(await bridge.write?.(request));
}

export async function completeDesktopDownload(
  bridge: DesktopDownloadsBridge,
  request: DesktopDownloadCompleteRequest,
): Promise<DesktopDownloadCompleteResponse> {
  return normalizeDesktopDownloadCompleteResponse(await bridge.complete?.(request));
}

export async function abortDesktopDownload(
  bridge: DesktopDownloadsBridge,
  request: DesktopDownloadAbortRequest,
): Promise<DesktopDownloadActionResponse> {
  return normalizeDesktopDownloadActionResponse(await bridge.abort?.(request));
}

export async function revealDesktopDownload(
  bridge: DesktopDownloadsBridge,
  request: DesktopDownloadActionRequest,
): Promise<DesktopDownloadActionResponse> {
  return normalizeDesktopDownloadActionResponse(await bridge.reveal?.(request));
}

export async function openDesktopDownload(
  bridge: DesktopDownloadsBridge,
  request: DesktopDownloadActionRequest,
): Promise<DesktopDownloadActionResponse> {
  return normalizeDesktopDownloadActionResponse(await bridge.open?.(request));
}
