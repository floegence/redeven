import { describe, expect, it } from 'vitest';

import {
  normalizeAskUserQuestions,
  questionCanAutofillFromComposer,
  questionHasDraftAnswer,
  questionRequiresText,
} from './askUserContract';

describe('askUserContract', () => {
  it('normalizes legacy is_other prompts into select_or_write with a standardized write fallback', () => {
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

    expect(question).toEqual({
      id: 'question-1',
      header: 'Situation',
      question: 'Choose the closest situation.',
      isSecret: false,
      responseMode: 'select_or_write',
      writeLabel: 'None of the above',
      writePlaceholder: 'Type another answer',
      choices: [
        { choiceId: 'working', label: 'Already working', kind: 'select', description: undefined, actions: undefined },
        { choiceId: 'studying', label: 'Studying full time', kind: 'select', description: undefined, actions: undefined },
      ],
    });
  });

  it('normalizes legacy option detail modes into a question-level write fallback', () => {
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

    expect(question).toEqual({
      id: 'question-1',
      header: 'Situation',
      question: 'Choose the closest situation.',
      isSecret: false,
      responseMode: 'select_or_write',
      writeLabel: 'Other',
      writePlaceholder: 'Describe your current situation',
      choices: [
        { choiceId: 'working', label: 'Already working', kind: 'select', description: undefined, actions: undefined },
      ],
    });
  });

  it('only autofills composer text when the question is direct-write or the write path is selected', () => {
    const [mixedQuestion] = normalizeAskUserQuestions([
      {
        id: 'question-1',
        header: 'Situation',
        question: 'Choose the closest situation.',
        response_mode: 'select_or_write',
        write_label: 'None of the above',
        write_placeholder: 'Type another answer',
        choices: [
          { choice_id: 'working', label: 'Already working', kind: 'select' },
        ],
      },
    ]);
    const [directWriteQuestion] = normalizeAskUserQuestions([
      {
        id: 'question-2',
        header: 'Clarify',
        question: 'What should Flower inspect next?',
        response_mode: 'write',
        write_placeholder: 'Type your answer',
      },
    ]);

    expect(questionCanAutofillFromComposer(mixedQuestion, undefined)).toBe(false);
    expect(questionCanAutofillFromComposer(mixedQuestion, { writeSelected: true })).toBe(true);
    expect(questionCanAutofillFromComposer(directWriteQuestion, undefined)).toBe(true);
  });

  it('requires text before a write path counts as answered', () => {
    const [question] = normalizeAskUserQuestions([
      {
        id: 'question-1',
        header: 'Situation',
        question: 'Choose the closest situation.',
        response_mode: 'select_or_write',
        write_label: 'Other',
        write_placeholder: 'Describe your current situation',
        choices: [
          { choice_id: 'working', label: 'Already working', kind: 'select' },
        ],
      },
    ]);

    expect(questionRequiresText(question, { writeSelected: true })).toBe(true);
    expect(questionHasDraftAnswer(question, { writeSelected: true })).toBe(false);
    expect(questionHasDraftAnswer(question, { writeSelected: true, text: 'Working and studying part time' })).toBe(true);
  });
});
