import type { JsonValue } from '@floegence/flowersec-core';
export type TerminalView = { id: string; name: string; layout: JsonValue; revision: number; createdAtMs: number; updatedAtMs: number };
export type TerminalViewSnapshot = { revision: number; views: TerminalView[] };
export type TerminalViewPutRequest = { id: string; name: string; layout: JsonValue; baseRevision: number };
export type TerminalViewDeleteRequest = { id: string; baseRevision: number };

export type TerminalViewsUpdateRequest = { changes: Array<TerminalViewPutRequest | { id: string; baseRevision: number; delete: true }> };
