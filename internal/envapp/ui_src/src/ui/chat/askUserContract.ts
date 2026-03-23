export type AskUserExecutionMode = 'act' | 'plan';
export type AskUserResponseMode = 'select' | 'write' | 'select_or_write';

export type AskUserAction = Readonly<{
  type: string;
  mode?: AskUserExecutionMode;
}>;

export type AskUserChoice = Readonly<{
  choiceId: string;
  label: string;
  description?: string;
  kind: 'select';
  actions?: AskUserAction[];
}>;

export type AskUserQuestion = Readonly<{
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  responseMode: AskUserResponseMode;
  writeLabel?: string;
  writePlaceholder?: string;
  choices: AskUserChoice[];
}>;

export type AskUserDraft = Readonly<{
  choiceId?: string;
  text?: string;
  writeSelected?: boolean;
}>;

type NormalizedChoiceSource = Readonly<{
  choices: AskUserChoice[];
  hasWritePath: boolean;
  writeLabel?: string;
  writePlaceholder?: string;
}>;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeExecutionMode(raw: unknown): AskUserExecutionMode {
  return String(raw ?? '').trim().toLowerCase() === 'plan' ? 'plan' : 'act';
}

function normalizeAskUserResponseMode(raw: unknown): AskUserResponseMode | undefined {
  const mode = String(raw ?? '').trim().toLowerCase();
  if (mode === 'select' || mode === 'write' || mode === 'select_or_write') return mode;
  return undefined;
}

function normalizeAskUserChoiceKind(raw: unknown): 'select' | 'write' {
  return String(raw ?? '').trim().toLowerCase() === 'write' ? 'write' : 'select';
}

function normalizeAskUserActions(raw: unknown): AskUserAction[] {
  if (!Array.isArray(raw)) return [];
  const out: AskUserAction[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const type = asTrimmedString((item as any).type).toLowerCase();
    if (!type) continue;
    const mode = type === 'set_mode' ? normalizeExecutionMode((item as any).mode) : undefined;
    const key = `${type}:${mode ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, mode });
    if (out.length >= 4) break;
  }
  return out;
}

function defaultWriteLabel(responseMode: AskUserResponseMode, header: string, question: string): string {
  if (responseMode === 'select_or_write') return 'None of the above';
  return header || question || 'Your answer';
}

function defaultWritePlaceholder(responseMode: AskUserResponseMode): string {
  return responseMode === 'select_or_write' ? 'Type another answer' : 'Type your answer';
}

function normalizeAskUserChoicesArray(raw: unknown): NormalizedChoiceSource {
  if (!Array.isArray(raw)) return { choices: [], hasWritePath: false };
  const choices: AskUserChoice[] = [];
  const seenChoice = new Set<string>();
  const seenLabel = new Set<string>();
  let hasWritePath = false;
  let writeLabel: string | undefined;
  let writePlaceholder: string | undefined;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const kind = normalizeAskUserChoiceKind((item as any).kind);
    const label = asTrimmedString((item as any).label) || (kind === 'write' ? 'Other' : '');
    if (!label) continue;
    const choiceId = asTrimmedString((item as any).choice_id ?? (item as any).choiceId) || `${kind}_${choices.length + 1}`;
    const actions = normalizeAskUserActions((item as any).actions);

    if (kind === 'write') {
      if (!hasWritePath) {
        hasWritePath = true;
        writeLabel = label || undefined;
        writePlaceholder = asTrimmedString((item as any).input_placeholder ?? (item as any).inputPlaceholder) || undefined;
      }
      continue;
    }

    const choiceKey = choiceId.toLowerCase();
    const labelKey = label.toLowerCase();
    if (seenChoice.has(choiceKey) || seenLabel.has(labelKey)) continue;
    seenChoice.add(choiceKey);
    seenLabel.add(labelKey);
    choices.push({
      choiceId,
      label,
      description: asTrimmedString((item as any).description) || undefined,
      kind: 'select',
      actions: actions.length > 0 ? actions : undefined,
    });
    if (choices.length >= 4) break;
  }

  return {
    choices,
    hasWritePath,
    writeLabel,
    writePlaceholder,
  };
}

function normalizeLegacyAskUserChoices(raw: unknown, allowOther: boolean): NormalizedChoiceSource {
  const items = Array.isArray(raw) ? raw : [];
  const projected = items.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const detailMode = asTrimmedString((item as any).detail_input_mode).toLowerCase();
    return {
      choice_id: asTrimmedString((item as any).option_id ?? (item as any).optionId),
      label: asTrimmedString((item as any).label),
      description: asTrimmedString((item as any).description) || undefined,
      kind: detailMode === 'required' || detailMode === 'optional' ? 'write' : 'select',
      input_placeholder: asTrimmedString((item as any).detail_input_placeholder) || undefined,
      actions: (item as any).actions,
    };
  }).filter(Boolean);

  if (allowOther) {
    projected.push({
      choice_id: 'other',
      label: 'None of the above',
      description: 'Type another answer.',
      kind: 'write',
      input_placeholder: 'Type another answer',
      actions: undefined,
    });
  }

  return normalizeAskUserChoicesArray(projected);
}

export function normalizeAskUserQuestions(raw: unknown): AskUserQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: AskUserQuestion[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = asTrimmedString((item as any).id) || `question_${out.length + 1}`;
    const header = asTrimmedString((item as any).header);
    const question = asTrimmedString((item as any).question);
    if (!header && !question) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const normalizedHeader = header || question;
    const normalizedQuestion = question || normalizedHeader;
    const explicitResponseMode = normalizeAskUserResponseMode((item as any).response_mode ?? (item as any).responseMode);
    const canonicalChoices = normalizeAskUserChoicesArray((item as any).choices);
    const legacyChoices = canonicalChoices.choices.length > 0 || canonicalChoices.hasWritePath
      ? canonicalChoices
      : normalizeLegacyAskUserChoices((item as any).options, Boolean((item as any).is_other));

    let responseMode = explicitResponseMode;
    if (!responseMode) {
      const explicitExhaustive = typeof (item as any).choices_exhaustive === 'boolean'
        ? Boolean((item as any).choices_exhaustive)
        : undefined;
      if (explicitExhaustive === false && legacyChoices.choices.length > 0) {
        responseMode = 'select_or_write';
      } else if (legacyChoices.hasWritePath && legacyChoices.choices.length > 0) {
        responseMode = 'select_or_write';
      } else if (legacyChoices.hasWritePath || legacyChoices.choices.length === 0) {
        responseMode = 'write';
      } else {
        responseMode = 'select';
      }
    }

    if ((responseMode === 'select' || responseMode === 'select_or_write') && legacyChoices.choices.length === 0) {
      responseMode = 'write';
    }

    const writeLabel = responseMode === 'write' || responseMode === 'select_or_write'
      ? asTrimmedString((item as any).write_label ?? (item as any).writeLabel)
        || legacyChoices.writeLabel
        || defaultWriteLabel(responseMode, normalizedHeader, normalizedQuestion)
      : undefined;
    const writePlaceholder = responseMode === 'write' || responseMode === 'select_or_write'
      ? asTrimmedString((item as any).write_placeholder ?? (item as any).writePlaceholder)
        || legacyChoices.writePlaceholder
        || defaultWritePlaceholder(responseMode)
      : undefined;

    out.push({
      id,
      header: normalizedHeader,
      question: normalizedQuestion,
      isSecret: Boolean((item as any).is_secret ?? (item as any).isSecret),
      responseMode,
      writeLabel,
      writePlaceholder,
      choices: responseMode === 'write' ? [] : legacyChoices.choices,
    });
    if (out.length >= 5) break;
  }

  return out;
}

export function normalizeAskUserDraft(draft: AskUserDraft | undefined | null): AskUserDraft {
  return {
    choiceId: asTrimmedString(draft?.choiceId) || undefined,
    text: asTrimmedString(draft?.text) || undefined,
    writeSelected: Boolean(draft?.writeSelected) || undefined,
  };
}

export function findAskUserChoice(question: AskUserQuestion, choiceId: string | undefined): AskUserChoice | undefined {
  const normalizedChoiceId = asTrimmedString(choiceId);
  if (!normalizedChoiceId) return undefined;
  return question.choices.find((choice) => choice.choiceId === normalizedChoiceId);
}

export function questionUsesDirectWriteInput(question: AskUserQuestion): boolean {
  return question.responseMode === 'write';
}

export function normalizeAskUserDraftForQuestion(question: AskUserQuestion, draft: AskUserDraft | undefined | null): AskUserDraft {
  const normalized = normalizeAskUserDraft(draft);
  const selectedChoice = findAskUserChoice(question, normalized.choiceId);

  if (question.responseMode === 'write') {
    return {
      text: normalized.text,
      writeSelected: true,
    };
  }
  if (selectedChoice) {
    return {
      choiceId: selectedChoice.choiceId,
    };
  }
  if (question.responseMode === 'select_or_write' && (normalized.writeSelected || normalized.text)) {
    return {
      text: normalized.text,
      writeSelected: true,
    };
  }
  return {};
}

export function getSelectedAskUserChoice(question: AskUserQuestion, draft: AskUserDraft | undefined | null): AskUserChoice | undefined {
  const normalized = normalizeAskUserDraftForQuestion(question, draft);
  return findAskUserChoice(question, normalized.choiceId);
}

export function questionRequiresChoiceSelection(question: AskUserQuestion): boolean {
  return question.responseMode === 'select';
}

export function questionAllowsText(question: AskUserQuestion, draft: AskUserDraft | undefined | null): boolean {
  const normalized = normalizeAskUserDraftForQuestion(question, draft);
  return question.responseMode === 'write' || (question.responseMode === 'select_or_write' && !!normalized.writeSelected);
}

export function questionRequiresText(question: AskUserQuestion, draft: AskUserDraft | undefined | null): boolean {
  return questionAllowsText(question, draft);
}

export function questionHasDraftAnswer(question: AskUserQuestion, draft: AskUserDraft | undefined | null): boolean {
  const normalized = normalizeAskUserDraftForQuestion(question, draft);
  if (question.responseMode === 'write') {
    return Boolean(normalized.text);
  }
  if (normalized.choiceId) {
    return true;
  }
  return question.responseMode === 'select_or_write' && !!normalized.writeSelected && !!normalized.text;
}

export function questionCanAutofillFromComposer(question: AskUserQuestion, draft: AskUserDraft | undefined | null): boolean {
  if (question.isSecret) return false;
  const normalized = normalizeAskUserDraftForQuestion(question, draft);
  return question.responseMode === 'write' || (question.responseMode === 'select_or_write' && !!normalized.writeSelected);
}

export function questionSupportsAutoSubmit(question: AskUserQuestion, totalQuestions: number): boolean {
  return totalQuestions === 1
    && !question.isSecret
    && question.responseMode === 'select'
    && question.choices.length > 0
    && question.choices.every((choice) => !(choice.actions?.length));
}

export function questionInputPlaceholder(question: AskUserQuestion, _draft: AskUserDraft | undefined | null): string {
  if (question.isSecret) {
    return question.writePlaceholder || 'Enter secret value';
  }
  return question.writePlaceholder || defaultWritePlaceholder(question.responseMode);
}
