import { describe, expect, it } from 'vitest';

import {
  normalizeAskUserQuestions,
  questionCanAutofillFromComposer,
  questionHasDraftAnswer,
  questionRequiresText,
} from './askUserContract';

describe('askUserContract', () => {
  it('normalizes legacy is_other prompts into an explicit write choice', () => {
    const [question] = normalizeAskUserQuestions([
      {
        id: 'question-1',
        header: 'Situation',
        question: 'Choose the closest situation.',
        is_other: true,
        options: [
          { option_id: 'working', label: 'Already working' },
          { option_id: 'studying', label: 'Studying full time' },
        ],
      },
    ]);

    expect(question?.choices).toEqual([
      { choiceId: 'working', label: 'Already working', kind: 'select', description: undefined, inputPlaceholder: undefined, actions: undefined },
      { choiceId: 'studying', label: 'Studying full time', kind: 'select', description: undefined, inputPlaceholder: undefined, actions: undefined },
      { choiceId: 'other', label: 'None of the above', kind: 'write', description: 'Type another answer.', inputPlaceholder: 'Type another answer', actions: undefined },
    ]);
  });

  it('normalizes legacy option detail modes into write choices', () => {
    const [question] = normalizeAskUserQuestions([
      {
        id: 'question-1',
        header: 'Situation',
        question: 'Choose the closest situation.',
        options: [
          { option_id: 'working', label: 'Already working' },
          {
            option_id: 'other',
            label: 'Other',
            detail_input_mode: 'optional',
            detail_input_placeholder: 'Describe your current situation',
          },
        ],
      },
    ]);

    expect(question?.choices).toEqual([
      { choiceId: 'working', label: 'Already working', kind: 'select', description: undefined, inputPlaceholder: undefined, actions: undefined },
      { choiceId: 'other', label: 'Other', kind: 'write', description: undefined, inputPlaceholder: 'Describe your current situation', actions: undefined },
    ]);
  });

  it('only autofills composer text when the question is direct-write or a write choice is already selected', () => {
    const [mixedQuestion] = normalizeAskUserQuestions([
      {
        id: 'question-1',
        header: 'Situation',
        question: 'Choose the closest situation.',
        choices: [
          { choice_id: 'working', label: 'Already working', kind: 'select' },
          { choice_id: 'other', label: 'None of the above', kind: 'write', input_placeholder: 'Type another answer' },
        ],
      },
    ]);
    const [directWriteQuestion] = normalizeAskUserQuestions([
      {
        id: 'question-2',
        header: 'Clarify',
        question: 'What should Flower inspect next?',
        choices: [
          { choice_id: 'write', label: 'Your answer', kind: 'write', input_placeholder: 'Type your answer' },
        ],
      },
    ]);

    expect(questionCanAutofillFromComposer(mixedQuestion, undefined)).toBe(false);
    expect(questionCanAutofillFromComposer(mixedQuestion, { choiceId: 'other' })).toBe(true);
    expect(questionCanAutofillFromComposer(directWriteQuestion, undefined)).toBe(true);
  });

  it('requires text before a write choice counts as answered', () => {
    const [question] = normalizeAskUserQuestions([
      {
        id: 'question-1',
        header: 'Situation',
        question: 'Choose the closest situation.',
        choices: [
          { choice_id: 'working', label: 'Already working', kind: 'select' },
          { choice_id: 'other', label: 'Other', kind: 'write', input_placeholder: 'Describe your current situation' },
        ],
      },
    ]);

    expect(questionRequiresText(question, { choiceId: 'other' })).toBe(true);
    expect(questionHasDraftAnswer(question, { choiceId: 'other' })).toBe(false);
    expect(questionHasDraftAnswer(question, { choiceId: 'other', text: 'Working and studying part time' })).toBe(true);
  });
});
