import {
  NotesOverlay as SharedNotesOverlay,
  type NotesOverlayProps as SharedNotesOverlayProps,
} from '@floegence/floe-webapp-core/notes';
import { createEffect, onCleanup } from 'solid-js';
import { useRedevenNotesController } from './createRedevenNotesController';
import { createNotesOverlayViewportController } from './notesOverlayViewport';

export interface NotesOverlayProps {
  open: boolean;
  onClose: () => void;
  viewportHost?: HTMLElement | null;
}

export function NotesOverlay(props: NotesOverlayProps) {
  const controller = useRedevenNotesController(() => props.open);
  const viewportController = createNotesOverlayViewportController();

  createEffect(() => {
    viewportController.setViewportHostElement(props.viewportHost ?? null);
  });

  createEffect(() => {
    viewportController.setActive(props.open);
  });

  onCleanup(() => {
    viewportController.dispose();
  });

  return (
    <SharedNotesOverlay
      open={props.open}
      controller={controller}
      onClose={props.onClose}
      interactionMode="floating"
    />
  );
}

export type { SharedNotesOverlayProps };
