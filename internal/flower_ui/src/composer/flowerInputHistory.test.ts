import { describe, expect, it } from 'vitest';
import type { FlowerChatMessage } from '../contracts/flowerSurfaceContracts';
import { flowerInputHistoryEntries } from './flowerInputHistory';

const message = (overrides: Partial<FlowerChatMessage> = {}): FlowerChatMessage => ({
  id: 'user', turn_id: 'turn', role: 'user', content: 'Original\n输入 🙂', status: 'complete', created_at_ms: 1, ...overrides,
});

describe('Flower input history candidates', () => {
  it('preserves canonical order and repeated text without copying attachment metadata', () => {
    const input = message({ blocks: [{ type: 'image', src: '/attachment.png', alt: 'Attachment' }] });
    expect(flowerInputHistoryEntries([input, message({ id: 'repeat' })])).toEqual([
      { id: 'user', text: 'Original\n输入 🙂' }, { id: 'repeat', text: 'Original\n输入 🙂' },
    ]);
  });

  it('excludes assistant, system, synthetic, empty and unadmitted messages', () => {
    expect(flowerInputHistoryEntries([
      message({ role: 'assistant' }), message({ role: 'system' }), message({ turn_id: undefined }),
      message({ content: '' }), message({ status: 'sending' }),
    ])).toEqual([]);
  });

  it('keeps admitted inputs whose turns failed or were canceled', () => {
    expect(flowerInputHistoryEntries([message({ status: 'error' }), message({ id: 'canceled', status: 'canceled' })]))
      .toHaveLength(2);
  });

  it('never recalls structured answers or redacted secrets presented as user messages', () => {
    expect(flowerInputHistoryEntries([message({ blocks: [{
      type: 'input-response',
      questions: [{ question_id: 'secret', question: 'Password', answer: '••••', redacted: true }],
    }] })])).toEqual([]);
  });
});
