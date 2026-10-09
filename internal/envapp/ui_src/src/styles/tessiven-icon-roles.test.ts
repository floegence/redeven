import { describe, expect, it } from 'vitest';
import { resolveTessivenIcon } from '../../../../tessiven_ui/src/iconRoles';

describe('service icon responsibility refinement', () => {
  it('refines the legacy Kubernetes inventory without modifying canonical kinds', () => {
    const services = [
      { kind: 'service', name: 'kube-scheduler', expected: 'scheduler' },
      { kind: 'service', name: 'kube-controller-manager', expected: 'controller' },
      { kind: 'service', name: 'cloud-controller-manager', expected: 'cloud_controller' },
      { kind: 'worker', name: 'kubelet (node agent)', expected: 'node_agent' },
      { kind: 'service', name: 'Container runtime (containerd / CRI-O)', expected: 'container_runtime' },
      { kind: 'service', name: 'Network plugin (CNI: Calico / Cilium)', expected: 'network_plugin' },
    ];
    const before = structuredClone(services);
    expect(services.map(service => resolveTessivenIcon(service.kind, service.name)))
      .toEqual(services.map(service => service.expected));
    expect(services).toEqual(before);
  });

  it('preserves specific and incompatible saved responsibilities', () => {
    expect(resolveTessivenIcon('api', 'kube-scheduler')).toBe('api');
    expect(resolveTessivenIcon('controller', 'kube-scheduler')).toBe('controller');
    expect(resolveTessivenIcon('database', 'etcd')).toBe('database');
    expect(resolveTessivenIcon('metadata', 'containerd')).toBe('metadata');
    expect(resolveTessivenIcon('external', 'containerd')).toBe('external');
  });

  it('refines only known names and compatible broad families', () => {
    expect(resolveTessivenIcon('network', 'CNI: Calico')).toBe('network_plugin');
    expect(resolveTessivenIcon('monitoring', 'Prometheus')).toBe('metrics');
    expect(resolveTessivenIcon('monitoring', 'Jaeger')).toBe('tracing');
    expect(resolveTessivenIcon('monitoring', 'Alertmanager')).toBe('alerting');
    expect(resolveTessivenIcon('service', 'Kafka Streams')).toBe('stream_processor');
    expect(resolveTessivenIcon('service', 'Kafka')).toBe('queue');
    expect(resolveTessivenIcon('service', 'PostgreSQL')).toBe('database');
    expect(resolveTessivenIcon('service', 'HDFS DataNode')).toBe('storage');
    expect(resolveTessivenIcon('service', 'KUBE_SCHEDULER')).toBe('scheduler');
    expect(resolveTessivenIcon('service', 'Payments')).toBe('service');
    expect(resolveTessivenIcon('service', 'containerdaemon')).toBe('service');
    expect(resolveTessivenIcon('service', 'Dexter')).toBe('service');
    expect(resolveTessivenIcon('runtime')).toBe('runtime');
  });
});
