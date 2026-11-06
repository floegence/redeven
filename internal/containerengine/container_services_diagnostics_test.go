package containerengine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestContainerServiceDiagnosticProjectsOnlyObservedFacts(t *testing.T) {
	for _, tt := range []struct {
		name, phase, code string
		err               error
	}{
		{"health permission", "health", "permission_denied", ErrPermissionDenied},
		{"management permission", "management", "permission_denied", ErrPermissionDenied},
		{"discovery CLI", "discovery", "cli_unavailable", ErrCLIUnavailable},
		{"timeout", "health", "timeout", ErrEngineTimeout},
		{"deadline", "discovery", "timeout", context.DeadlineExceeded},
		{"unreachable", "health", "unreachable", ErrBackendUnreachable},
		{"stopped", "health", "stopped", ErrDaemonStopped},
		{"unavailable", "health", "stopped", ErrEngineUnavailable},
		{"management cannot prove stopped", "management", "unknown", ErrDaemonStopped},
		{"unknown", "health", "unknown", errors.New("unexpected failure")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			before := time.Now().UnixMilli()
			diagnostic := containerServiceDiagnostic(tt.phase, fmt.Errorf("ssh://user:secret@private.example /private/docker.sock: %w", tt.err))
			if diagnostic.Code != tt.code || diagnostic.Phase != tt.phase || diagnostic.ObservedAtUnixMs < before || diagnostic.ObservedAtUnixMs > time.Now().UnixMilli() {
				t.Fatalf("unexpected diagnostic: %+v", diagnostic)
			}
			raw, err := json.Marshal(diagnostic)
			if err != nil || strings.Contains(string(raw), "private") || strings.Contains(string(raw), "secret") {
				t.Fatalf("unsafe diagnostic: %s, %v", raw, err)
			}
		})
	}
	if got := containerServiceDiagnostic("health", nil); got != nil {
		t.Fatalf("successful probe gained a diagnostic: %+v", got)
	}
	raw, err := json.Marshal(ContainerService{State: ContainerServiceStateRunning})
	if err != nil || strings.Contains(string(raw), "diagnostic") {
		t.Fatalf("optional diagnostic was not omitted: %s, %v", raw, err)
	}
}

func TestContainerServicePreservesHealthDiagnosticAlongsideManagementGuidance(t *testing.T) {
	runner := &runtimeDiscoveryRunner{outputs: map[string]string{
		"docker context ls --format {{json .}}": `{"Name":"default","Current":true,"DockerEndpoint":"unix:///private/docker.sock"}`,
	}, errors: map[string]error{
		"docker --context default version --format {{json .}}": ErrPermissionDenied,
		"podman system connection list --format json":          ErrCLIUnavailable,
	}}
	client := &CLIClient{Runner: runner, GOOS: "linux", EffectiveUserID: func() int { return 1000 }, UserHomeDir: func() (string, error) { return t.TempDir(), nil }}
	services, err := client.ContainerServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	service := services[0]
	if service.State != ContainerServiceStatePermission {
		t.Fatalf("state = %s", service.State)
	}
	if service.GuidanceCode != ContainerServiceGuidanceHostManager {
		t.Fatalf("management guidance = %s", service.GuidanceCode)
	}
	raw, err := json.Marshal(service)
	if err != nil {
		t.Fatal(err)
	}
	var projected map[string]any
	if err := json.Unmarshal(raw, &projected); err != nil {
		t.Fatal(err)
	}
	diagnostic, ok := projected["diagnostic"].(map[string]any)
	if !ok || diagnostic["code"] != "permission_denied" || diagnostic["phase"] != "health" {
		t.Fatalf("health diagnostic was lost: %s", raw)
	}
}
