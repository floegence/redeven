import { vi } from 'vitest';
import type { AgentPluginInstall, AgentPluginListing, AgentPluginOperation, AgentPluginsAdapter } from '../../../../../flower_ui/src/extensions/agentPluginTypes';
export function agentPluginsFixture(): AgentPluginsAdapter {
  const pkg = { manifest: { name: 'review-tools', version: '1.0', description: 'Review project changes.' }, skills: [{ key: 'skill:review', name: 'review', description: 'Review code', path: 'skills/review/SKILL.md' }], mcp: { workspace: { type: 'stdio', command: 'workspace-mcp', args: ['--read-only'] } }, diagnostics: [] };
  let listing: AgentPluginListing = { items: [], sources: [], operations: [], revision: 1, target: 'Development', can_launch: true };
  let op: AgentPluginOperation;
  return {
    list: vi.fn(async () => structuredClone(listing)),
    prepare: vi.fn(async input => { op = { id: 'op-1', install_id: 'install-1', expected_revision: input.revision, kind: input.install_id ? 'update' : 'install', status: 'ready', source: input.source, digest: 'a'.repeat(64), package: pkg, expires_at: Date.now() + 60000 }; listing.operations = [op]; return structuredClone(op); }),
    operation: vi.fn(async () => structuredClone(op)),
    commit: vi.fn(async input => { const item: AgentPluginInstall = { id: op.install_id, revision: 1, source: op.source, digest: input.digest, package: pkg, enabled: input.enabled, components: Object.fromEntries(['skill:review', 'mcp:workspace'].map(key => [key, { enabled: input.components.includes(key) }])), health: { 'mcp:workspace': { status: 'needs_check', checked_at: 0, tools: 0 } } }; listing = { ...listing, items: [item], operations: [], revision: listing.revision + 1 }; return structuredClone(item); }),
    change: vi.fn(async input => { const item = listing.items.find(item => item.id === input.id)!; if (input.component) item.components[input.component].enabled = input.enabled ?? false; else item.enabled = input.enabled ?? item.enabled; item.revision++; return structuredClone(item); }),
    remove: vi.fn(async input => { listing.items = listing.items.filter(item => item.id !== input.id); }),
    check: vi.fn(async () => {}),
    credentials: vi.fn(async input => structuredClone(listing.items.find(item => item.id === input.id)!)),
    addSource: vi.fn(async input => { const entry = { id: 'source-1', name: 'Trusted catalog', url: input.url }; listing.sources.push(entry); listing.revision++; return entry; }),
    removeSource: vi.fn(async input => { listing.sources = listing.sources.filter(source => source.id !== input.id); listing.revision++; }),
    catalog: vi.fn(async () => ({ id: 'trusted', plugins: [{ id: 'review-tools', source: { type: 'github' as const, repository: 'example/tools' } }] })),
  };
}
