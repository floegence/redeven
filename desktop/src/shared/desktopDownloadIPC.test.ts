import { describe, expect, it } from 'vitest';
import {
  normalizeDesktopDownloadAbortRequest,
  normalizeDesktopDownloadActionRequest,
  normalizeDesktopDownloadActionResponse,
  normalizeDesktopDownloadCompleteRequest,
  normalizeDesktopDownloadCompleteResponse,
  normalizeDesktopDownloadPrepareRequest,
  normalizeDesktopDownloadPrepareResponse,
  normalizeDesktopDownloadWriteRequest,
} from './desktopDownloadIPC';

describe('desktopDownloadIPC', () => {
  it('normalizes prepare requests and rejects missing required fields', () => {
    expect(normalizeDesktopDownloadPrepareRequest({
      task_id: ' task-1 ',
      suggested_name: ' report.txt ',
      total_bytes: 42.8,
    })).toEqual({
      task_id: 'task-1',
      suggested_name: 'report.txt',
      total_bytes: 42,
    });
    expect(normalizeDesktopDownloadPrepareRequest({ task_id: 'task-1' })).toBeNull();
    expect(normalizeDesktopDownloadPrepareRequest(null)).toBeNull();
  });

  it('normalizes chunk requests into owned byte views', () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const view = new Uint8Array(buffer, 1, 2);
    const normalized = normalizeDesktopDownloadWriteRequest({
      token: ' token ',
      chunk: view,
    });

    expect(normalized?.token).toBe('token');
    expect(Array.from(normalized?.chunk instanceof Uint8Array ? normalized.chunk : [])).toEqual([2, 3]);
    expect(normalizeDesktopDownloadWriteRequest({ token: 'token', chunk: 'nope' })).toBeNull();
  });

  it('normalizes completion, abort, and action payloads', () => {
    expect(normalizeDesktopDownloadCompleteRequest({ token: ' token ' })).toEqual({ token: 'token' });
    expect(normalizeDesktopDownloadAbortRequest({ token: ' token ', reason: 'failed' })).toEqual({
      token: 'token',
      reason: 'failed',
    });
    expect(normalizeDesktopDownloadAbortRequest({ token: ' token ', reason: 'other' })).toBeNull();
    expect(normalizeDesktopDownloadActionRequest({ token: ' token ' })).toEqual({ token: 'token' });
  });

  it('normalizes responses without trusting malformed destinations', () => {
    expect(normalizeDesktopDownloadPrepareResponse({
      ok: true,
      canceled: false,
      destination: {
        token: ' token ',
        file_name: 'report.txt',
        display_path: '/tmp/report.txt',
      },
    })).toEqual({
      ok: true,
      canceled: false,
      destination: {
        token: 'token',
        file_name: 'report.txt',
        display_path: '/tmp/report.txt',
      },
      message: undefined,
    });
    expect(normalizeDesktopDownloadPrepareResponse(null)).toEqual({
      ok: false,
      message: 'Desktop could not prepare the download.',
    });
    expect(normalizeDesktopDownloadCompleteResponse({ ok: true, destination: { token: '', file_name: '', display_path: '' } })).toEqual({
      ok: true,
      message: undefined,
    });
    expect(normalizeDesktopDownloadActionResponse({ ok: true, message: ' done ' })).toEqual({
      ok: true,
      message: 'done',
    });
  });
});
