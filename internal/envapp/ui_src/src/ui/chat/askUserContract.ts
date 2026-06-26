export type AskUserResponseMode = 'select' | 'write' | 'select_or_write';

export type AskUserAction = Readonly<{
  type: string;
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

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAskUserResponseMode(raw: unknown): AskUserResponseMode | null {
  const mode = String(raw ?? '').trim().toLowerCase();
  if (mode === 'select' || mode === 'write' || mode === 'select_or_write') return mode;
  return null;
}

function normalizeAskUserActions(raw: unknown): AskUserAction[] {
  if (!Array.isArray(raw)) return [];
  const out: AskUserAction[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const type = asTrimmedString((item as any).type).toLowerCase();
    if (type !== 'open_subagent') continue;
    const key = type;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type });
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeAskUserChoice(raw: unknown): AskUserChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as any;
  if (asTrimmedString(item.kind).toLowerCase() !== 'select') return null;
  const choiceId = asTrimmedString(item.choice_id);
  const label = asTrimmedString(item.label);
  if (!choiceId || !label) return null;
  const actions = normalizeAskUserActions(item.actions);
  return {
    choiceId,
    label,
    description: asTrimmedString(item.description) || undefined,
    kind: 'select',
    actions: actions.length > 0 ? actions : undefined,
  };
}

function normalizeAskUserQuestion(raw: unknown): AskUserQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as any;
  const id = asTrimmedString(item.id);
  const header = asTrimmedString(item.header);
  const question = asTrimmedString(item.question);
  const responseMode = normalizeAskUserResponseMode(item.response_mode);
  if (!id || !header || !question || !responseMode) return null;

  const choices = Array.isArray(item.choices)
    ? (item.choices as unknown[])
        .map((choice): AskUserChoice | null => normalizeAskUserChoice(choice))
        .filter((choice): choice is AskUserChoice => choice !== null)
    : [];

  if (responseMode === 'write') {
    if (choices.length > 0) return null;
    return {
      id,
      header,
      question,
      isSecret: Boolean(item.is_secret),
      responseMode,
      writeLabel: asTrimmedString(item.write_label) || undefined,
      writePlaceholder: asTrimmedString(item.write_placeholder) || undefined,
      choices: [],
    };
  }

  if (choices.length === 0) return null;
  if (responseMode === 'select') {
    return {
      id,
      header,
      question,
      isSecret: Boolean(item.is_secret),
      responseMode,
      choices,
    };
  }

  const writeLabel = asTrimmedString(item.write_label);
  const writePlaceholder = asTrimmedString(item.write_placeholder);
  if (!writeLabel || !writePlaceholder) return null;
  return {
    id,
    header,
    question,
    isSecret: Boolean(item.is_secret),
    responseMode,
    writeLabel,
    writePlaceholder,
    choices,
  };
}

export function normalizeAskUserQuestions(raw: unknown): AskUserQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: AskUserQuestion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const question = normalizeAskUserQuestion(item);
    if (!question) continue;
    const key = question.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
    if (out.length >= 5) break;
  }
  return out;
}
