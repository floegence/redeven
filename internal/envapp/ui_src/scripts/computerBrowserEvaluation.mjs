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
