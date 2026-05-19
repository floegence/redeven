// Minimal streaming mark shown while assistant text is still arriving.

import type { Component } from 'solid-js';
import { ActivityStatusIcon } from './ActivityLine';

export interface StreamingCursorProps {
  class?: string;
}

export const StreamingCursor: Component<StreamingCursorProps> = (props) => {
  return <ActivityStatusIcon status="running" class={props.class} />;
};
