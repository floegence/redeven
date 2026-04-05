import {
  NotesOverlay as SharedNotesOverlay,
  type NotesOverlayProps as SharedNotesOverlayProps,
} from '@floegence/floe-webapp-core/notes';
import { useRedevenNotesController } from './createRedevenNotesController';

export interface NotesOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function NotesOverlay(props: NotesOverlayProps) {
  const controller = useRedevenNotesController(() => props.open);

  return (
    <SharedNotesOverlay
      open={props.open}
      controller={controller}
      onClose={props.onClose}
    />
  );
}

export type { SharedNotesOverlayProps };
