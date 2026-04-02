export type CodexComposerControlOption = Readonly<{
  value: string;
  label: string;
  description?: string;
}>;

export type CodexComposerControlID =
  | 'model'
  | 'effort'
  | 'approval'
  | 'sandbox';

export type CodexComposerControlVariant = 'value' | 'policy';

export type CodexComposerControlSpec = Readonly<{
  id: CodexComposerControlID;
  label: string;
  value: string;
  options: readonly CodexComposerControlOption[];
  placeholder: string;
  disabled: boolean;
  variant: CodexComposerControlVariant;
  onChange: (value: string) => void;
}>;

export function findCodexComposerControlSpec(
  controls: readonly CodexComposerControlSpec[],
  controlID: CodexComposerControlID,
): CodexComposerControlSpec | null {
  return controls.find((control) => control.id === controlID) ?? null;
}
