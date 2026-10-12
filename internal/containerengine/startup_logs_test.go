package containerengine

import (
	"context"
	"strings"
	"testing"
)

func TestInspectPreservesExactLaunchTime(t *testing.T) {
	const started = "2026-10-12T18:45:12.123456789Z"
	raw := `[{"Id":"container_123","Created":"2026-10-01T00:00:00Z","State":{"Running":true,"Status":"running","StartedAt":"` + started + `"}}]`
	container, err := parseContainerInspect(EngineDocker, []byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if container.StartedAt != started || containerInspect(container).StartedAt != started {
		t.Fatal("launch time was lost or rounded")
	}
}

func TestStartupLogsReadWholeCurrentLaunchWithinLimits(t *testing.T) {
	const started = "2026-10-12T18:45:12.123456789Z"
	runner := &resourceOutputStreamRunner{raw: []byte("entrance\n" + strings.Repeat("later\n", 2000))}
	client := &CLIClient{Runner: runner}
	got, err := client.StartupLogs(context.Background(), EngineDocker, "container_123", started)
	if err != nil || !strings.HasPrefix(string(got), "entrance\n") {
		t.Fatalf("current launch output: %v", err)
	}
	if runner.runCalled || len(runner.calls) != 1 || runner.calls[0] != "docker logs --since "+started+" --tail all container_123" {
		t.Fatalf("unsafe or truncated argv: %v", runner.calls)
	}
	runner.raw = []byte(strings.Repeat("x", maxStartupLogLineBytes))
	if _, err := client.StartupLogs(context.Background(), EngineDocker, "container_123", started); err == nil {
		t.Fatal("oversized line accepted")
	}
	if _, err := client.StartupLogs(context.Background(), EngineDocker, "container_123", "invalid"); err == nil {
		t.Fatal("unverified launch accepted")
	}
}
