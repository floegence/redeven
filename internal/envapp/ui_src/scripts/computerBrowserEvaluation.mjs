// A CDP response acknowledges transport, not successful JavaScript execution.
// Callers specify the value their controlled expression promises. Do not expose
// exception text, infer retry safety, or repeat an operation here.
export function evaluationValue(response, method, accepts = value => value !== undefined) {
  const fail = reason => {
    throw Object.assign(new Error('TARGET_OBSERVATION_UNAVAILABLE'), {
      observationStage: 'semantic_read',
      protocolDiagnostic: {phase:'evaluation',method,reason},
    });
  };
  if (!response || typeof response !== 'object' || Array.isArray(response)) fail('invalid_result');
  if (Object.hasOwn(response, 'exceptionDetails')) fail('exception');
  const remote = response.result;
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) fail('invalid_result');
  const hasValue = Object.hasOwn(remote, 'value');
  if (!hasValue && remote.type !== 'undefined') fail('invalid_result');
  const value = hasValue ? remote.value : undefined;
  if (!accepts(value)) fail('invalid_result');
  return value;
}

export async function evaluate(session, method, parameters, accepts) {
  return evaluationValue(await session.send(method, parameters), method, accepts);
}

// Validate consumed CDP facts at their adapter boundary. Raw values and error
// text never become diagnostics; these failures never authorize a retry.
export function adapterFailure(method, reason) {
  return Object.assign(new Error('TARGET_OBSERVATION_UNAVAILABLE'), {
    protocolDiagnostic: {phase:'adapter',method,reason},
  });
}
export async function protocolRead(session, method, parameters, validate) {
  let response;
  try { response = await session.send(method, parameters); }
  catch (error) {
    // The pending method is known even when the transport supplied no code.
    if (!error.protocolDiagnostic) error.protocolDiagnostic = {phase:'protocol',method};
    throw error;
  }
  let valid;
  try { valid = validate(response); }
  catch { throw adapterFailure(method, 'invalid_result'); }
  if (!valid) throw adapterFailure(method, 'invalid_result');
  return response;
}

// Only the DOMSnapshot fields consumed by safety and geometry are required.
// Extra protocol fields remain forward compatible; empty collections are data.
export function domSnapshotValue(value) {
  if (!Array.isArray(value?.strings) || !value.strings.every(s => typeof s === 'string') || !Array.isArray(value.documents)) return false;
  const stringIndex = i => Number.isInteger(i) && i >= 0 && i < value.strings.length;
  return value.documents.every(document => {
    const nodes = document?.nodes, layout = document?.layout;
    if (!nodes || !layout || !Array.isArray(nodes.nodeName) || !Array.isArray(nodes.backendNodeId)
      || !Array.isArray(nodes.attributes) || !Array.isArray(layout.nodeIndex) || !Array.isArray(layout.bounds)
      || !stringIndex(document.frameId) || document.scrollOffsetX !== undefined && !Number.isFinite(document.scrollOffsetX)
      || document.scrollOffsetY !== undefined && !Number.isFinite(document.scrollOffsetY)) return false;
    return layout.nodeIndex.length === layout.bounds.length && layout.nodeIndex.every((index, position) => {
      if (!Number.isInteger(index) || index < 0 || !stringIndex(nodes.nodeName[index]) || !Number.isInteger(nodes.backendNodeId[index])) return false;
      const bounds = layout.bounds[position], attributes = nodes.attributes[index];
      return Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite)
        && (attributes === undefined || Array.isArray(attributes) && attributes.length % 2 === 0 && attributes.every((value, i) => stringIndex(value) || i % 2 === 1 && value === -1));
    });
  });
}
