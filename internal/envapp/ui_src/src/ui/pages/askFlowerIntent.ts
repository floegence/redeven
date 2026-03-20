export type AskFlowerIntentSource = 'file_browser' | 'terminal' | 'file_preview' | 'monitoring';

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
    }
  | {
      kind: 'process_snapshot';
      pid: number;
      name: string;
      username: string;
      cpuPercent: number;
      memoryBytes: number;
      platform?: string;
      capturedAtMs?: number;
    };

export type AskFlowerIntent = {
  id: string;
  source: AskFlowerIntentSource;
  mode: AskFlowerIntentMode;
  userPrompt?: string;
  suggestedWorkingDirAbs?: string;
  contextItems: AskFlowerContextItem[];
  pendingAttachments: File[];
  notes: string[];
};
