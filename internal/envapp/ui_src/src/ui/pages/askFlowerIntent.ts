export type AskFlowerIntentSource = 'file_browser' | 'terminal' | 'file_preview';

export type AskFlowerIntentMode = 'append' | 'replace';

export type AskFlowerContextItem =
  | {
      kind: 'file_path';
      path: string;
      isDirectory: boolean;
    }
  | {
      kind: 'file_selection';
      path: string;
      selection: string;
      selectionChars: number;
    }
  | {
      kind: 'terminal_selection';
      workingDir: string;
      selection: string;
      selectionChars: number;
    };

export type AskFlowerIntent = {
  id: string;
  source: AskFlowerIntentSource;
  mode: AskFlowerIntentMode;
  suggestedWorkingDir?: string;
  contextItems: AskFlowerContextItem[];
  pendingAttachments: File[];
  notes: string[];
};
