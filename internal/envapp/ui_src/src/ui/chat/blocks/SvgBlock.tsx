// SvgBlock — inline SVG rendering.

import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface SvgBlockProps {
  content: string;
  class?: string;
}

/**
 * Renders inline SVG markup directly into the DOM.
 */
export const SvgBlock: Component<SvgBlockProps> = (props) => {
  return (
    <div
      class={cn('chat-svg-block', props.class)}
      // eslint-disable-next-line solid/no-innerhtml
      innerHTML={props.content}
    />
  );
};

export default SvgBlock;
