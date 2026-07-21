import type { FlowerTurnLauncherContextTone } from '../flowerTurnLauncherCopy';
import type { FlowerTurnLauncherSourceSurface } from './flowerSurfaceContracts';

export type FlowerChatContextTone = FlowerTurnLauncherContextTone;

export type FlowerChatContextSnapshotAction =
  | Readonly<{ type: 'open_text_preview'; title: string; subtitle: string; body: string; context_index: number; source_path?: string; truncated?: boolean }>
  | Readonly<{ type: 'open_process_preview'; title: string; subtitle: string; body: string; pid: number; context_index: number; truncated?: boolean }>;

export type FlowerChatContextHostAction =
  | Readonly<{ type: 'open_canonical_reference'; reference_id: string }>
  | Readonly<{ type: 'open_linked_file_preview'; path: string; context_index: number }>
  | Readonly<{ type: 'open_linked_directory_browser'; path: string; context_index: number }>;

export type FlowerChatContextAction = FlowerChatContextSnapshotAction | FlowerChatContextHostAction;

export type FlowerChatContextChip = Readonly<{
  id: string;
  kind: string;
  tone: FlowerChatContextTone;
  label: string;
  detail: string;
  truncated?: boolean;
  action: FlowerChatContextAction | null;
}>;

export type FlowerChatContextDisplay =
  | Readonly<{
      authority: 'canonical_references';
      chips: readonly FlowerChatContextChip[];
    }>
  | Readonly<{
      authority: 'queued_context_action';
      surface: FlowerTurnLauncherSourceSurface;
      target: string;
      chips: readonly FlowerChatContextChip[];
    }>;

export type FlowerChatContextSnapshotPreview = Readonly<{
  title: string;
  action: FlowerChatContextSnapshotAction;
  thread_id: string;
  message_id: string;
}>;
