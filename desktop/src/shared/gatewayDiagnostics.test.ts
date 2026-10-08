import { describe, expect, it } from 'vitest';
import { redactGatewayDiagnosticValue } from './gatewayDiagnostics';

describe('Gateway diagnostic output', () => {
  it('retains the actual build error at the end of a bounded log after redaction', () => {
    const output = `Preparing package\n${'Build progress\n'.repeat(2000)}token=private-material\ncompiler: target build failed`;
    const result = redactGatewayDiagnosticValue(output) as string;
    expect(result).toContain('Preparing package');
    expect(result).toContain('compiler: target build failed');
    expect(result).toContain('token=[redacted]');
    expect(result).not.toContain('private-material');
    expect(result.length).toBeLessThanOrEqual(16_384);
  });

  it('keeps sensitive structured fields redacted', () => {
    expect(redactGatewayDiagnosticValue({ authorization: 'credential', messages: ['Authorization: Bearer credential', 'ready'] }))
      .toEqual({ authorization: '[redacted]', messages: ['Authorization: [redacted]', 'ready'] });
  });
});
