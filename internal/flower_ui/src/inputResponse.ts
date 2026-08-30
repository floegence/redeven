import type {
  FlowerInputResponseBlock,
  FlowerRuntimeInteraction,
} from './contracts/flowerSurfaceContracts';

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function assertExactFields(record: JsonRecord, allowed: ReadonlySet<string>, context: string): void {
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      throw new Error(`Flower contract error: ${context} contains unsupported field ${field}.`);
    }
  }
}

export function mapFlowerInputResponseBlock(raw: unknown): FlowerInputResponseBlock | null {
  const block = recordValue(raw);
  if (!block || trim(block.type) !== 'input-response') return null;
  assertExactFields(block, new Set(['type', 'questions']), 'input-response block');
  if (!Array.isArray(block.questions) || block.questions.length === 0) {
    throw new Error('Flower contract error: input-response block requires at least one question.');
  }
  const seen = new Set<string>();
  const questions = block.questions.map((rawQuestion, index) => {
    const question = recordValue(rawQuestion);
    if (!question) {
      throw new Error(`Flower contract error: input-response question ${index} must be an object.`);
    }
    assertExactFields(question, new Set(['question_id', 'question', 'answer', 'redacted']), `input-response question ${index}`);
    const questionID = trim(question.question_id);
    const prompt = trim(question.question);
    if (!questionID || !prompt) {
      throw new Error(`Flower contract error: input-response question ${index} requires question_id and question.`);
    }
    if (seen.has(questionID)) {
      throw new Error(`Flower contract error: input-response question ${questionID} is duplicated.`);
    }
    seen.add(questionID);
    if (question.redacted !== undefined && question.redacted !== true) {
      throw new Error(`Flower contract error: input-response question ${questionID} redacted must be true when present.`);
    }
    const redacted = question.redacted === true;
    const hasAnswer = Object.prototype.hasOwnProperty.call(question, 'answer');
    if (redacted) {
      if (hasAnswer) {
        throw new Error(`Flower contract error: input-response question ${questionID} must not expose a redacted answer.`);
      }
      return { question_id: questionID, question: prompt, redacted: true } as const;
    }
    if (!hasAnswer || typeof question.answer !== 'string' || !trim(question.answer)) {
      throw new Error(`Flower contract error: input-response question ${questionID} requires a visible answer.`);
    }
    return { question_id: questionID, question: prompt, answer: question.answer } as const;
  });
  return { type: 'input-response', questions };
}

export function inputResponseBlockFromInteraction(interaction: FlowerRuntimeInteraction): FlowerInputResponseBlock | null {
  if (interaction.kind !== 'input' || !interaction.resolved) return null;
  const resolution = interaction.resolution;
  if (!resolution) {
    throw new Error('Flower contract error: resolved input interaction requires a resolution.');
  }
  if (!resolution.accepted) return null;
  const presentation = interaction.input;
  if (!presentation || presentation.questions.length === 0) {
    throw new Error('Flower contract error: accepted input interaction requires its question presentation.');
  }

  const publicAnswers = resolution.input ?? {};
  const seen = new Set<string>();
  let hasSecret = false;
  const questions = presentation.questions.map((inputQuestion, index) => {
    const questionID = trim(inputQuestion.id);
    const question = trim(inputQuestion.prompt);
    if (!questionID || !question) {
      throw new Error(`Flower contract error: accepted input question ${index} requires id and prompt.`);
    }
    if (seen.has(questionID)) {
      throw new Error(`Flower contract error: accepted input question ${questionID} is duplicated.`);
    }
    seen.add(questionID);
    if (inputQuestion.secret === true) {
      hasSecret = true;
      if (Object.prototype.hasOwnProperty.call(publicAnswers, questionID)) {
        throw new Error(`Flower contract error: accepted secret input question ${questionID} exposes its answer.`);
      }
      return { question_id: questionID, question, redacted: true } as const;
    }
    if (!Object.prototype.hasOwnProperty.call(publicAnswers, questionID)) {
      throw new Error(`Flower contract error: accepted input question ${questionID} is missing its answer.`);
    }
    const answer = publicAnswers[questionID];
    if (typeof answer !== 'string' || !trim(answer)) {
      throw new Error(`Flower contract error: accepted input question ${questionID} requires a visible answer.`);
    }
    return { question_id: questionID, question, answer } as const;
  });
  for (const questionID of Object.keys(publicAnswers)) {
    if (!seen.has(questionID)) {
      throw new Error(`Flower contract error: accepted input response targets unknown question ${questionID}.`);
    }
  }
  if (Boolean(resolution.redacted) !== hasSecret) {
    throw new Error('Flower contract error: accepted input response has inconsistent secret-answer redaction.');
  }
  return { type: 'input-response', questions };
}

export function inputResponseVisibleText(block: FlowerInputResponseBlock, redactedLabel = ''): string {
  return block.questions.map((question) => {
    const answer = question.redacted ? trim(redactedLabel) : question.answer ?? '';
    return answer ? `${question.question}\n${answer}` : question.question;
  }).join('\n\n');
}

export function inputResponseSignature(block: FlowerInputResponseBlock): string {
  return block.questions.map((question) => [
    question.question_id,
    question.question,
    question.redacted ? 'redacted' : question.answer ?? '',
  ].join('\x1f')).join('\x1e');
}
