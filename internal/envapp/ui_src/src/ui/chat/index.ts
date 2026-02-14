// Chat module — main entry point.
// Re-exports all public components, types, and utilities.

// Core
export { ChatContainer, type ChatContainerProps } from './ChatContainer';
export { ChatProvider, useChatContext, type ChatProviderProps, type ChatContextValue } from './ChatProvider';
export * from './types';
export { createStreamEventBuilder, buildAssistantNoticeEvents, isStreamEvent, type StreamEventBuilder } from './streamEvents';

// Message list
export { VirtualMessageList, type VirtualMessageListProps } from './message-list';

// Message components
export {
  MessageItem, MessageBubble, MessageAvatar, MessageMeta, MessageActions,
  type MessageItemProps, type MessageBubbleProps, type MessageAvatarProps, type MessageMetaProps, type MessageActionsProps,
} from './message';

// Block renderers
export {
  BlockRenderer, TextBlock, MarkdownBlock, CodeBlock, CodeDiffBlock, ImageBlock, SvgBlock, MermaidBlock,
  ChecklistBlock, ShellBlock, FileBlock, ThinkingBlock, ToolCallBlock,
  type BlockRendererProps, type TextBlockProps, type MarkdownBlockProps, type CodeBlockProps, type CodeDiffBlockProps,
  type ImageBlockProps, type SvgBlockProps, type MermaidBlockProps, type ChecklistBlockProps, type ShellBlockProps,
  type FileBlockProps, type ThinkingBlockProps, type ToolCallBlockProps,
} from './blocks';

// Input
export { ChatInput, AttachmentPreview, type ChatInputProps, type AttachmentPreviewProps } from './input';

// Status
export {
  WorkingIndicator, StreamingCursor, ConnectionStatus,
  type WorkingIndicatorProps, type StreamingCursorProps, type ConnectionStatusProps, type ConnectionState,
} from './status';

// Hooks
export { useVirtualList, useAttachments, type UseVirtualListOptions, type UseVirtualListReturn, type VirtualItem, type UseAttachmentsOptions } from './hooks';
