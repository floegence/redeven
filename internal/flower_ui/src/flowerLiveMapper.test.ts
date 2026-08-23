import { describe, expect, it } from 'vitest';

import { mapFlowerActivityItem, mapFlowerThread } from './flowerLiveMapper';

describe('mapFlowerThread title contract', () => {
  it('rejects a non-empty title without a canonical title status', () => {
    expect(() => mapFlowerThread({
      thread_id: 'thread-invalid-title',
      title: 'Canonical title',
      title_status: '',
      model_id: 'openai/gpt-5-mini',
      working_dir: '/',
      created_at_unix_ms: 1,
      updated_at_unix_ms: 1,
      run_status: 'idle',
      queued_turn_count: 0,
    }, [], {
      runtimeID: 'runtime-test',
      runtimeKind: 'local_environment',
      sourceLabel: 'Local',
      targetLabels: [],
    })).toThrow('title_status may be empty only when title is empty');
  });
});

describe('mapFlowerActivityItem structured rows contract', () => {
  const activity = (rows: unknown) => ({
    item_id: 'activity-okf',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    presentation: {
      label: 'OKF search',
      renderer: 'structured',
      payload: { rows },
    },
  });

  it('maps typed rows without exposing another payload shape', () => {
    expect(mapFlowerActivityItem(activity([{
      title: 'Flower runtime',
      meta: 'Architecture',
      content: 'One current view.',
      format: 'markdown',
    }]))?.payload?.rows).toEqual([{
      title: 'Flower runtime',
      meta: 'Architecture',
      content: 'One current view.',
      format: 'markdown',
    }]);
  });

  it('rejects unknown row fields and unsupported formats', () => {
    expect(() => mapFlowerActivityItem(activity([{ title: 'Unsafe', format: 'text', internal_id: 'private' }])))
      .toThrow('internal_id is not part of the structured activity row contract');
    expect(() => mapFlowerActivityItem(activity([{ title: 'Unsafe', format: 'json' }])))
      .toThrow('format is unsupported');
  });

  it('rejects empty rows and an oversized row list', () => {
    expect(() => mapFlowerActivityItem(activity([{ format: 'text' }])))
      .toThrow('must contain display content');
    expect(() => mapFlowerActivityItem(activity(Array.from({ length: 201 }, () => ({ title: 'row', format: 'text' })))))
      .toThrow('exceeds 200 rows');
  });
});
