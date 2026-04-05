import type { JSX } from 'solid-js';
import type { NoteColorToken, TopicAccentToken, TopicIconKey } from './notesModel';

export const NOTE_COLOR_LABELS: Readonly<Record<NoteColorToken, string>> = Object.freeze({
  graphite: 'Graphite',
  sage: 'Sage',
  amber: 'Amber',
  azure: 'Azure',
  coral: 'Coral',
  rose: 'Rose',
});

export const TOPIC_ACCENT_LABELS: Readonly<Record<TopicAccentToken, string>> = Object.freeze({
  ember: 'Ember',
  sea: 'Sea',
  moss: 'Moss',
  ink: 'Ink',
  gold: 'Gold',
  berry: 'Berry',
});

export function NotesOverlayIcon(props: { class?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="M6.25 5.5h11.5" />
      <path d="M7.75 3.75v3.5" />
      <path d="M12 3.75v3.5" />
      <path d="M16.25 3.75v3.5" />
      <rect x="4.5" y="7.5" width="15" height="12" rx="2.25" />
      <path d="M8 12.25h8" />
      <path d="M8 15.5h5.75" />
    </svg>
  );
}

export function NotesTrashCanIcon(props: { class?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="M8 5.25h8" />
      <path d="M10 3.5h4" />
      <path d="M6.5 6.75h11" />
      <path d="M7.25 7.25v10.25c0 1.1.9 2 2 2h5.5c1.1 0 2-.9 2-2V7.25" />
      <path d="M9.75 10.25v6" />
      <path d="M14.25 10.25v6" />
      <path d="M5 19.75h14" opacity="0.45" />
    </svg>
  );
}

function NotesFoxIcon(props: { class?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="m6 9.75 2.2-4.25 2.3 2.6" />
      <path d="m18 9.75-2.2-4.25-2.3 2.6" />
      <path d="M6.35 10.25c.2 5.2 2.95 8.25 5.65 8.25s5.45-3.05 5.65-8.25c-1.4-1.2-3.3-1.9-5.65-1.9s-4.25.7-5.65 1.9Z" />
      <path d="M9.8 13.35h.01" />
      <path d="M14.2 13.35h.01" />
      <path d="M10.5 16.05c.6.45 1.2.65 1.5.65s.9-.2 1.5-.65" />
    </svg>
  );
}

function NotesCraneIcon(props: { class?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="M8.5 16.75c0-3.2 1.2-5.9 3.6-8.4" />
      <path d="M12.1 8.35c.55-2.25 1.65-3.7 3.4-4.85" />
      <path d="M14.5 4.1 19.5 5.7 15 7.55" />
      <path d="M8.5 16.75c0 1.55 1.2 2.75 2.75 2.75 2.55 0 4.75-1.15 6.25-3.35" />
      <path d="M12 11.9c1.45.3 2.6 1.15 3.6 2.6" />
      <path d="M7.5 20.5h4.5" />
    </svg>
  );
}

function NotesOtterIcon(props: { class?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="M7.5 9.25 6.2 6.6 8.75 7.45" />
      <path d="M16.5 9.25 17.8 6.6 15.25 7.45" />
      <path d="M6.25 12.2c0-3.2 2.6-5.7 5.75-5.7s5.75 2.5 5.75 5.7c0 3.45-2.35 6.55-5.75 6.55s-5.75-3.1-5.75-6.55Z" />
      <path d="M9.55 12.5h.01" />
      <path d="M14.45 12.5h.01" />
      <path d="M10 15.1c.7.55 1.35.8 2 .8s1.3-.25 2-.8" />
      <path d="M8.75 17.5c.2 1.05 1.05 2 3.25 2s3.05-.95 3.25-2" />
    </svg>
  );
}

function NotesLynxIcon(props: { class?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="m7.4 9.4-.85-4 2.55 2.3" />
      <path d="m16.6 9.4.85-4-2.55 2.3" />
      <path d="M6.7 10.4c.25 5.05 2.55 8.1 5.3 8.1s5.05-3.05 5.3-8.1c-1.35-1.3-3.1-2.05-5.3-2.05s-3.95.75-5.3 2.05Z" />
      <path d="M9.6 12.95h.01" />
      <path d="M14.4 12.95h.01" />
      <path d="M10.15 16.1c.55.45 1.15.65 1.85.65s1.3-.2 1.85-.65" />
      <path d="M8.25 18.1 6.5 19.85" />
      <path d="M15.75 18.1 17.5 19.85" />
    </svg>
  );
}

function NotesWhaleIcon(props: { class?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="M4.5 14.25c0-3.65 2.75-6.25 7.25-6.25 2.9 0 5.8 1.05 7.75 3.35" />
      <path d="M19.5 11.35c0 4.4-3.15 7.15-7.65 7.15-3.75 0-6.75-1.8-7.35-4.9 1.3.8 2.7 1.15 4.15 1.15 1.9 0 3.15-.45 4.45-1.6.75-.65 1.55-1 2.35-1 .8 0 1.45.25 2.25.85l1.8-1.05Z" />
      <path d="M9.5 10.4h.01" />
      <path d="M16.2 7.55c-.35-1.55-1.15-2.75-2.45-4.05" />
    </svg>
  );
}

function NotesHareIcon(props: { class?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <path d="M9.5 9.4c-1.05-2.25-1.2-4.25-.7-6.4 1.45.6 2.2 1.8 2.7 3.6" />
      <path d="M14.5 9.4c.35-2.4 1.3-4.5 3.3-5.9.55 2.6.1 4.5-1.2 6.15" />
      <path d="M7 11.25c0-2.35 2.25-4.25 5-4.25s5 1.9 5 4.25c0 4.1-1.7 7.25-5 7.25S7 15.35 7 11.25Z" />
      <path d="M9.8 12.7h.01" />
      <path d="M14.2 12.7h.01" />
      <path d="M10.35 15.85c.55.45 1.05.65 1.65.65s1.1-.2 1.65-.65" />
    </svg>
  );
}

export function NotesAnimalIcon(props: { iconKey: TopicIconKey; class?: string }): JSX.Element {
  switch (props.iconKey) {
    case 'crane':
      return <NotesCraneIcon class={props.class} />;
    case 'otter':
      return <NotesOtterIcon class={props.class} />;
    case 'lynx':
      return <NotesLynxIcon class={props.class} />;
    case 'whale':
      return <NotesWhaleIcon class={props.class} />;
    case 'hare':
      return <NotesHareIcon class={props.class} />;
    case 'fox':
    default:
      return <NotesFoxIcon class={props.class} />;
  }
}
