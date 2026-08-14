#!/usr/bin/env node

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'spec/capabilities/container-resources-v3.contract.json');
const outputPath = path.join(root, 'spec/capabilities/container-resources-v4.contract.json');
const hostProjectionPath = path.join(root, 'spec/redevplugin/known-containers-capability-v4.contract.json');
const verify = process.argv.includes('--verify');

const contract = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
contract.contract_id = 'redeven.container_resources.v4';
contract.contract_version = '4.0.0';
contract.capability_version = '3.0.0';
contract.client_name = 'RedevenContainerResourcesV4Client';
contract.methods = contract.methods.map((method) => normalizePermissionGroups(addEndpointIdentity(method)));
contract.methods.push(...workspaceMethods());

addContainerGrouping(contract.methods.find((item) => item.name === 'containers.list')?.response_schema?.properties?.containers?.items);
addContainerGrouping(contract.methods.find((item) => item.name === 'containers.inspect')?.response_schema?.properties?.container);

const publishedBytes = fs.readFileSync(outputPath);
const publishedDigest = crypto.createHash('sha256').update(publishedBytes).digest('hex');
if (publishedDigest !== '0137cd99569a48d3ef4061b19b2fda021ed02cf268094b79c29a40f74bce0b92') {
  throw new Error('published Containers v4 capability artifact digest changed');
}
const published = JSON.parse(publishedBytes.toString('utf8'));
normalizePublishedRepresentation(contract);
normalizePublishedRepresentation(published);
assert.deepStrictEqual(published, contract, 'published Containers v4 capability artifact is semantically stale');

if (verify) {
  if (!fs.existsSync(hostProjectionPath) || !fs.readFileSync(hostProjectionPath).equals(publishedBytes)) {
    throw new Error(`${path.relative(root, hostProjectionPath)} is stale; run scripts/build_containers_v4_contract.mjs`);
  }
} else {
  fs.writeFileSync(hostProjectionPath, publishedBytes);
}

function normalizePublishedRepresentation(value) {
  for (const method of value.methods ?? []) {
    if (method.confirmation?.plan_hash_required === false) delete method.confirmation.plan_hash_required;
  }
}

function addEndpointIdentity(method) {
  const copy = structuredClone(method);
  addEndpointSchema(copy.target_schema);
  addEndpointSchema(copy.request_schema);
  addEndpointSchema(copy.response_schema);
  if (Array.isArray(copy.target_fields) && !copy.target_fields.includes('endpoint_id')) {
    copy.target_fields.splice(Math.max(0, copy.target_fields.indexOf('engine') + 1), 0, 'endpoint_id');
  }
  const hashes = copy.confirmation?.request_hash_fields;
  if (Array.isArray(hashes) && !hashes.includes('endpoint_id')) {
    hashes.splice(Math.max(0, hashes.indexOf('engine') + 1), 0, 'endpoint_id');
  }
  if (copy.preflight_only && copy.response_schema?.properties?.plan_digest) {
    copy.response_schema.required ??= [];
    if (!copy.response_schema.required.includes('plan_digest')) copy.response_schema.required.push('plan_digest');
  }
  return copy;
}

function normalizePermissionGroups(method) {
  const copy = structuredClone(method);
  if (copy.effect === 'read') {
    copy.required_permissions = [permissionForReadMethod(copy.name)];
    return copy;
  }
  if (copy.name === 'images.pull' || copy.name === 'images.tag') {
    copy.required_permissions = ['containers.images.write'];
    return copy;
  }
  if (copy.effect === 'delete' || copy.name.includes('.remove') || copy.name.includes('.prune')) {
    copy.required_permissions = ['containers.delete'];
    return copy;
  }
  copy.required_permissions = ['containers.execute'];
  return copy;
}

function permissionForReadMethod(name) {
  if (name === 'containers.create.preflight' || name === 'volumes.create.preflight') {
    return 'containers.execute';
  }
  if (name.includes('.remove.') || name.endsWith('.remove.preflight') || name.includes('.prune.')) {
    return 'containers.delete';
  }
  return 'containers.read';
}

function addEndpointSchema(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object' && schema.properties?.engine) {
    schema.properties.endpoint_id = endpointIDSchema();
    schema.required ??= [];
    if (!schema.required.includes('endpoint_id')) {
      const index = schema.required.indexOf('engine');
      schema.required.splice(index < 0 ? 0 : index + 1, 0, 'endpoint_id');
    }
  }
  for (const value of Object.values(schema)) {
    if (value && typeof value === 'object') addEndpointSchema(value);
  }
}

function addContainerGrouping(schema) {
  if (!schema?.properties) return;
  schema.properties.group_kind = { type: 'string', enum: ['compose_project', 'pod'] };
  schema.properties.group_id = textSchema(1, 256);
  schema.properties.group_name = textSchema(1, 256);
}

function workspaceMethods() {
  const methods = [
    readMethod('endpoints.list', 'listEndpoints', 'EndpointsListRequest', 'EndpointsListResponse',
      { engine: engineSchema() }, ['engine'],
      { engine: engineSchema(), endpoints: { type: 'array', items: endpointSchema(), maxItems: 64 } }, ['engine', 'endpoints'], ['engine']),
    readMethod('endpoints.status', 'endpointStatus', 'EndpointsStatusRequest', 'EndpointsStatusResponse',
      endpointRequestProperties(), ['engine', 'endpoint_id'], { endpoint: endpointSchema() }, ['endpoint'], ['engine', 'endpoint_id']),
    readMethod('compose.projects.list', 'listComposeProjects', 'ComposeProjectsListRequest', 'ComposeProjectsListResponse',
      endpointRequestProperties('docker'), ['engine', 'endpoint_id'],
      { engine: literalEngine('docker'), endpoint_id: endpointIDSchema(), projects: { type: 'array', items: composeProjectSchema(), maxItems: 4096 } },
      ['engine', 'endpoint_id', 'projects'], ['engine', 'endpoint_id']),
    readMethod('compose.projects.inspect', 'inspectComposeProject', 'ComposeProjectsInspectRequest', 'ComposeProjectsInspectResponse',
      { ...endpointRequestProperties('docker'), project_id: projectIDSchema() }, ['engine', 'endpoint_id', 'project_id'],
      { engine: literalEngine('docker'), endpoint_id: endpointIDSchema(), project: composeProjectDetailsSchema() },
      ['engine', 'endpoint_id', 'project'], ['engine', 'endpoint_id', 'project_id']),
    preflightMethod('compose.projects.action.preflight', 'composeProjectActionPreflight', 'ComposeProjectsActionPreflightRequest',
      composeActionRequestProperties(), ['engine', 'endpoint_id', 'project_id', 'action'], composeActions()),
    readMethod('pods.list', 'listPods', 'PodsListRequest', 'PodsListResponse',
      endpointRequestProperties('podman'), ['engine', 'endpoint_id'],
      { engine: literalEngine('podman'), endpoint_id: endpointIDSchema(), pods: { type: 'array', items: podSchema(false), maxItems: 4096 } },
      ['engine', 'endpoint_id', 'pods'], ['engine', 'endpoint_id']),
    readMethod('pods.inspect', 'inspectPod', 'PodsInspectRequest', 'PodsInspectResponse',
      { ...endpointRequestProperties('podman'), pod_id: resourceIDSchema() }, ['engine', 'endpoint_id', 'pod_id'],
      { engine: literalEngine('podman'), endpoint_id: endpointIDSchema(), pod: podSchema(true) },
      ['engine', 'endpoint_id', 'pod'], ['engine', 'endpoint_id', 'pod_id']),
    preflightMethod('pods.create.preflight', 'createPodPreflight', 'PodsCreatePreflightRequest',
      { ...endpointRequestProperties('podman'), name: nameSchema() }, ['engine', 'endpoint_id', 'name'], ['pods.create']),
    preflightMethod('pods.action.preflight', 'podActionPreflight', 'PodsActionPreflightRequest',
      podActionRequestProperties(), ['engine', 'endpoint_id', 'pod_id', 'action'], podActions()),
  ];
  for (const action of composeActions()) {
    const typeName = action.split('.').at(-1).replace(/^./, (value) => value.toUpperCase());
    methods.push(operationMethod(action, composeClientMethod(action), `ComposeProjects${typeName}Request`, `ComposeProjects${typeName}Response`,
      { ...composeActionRequestProperties(), action: { const: action, type: 'string' } },
      ['engine', 'endpoint_id', 'project_id', 'action'], action === 'compose.projects.down' ? 'delete' : 'execute',
      action === 'compose.projects.down' ? 'containers.delete' : 'containers.execute', 'compose.projects.action.preflight'));
  }
  methods.push(operationMethod('pods.create', 'createPod', 'PodsCreateRequest', 'PodsCreateResponse',
    { ...endpointRequestProperties('podman'), name: nameSchema() }, ['engine', 'endpoint_id', 'name'], 'execute', 'containers.execute', 'pods.create.preflight'));
  for (const action of podActions()) {
    const typeName = action.split('.').at(-1).replace(/^./, (value) => value.toUpperCase());
    methods.push(operationMethod(action, podClientMethod(action), `Pods${typeName}Request`, `Pods${typeName}Response`,
      { ...podActionRequestProperties(), action: { const: action, type: 'string' } },
      ['engine', 'endpoint_id', 'pod_id', 'action'], action === 'pods.remove' ? 'delete' : 'execute',
      action === 'pods.remove' ? 'containers.delete' : 'containers.execute', 'pods.action.preflight'));
  }
  return methods;
}

function readMethod(name, clientMethod, requestType, responseType, requestProperties, requestRequired, responseProperties, responseRequired, targetFields) {
  const targetProperties = Object.fromEntries(targetFields.map((field) => [field, requestProperties[field]]));
  return {
    name,
    client_method: clientMethod,
    effect: 'read',
    execution: 'sync',
    required_permissions: ['containers.read'],
    target_fields: targetFields,
    target_schema: objectSchema(targetProperties, targetFields),
    request_type_name: requestType,
    response_type_name: responseType,
    request_schema: objectSchema(requestProperties, requestRequired),
    response_schema: objectSchema(responseProperties, responseRequired),
    quota: {},
  };
}

function preflightMethod(name, clientMethod, requestType, properties, required, allowedMethods) {
  return {
    ...readMethod(name, clientMethod, requestType, requestType.replace(/Request$/, 'Response'), properties, required,
      resourcePlanProperties(allowedMethods, properties), ['method', 'request', 'target', 'risk_level', 'risk_flags', 'requires_admin', 'plan_digest'],
      required.filter((field) => field !== 'confirmation_name')),
    preflight_only: true,
  };
}

function operationMethod(name, clientMethod, requestType, responseType, properties, required, effect, permission, preflightMethodName) {
  const identity = name.startsWith('compose.') ? ['project_id'] : name === 'pods.create' ? ['name'] : ['pod_id'];
  const responseProperties = { accepted: { type: 'boolean' }, engine: properties.engine, endpoint_id: endpointIDSchema(), method: { const: name, type: 'string' } };
  for (const field of identity) responseProperties[field] = properties[field];
  return {
    name,
    client_method: clientMethod,
    effect,
    execution: 'operation',
    required_permissions: [permission],
    target_fields: required.filter((field) => field !== 'confirmation_name' && field !== 'action'),
    target_schema: objectSchema(Object.fromEntries(required.filter((field) => field !== 'confirmation_name' && field !== 'action').map((field) => [field, properties[field]])), required.filter((field) => field !== 'confirmation_name' && field !== 'action')),
    request_type_name: requestType,
    response_type_name: responseType,
    request_schema: objectSchema(properties, required),
    response_schema: objectSchema(responseProperties, ['accepted', 'engine', 'endpoint_id', 'method', ...identity]),
    confirmation: { mode: 'required', preflight_method: preflightMethodName, request_hash_fields: required, plan_hash_required: true },
    cancel_policy: { cancelable: true, disable_behavior: 'cancel', uninstall_behavior: 'cancel_then_block_delete', ack_timeout_ms: 2000 },
    quota: { max_concurrent: 4, max_duration_ms: 120000 },
  };
}

function resourcePlanProperties(methods, requestProperties) {
  return {
    method: { type: 'string', enum: methods },
    request: objectSchema(requestProperties, Object.keys(requestProperties).filter((key) => key !== 'confirmation_name')),
    target: objectSchema({
      engine: requestProperties.engine,
      endpoint_id: endpointIDSchema(),
      resource_kind: { type: 'string', enum: ['compose_project', 'pod'] },
      identity: textSchema(1, 256), project_id: projectIDSchema(), pod_id: resourceIDSchema(), name: nameSchema(),
      container_count: { type: 'integer', minimum: 0 },
    }, ['engine', 'endpoint_id', 'resource_kind']),
    risk_level: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
    risk_flags: { type: 'array', items: riskFlagSchema() },
    requires_admin: { type: 'boolean' },
    summary: { type: 'array', items: { type: 'string' } },
    plan_digest: { type: 'string' },
  };
}

function endpointRequestProperties(engine) {
  return { engine: engine ? literalEngine(engine) : engineSchema(), endpoint_id: endpointIDSchema() };
}

function composeActionRequestProperties() {
  return { ...endpointRequestProperties('docker'), project_id: projectIDSchema(), action: { type: 'string', enum: composeActions() }, confirmation_name: textSchema(1, 256) };
}

function podActionRequestProperties() {
  return { ...endpointRequestProperties('podman'), pod_id: resourceIDSchema(), action: { type: 'string', enum: podActions() }, confirmation_name: textSchema(1, 256) };
}

function endpointSchema() {
  return objectSchema({
    endpoint_id: endpointIDSchema(), engine: engineSchema(), display_name: textSchema(1, 256), default: { type: 'boolean' }, remote: { type: 'boolean' }, available: { type: 'boolean' },
    engine_version: textSchema(1, 256), rootless: { type: 'boolean' },
  }, ['endpoint_id', 'engine', 'display_name', 'default', 'remote', 'available']);
}

function composeProjectSchema() {
  return objectSchema({ project_id: projectIDSchema(), name: nameSchema(), status: { type: 'string', enum: ['running', 'stopped', 'degraded', 'unknown'] }, service_count: countSchema(), container_count: countSchema(), running_count: countSchema() }, ['project_id', 'name', 'status', 'service_count', 'container_count', 'running_count']);
}

function composeProjectDetailsSchema() {
  const schema = composeProjectSchema();
  schema.properties.containers = { type: 'array', maxItems: 4096, items: objectSchema({ container_id: resourceIDSchema(), name: textSchema(1, 256), service: textSchema(1, 256), state: containerStateSchema(), health: healthSchema() }, ['container_id', 'state']) };
  schema.required.push('containers');
  return schema;
}

function podSchema(details) {
  const properties = { pod_id: resourceIDSchema(), name: nameSchema(), status: { type: 'string', enum: ['running', 'degraded', 'paused', 'exited', 'stopped', 'created', 'unknown'] }, infra_id: resourceIDSchema(), container_count: countSchema(), running_count: countSchema(), created_at_unix_ms: { type: 'integer', minimum: 0 }, ports: { type: 'array', items: portSummarySchema(), maxItems: 4096 } };
  if (details) properties.containers = { type: 'array', maxItems: 4096, items: objectSchema({ container_id: resourceIDSchema(), name: textSchema(1, 256), state: containerStateSchema(), infra: { type: 'boolean' } }, ['container_id', 'state', 'infra']) };
  return objectSchema(properties, ['pod_id', 'name', 'status', 'container_count', 'running_count', ...(details ? ['containers'] : [])]);
}

function portSummarySchema() {
  return objectSchema({ protocol: { type: 'string' }, host_ip: { type: 'string' }, host_port: { type: 'integer', minimum: 0 }, port: { type: 'integer', minimum: 1, maximum: 65535 } }, ['port']);
}

function riskFlagSchema() {
  return objectSchema({ id: textSchema(1, 128), severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, title: textSchema(1, 256), detail: { type: 'string' }, admin_required: { type: 'boolean' } }, ['id', 'severity', 'title']);
}

function objectSchema(properties, required) { return { type: 'object', additionalProperties: false, required, properties }; }
function engineSchema() { return { type: 'string', enum: ['docker', 'podman'] }; }
function literalEngine(engine) { return { type: 'string', const: engine }; }
function endpointIDSchema() { return { type: 'string', pattern: '^endpoint_[a-f0-9]{64}$', minLength: 73, maxLength: 73 }; }
function projectIDSchema() { return { type: 'string', pattern: '^project_[a-f0-9]{64}$', minLength: 72, maxLength: 72 }; }
function resourceIDSchema() { return { type: 'string', pattern: '^[A-Za-z0-9_][A-Za-z0-9._~:/-]*$', minLength: 1, maxLength: 1024 }; }
function nameSchema() { return { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$', minLength: 1, maxLength: 128 }; }
function textSchema(minLength, maxLength) { return { type: 'string', minLength, maxLength }; }
function countSchema() { return { type: 'integer', minimum: 0 }; }
function containerStateSchema() { return { type: 'string', enum: ['created', 'running', 'paused', 'restarting', 'exited', 'stopped', 'unknown'] }; }
function healthSchema() { return { type: 'string', enum: ['healthy', 'unhealthy', 'starting', 'none', 'unknown'] }; }
function composeActions() { return ['compose.projects.start', 'compose.projects.stop', 'compose.projects.restart', 'compose.projects.down']; }
function podActions() { return ['pods.start', 'pods.stop', 'pods.restart', 'pods.remove']; }
function composeClientMethod(action) { return { 'compose.projects.start': 'startComposeProject', 'compose.projects.stop': 'stopComposeProject', 'compose.projects.restart': 'restartComposeProject', 'compose.projects.down': 'downComposeProject' }[action]; }
function podClientMethod(action) { return { 'pods.start': 'startPod', 'pods.stop': 'stopPod', 'pods.restart': 'restartPod', 'pods.remove': 'removePod' }[action]; }
