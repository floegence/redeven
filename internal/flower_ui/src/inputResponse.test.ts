import { describe, expect, it } from 'vitest';

import type { FlowerRuntimeInteraction } from './contracts/flowerSurfaceContracts';
import {
  inputResponseBlockFromInteraction,
  inputResponseVisibleText,
  mapFlowerInputResponseBlock,
} from './inputResponse';

function interaction(overrides: Partial<FlowerRuntimeInteraction> = {}): FlowerRuntimeInteraction {
  return {
    id: 'input-a',
    turn_id: 'turn-a',
    run_id: 'run-a',
    kind: 'input',
    resolved: true,
    input: {
      summary: 'Questions',
      questions: [
        { id: 'second', prompt: 'Second question?', kind: 'write' },
        { id: 'first', prompt: 'First question?', kind: 'write' },
      ],
    },
    resolution: { accepted: true, input: { first: 'first answer', second: 'second answer' } },
    ...overrides,
  };
}

describe('Flower input response contract', () => {
  it('uses presentation order and derives visible text from the structured receipt', () => {
    const block = inputResponseBlockFromInteraction(interaction());

    expect(block).toEqual({
      type: 'input-response',
      questions: [
        { question_id: 'second', question: 'Second question?', answer: 'second answer' },
        { question_id: 'first', question: 'First question?', answer: 'first answer' },
      ],
    });
    expect(inputResponseVisibleText(block!)).toBe(
      'Second question?\nsecond answer\n\nFirst question?\nfirst answer',
    );
  });

  it('keeps secret questions while excluding their answer from every derived representation', () => {
    const block = inputResponseBlockFromInteraction(interaction({
      input: {
        summary: 'Secret',
        questions: [{ id: 'token', prompt: 'Deployment token?', kind: 'write', secret: true }],
      },
      resolution: { accepted: true, redacted: true },
    }));

    expect(block).toEqual({
      type: 'input-response',
      questions: [{ question_id: 'token', question: 'Deployment token?', redacted: true }],
    });
    expect(inputResponseVisibleText(block!, 'Answer hidden')).toBe('Deployment token?\nAnswer hidden');
    expect(JSON.stringify(block)).not.toContain('secret-value');
  });

  it('does not create a receipt for an unaccepted interaction', () => {
    expect(inputResponseBlockFromInteraction(interaction({
      resolution: { accepted: false, outcome: 'cancelled' },
    }))).toBeNull();
  });

  it.each([
    ['missing presentation', interaction({ input: undefined }), 'requires its question presentation'],
    ['duplicate question', interaction({
      input: {
        summary: 'Duplicate',
        questions: [
          { id: 'same', prompt: 'One?', kind: 'write' },
          { id: 'same', prompt: 'Two?', kind: 'write' },
        ],
      },
      resolution: { accepted: true, input: { same: 'answer' } },
    }), 'is duplicated'],
    ['missing answer', interaction({ resolution: { accepted: true, input: { first: 'first answer' } } }), 'missing its answer'],
    ['unknown answer', interaction({
      resolution: { accepted: true, input: { first: 'first answer', second: 'second answer', other: 'other' } },
    }), 'targets unknown question'],
    ['noncanonical answer identity', interaction({
      resolution: { accepted: true, input: { first: 'first answer', second: 'second answer', ' first ': 'other' } },
    }), 'targets unknown question'],
    ['inconsistent redaction', interaction({
      resolution: { accepted: true, redacted: true, input: { first: 'first answer', second: 'second answer' } },
    }), 'inconsistent secret-answer redaction'],
  ])('rejects %s', (_name, value, expected) => {
    expect(() => inputResponseBlockFromInteraction(value as FlowerRuntimeInteraction)).toThrow(expected as string);
  });

  it('strictly validates the wire block', () => {
    expect(mapFlowerInputResponseBlock({
      type: 'input-response',
      questions: [{ question_id: 'target', question: 'Which target?', answer: 'Staging' }],
    })).toEqual({
      type: 'input-response',
      questions: [{ question_id: 'target', question: 'Which target?', answer: 'Staging' }],
    });
    expect(() => mapFlowerInputResponseBlock({
      type: 'input-response',
      questions: [{ question_id: 'target', question: 'Which target?', answer: 'Staging', legacy: true }],
    })).toThrow('contains unsupported field legacy');
    expect(() => mapFlowerInputResponseBlock({
      type: 'input-response',
      questions: [{ question_id: 'target', question: 'Which target?', answer: 'Staging', redacted: true }],
    })).toThrow('must not expose a redacted answer');
  });
});
