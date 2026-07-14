import { describe, expect, it } from 'vitest';

import {
  fromWireTerminalHistoryResponse,
  fromWireTerminalSessionsChangedNotify,
  toWireTerminalHistoryRequest,
} from './terminal';

describe('terminal codec', () => {
  it('encodes terminal history page options', () => {
    expect(toWireTerminalHistoryRequest({
      sessionId: 'session-1',
      startSeq: 2,
      endSeq: -1,
      historyGeneration: 7,
      limitChunks: 128.7,
      maxBytes: 4096,
    })).toEqual({
      session_id: 'session-1',
      start_seq: 2,
      end_seq: -1,
      history_generation: 7,
      limit_chunks: 128,
      max_bytes: 4096,
    });
  });

  it('decodes terminal history cursor metadata', () => {
    const resp = fromWireTerminalHistoryResponse({
      chunks: [
        {
          sequence: 9,
          timestamp_ms: 42,
          data_b64: 'aGVsbG8=',
        },
      ],
      next_start_seq: 10,
      has_more: true,
      first_sequence: 9,
      last_sequence: 9,
      covered_through_sequence: 12,
      snapshot_end_sequence: 20,
      first_retained_sequence: 4,
      history_generation: 7,
      history_truncated: true,
      covered_bytes: 5,
      total_bytes: 1024,
    });

    expect(resp.chunks).toHaveLength(1);
    expect(resp.chunks[0]?.sequence).toBe(9);
    expect(new TextDecoder().decode(resp.chunks[0]?.data)).toBe('hello');
    expect(resp.nextStartSeq).toBe(10);
    expect(resp.hasMore).toBe(true);
    expect(resp.firstSequence).toBe(9);
    expect(resp.lastSequence).toBe(9);
    expect(resp.coveredThroughSequence).toBe(12);
    expect(resp.snapshotEndSequence).toBe(20);
    expect(resp.firstRetainedSequence).toBe(4);
    expect(resp.historyGeneration).toBe(7);
    expect(resp.historyReset).toBe(false);
    expect(resp.historyTruncated).toBe(true);
    expect(resp.coveredBytes).toBe(5);
    expect(resp.totalBytes).toBe(1024);
  });

  it('distinguishes explicit zero history coverage from a missing contract', () => {
    expect(fromWireTerminalHistoryResponse({
      chunks: [],
      covered_through_sequence: 0,
      snapshot_end_sequence: 0,
      first_retained_sequence: 0,
      history_generation: 1,
    })).toMatchObject({
      coveredThroughSequence: 0,
      snapshotEndSequence: 0,
      firstRetainedSequence: 0,
      historyGeneration: 1,
    });

    expect(fromWireTerminalHistoryResponse({ chunks: [] })).toMatchObject({
      coveredThroughSequence: undefined,
      snapshotEndSequence: undefined,
      firstRetainedSequence: undefined,
      historyGeneration: undefined,
    });
  });

  it.each([null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'preserves invalid history coverage %s for the coordinator validator',
    (coveredThroughSequence) => {
      const result = fromWireTerminalHistoryResponse({
        chunks: [],
        covered_through_sequence: coveredThroughSequence as number,
      });
      expect(result.coveredThroughSequence).toBeNaN();
    },
  );

  it('decodes hidden terminal close lifecycle notifications', () => {
    expect(fromWireTerminalSessionsChangedNotify({
      reason: 'close_failed_hidden',
      session_id: ' session-1 ',
      timestamp_ms: 42,
      lifecycle: 'close_failed_hidden',
      hidden: true,
      owner_widget_id: ' widget-terminal-1 ',
      failure_code: 'DELETE_FAILED',
      failure_message: 'pty cleanup timed out',
    })).toEqual({
      reason: 'close_failed_hidden',
      sessionId: 'session-1',
      timestampMs: 42,
      lifecycle: 'close_failed_hidden',
      hidden: true,
      ownerWidgetId: 'widget-terminal-1',
      failureCode: 'DELETE_FAILED',
      failureMessage: 'pty cleanup timed out',
    });
  });

  it('rejects unknown terminal session change reasons', () => {
    expect(fromWireTerminalSessionsChangedNotify({
      reason: 'unknown' as any,
    })).toBeNull();
  });
});
