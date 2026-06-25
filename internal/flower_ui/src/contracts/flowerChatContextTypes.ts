import type { FlowerTurnLauncherContextTone } from '../flowerTurnLauncherCopy';

export type FlowerChatContextTone = FlowerTurnLauncherContextTone;

export type FlowerChatContextAction =
  | Readonly<{ type: 'open_text_preview'; title: string; subtitle: string; body: string; source_path?: string }>
  | Readonly<{ type: 'open_process_preview'; title: string; subtitle: string; body: string; pid: number }>
  | Readonly<{ type: 'open_file_preview'; path: string }>
  | Readonly<{ type: 'open_directory_browser'; path: string }>;

export type FlowerChatContextChip = Readonly<{
  id: string;
  kind: string;
  tone: FlowerChatContextTone;
  label: string;
  detail: string;
  action: FlowerChatContextAction | null;
}>;

export type FlowerChatContextDisplay = Readonly<{
  surface: string;
  target: string;
  chips: readonly FlowerChatContextChip[];
}>;
