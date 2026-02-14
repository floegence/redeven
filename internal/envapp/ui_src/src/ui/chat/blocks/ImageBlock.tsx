// ImageBlock — image display with click-to-zoom dialog.

import { createSignal, createEffect, Show, onCleanup } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface ImageBlockProps {
  src: string;
  alt?: string;
  class?: string;
}

/**
 * Renders an image with click-to-zoom functionality.
 * Opens a full-screen dialog overlay with zoom/pan controls.
 */
export const ImageBlock: Component<ImageBlockProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [zoom, setZoom] = createSignal(1);

  // Close dialog on Escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  createEffect(() => {
    if (isOpen()) {
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.removeEventListener('keydown', handleKeyDown);
      // Reset zoom when closing
      setZoom(1);
    }
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  const handleBackdropClick = (e: MouseEvent) => {
    // Only close when clicking the backdrop itself, not the image
    if (e.target === e.currentTarget) {
      setIsOpen(false);
    }
  };

  const zoomIn = (e: MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.min(z + 0.25, 5));
  };

  const zoomOut = (e: MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.max(z - 0.25, 0.25));
  };

  const resetZoom = (e: MouseEvent) => {
    e.stopPropagation();
    setZoom(1);
  };

  return (
    <div class={cn('chat-image-block', props.class)}>
      <img
        class="chat-image"
        src={props.src}
        alt={props.alt || ''}
        onClick={() => setIsOpen(true)}
        style={{ cursor: 'pointer' }}
      />

      <Show when={isOpen()}>
        <div
          class="chat-image-dialog-overlay"
          onClick={handleBackdropClick}
          style={{
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            'z-index': '9999',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'background-color': 'rgba(0, 0, 0, 0.8)',
          }}
        >
          {/* Zoom controls */}
          <div
            class="chat-image-dialog-controls"
            style={{
              position: 'fixed',
              top: '16px',
              right: '16px',
              display: 'flex',
              gap: '8px',
              'z-index': '10000',
            }}
          >
            <button
              class="chat-image-zoom-btn"
              onClick={zoomOut}
              title="Zoom out"
              aria-label="Zoom out"
            >
              -
            </button>
            <button
              class="chat-image-zoom-btn"
              onClick={resetZoom}
              title="Reset zoom"
              aria-label="Reset zoom"
            >
              {Math.round(zoom() * 100)}%
            </button>
            <button
              class="chat-image-zoom-btn"
              onClick={zoomIn}
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              class="chat-image-zoom-btn"
              onClick={() => setIsOpen(false)}
              title="Close"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Zoomed image */}
          <img
            class="chat-image-dialog-image"
            src={props.src}
            alt={props.alt || ''}
            style={{
              transform: `scale(${zoom()})`,
              'transition': 'transform 0.2s ease',
              'max-width': '90vw',
              'max-height': '90vh',
              'object-fit': 'contain',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </Show>
    </div>
  );
};
