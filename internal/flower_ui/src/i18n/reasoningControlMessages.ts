export const reasoningControlEnUS = {
  default: 'Default', off: 'Off', on: 'On', minimal: 'Min', low: 'Low', medium: 'Med',
  high: 'High', xhigh: 'XHigh', max: 'Max',
  label: 'Reasoning', defaultLabel: 'Default reasoning', reset: 'Reset reasoning',
  defaultHint: 'Use the model’s default reasoning configuration',
  alwaysOn: 'Always on', modelControlled: 'Model controlled',
  modelControlledHint: 'This model does not declare supported reasoning controls. Its default behavior is used.', tokens: '{count} tokens',
  tokenUnit: 'tokens', budgetLabel: '{label} budget tokens',
} as const;

export type ReasoningControlCopy = Readonly<Record<keyof typeof reasoningControlEnUS, string>>;

export function createLocalizedReasoningControlCopy(i18n: { t: (key: string) => string }): ReasoningControlCopy {
  return Object.fromEntries(Object.keys(reasoningControlEnUS).map((key) => [key, i18n.t(`flowerSurface.reasoningControl.${key}`)])) as ReasoningControlCopy;
}
