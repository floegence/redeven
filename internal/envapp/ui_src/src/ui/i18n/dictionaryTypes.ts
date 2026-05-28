export type TranslationParams = Readonly<Record<string, string | number>>;

export type PluralMessage = Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string;
}>;

export type RichTextPart =
  | Readonly<{ type: 'text'; value: string }>
  | Readonly<{ type: 'code'; value: string }>
  | Readonly<{ type: 'kbd'; value: string }>
  | Readonly<{ type: 'strong'; children: readonly RichTextPart[] }>
  | Readonly<{ type: 'link'; hrefKey: string; children: readonly RichTextPart[] }>;

export type PrimitiveMessage = string | PluralMessage | readonly RichTextPart[];

export type TranslationTree = {
  readonly [key: string]: PrimitiveMessage | TranslationTree;
};

export type DeepWidenMessages<T> =
  T extends string
    ? string
    : T extends readonly RichTextPart[]
      ? readonly RichTextPart[]
      : T extends PluralMessage
        ? PluralMessage
        : T extends Record<string, unknown>
          ? { readonly [K in keyof T]: DeepWidenMessages<T[K]> }
          : never;

type DotPathForKey<T, K extends Extract<keyof T, string>> =
  T[K] extends string
    ? K
    : T[K] extends readonly RichTextPart[]
      ? K
      : T[K] extends PluralMessage
        ? K
        : T[K] extends Record<string, unknown>
          ? `${K}.${DotPath<T[K]>}`
          : never;

export type DotPath<T> = {
  [K in Extract<keyof T, string>]: DotPathForKey<T, K>;
}[Extract<keyof T, string>];

export function defineDictionary<const T extends TranslationTree>(value: T): T {
  return value;
}
