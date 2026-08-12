import { describe, expect, it } from 'vitest';

import { createThreadStore } from '../../../../flower_ui/src/threadStore';

describe('Flower ThreadStore', () => {
  it('fences stale A/B/A detail responses and preserves summary-only detail', () => {
    const store = createThreadStore();
    store.seedSummary({ thread_id: 'a', title: 'A', status: 'waiting_user' });
    store.seedSummary({ thread_id: 'b', title: 'B', status: 'running' });
    store.selectThread('a');
    store.applyDetail({ thread_id: 'a', revision: 2, messages: ['a-history'], status: 'waiting_user' });
    store.selectThread('b');
    store.selectThread('a');
    expect(store.selectedThreadId()).toBe('a');
    expect(store.applyDetail({ thread_id: 'b', revision: 3, messages: ['late-b'], status: 'success' })).toBe(false);
    expect(store.applySummary({ thread_id: 'a', revision: 3, status: 'waiting_user', messages: [] })).toBe(true);
    expect(store.detail('a')?.messages).toEqual(['a-history']);
    expect(store.detail('a')?.status).toBe('waiting_user');
  });

  it('applies only contiguous revisions and requests resync on a cursor gap', () => {
    const store = createThreadStore();
    store.selectThread('a');
    store.applyDetail({ thread_id: 'a', revision: 1, messages: [], status: 'running' });
    expect(store.applyEvent({ thread_id: 'a', revision: 3, id: 'e3', kind: 'turn_state', payload: { status: 'success' } })).toBe('resync');
    expect(store.detail('a')?.revision).toBe(1);
    expect(store.applyEvent({ thread_id: 'a', revision: 2, id: 'e2', kind: 'turn_state', payload: { status: 'waiting_user' } })).toBe('applied');
    expect(store.detail('a')?.status).toBe('waiting_user');
  });

  it('keeps higher-priority waiting states from being overwritten by stale running patches', () => {
    const store = createThreadStore();
    store.selectThread('a');
    store.applyDetail({ thread_id: 'a', revision: 1, messages: [], status: 'waiting_user' });
    expect(store.applyEvent({ thread_id: 'a', revision: 2, id: 'running', kind: 'turn_state', payload: { status: 'running' } })).toBe('applied');
    expect(store.detail('a')?.status).toBe('waiting_user');
    store.applyDetail({ thread_id: 'a', revision: 3, messages: [], status: 'waiting_approval' });
    expect(store.detail('a')?.status).toBe('waiting_user');
  });

  it('scopes transient operations to their thread and keeps navigation independent', () => {
    const store = createThreadStore();
    store.setOperation({ thread_id: 'a', request_id: 'req-a', kind: 'resolve' });
    store.selectThread('b');
    expect(store.operation('a')?.request_id).toBe('req-a');
    expect(store.operation('b')).toBeUndefined();
    store.clearOperation('b');
    expect(store.operation('a')?.request_id).toBe('req-a');
    store.clearOperation('a');
    expect(store.operation('a')).toBeUndefined();
    store.setOperation({ thread_id: 'a', request_id: 'req-a', kind: 'resolve' });
    store.setOperation({ thread_id: 'a', request_id: 'req-a-2', kind: 'retry' });
    expect(store.operation('a')?.request_id).toBe('req-a-2');
  });
});
