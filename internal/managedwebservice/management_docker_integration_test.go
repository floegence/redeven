package managedwebservice

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type crashAfterVolumeRemoval struct{ *containerengine.CLIClient }

func (c crashAfterVolumeRemoval) RemoveVolume(ctx context.Context, req containerengine.VolumeRemoveRequest) error {
	if err := c.CLIClient.RemoveVolume(ctx, req); err != nil {
		return err
	}
	// This is a test-process crash after the external mutation and before the
	// transaction can record its result. No additional product executable is used.
	os.Exit(23)
	return nil
}

func openDockerManagementTest(t *testing.T, root string, crash bool) *Manager {
	t.Helper()
	registry, err := pfregistry.Open(filepath.Join(root, "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewDefaultRegistry(root)
	if err != nil {
		t.Fatal(err)
	}
	var client containerengine.EngineClient = containerengine.NewCLIClient()
	if crash {
		client = crashAfterVolumeRemoval{containerengine.NewCLIClient()}
	}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	m, err := New(ManagerOptions{StateDir: filepath.Join(root, "state"), Registry: registry, Scope: scope, Containers: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(); _ = registry.Close() })
	return m
}

func TestManagementDockerInterruptedUninstallProcess(t *testing.T) {
	if root := os.Getenv("REDEVEN_MANAGEMENT_CRASH_ROOT"); root != "" {
		m := openDockerManagementTest(t, root, true)
		service, err := m.registry.GetManagedService(context.Background(), os.Getenv("REDEVEN_MANAGEMENT_CRASH_SERVICE"))
		if err != nil {
			t.Fatal(err)
		}
		op := managementRun(t, m, service, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true, DeleteWorkspace: true})
		t.Fatalf("crash boundary was not reached: %+v", op)
	}
	if os.Getenv("REDEVEN_MANAGEMENT_DOCKER_TEST") != "1" {
		t.Skip("explicit isolated Docker acceptance only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	roots := []string{t.TempDir(), t.TempDir()}
	managers := []*Manager{}
	services := []*pfregistry.ManagedService{}
	volumeNames := map[string]bool{}
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentCompose, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 8080, Path: "/", HealthPath: "/"}, Compose: &ComposeTemplateSpec{MainService: "web", YAML: `services:
  web:
    image: busybox:1.36.1
    read_only: false
    command: [sh, -c, 'mkdir -p /tmp/site; printf ready > /tmp/site/index.html; exec httpd -f -p 8080 -h /tmp/site']
    volumes:
      - first:/data/first
      - second:/data/second
volumes:
  first: {}
  second: {}
`}}
	for _, root := range roots {
		root, err := filepath.EvalSymlinks(root)
		if err != nil {
			t.Fatal(err)
		}
		m := openDockerManagementTest(t, root, false)
		if _, err := m.containers.ListNetworks(ctx, containerengine.EngineDocker); err != nil {
			t.Fatalf("network inventory: %v", err)
		}
		raw, digest, err := canonicalTemplateSpec(spec)
		if err != nil {
			t.Fatal(err)
		}
		template := pfregistry.ManagedTemplate{TemplateID: "management-integration", Name: "Management acceptance", Source: "custom", Deployment: "compose", Revision: 1, ServiceFamilyID: "management-integration", SpecJSON: raw, SpecSHA256: digest}
		if err = m.registry.CreateManagedTemplate(ctx, template); err != nil {
			t.Fatal(err)
		}
		req := CreateRequest{RequestID: "isolated-install", TemplateID: template.TemplateID, Deployment: DeploymentCompose}
		plan, err := m.PreflightInstall(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		req.PlanDigest, req.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
		created, err := m.Create(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		serviceID := created.Service.ServiceID
		// Cleanup is restricted to this test's newly allocated random service ID.
		t.Cleanup(func() { cleanupDockerManagementTest(t, serviceID) })
		m.workers.Wait()
		op, err := m.Operation(ctx, created.Operation.OperationID)
		if err != nil || op.State != "succeeded" {
			failed, _ := m.registry.GetManagedService(ctx, serviceID)
			project, _ := m.containers.InspectComposeDeployment(ctx, m.compose.(*composeTemplateDriver).request(failed))
			for _, child := range project.Containers {
				inspected, _ := m.containers.Inspect(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: child.ContainerID})
				t.Logf("actual mounts=%+v", inspected.Container.Mounts)
			}
			resources, _ := m.registry.ListManagedServiceResources(ctx, serviceID)
			t.Logf("resource inventory=%+v", resources)
			t.Fatalf("install failed: %+v %v", op, err)
		}
		service, err := m.registry.GetManagedService(ctx, serviceID)
		if err != nil {
			t.Fatal(err)
		}
		facts, err := m.inspectService(ctx, service, true)
		if err != nil {
			t.Fatal(err)
		}
		volumes, networks := 0, 0
		for _, item := range facts.Resources {
			if item.Kind == "volume" {
				volumes++
				if volumeNames[item.Identity] {
					t.Fatal("separate state directories shared a volume")
				}
				volumeNames[item.Identity] = true
			}
			if item.Kind == "network" {
				networks++
				if item.Ownership != "owned" {
					t.Fatalf("network ownership not persisted: %+v", item)
				}
			}
		}
		if volumes != 2 || networks != 1 {
			t.Fatalf("incomplete resource inventory: %+v", facts)
		}
		response, err := (&http.Client{Timeout: 5 * time.Second}).Get(fmt.Sprintf("http://127.0.0.1:%d/", service.RuntimePort))
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil || string(body) != "ready" {
			t.Fatalf("business response: %q %v", body, readErr)
		}
		managers = append(managers, m)
		services = append(services, service)
	}
	if services[0].WorkspacePath == services[1].WorkspacePath {
		t.Fatal("state directories shared the default workspace")
	}
	m, service := managers[0], services[0]
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	if err := m.registry.Close(); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestManagementDockerInterruptedUninstallProcess$", "-test.count=1")
	command.Env = append(os.Environ(), "REDEVEN_MANAGEMENT_CRASH_ROOT="+roots[0], "REDEVEN_MANAGEMENT_CRASH_SERVICE="+service.ServiceID)
	output, err := command.CombinedOutput()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 23 {
		t.Fatalf("unexpected child exit: %v %s", err, output)
	}
	recovered := openDockerManagementTest(t, roots[0], false)
	stored, err := recovered.registry.GetManagedService(ctx, service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if !pendingUninstall(stored) {
		t.Fatal("process crash lost the uninstall transaction")
	}
	op := managementRun(t, recovered, stored, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true, DeleteWorkspace: true})
	if op.State != "succeeded" {
		t.Fatalf("resume failed: %+v", op)
	}
	record, err := recovered.registry.GetManagedService(ctx, service.ServiceID)
	if err != nil || record != nil {
		t.Fatalf("completed cleanup left an active service: %+v %v", record, err)
	}
	// The second isolated instance must continue serving while the first is removed.
	response, err := (&http.Client{Timeout: 5 * time.Second}).Get(fmt.Sprintf("http://127.0.0.1:%d/", services[1].RuntimePort))
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	op = managementRun(t, managers[1], services[1], ManagementPlanRequest{Action: ActionUninstall, DeleteData: true, DeleteWorkspace: true})
	if op.State != "succeeded" {
		t.Fatalf("second uninstall failed: %+v", op)
	}
}

func cleanupDockerManagementTest(t *testing.T, serviceID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	run := func(args ...string) []byte {
		out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
		if err != nil {
			t.Logf("isolated cleanup %s: %v", args[0], err)
		}
		return out
	}
	filter := "label=" + managedServiceLabel + "=" + serviceID
	for _, id := range strings.Fields(string(run("ps", "-aq", "--filter", filter))) {
		run("rm", "-f", id)
	}
	for _, id := range strings.Fields(string(run("network", "ls", "-q", "--filter", filter))) {
		run("network", "rm", id)
	}
	for _, name := range strings.Fields(string(run("volume", "ls", "-q", "--filter", filter))) {
		run("volume", "rm", name)
	}
}
