import { describe, expect, it } from 'vitest';

import {
  buildFlowerTurnHTTPBody,
  flowerTurnAdmissionError,
  flowerTurnAdmissionFailureKind,
  normalizeFlowerTurnLaunchReceipt,
} from './flowerTurnAdmission';

describe('Flower turn admission', () => {
  it('places a new-thread identity only in the create snapshot', () => {
    const body = buildFlowerTurnHTTPBody({
      launch: { client_request_id: 'client-new', prompt: 'hello' },
      modelID: 'deepseek/deepseek-v4-flash',
      permissionType: 'approval_required',
      attachmentIDs: [],
    });

    expect(body).not.toHaveProperty('client_request_id');
    expect(body).not.toHaveProperty('thread_id');
    expect(body).toMatchObject({
      create: {
        client_request_id: 'client-new',
        model_id: 'deepseek/deepseek-v4-flash',
      },
    });
  });

  it('places an existing-thread identity only at the top level and uses the path for ThreadID', () => {
    const body = buildFlowerTurnHTTPBody({
      launch: { client_request_id: 'client-existing', thread_id: 'thread-a', prompt: 'continue' },
      modelID: '',
      attachmentIDs: [],
    });

    expect(body).toMatchObject({ client_request_id: 'client-existing' });
    expect(body).not.toHaveProperty('thread_id');
    expect(body).not.toHaveProperty('create');
  });

  it('classifies explicit rejection separately from unresolved admission', () => {
    expect(flowerTurnAdmissionFailureKind({ failureKind: 'response' })).toBe('rejected');
    expect(flowerTurnAdmissionFailureKind({ failureKind: 'transport_unknown' })).toBe('unknown');
    expect(flowerTurnAdmissionFailureKind(new Error('local validation'))).toBe('not_sent');
    expect(flowerTurnAdmissionFailureKind(
      flowerTurnAdmissionError('unknown', new Error('response lost')),
    )).toBe('unknown');
  });

  it('treats an unusable success receipt as unresolved admission', () => {
    expect(() => normalizeFlowerTurnLaunchReceipt(
      { client_request_id: 'client-other', thread_id: 'thread-a' },
      { clientRequestID: 'client-request', existingThreadID: 'thread-a' },
    )).toThrow(expect.objectContaining({ admission_kind: 'unknown' }));
  });
});
