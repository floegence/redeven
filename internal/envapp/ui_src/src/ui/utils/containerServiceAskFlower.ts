import type { ContainerService } from '../services/containerResourcesApi';
import type { EnvAppTranslationKey } from '../i18n';
import { attachAskFlowerContextAction, type EnvFlowerTurnLauncherIntent } from '../contextActions/askFlower';
import { createClientId } from './clientId';

export function containerServiceDiagnosticKey(service: ContainerService): EnvAppTranslationKey | undefined {
  const diagnostic = service.diagnostic;
  if (diagnostic) {
    switch (diagnostic.code) {
      case 'permission_denied':
        return diagnostic.phase === 'health' ? 'containers.services.diagnostics.permissionHealth'
          : diagnostic.phase === 'management' ? 'containers.services.diagnostics.permissionManagement'
          : 'containers.services.diagnostics.permission';
      case 'cli_unavailable': return 'containers.services.diagnostics.cliUnavailable';
      case 'timeout': return 'containers.services.diagnostics.timeout';
      case 'unreachable': return 'containers.services.diagnostics.unreachable';
      case 'stopped': return 'containers.services.diagnostics.stopped';
      case 'unknown': return 'containers.services.diagnostics.unknown';
    }
  }
  // Older service responses still must not let management advice hide a fault.
  if (service.state === 'permission') return 'containers.services.diagnostics.permission';
  if (service.state === 'unreachable') return 'containers.services.diagnostics.unreachable';
  if (service.state === 'error') return 'containers.services.diagnostics.unknown';
  return undefined;
}

export function containerServiceNeedsAssistance(service: ContainerService): boolean {
  return ['permission', 'unreachable', 'error'].includes(service.state)
    || (service.state === 'stopped' && !service.capabilities.start);
}

export function buildContainerServiceFlowerIntent(params: {
  service: ContainerService;
  environmentID: string;
  environmentName: string;
  summary: string;
  capturedAtMs: number;
}) {
  const { service } = params;
  // Explicitly project safe facts. Never attach raw CLI output, endpoints,
  // configuration contents, or environment/session credentials.
  const content = JSON.stringify({
    environment: { id: params.environmentID, name: params.environmentName },
    summary: params.summary,
    diagnostic: service.diagnostic ? {
      phase: service.diagnostic.phase, code: service.diagnostic.code,
      observed_at_unix_ms: service.diagnostic.observed_at_unix_ms,
    } : null,
    service: {
      service_id: service.service_id, engine: service.engine, name: service.name,
      implementation: service.implementation, state: service.state,
      version: service.version ?? null, rootless: service.rootless ?? null, remote: service.remote ?? null,
      capabilities: { start: service.capabilities.start, stop: service.capabilities.stop, restart: service.capabilities.restart },
      configuration: { mode: service.configuration.mode, sources: service.configuration.mode === 'local' ? [...service.configuration.sources] : [] },
      restart_required: service.restart_required ?? false,
      generation: service.generation ?? null,
    },
    management_guidance: service.guidance_code ?? null,
    captured_at_unix_ms: params.capturedAtMs,
  }, null, 2);
  const intent: EnvFlowerTurnLauncherIntent = {
    id: createClientId(), source_surface: 'container_services',
    context_items: [{ kind: 'text_snapshot', title: service.name, detail: params.environmentName || params.environmentID, content }],
    pending_attachments: [], notes: [],
  };
  return attachAskFlowerContextAction(intent, service.service_id);
}
