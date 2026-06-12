import { describe, expect, it } from 'vitest';

import { projectFlowerThreadListItem } from '../flowerSurfaceModel';
import type { FlowerThreadSnapshot } from '../contracts/flowerSurfaceContracts';

describe('Flower thread list projection', () => {
  it('uses the latest non-empty message as the shared thread preview', () => {
    const thread: FlowerThreadSnapshot = {
      thread_id: 'thread-1',
      title: 'Transfer plan',
      model_id: 'primary/gpt-4.1',
      working_dir: '/workspace/redeven',
      pinned_at_ms: 123,
      created_at_ms: 1,
      updated_at_ms: 2,
      status: 'success',
      source_label: 'env A',
      target_labels: ['env B'],
      messages: [
        { id: 'm1', role: 'user', content: 'Plan this transfer', status: 'complete', created_at_ms: 1 },
        { id: 'm2', role: 'assistant', content: 'Destination preview is ready.', status: 'complete', created_at_ms: 2 },
      ],
    };

    expect(projectFlowerThreadListItem(thread)).toMatchObject({
      thread_id: 'thread-1',
      working_dir: '/workspace/redeven',
      pinned: true,
      pinned_at_ms: 123,
      preview: 'Destination preview is ready.',
      source_label: 'env A',
      target_labels: ['env B'],
      status: 'success',
    });
  });
});
