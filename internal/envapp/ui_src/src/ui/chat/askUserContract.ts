export type AskUserExecutionMode = 'act' | 'plan';
export type AskUserChoiceKind = 'select' | 'write';

export type AskUserAction = Readonly<{
  type: string;
  mode?: AskUserExecutionMode;
}>;

export type AskUserChoice = Readonly<{
  choiceId: string;
  label: string;
  description?: string;
  kind: AskUserChoiceKind;
  inputPlaceholder?: string;
  actions?: AskUserAction[];
}>;

export type AskUserQuestion = Readonly<{
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  choices: AskUserChoice[];
}>;

export type AskUserDraft = Readonly<{
  choiceId?: string;
  text?: string;
}>;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeExecutionMode(raw: unknown): AskUserExecutionMode {
  return String(raw ?? '').trim().toLowerCase() === 'plan' ? 'plan' : 'act';
}

function normalizeAskUserChoiceKind(raw: unknown): AskUserChoiceKind {
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

function normalizeAskUserChoicesArray(raw: unknown): AskUserChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: AskUserChoice[] = [];
  const seenChoice = new Set<string>();
  const seenLabel = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const kind = normalizeAskUserChoiceKind((item as any).kind);
    const label = asTrimmedString((item as any).label) || (kind === 'write' ? 'Other' : '');
    if (!label) continue;
    const choiceId = asTrimmedString((item as any).choice_id ?? (item as any).choiceId) || `${kind}_${out.length + 1}`;
    const choiceKey = choiceId.toLowerCase();
    const labelKey = label.toLowerCase();
    if (seenChoice.has(choiceKey) || seenLabel.has(labelKey)) continue;
    seenChoice.add(choiceKey);
    seenLabel.add(labelKey);
    const actions = normalizeAskUserActions((item as any).actions);
    out.push({
      choiceId,
      label,
      description: asTrimmedString((item as any).description) || undefined,
      kind,
      inputPlaceholder: kind === 'write'
        ? asTrimmedString((item as any).input_placeholder ?? (item as any).inputPlaceholder) || undefined
        : undefined,
      actions: actions.length > 0 ? actions : undefined,
    });
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeLegacyAskUserChoices(raw: unknown, allowOther: boolean, header: string, question: string): AskUserChoice[] {
  const out: AskUserChoice[] = [];
  const items = Array.isArray(raw) ? raw : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const label = asTrimmedString((item as any).label);
    if (!label) continue;
    const detailMode = asTrimmedString((item as any).detail_input_mode).toLowerCase();
    const kind: AskUserChoiceKind = detailMode === 'required' || detailMode === 'optional' ? 'write' : 'select';
    const actions = normalizeAskUserActions((item as any).actions);
    out.push({
      choiceId: asTrimmedString((item as any).option_id ?? (item as any).optionId) || `${kind}_${out.length + 1}`,
      label,
      description: asTrimmedString((item as any).description) || undefined,
      kind,
      inputPlaceholder: kind === 'write'
        ? asTrimmedString((item as any).detail_input_placeholder) || undefined
        : undefined,
      actions: actions.length > 0 ? actions : undefined,
    });
  }
  if (allowOther) {
    out.push({
      choiceId: 'other',
      label: 'None of the above',
      description: 'Type another answer.',
      kind: 'write',
      inputPlaceholder: 'Type another answer',
    });
  }
  if (out.length === 0) {
    out.push({
      choiceId: 'write',
      label: header || question || 'Your answer',
      kind: 'write',
      inputPlaceholder: 'Type your answer',
    });
  }
  return normalizeAskUserChoicesArray(out.map((choice) => ({
    choice_id: choice.choiceId,
    label: choice.label,
    description: choice.description,
    kind: choice.kind,
    input_placeholder: choice.inputPlaceholder,
    actions: choice.actions,
  })));
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
    const choices = (() => {
      const canonical = normalizeAskUserChoicesArray((item as any).choices);
      if (canonical.length > 0) return canonical;
      return normalizeLegacyAskUserChoices(
        (item as any).options,
        Boolean((item as any).is_other),
        normalizedHeader,
        normalizedQuestion,
      );
    })();
    out.push({
      id,
      header: normalizedHeader,
      question: normalizedQuestion,
      isSecret: Boolean((item as any).is_secret ?? (item as any).isSecret),
      choices,
    });
    if (out.length >= 5) break;
  }
  return out;
}

export function normalizeAskUserDraft(draft: AskUserDraft | undefined | null): AskUserDraft {
  return {
    choiceId: asTrimmedString(draft?.choiceId) || undefined,
    text: asTrimmedString(draft?.text) || undefined,
  };
}

export function findAskUserChoice(question: AskUserQuestion, choiceId: string | undefined): AskUserChoice | undefined {
  const normalizedChoiceId = asTrimmedString(choiceId);
  if (!normalizedChoiceId) return undefined;
  return question.choices.find((choice) => choice.choiceId === normalizedChoiceId);
}

export function getSingleWriteChoice(question: AskUserQuestion): AskUserChoice | undefined {
  const writes = question.choices.filter((choice) => choice.kind === 'write');
  return writes.length === 1 ? writes[0] : undefined;
}

export function questionUsesDirectWriteInput(question: AskUserQuestion): boolean {
  return question.choices.length === 1 && question.choices[0].kind === 'write';
}

export function normalizeAskUserDraftForQuestion(question: AskUserQuestion, draft: AskUserDraft | undefined | null): AskUserDraft {
  const normalized = normalizeAskUserDraft(draft);
  const selectedChoice = findAskUserChoice(question, normalized.choiceId);
  if (selectedChoice) {
    return {
      choiceId: selectedChoice.choiceId,
      text: selectedChoice.kind === 'write' ? normalized.text : undefined,
    };
  }
  if (questionUsesDirectWriteInput(question)) {
    return {
      choiceId: question.choices[0]?.choiceId,
      text: normalized.text,
    };
  }
  if (normalized.text) {
    const writeChoice = getSingleWriteChoice(question);
    if (writeChoice) {
      return {
        choiceId: writeChoice.choiceId,
        text: normalized.text,
      };
    }
  }
  return normalized;
}

export function getSelectedAskUserChoice(question: AskUserQuestion, draft: AskUserDraft | undefined | null): AskUserChoice | undefined {
  const normalized = normalizeAskUserDraftForQuestion(question, draft);
  return findAskUserChoice(question, normalized.choiceId);
}

export function questionRequiresChoiceSelection(question: AskUserQuestion): boolean {
  return !questionUsesDirectWriteInput(question);
}

export function questionAllowsText(question: AskUserQuestion, draft: AskUserDraft | undefined | null): boolean {
  return getSelectedAskUserChoice(question, draft)?.kind === 'write';
}

export function questionRequiresText(question: AskUserQuestion, draft: AskUserDraft | undefined | null): boolean {
  return getSelectedAskUserChoice(question, draft)?.kind === 'write';
}

export function questionHasDraftAnswer(question: AskUserQuestion, draft: AskUserDraft | undefined | null): boolean {
  const normalized = normalizeAskUserDraftForQuestion(question, draft);
  const selectedChoice = getSelectedAskUserChoice(question, normalized);
  if (!selectedChoice) {
    return false;
  }
  if (selectedChoice.kind === 'write') {
    return Boolean(normalized.text);
  }
  return !normalized.text;
}

export function questionCanAutofillFromComposer(question: AskUserQuestion, draft: AskUserDraft | undefined | null): boolean {
  if (question.isSecret) return false;
  return questionUsesDirectWriteInput(question) || getSelectedAskUserChoice(question, draft)?.kind === 'write';
}

export function questionSupportsAutoSubmit(question: AskUserQuestion, totalQuestions: number): boolean {
  return totalQuestions === 1
    && !question.isSecret
    && question.choices.length > 0
    && question.choices.every((choice) => choice.kind === 'select' && !(choice.actions?.length));
}

export function questionInputPlaceholder(question: AskUserQuestion, draft: AskUserDraft | undefined | null): string {
  const choice = getSelectedAskUserChoice(question, draft);
  if (choice?.inputPlaceholder) {
    return choice.inputPlaceholder;
  }
  if (question.isSecret) {
    return 'Enter secret value';
  }
  if (choice?.kind === 'write' || questionUsesDirectWriteInput(question)) {
    return 'Type your answer';
  }
  return 'Type your answer';
}
