package containers

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestBuildStartPreflightPlanRedactsSensitiveDataAndFlagsRisks(t *testing.T) {
	plan, err := BuildStartPreflightPlan(StartPreflightInput{
		Engine: EngineDocker, ContainerID: "container_123", ContainerName: "api",
		Image: ImageInput{Reference: "ghcr.io/acme/api:latest"},
		Runtime: RuntimeInput{
			Privileged: true, NetworkMode: "host", PIDMode: "host", IPCMode: "host",
			Env:    []string{"MODE=prod", "API_TOKEN=raw-token"},
			Labels: map[string]string{"service": "api", "auth_secret": "raw-label-secret"},
			Mounts: []MountInput{
				{Type: MountTypeBind, Source: "/Users/alice/private/secrets", Target: "/run/secrets", ReadOnly: true},
				{Type: MountTypeBind, Source: "/var/run/docker.sock", Target: "/var/run/docker.sock"},
			},
			Devices: []DeviceInput{{HostPath: "/dev/kvm", ContainerPath: "/dev/kvm", Permissions: "rwm"}},
			CapAdd:  []string{"SYS_ADMIN"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Method != MethodStart || plan.Request.Engine != EngineDocker || plan.Target.TargetHash == "" {
		t.Fatalf("preflight identity = %+v", plan)
	}
	if plan.RiskLevel != RiskLevelCritical || !plan.RequiresAdmin {
		t.Fatalf("preflight risk = %s, admin=%v", plan.RiskLevel, plan.RequiresAdmin)
	}
	assertRiskIDs(t, plan.RiskFlags, []string{
		"added_linux_capability", "container_privileged", "container_socket_mount", "host_bind_mount",
		"host_device", "host_ipc_namespace", "host_network", "host_pid_namespace",
		"image_not_digest_pinned", "secret_environment", "secret_labels", "sensitive_mount_path",
	})
	raw, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"raw-token", "raw-label-secret", "/Users/alice/private/secrets"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("preflight plan leaked %q: %s", forbidden, raw)
		}
	}
}

func TestBuildStartPreflightPlanProducesStableOwnedSummaries(t *testing.T) {
	input := StartPreflightInput{
		Engine: EnginePodman, ContainerID: "container_9", ContainerName: "worker",
		Image: ImageInput{Reference: "registry.example/worker@sha256:feed", Digest: "sha256:feed"},
		Runtime: RuntimeInput{
			Env: []string{"B=2", "A=1"}, Labels: map[string]string{"team": "infra"},
			Mounts: []MountInput{
				{Type: MountTypeVolume, Source: "cache", Target: "/cache"},
				{Type: MountTypeTmpfs, Target: "/tmp"},
			},
			CapAdd: []string{"net_bind_service", "NET_BIND_SERVICE"},
		},
	}
	first, err := BuildStartPreflightPlan(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildStartPreflightPlan(input)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) || first.Target.TargetHash != second.Target.TargetHash {
		t.Fatalf("preflight output is not stable:\nfirst=%+v\nsecond=%+v", first, second)
	}
	input.Runtime.Env[0] = "TOKEN=mutated"
	input.Runtime.Mounts[0].Source = "mutated"
	if first.Runtime.Env.SecretLikeCount != 0 || first.Runtime.Mounts[0].Source == "mutated" {
		t.Fatalf("preflight output retained mutable input: %+v", first.Runtime)
	}
}

func TestBuildStartPreflightPlanRejectsInvalidInput(t *testing.T) {
	if _, err := BuildStartPreflightPlan(StartPreflightInput{ContainerID: "container_1"}); err == nil {
		t.Fatal("missing engine unexpectedly accepted")
	}
	if _, err := BuildStartPreflightPlan(StartPreflightInput{Engine: EngineDocker}); err == nil {
		t.Fatal("missing container_id unexpectedly accepted")
	}
}
