export type TranslationParams = Readonly<Record<string, string | number>>;

export type PluralMessage = Readonly<{
  kind: 'plural';
  forms: Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & {
    other: string;
  }>;
}>;

export type TranslationLeaf = string | PluralMessage;
export interface TranslationTree {
  readonly [key: string]: TranslationLeaf | TranslationTree;
}

export type DeepWidenMessages<T> = T extends string
  ? string
  : T extends PluralMessage
    ? PluralMessage
    : T extends Readonly<Record<string, unknown>>
      ? { readonly [K in keyof T]: DeepWidenMessages<T[K]> }
      : never;

type JoinPath<Prefix extends string, Key extends string> = Prefix extends '' ? Key : `${Prefix}.${Key}`;

export type DotPathByLeaf<T, Leaf, Prefix extends string = ''> = T extends Leaf
  ? Prefix
  : T extends Readonly<Record<string, unknown>>
    ? {
      [K in Extract<keyof T, string>]: DotPathByLeaf<T[K], Leaf, JoinPath<Prefix, K>>;
    }[Extract<keyof T, string>]
    : never;

export function plural(forms: PluralMessage['forms']): PluralMessage {
  return {
    kind: 'plural',
    forms,
  };
}

export function isPluralMessage(value: unknown): value is PluralMessage {
  return Boolean(
    value
      && typeof value === 'object'
      && (value as Partial<PluralMessage>).kind === 'plural'
      && typeof (value as Partial<PluralMessage>).forms === 'object'
      && typeof (value as Partial<PluralMessage>).forms?.other === 'string',
  );
}
