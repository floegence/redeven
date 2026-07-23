import { describe, expect, it } from 'vitest';

import type { FlowerCompanionPresenceProjection } from '../../../../flower_ui/src';
import {
  presentActivityFlowerCompletion,
  presentActivityFlowerSummary,
  type ActivityFlowerSummaryCopy,
} from './activityFlowerSummary';

const copy: ActivityFlowerSummaryCopy = {
  lead: {
    running: 'Working on',
    queued: 'Waiting to start',
  },
  withTitle: (lead, title) => `${lead} / ${title}`,
  withTitleAndMore: (lead, title, count) => `${lead} / ${title} / +${count}`,
  withoutTitle: (status, count) => `${status} without title ${count}`,
  secondaryWorking: (count) => `also working ${count}`,
  readyToAsk: 'Ready to ask Flower',
  unavailable: 'Flower unavailable',
};

function presence(overrides: Partial<FlowerCompanionPresenceProjection>): FlowerCompanionPresenceProjection {
  return {
    priority_status: 'idle',
    priority_count: 0,
    attention_count: 0,
    unread_failed_count: 0,
    running_count: 0,
    queued_count: 0,
    unread_canceled_count: 0,
    unread_completed_count: 0,
    ...overrides,
  };
}

describe('presentActivityFlowerSummary', () => {
  it('presents a completion transition as an explicit ephemeral state', () => {
    expect(presentActivityFlowerCompletion('Completed', 'Refine the companion', copy)).toEqual({
      visualText: 'Completed / Refine the companion',
      accessibleText: 'Completed / Refine the companion',
      presentationStatus: 'completed',
      ephemeralKind: 'completion',
    });
    expect(presentActivityFlowerCompletion('Completed', undefined, copy).visualText).toBe('Completed');
  });

  it('counts only additional items in a titled priority group', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'running',
      priority_count: 3,
      priority_thread_title: 'Run checks',
      running_count: 3,
    }), copy)).toMatchObject({
      visualText: 'Working on / Run checks / +2',
      presentationStatus: 'running',
    });
  });

  it('uses the live model phase as the running lead', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'running',
      priority_count: 1,
      priority_thread_title: 'Refine the companion',
      priority_thread_progress: 'Streaming response...',
      priority_thread_progress_kind: 'status',
      running_count: 1,
    }), copy)).toEqual({
      visualText: 'Streaming response...',
      accessibleText: 'Streaming response...',
      presentationStatus: 'running',
      progressKind: 'status',
    });
  });

  it('shows live progress while the running thread title is still pending', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'running',
      priority_count: 1,
      priority_thread_progress: 'Preparing model request...',
      running_count: 1,
    }), copy)).toEqual({
      visualText: 'Preparing model request...',
      accessibleText: 'Preparing model request...',
      presentationStatus: 'running',
      progressKind: 'status',
    });
  });

  it('marks latest output and tool summaries for the left-clipped live tail treatment', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'running',
      priority_count: 1,
      priority_thread_progress: 'The newest response fragment',
      priority_thread_progress_kind: 'output',
      priority_thread_progress_identity: 'thread\u001frun\u001fmessage\u001fblock:1',
      running_count: 1,
    }), copy)).toMatchObject({
      visualText: 'The newest response fragment',
      presentationStatus: 'running',
      progressKind: 'output',
      progressIdentity: 'thread\u001frun\u001fmessage\u001fblock:1',
    });
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'running',
      priority_count: 3,
      priority_thread_progress: 'pnpm test --filter flower',
      priority_thread_progress_kind: 'tool',
      running_count: 3,
    }), copy)).toMatchObject({
      visualText: 'pnpm test --filter flower',
      presentationStatus: 'running',
      progressKind: 'tool',
      accessibleText: 'pnpm test --filter flower. also working 2',
    });
  });

  it('uses a complete sentence when the canonical group has no ready title', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'queued',
      priority_count: 2,
    }), copy)).toMatchObject({
      visualText: 'queued without title 2',
      presentationStatus: 'queued',
    });
  });

  it.each(['attention', 'failed', 'canceled', 'completed'] as const)(
    'keeps historical or attention-only %s state out of the collapsed companion',
    (priorityStatus) => {
      expect(presentActivityFlowerSummary(presence({
        priority_status: priorityStatus,
        priority_count: 1,
        priority_thread_title: 'Historical work',
      }), copy)).toEqual({
        visualText: '',
        accessibleText: 'Ready to ask Flower',
        presentationStatus: 'idle',
      });
    },
  );

  it('keeps quiet and unavailable states out of the visual work summary', () => {
    expect(presentActivityFlowerSummary(presence({}), copy)).toEqual({
      visualText: '',
      accessibleText: 'Ready to ask Flower',
      presentationStatus: 'idle',
    });
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'unavailable',
      priority_count: 1,
    }), copy)).toEqual({
      visualText: '',
      accessibleText: 'Flower unavailable',
      presentationStatus: 'unavailable',
    });
  });
});
