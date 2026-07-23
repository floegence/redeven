import { describe, expect, it } from 'vitest';

import type { FlowerCompanionPresenceProjection } from '../../../../flower_ui/src';
import { presentActivityFlowerSummary, type ActivityFlowerSummaryCopy } from './activityFlowerSummary';

const copy: ActivityFlowerSummaryCopy = {
  lead: {
    attention: 'Needs your attention',
    failed: 'Needs review',
    running: 'Working on',
    queued: 'Waiting to start',
    canceled: 'Stopped',
    completed: 'Ready',
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
  it('describes one titled item without exposing an internal count', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'failed',
      priority_count: 1,
      priority_thread_title: 'Repair deploy config',
    }), copy)).toEqual({
      visualText: 'Needs review / Repair deploy config',
      accessibleText: 'Needs review / Repair deploy config',
    });
  });

  it('counts only additional items in a titled priority group', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'running',
      priority_count: 3,
      priority_thread_title: 'Run checks',
      running_count: 3,
    }), copy).visualText).toBe('Working on / Run checks / +2');
  });

  it('uses the live model phase as the running lead', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'running',
      priority_count: 1,
      priority_thread_title: 'Refine the companion',
      priority_thread_progress: 'Streaming response...',
      running_count: 1,
    }), copy)).toEqual({
      visualText: 'Streaming response... / Refine the companion',
      accessibleText: 'Streaming response... / Refine the companion',
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
    });
  });

  it('uses a complete sentence when the canonical group has no ready title', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'queued',
      priority_count: 2,
    }), copy).visualText).toBe('queued without title 2');
  });

  it('adds background running context only to the complete accessible text', () => {
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'attention',
      priority_count: 1,
      priority_thread_title: 'Approve migration',
      running_count: 2,
    }), copy)).toEqual({
      visualText: 'Needs your attention / Approve migration',
      accessibleText: 'Needs your attention / Approve migration. also working 2',
    });
  });

  it('keeps quiet and unavailable states out of the visual work summary', () => {
    expect(presentActivityFlowerSummary(presence({}), copy)).toEqual({
      visualText: '',
      accessibleText: 'Ready to ask Flower',
    });
    expect(presentActivityFlowerSummary(presence({
      priority_status: 'unavailable',
      priority_count: 1,
    }), copy)).toEqual({
      visualText: '',
      accessibleText: 'Flower unavailable',
    });
  });
});
