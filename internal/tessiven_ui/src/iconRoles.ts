// Recognized service names refine only generic or compatible broad kinds.
// This is display metadata; saved responsibilities and management identity stay intact.
const roles: readonly { kind: string; family: string; names: RegExp }[] = [
  { kind: 'cloud_controller', family: 'controller', names: /\bcloud[- ]controller(?:[- ]manager)?\b/i },
  { kind: 'operator', family: 'controller', names: /\b(?:resource[- ]operator|kubernetes[- ]operator|prometheus[- ]operator|strimzi)\b/i },
  { kind: 'controller', family: 'controller', names: /\bkube[- ]controller[- ]manager\b/i },
  { kind: 'scheduler', family: 'scheduler', names: /\b(?:kube[- ]scheduler|job[- ]scheduler|resource[- ]?manager)\b/i },
  { kind: 'node_agent', family: 'worker', names: /\b(?:kubelet|node[- ]agent|node[- ]?manager)\b/i },
  { kind: 'container_runtime', family: 'runtime', names: /\b(?:containerd|cri[- ]?o|container[- ]runtime)\b/i },
  { kind: 'network_plugin', family: 'network', names: /\b(?:cni|calico|cilium|flannel|network[- ]plugin)\b/i },
  { kind: 'service_mesh', family: 'network', names: /\b(?:istio|linkerd|service[- ]mesh)\b/i },
  { kind: 'ingress', family: 'gateway', names: /\b(?:ingress[- ](?:nginx|controller)|traefik)\b/i },
  { kind: 'gateway', family: 'gateway', names: /\bkube[- ]proxy\b/i },
  { kind: 'dns', family: 'network', names: /\b(?:coredns|kube[- ]dns)\b/i },
  { kind: 'registry', family: 'storage', names: /\b(?:harbor|image[- ]registry|container[- ]registry|docker[- ]registry)\b/i },
  { kind: 'metrics', family: 'monitoring', names: /\b(?:prometheus|victoriametrics|metrics[- ]server|node[- ]exporter)\b/i },
  { kind: 'tracing', family: 'monitoring', names: /\b(?:jaeger|zipkin|grafana[- ]tempo|distributed[- ]tracing)\b/i },
  { kind: 'alerting', family: 'monitoring', names: /\b(?:alertmanager|alert[- ]manager)\b/i },
  { kind: 'identity', family: 'security', names: /\b(?:keycloak|dex|identity[- ]service)\b/i },
  { kind: 'secrets', family: 'security', names: /\b(?:hashicorp[- ]vault|secret[- ]store|secrets[- ]manager)\b/i },
  { kind: 'certificate', family: 'security', names: /\b(?:cert[- ]manager|certificate[- ]service)\b/i },
  { kind: 'stream_processor', family: 'analytics', names: /\b(?:flink|kafka[- ]streams|stream[- ]processor)\b/i },
  { kind: 'metadata', family: 'database', names: /\b(?:hive[- ]metastore|name[- ]?node|metadata[- ]service)\b/i },
  { kind: 'coordination', family: 'coordination', names: /\b(?:zookeeper|etcd)\b/i },
  { kind: 'cache', family: 'cache', names: /\b(?:redis|memcached)\b/i },
  { kind: 'search', family: 'search', names: /\b(?:elasticsearch|opensearch|solr)\b/i },
  { kind: 'queue', family: 'queue', names: /\b(?:kafka|rabbitmq|nats|pulsar)\b/i },
  { kind: 'database', family: 'database', names: /\b(?:postgresql|postgres|mysql|mariadb|mongodb|clickhouse|hbase[- ]?region[- ]?server)\b/i },
  { kind: 'storage', family: 'storage', names: /\b(?:data[- ]?node|ceph|minio)\b/i },
  { kind: 'logging', family: 'logging', names: /\b(?:fluent[- ]?bit|fluentd|logstash|grafana[- ]loki)\b/i },
];

export function resolveTessivenIcon(kind: string, name?: string): string {
  if (!name) return kind;
  const normalized = name.replaceAll('_', '-');
  return roles.find(role => (kind === 'service' || kind === role.family) && role.names.test(normalized))?.kind ?? kind;
}
