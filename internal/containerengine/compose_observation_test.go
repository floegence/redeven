package containerengine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestComposeObservationDoesNotRequireConfigurationFiles(t *testing.T) {
	t.Parallel()
	raw := `{"ID":"full-mysql-id","Name":"mysql-db-1","Project":"mysql","Service":"db","State":"running","Status":"Up (healthy)"}
{"ID":"full-web-2-id","Name":"deps-web-2","Project":"deps","Service":"web","State":"running","Status":"Up"}
{"ID":"full-job-id","Name":"deps-job","Project":"deps","Service":"job","State":"exited","Status":"Exited (0)"}
{"ID":"full-web-1-id","Name":"deps-web-1","Project":"deps","Service":"web","State":"running","Status":"Up"}`
	calls := 0
	client := &CLIClient{Runner: CommandRunnerFunc(func(_ context.Context, name string, args ...string) ([]byte, error) {
		command := name + " " + strings.Join(args, " ")
		if !strings.HasPrefix(command, "docker --context production ps -a --no-trunc --filter label=com.docker.compose.project --format ") {
			return nil, errors.New("observation must only query labeled containers in the bound context")
		}
		calls++
		return []byte(raw), nil
	})}
	ctx := context.WithValue(context.Background(), endpointContextKey{}, boundEngineEndpoint{engine: EngineDocker, name: "production", useConnection: true})
	projects, err := client.ListComposeProjects(ctx)
	if err != nil || len(projects) != 2 {
		t.Fatalf("projects = %+v, err = %v", projects, err)
	}
	if calls != 1 || projects[0].Name != "deps" || projects[0].ContainerCount != 3 || projects[0].RunningCount != 2 || projects[0].ServiceCount != 2 || projects[0].Status != "degraded" {
		t.Fatalf("projects = %+v, calls = %d", projects, calls)
	}
	details, err := client.InspectComposeProject(ctx, projects[0].ProjectID)
	if err != nil || details.ComposeProject != projects[0] || len(details.Containers) != 3 || details.Containers[1].ContainerID != "full-web-1-id" {
		t.Fatalf("details = %+v, err = %v", details, err)
	}
	deployment, err := client.InspectComposeDeployment(ctx, ComposeDeploymentRequest{
		ProjectName: "deps", ConfigPath: filepath.Join(t.TempDir(), "missing.yaml"),
	})
	if err != nil || deployment.ComposeProject != details.ComposeProject || len(deployment.Containers) != 3 {
		t.Fatalf("deployment = %+v, err = %v", deployment, err)
	}
	if projects[1].RunningCount != 1 || projects[1].Status != "running" {
		t.Fatalf("mysql = %+v", projects[1])
	}
}

func TestComposeObservationStatesAndEmptyDefinitions(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name    string
		states  []string
		status  string
		running int
	}{
		{"empty", nil, "stopped", 0},
		{"running", []string{"running", "running"}, "running", 2},
		{"paused", []string{"paused", "paused"}, "paused", 0},
		{"stopped", []string{"created", "exited", "dead", "stopped"}, "stopped", 0},
		{"partial", []string{"running", "exited"}, "degraded", 1},
		{"restarting", []string{"restarting"}, "degraded", 0},
		{"removing", []string{"removing"}, "degraded", 0},
		{"unknown", []string{"running", "unexpected"}, "unknown", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows := []map[string]string{}
			for i, state := range tc.states {
				rows = append(rows, map[string]string{"ID": fmt.Sprint(i), "Project": "app", "State": state})
			}
			raw, _ := json.Marshal(rows)
			client := &CLIClient{Runner: CommandRunnerFunc(func(context.Context, string, ...string) ([]byte, error) { return raw, nil })}
			ctx := context.WithValue(context.Background(), endpointContextKey{}, boundEngineEndpoint{engine: EngineDocker})
			definition := ComposeDeploymentRequest{ProjectName: "app", ConfigPath: filepath.Join(t.TempDir(), "missing.yaml")}
			details, err := client.InspectComposeDeployment(ctx, definition)
			if err != nil || details.Status != tc.status || details.RunningCount != tc.running || details.ContainerCount != len(tc.states) || details.ServiceCount != 0 || details.Containers == nil {
				t.Fatalf("details = %+v, err = %v", details, err)
			}
			_, err = client.InspectComposeProject(ctx, ComposeProjectID("absent"))
			if !errors.Is(err, ErrComposeProjectNotFound) {
				t.Fatalf("absent project error = %v", err)
			}
		})
	}
}

func TestComposeObservationPropagatesFailures(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, raw string
		err       error
	}{
		{name: "unreachable", err: ErrBackendUnreachable},
		{name: "timeout", err: context.DeadlineExceeded},
		{name: "permission", err: ErrPermissionDenied},
		{name: "invalid JSON", raw: "{"},
		{name: "missing identity", raw: `[{"Project":"app"}]`},
		{name: "duplicate identity", raw: `[{"ID":"1","Project":"app"},{"ID":"1","Project":"app"}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &CLIClient{Runner: CommandRunnerFunc(func(context.Context, string, ...string) ([]byte, error) { return []byte(tc.raw), tc.err })}
			ctx := context.WithValue(context.Background(), endpointContextKey{}, boundEngineEndpoint{engine: EngineDocker})
			if _, err := client.ListComposeProjects(ctx); err == nil {
				t.Fatal("inventory failure must not return an empty list")
			}
			if _, err := client.InspectComposeProject(ctx, ComposeProjectID("app")); err == nil || errors.Is(err, ErrComposeProjectNotFound) {
				t.Fatalf("inspection error = %v", err)
			}
			if _, err := client.InspectComposeDeployment(ctx, ComposeDeploymentRequest{ProjectName: "app", ConfigPath: "/missing.yaml"}); err == nil {
				t.Fatal("deployment failure must not return zero members")
			}
		})
	}
}
