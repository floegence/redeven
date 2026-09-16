package managedwebservice

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// This opt-in acceptance uses a released catalog and registry-verified releases.
// Every application, volume, workspace and Registry belongs to this test.
func TestManagedContainerDockerLifecycle(t *testing.T) {
	if os.Getenv("REDEVEN_MANAGED_CONTAINER_DOCKER_TEST") != "1" {
		t.Skip("explicit isolated container acceptance only")
	}
	templateID, tag := os.Getenv("REDEVEN_MANAGED_CONTAINER_TEMPLATE"), os.Getenv("REDEVEN_MANAGED_CONTAINER_TAG")
	if templateID == "" || tag == "" {
		t.Fatal("an exact released container template and target tag are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	// Docker Desktop workspaces use the user's shared home. macOS's /private
	// temporary root is intentionally redacted by the public Inspect surface.
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp(home, ".redeven-container-acceptance-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(root); err != nil {
			t.Errorf("remove isolated state: %v", err)
		}
	})
	m := openDockerManagementTest(t, root, false)
	template, err := m.Template(ctx, templateID)
	if err != nil || template.Spec == nil || template.Spec.Container == nil {
		t.Fatalf("released template unavailable: %v", err)
	}
	candidateID := dockerLifecycleCandidate(t, ctx, m, template, "template:"+templateID, tag, nil)
	request := CreateRequest{RequestID: "docker-lifecycle-install", TemplateID: templateID, Deployment: DeploymentContainer, TargetReleaseID: candidateID}
	plan, err := m.PreflightInstall(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	request.PlanDigest, request.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
	created, err := m.Create(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	serviceID := created.Service.ServiceID
	t.Cleanup(func() {
		defer func() { _ = m.Close(); _ = m.registry.Close() }()
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cleanupCancel()
		service, readErr := m.registry.GetManagedService(cleanupCtx, serviceID)
		if readErr != nil || service == nil {
			t.Errorf("read test service for cleanup: %v", readErr)
			return
		}
		plan, planErr := m.PreflightManagement(cleanupCtx, serviceID, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true, DeleteWorkspace: true})
		if planErr != nil || len(plan.Blockers) > 0 {
			t.Errorf("test cleanup preflight: %+v, %v", plan, planErr)
			return
		}
		op, runErr := m.Operate(cleanupCtx, serviceID, OperationRequest{RequestID: "docker-lifecycle-cleanup", Action: ActionUninstall, PlanDigest: plan.PlanDigest, DeleteData: true, DeleteWorkspace: true, Administrator: true})
		if runErr != nil {
			t.Errorf("test cleanup: %v", runErr)
			return
		}
		m.workers.Wait()
		op, runErr = m.Operation(cleanupCtx, op.OperationID)
		if runErr != nil || op.State != "succeeded" {
			t.Errorf("test cleanup result: %+v, %v", op, runErr)
		}
	})
	dockerLifecycleOperation(t, ctx, m, &created.Operation)
	service := dockerLifecycleService(t, ctx, m, serviceID)
	t.Logf("isolated runtime pid=%d service=%s port=%d state=%s image=%s", os.Getpid(), serviceID, service.RuntimePort, root, service.ArtifactReference)
	if expected := os.Getenv("REDEVEN_MANAGED_CONTAINER_DIGEST"); expected != "" && imageReferenceDigest(service.ArtifactReference) != expected {
		t.Fatal("the verified release digest differs from the requested acceptance image")
	}
	dockerLifecycleHealthy(t, ctx, m, service)
	resources, err := m.registry.ListManagedServiceResources(ctx, serviceID)
	if err != nil {
		t.Fatal(err)
	}
	volumes := []pfregistry.ManagedServiceResource{}
	for _, resource := range resources {
		if resource.Kind == "volume" {
			volumes = append(volumes, resource)
		}
	}
	if len(volumes) == 0 {
		t.Fatal("acceptance requires a template with retained data")
	}
	resolved, err := m.resolveCurrentRuntime(ctx, service)
	if err != nil {
		t.Fatal(err)
	}
	dataTarget := ""
	for _, mount := range resolved.Spec.Container.Mounts {
		if mount.Type == "volume" && mount.ResourceID == volumes[0].ResourceID {
			dataTarget = mount.Target
		}
	}
	if dataTarget == "" {
		t.Fatal("retained data mount not found")
	}
	marker := filepath.Join(dataTarget, "redeven-lifecycle-evidence")
	dockerLifecycleExec(t, ctx, service.RuntimeIdentity, "sh", "-c", `printf preserved > "$1"`, "test", marker)
	workspaceMarker := filepath.Join(service.WorkspacePath, "redeven-lifecycle-evidence")
	if err := os.WriteFile(workspaceMarker, []byte("workspace preserved"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, action := range []OperationAction{ActionStop, ActionStart, ActionRestart} {
		op, err := m.Operate(ctx, serviceID, OperationRequest{RequestID: "docker-lifecycle-" + string(action), Action: action})
		if err != nil {
			t.Fatal(err)
		}
		dockerLifecycleOperation(t, ctx, m, op)
	}
	// Simulate an externally removed runtime while retaining the exact data.
	service = dockerLifecycleService(t, ctx, m, serviceID)
	if err := m.container.(*containerTemplateDriver).RemoveRuntime(ctx, service); err != nil {
		t.Fatal(err)
	}
	planRecovery, err := m.PreflightManagement(ctx, serviceID, ManagementPlanRequest{Action: ActionRecover})
	if err != nil || len(planRecovery.Blockers) > 0 {
		t.Fatalf("recovery plan: %+v, %v", planRecovery, err)
	}
	op, err := m.Operate(ctx, serviceID, OperationRequest{RequestID: "docker-lifecycle-recovery", Action: ActionRecover, PlanDigest: planRecovery.PlanDigest, Administrator: true})
	if err != nil {
		t.Fatal(err)
	}
	dockerLifecycleOperation(t, ctx, m, op)
	service = dockerLifecycleService(t, ctx, m, serviceID)
	dockerLifecycleHealthy(t, ctx, m, service)
	if output := dockerLifecycleExec(t, ctx, service.RuntimeIdentity, "cat", marker); output != "preserved" {
		t.Fatalf("recovery lost retained data: %q", output)
	}
	// Use another verified version for a successful update and force one
	// post-creation health failure to exercise the real rollback driver.
	if otherTag := os.Getenv("REDEVEN_MANAGED_CONTAINER_UPDATE_TAG"); otherTag != "" {
		for attempt, targetTag := range []string{otherTag, tag} {
			stop, err := m.Operate(ctx, serviceID, OperationRequest{RequestID: fmt.Sprintf("docker-update-stop-%d", attempt), Action: ActionStop})
			if err != nil {
				t.Fatal(err)
			}
			dockerLifecycleOperation(t, ctx, m, stop)
			service = dockerLifecycleService(t, ctx, m, serviceID)
			current, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
			if err != nil {
				t.Fatal(err)
			}
			candidate := dockerLifecycleCandidate(t, ctx, m, template, "service:"+serviceID, targetTag, current)
			update, err := m.CreateUpdatePlan(ctx, serviceID, UpdatePlanRequest{TargetCandidateID: candidate})
			if err != nil {
				t.Fatal(err)
			}
			if attempt == 1 {
				m.healthCheck = func(context.Context, *pfregistry.ManagedService) error {
					return errors.New("injected target health failure")
				}
			}
			op, err := m.Operate(ctx, serviceID, OperationRequest{RequestID: fmt.Sprintf("docker-update-%d", attempt), Action: ActionUpdate, UpdatePlanID: update.UpdatePlanID})
			if err != nil {
				t.Fatal(err)
			}
			m.workers.Wait()
			m.healthCheck = nil
			op, err = m.Operation(ctx, op.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			if attempt == 0 {
				dockerLifecycleOperation(t, ctx, m, op)
			} else if op.State != "failed" || op.ErrorCode != "HEALTH_CHECK_FAILED" {
				t.Fatalf("update must restore the old runtime after health failure: %+v", op)
			} else {
				t.Log("target health failure rolled back to the previous release")
			}
			service = dockerLifecycleService(t, ctx, m, serviceID)
			if service.RuntimeManifestJSON != "{}" || (attempt == 1 && service.ReleaseIdentityJSON != mustReleaseJSON(t, *current)) {
				t.Fatal("update left a pending journal or lost the old release")
			}
		}
		op, err := m.Operate(ctx, serviceID, OperationRequest{RequestID: "docker-after-rollback-start", Action: ActionStart})
		if err != nil {
			t.Fatal(err)
		}
		dockerLifecycleOperation(t, ctx, m, op)
	}
	// Reopen the product owner; container identity and retained resources survive.
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	if err := m.registry.Close(); err != nil {
		t.Fatal(err)
	}
	registry, err := pfregistry.Open(filepath.Join(root, "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := New(ManagerOptions{StateDir: filepath.Join(root, "state"), Registry: registry, Scope: m.scope, Containers: m.containers})
	if err != nil {
		_ = registry.Close()
		t.Fatal(err)
	}
	m = reopened
	service = dockerLifecycleService(t, ctx, m, serviceID)
	dockerLifecycleHealthy(t, ctx, m, service)
	after, err := m.registry.ListManagedServiceResources(ctx, serviceID)
	if err != nil {
		t.Fatal(err)
	}
	for _, volume := range volumes {
		found := false
		for _, resource := range after {
			found = found || reflect.DeepEqual(volume, resource)
		}
		if !found {
			t.Fatal("lifecycle changed retained volume identity")
		}
	}
	if output := dockerLifecycleExec(t, ctx, service.RuntimeIdentity, "cat", marker); output != "preserved" {
		t.Fatal("lifecycle lost retained data")
	}
	if data, err := os.ReadFile(workspaceMarker); err != nil || string(data) != "workspace preserved" {
		t.Fatal("lifecycle changed workspace data")
	}
	t.Log("runtime owner restart preserved volume identities, volume data and workspace data")
}

func mustReleaseJSON(t *testing.T, identity ReleaseIdentity) string {
	t.Helper()
	raw, _, err := canonicalReleaseIdentity(identity)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func dockerLifecycleCandidate(t *testing.T, ctx context.Context, m *Manager, template *Template, scope, tag string, current *ReleaseIdentity) string {
	t.Helper()
	browse := releaseBrowseContext{Scope: scope, TemplateID: template.TemplateID, Spec: *template.Spec, TemplateSource: template.Source, Current: current}
	items, err := m.verifyOCIReleaseTags(ctx, browse.Spec, []string{tag})
	if err != nil || len(items) != 1 || !items[0].Compatible {
		t.Fatalf("verify release %s: %+v, %v", tag, items, err)
	}
	candidate := verifiedOCIReleaseCandidate(browse, pendingOCIReleaseCandidate(browse, tag), items[0])
	view, err := m.replaceReleaseView(ctx, browse, []cachedReleaseCandidate{candidate}, "complete", "")
	if err != nil || len(view.Candidates) != 1 {
		t.Fatalf("release selection: %+v, %v", view, err)
	}
	return view.Candidates[0].CandidateID
}

func dockerLifecycleService(t *testing.T, ctx context.Context, m *Manager, id string) *pfregistry.ManagedService {
	t.Helper()
	service, err := m.registry.GetManagedService(ctx, id)
	if err != nil || service == nil {
		t.Fatalf("service: %v", err)
	}
	return service
}

func dockerLifecycleOperation(t *testing.T, ctx context.Context, m *Manager, op *pfregistry.ManagedOperation) {
	t.Helper()
	m.workers.Wait()
	stored, err := m.Operation(ctx, op.OperationID)
	if err != nil || stored.State != "succeeded" {
		t.Fatalf("operation: %+v, %v", stored, err)
	}
	t.Logf("%s succeeded (%d/%d)", stored.Action, stored.ProgressCurrent, stored.ProgressTotal)
}

func dockerLifecycleHealthy(t *testing.T, ctx context.Context, m *Manager, service *pfregistry.ManagedService) {
	t.Helper()
	if err := m.waitHealthy(ctx, service); err != nil {
		t.Fatal(err)
	}
	opened, err := m.OpenSession(ctx, service.ServiceID, OpenSessionRequest{RequestID: "docker-lifecycle-open"})
	if err != nil || opened.State != "ready" {
		t.Fatalf("opening: %+v, %v", opened, err)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := (&http.Client{Timeout: 10 * time.Second, Jar: jar}).Get(fmt.Sprintf("http://127.0.0.1:%d%s", service.RuntimePort, opened.AppPath))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024))
	if err != nil || response.StatusCode != http.StatusOK || !strings.Contains(strings.ToLower(string(body)), "<html") {
		t.Errorf("application UI not available through the resolved opening: HTTP %d, %v", response.StatusCode, err)
	}
}

func dockerLifecycleExec(t *testing.T, ctx context.Context, id string, args ...string) string {
	t.Helper()
	output, err := exec.CommandContext(ctx, "docker", append([]string{"exec", id}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("isolated data assertion: %v, %s", err, output)
	}
	return string(output)
}
