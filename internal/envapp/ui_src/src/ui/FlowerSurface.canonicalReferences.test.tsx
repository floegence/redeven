// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
	adapter,
	deferred,
	flowerSurfaceNotifications,
	liveBootstrap,
	renderSurfaceWithAdapter,
	thread,
	waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('Flower canonical reference navigation', () => {
	it('opens a canonical file using only thread, turn, and reference identity', async () => {
		const completion = deferred<void>();
		const openCanonicalReference = vi.fn((_request: Readonly<{
			thread_id: string;
			turn_id: string;
			reference_id: string;
		}>) => completion.promise);
		const canonicalThread = thread({
			thread_id: 'thread-canonical-reference',
			title: 'Canonical reference',
			messages: [{
				id: 'entry-canonical-reference',
				turn_id: 'turn-canonical-reference',
				thread_id: 'thread-canonical-reference',
				role: 'user',
				content: 'Inspect this file',
				status: 'complete',
				created_at_ms: 1_000,
				references: [{ reference_id: 'context:0', kind: 'file', label: 'main.ts' }],
			}],
		});
		const runtime = renderSurfaceWithAdapter({
			...adapter(true),
			listThreads: vi.fn(async () => [canonicalThread]),
			loadThread: vi.fn(async () => liveBootstrap(canonicalThread)),
			openCanonicalReference,
		});

		await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-canonical-reference"] button')));
		(runtime.querySelector('[data-thread-id="thread-canonical-reference"] button') as HTMLButtonElement).click();
		await waitFor(() => Boolean(runtime.querySelector('[data-flower-chat-context-chip="true"]')));
		const chip = runtime.querySelector('[data-flower-chat-context-chip="true"]') as HTMLButtonElement;
		chip.focus();
		chip.click();
		chip.click();
		await waitFor(() => openCanonicalReference.mock.calls.length === 1);

		expect(openCanonicalReference).toHaveBeenCalledWith({
			thread_id: 'thread-canonical-reference',
			turn_id: 'turn-canonical-reference',
			reference_id: 'context:0',
		});
		expect((runtime.querySelector('[data-flower-chat-context-chip="true"]') as HTMLButtonElement).disabled).toBe(true);
		expect(JSON.stringify(openCanonicalReference.mock.calls[0]?.[0])).not.toContain('path');

		completion.resolve();
		await waitFor(() => (runtime.querySelector('[data-flower-chat-context-chip="true"]') as HTMLButtonElement)?.disabled === false);
		expect(document.activeElement).toBe(runtime.querySelector('[data-flower-chat-context-chip="true"]'));
	});

	it('shows the existing action error and never fabricates a preview when resolution fails', async () => {
		const notificationCount = flowerSurfaceNotifications().length;
		const openCanonicalReference = vi.fn(async () => {
			throw new Error('Canonical reference is no longer available.');
		});
		const canonicalThread = thread({
			thread_id: 'thread-canonical-reference-error',
			title: 'Missing canonical reference',
			messages: [{
				id: 'entry-canonical-reference-error',
				turn_id: 'turn-canonical-reference-error',
				thread_id: 'thread-canonical-reference-error',
				role: 'user',
				content: 'Inspect this directory',
				status: 'complete',
				created_at_ms: 1_000,
				references: [{ reference_id: 'context:directory', kind: 'directory', label: 'src' }],
			}],
		});
		const runtime = renderSurfaceWithAdapter({
			...adapter(true),
			listThreads: vi.fn(async () => [canonicalThread]),
			loadThread: vi.fn(async () => liveBootstrap(canonicalThread)),
			openCanonicalReference,
		});

		await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-canonical-reference-error"] button')));
		(runtime.querySelector('[data-thread-id="thread-canonical-reference-error"] button') as HTMLButtonElement).click();
		await waitFor(() => Boolean(runtime.querySelector('[data-flower-chat-context-chip="true"]')));
		(runtime.querySelector('[data-flower-chat-context-chip="true"]') as HTMLButtonElement).click();
		await waitFor(() => flowerSurfaceNotifications().length > notificationCount);

		expect(openCanonicalReference).toHaveBeenCalledWith({
			thread_id: 'thread-canonical-reference-error',
			turn_id: 'turn-canonical-reference-error',
			reference_id: 'context:directory',
		});
		expect(flowerSurfaceNotifications().at(-1)?.message).toBe('Canonical reference is no longer available.');
		expect(runtime.querySelector('.flower-chat-context-preview-window')).toBeNull();
	});
});
