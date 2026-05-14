import { describe, expect, it } from 'vitest';

import {
  createLocalRuntimeHostExecutor,
  createSSHRuntimeHostExecutor,
} from './runtimeHostAccess';

describe('runtimeHostAccess', () => {
  it('describes local host access without placement details', () => {
    expect(createLocalRuntimeHostExecutor().host_access).toEqual({ kind: 'local_host' });
  });

  it('describes SSH host access separately from runtime placement', () => {
    const executor = createSSHRuntimeHostExecutor({
      ssh_destination: 'devbox',
      ssh_port: 2222,
      auth_mode: 'key_agent',
      remote_install_dir: '/opt/redeven',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
      connect_timeout_seconds: 15,
    });

    expect(executor.host_access).toMatchObject({
      kind: 'ssh_host',
      ssh: {
        ssh_destination: 'devbox',
        ssh_port: 2222,
      },
    });
  });
});
