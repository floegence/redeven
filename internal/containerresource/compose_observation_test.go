package containerresource

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
)

func TestComposeInventoryUsesOneObservationForSavedAndDiscoveredProjects(t *testing.T) {
	ctx := context.Background()
	observation := `[{"ID":"api-1","Name":"api-1","Project":"api","Service":"web","State":"running"}]`
	var observationErr error
	reads := 0
	client := &containerengine.CLIClient{Runner: containerengine.CommandRunnerFunc(func(_ context.Context, name string, args ...string) ([]byte, error) {
		command := name + " " + strings.Join(args, " ")
		if strings.HasSuffix(command, " context ls --format {{json .}}") {
			return []byte(`{"Name":"default","Current":true}`), nil
		}
		if strings.HasPrefix(command, "docker --context default ps -a --no-trunc --filter label=com.docker.compose.project --format ") {
			reads++
			return []byte(observation), observationErr
		}
		return nil, errors.New("unexpected engine command")
	})}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	endpoints, err := adapter.ListEndpoints(ctx, containerengine.EndpointListRequest{Engine: containerengine.EngineDocker})
	if err != nil {
		t.Fatal(err)
	}
	endpoint := endpoints.Endpoints[0].EndpointID
	service, err := Open(Options{DatabasePath: filepath.Join(t.TempDir(), "resources.db"), Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { service.Close() })
	for _, name := range []string{"api", "empty"} {
		_, err := service.store.createComposeProjectDefinition(ctx, ComposeProjectDefinition{
			ProjectID: "compose_saved_" + name, Engine: containerengine.EngineDocker, EndpointID: endpoint,
			Name: name, ConfigPaths: []string{filepath.Join(t.TempDir(), "missing.yaml")}, CreatedAtUnixMs: 1, UpdatedAtUnixMs: 1,
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	req := containerengine.ComposeProjectListRequest{Engine: containerengine.EngineDocker, EndpointID: endpoint}
	items, err := service.ComposeProjects(ctx, req)
	if err != nil || reads != 1 || len(items) != 2 || !items[0].Saved || items[0].ProjectID != "compose_saved_api" || items[0].RunningCount != 1 || items[1].Status != "stopped" || items[1].ContainerCount != 0 {
		t.Fatalf("items = %+v, reads = %d, err = %v", items, reads, err)
	}
	projectReq := containerengine.ComposeProjectRequest{Engine: req.Engine, EndpointID: endpoint, ProjectID: "compose_saved_api"}
	details, _, err := service.ComposeProject(ctx, projectReq)
	if err != nil || details.RunningCount != 1 || len(details.Containers) != 1 {
		t.Fatalf("details = %+v, err = %v", details, err)
	}
	_, err = adapter.ComposeProjectPreflight(ctx, containerengine.MethodComposeProjectsStart, containerengine.ComposeProjectRequest{
		Engine: req.Engine, EndpointID: endpoint, ProjectID: "compose_saved_api",
		Deployment: &containerengine.ComposeDeploymentRequest{ProjectName: "api", ConfigPath: "/missing.yaml"},
	})
	if !errors.Is(err, containerengine.ErrComposeConfigurationUnavailable) {
		t.Fatalf("missing configuration error = %v", err)
	}
	observationErr = containerengine.ErrPermissionDenied
	if _, err := service.ComposeProjects(ctx, req); !errors.Is(err, observationErr) {
		t.Fatalf("inventory failure = %v", err)
	}
	if _, _, err := service.ComposeProject(ctx, projectReq); !errors.Is(err, observationErr) {
		t.Fatalf("detail failure = %v", err)
	}

	decoded := decodedMutation{request: &containerengine.ComposeProjectRequest{Engine: req.Engine, EndpointID: endpoint, ProjectID: containerengine.ComposeProjectID("api")}, preflight: Preflight{Method: containerengine.MethodComposeProjectsDown, Engine: req.Engine, EndpointID: endpoint, ResourceKind: ResourceComposeProject}}
	reads = 0
	if _, err := service.reconcile(ctx, decoded, executionResult{}); !errors.Is(err, observationErr) || reads != 1 {
		t.Fatalf("failed observation was not preserved: reads=%d, err=%v", reads, err)
	}
	observation, observationErr = "[]", nil
	evidence, err := service.reconcile(ctx, decoded, executionResult{})
	if err != nil || !strings.Contains(string(evidence), `"outcome":"absent"`) {
		t.Fatalf("absence evidence = %s, err = %v", evidence, err)
	}
}
