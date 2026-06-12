import { describe, expect, it } from 'vitest';

import { normalizeAskUserQuestions } from './askUserContract';

describe('askUserContract', () => {
  it('normalizes canonical select questions', () => {
    const [question] = normalizeAskUserQuestions([
      {
        id: 'target',
        header: 'Environment',
        question: 'Which environment should Flower inspect?',
        response_mode: 'select',
        choices: [
          { choice_id: 'staging', label: 'Staging', kind: 'select' },
          { choice_id: 'production', label: 'Production', description: 'Live environment', kind: 'select' },
        ],
      },
    ]);

    expect(question).toEqual({
      id: 'target',
      header: 'Environment',
      question: 'Which environment should Flower inspect?',
      isSecret: false,
      responseMode: 'select',
      choices: [
        { choiceId: 'staging', label: 'Staging', kind: 'select', description: undefined, actions: undefined },
        { choiceId: 'production', label: 'Production', kind: 'select', description: 'Live environment', actions: undefined },
      ],
    });
  });

  it('normalizes canonical select_or_write questions only with explicit write metadata', () => {
    const [question] = normalizeAskUserQuestions([
      {
        id: 'target',
        header: 'Environment',
        question: 'Which environment should Flower inspect?',
        response_mode: 'select_or_write',
        write_label: 'Another environment',
        write_placeholder: 'Type an environment name',
        choices: [
          { choice_id: 'staging', label: 'Staging', kind: 'select' },
        ],
      },
    ]);

    expect(question.responseMode).toBe('select_or_write');
    expect(question.writeLabel).toBe('Another environment');
    expect(question.writePlaceholder).toBe('Type an environment name');
    expect(question.choices.map((choice) => choice.choiceId)).toEqual(['staging']);
  });

  it('ignores non-select choices', () => {
    expect(normalizeAskUserQuestions([
      {
        id: 'target',
        header: 'Environment',
        question: 'Which environment should Flower inspect?',
        response_mode: 'select_or_write',
        write_label: 'Another environment',
        write_placeholder: 'Type an environment name',
        choices: [
          { choice_id: 'staging', label: 'Staging', kind: 'select' },
          { choice_id: 'other', label: 'Other', kind: 'custom' },
        ],
      },
    ])).toEqual([{
      id: 'target',
      header: 'Environment',
      question: 'Which environment should Flower inspect?',
      isSecret: false,
      responseMode: 'select_or_write',
      writeLabel: 'Another environment',
      writePlaceholder: 'Type an environment name',
      choices: [
        { choiceId: 'staging', label: 'Staging', description: undefined, kind: 'select', actions: undefined },
      ],
    }]);
  });

  it('rejects camelCase prompt aliases at the Flower wire boundary', () => {
    expect(normalizeAskUserQuestions([
      {
        id: 'target',
        header: 'Environment',
        question: 'Which environment should Flower inspect?',
        responseMode: 'select',
        isSecret: true,
        choices: [
          { choiceId: 'staging', label: 'Staging', kind: 'select' },
        ],
      },
    ])).toEqual([]);
  });
});
