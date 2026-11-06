package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type admissionDriver struct {
	workspaceLifecycleDriver
	installs atomic.Int32
}

func (d *admissionDriver) Install(context.Context, *pfregistry.ManagedService, operationProgress) (string, string, error) {
	d.installs.Add(1)
	return "", "", errors.New("installation must not run before release verification")
}

func admissionFixture(t *testing.T, handler http.HandlerFunc) (*Manager, *pfregistry.Registry, CreateRequest, *admissionDriver) {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	manager, registry, home := newWorkspaceTestManager(t)
	manager.releaseClient = server.Client()
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{NPM: &NPMHostPackageSpec{PackageName: "@example/admission", Version: "1.0.0", RegistryURL: server.URL, Executable: "admission"}, StartScript: "exec true"}}
	raw, digest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.CreateManagedTemplate(context.Background(), pfregistry.ManagedTemplate{TemplateID: "admission-host", Name: "Admission service", Source: "custom", Deployment: "host", Revision: 1, SpecJSON: raw, SpecSHA256: digest, ServiceFamilyID: "admission-host"}); err != nil {
		t.Fatal(err)
	}
	identity := ReleaseIdentity{SchemaVersion: 1, Kind: "npm", Source: "@example/admission", Registry: normalizedRegistryURL(server.URL), Version: "1.0.0", Platform: currentPlatformKey(), Integrity: testNPMIntegrity("reviewed")}
	manager.releaseItems["reviewed-candidate"] = cachedReleaseCandidate{Scope: "template:admission-host", TemplateID: "admission-host", Spec: spec, Identity: identity, ExpiresAt: time.Now().Add(time.Hour), Candidate: ReleaseCandidate{SourceKind: "npm", CandidateID: "reviewed-candidate", Selectable: true, VerificationStatus: "verified"}}
	driver := &admissionDriver{}
	manager.host = driver
	req := CreateRequest{RequestID: "admission-request-one", TemplateID: "admission-host", Deployment: DeploymentHost, WorkspacePath: filepath.Join(home, "admission-workspace"), TargetReleaseID: "reviewed-candidate"}
	plan, err := manager.PreflightInstall(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	req.PlanDigest, req.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
	return manager, registry, req, driver
}

func TestInstallAdmissionReturnsWhileRegistryIsBlocked(t *testing.T) {
	entered, release := make(chan struct{}, 1), make(chan struct{})
	manager, registry, req, driver := admissionFixture(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case entered <- struct{}{}:
		default:
		}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	t.Cleanup(func() { close(release) })
	type outcome struct {
		result *CreateResult
		err    error
	}
	returned := make(chan outcome, 1)
	go func() { v, err := manager.Create(context.Background(), req); returned <- outcome{v, err} }()
	var created *CreateResult
	select {
	case result := <-returned:
		if result.err != nil {
			t.Fatal(result.err)
		}
		created = result.result
	case <-time.After(time.Second):
		t.Fatal("installation admission waited for the Registry before returning a durable operation")
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("background release verification did not start")
	}
	persisted, err := registry.GetManagedOperation(context.Background(), created.Operation.OperationID)
	if err != nil || persisted == nil || persisted.Stage != "release_validation" {
		t.Fatalf("operation=%+v err=%v", persisted, err)
	}
	if driver.installs.Load() != 0 {
		t.Fatal("installation ran before release verification")
	}
	replay := make(chan outcome, 1)
	go func() { v, err := manager.Create(context.Background(), req); replay <- outcome{v, err} }()
	select {
	case result := <-replay:
		if result.err != nil || result.result.Operation.OperationID != created.Operation.OperationID {
			t.Fatalf("replay=%+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("Registry wait held the shared request lock")
	}
	_, err = manager.Cancel(context.Background(), created.Operation.OperationID)
	if err != nil {
		t.Fatal(err)
	}
}

func TestInstallAdmissionKeepsChangedReleaseFailureObservable(t *testing.T) {
	manager, registry, req, driver := admissionFixture(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"versions": map[string]any{"1.0.0": map[string]any{"version": "1.0.0", "dist": map[string]string{"integrity": testNPMIntegrity("changed")}}}})
	})
	created, err := manager.Create(context.Background(), req)
	if err != nil {
		t.Fatalf("release verification must fail inside the accepted operation: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		op, err := registry.GetManagedOperation(context.Background(), created.Operation.OperationID)
		if err != nil {
			t.Fatal(err)
		}
		if op.State == "failed" {
			if op.ErrorCode != "RELEASE_CANDIDATE_CHANGED" {
				t.Fatalf("failure=%+v", op)
			}
			if driver.installs.Load() != 0 {
				t.Fatal("changed release was installed")
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("release verification failure was not persisted")
}

func TestInstallReceiptNeverReplaysAnUnknownRequest(t *testing.T) {
	manager, registry, req, _ := admissionFixture(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) })
	missing, err := manager.InstallRequest(context.Background(), "unknown-install-request")
	if err != nil || missing != nil {
		t.Fatalf("unknown receipt: %+v %v", missing, err)
	}
	services, _ := registry.ListManagedServices(context.Background())
	if len(services) != 0 {
		t.Fatal("receipt query created a service")
	}
	created, err := manager.Create(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := manager.InstallRequest(context.Background(), req.RequestID)
	if err != nil || receipt == nil || receipt.Operation.OperationID != created.Operation.OperationID || receipt.Service.ServiceID != created.Service.ServiceID {
		t.Fatalf("accepted receipt: %+v %v", receipt, err)
	}
	other := req
	other.RequestID = "same-family-other-request"
	other.PlanDigest = ""
	if _, err := manager.Create(context.Background(), other); err == nil {
		t.Fatal("admission duplicated a pending family")
	}
}

type admissionDockerClient struct {
	catalogDockerEngineClient
	entered chan struct{}
}

func (d admissionDockerClient) Status(ctx context.Context, _ containerengine.Engine) (containerengine.EngineStatus, error) {
	select {
	case d.entered <- struct{}{}:
	default:
	}
	<-ctx.Done()
	return containerengine.EngineStatus{}, ctx.Err()
}
func TestInstallAdmissionNeverProbesDockerUnderTheRequestLock(t *testing.T) {
	m, registry, home := newWorkspaceTestManager(t)
	entered := make(chan struct{}, 1)
	adapter, err := containerengine.NewAdapter(admissionDockerClient{entered: entered})
	if err != nil {
		t.Fatal(err)
	}
	m.containers = adapter
	// Compose has no single release verification; the first external check is Docker.
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentCompose, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 8080}, Compose: &ComposeTemplateSpec{MainService: "web", YAML: "services:\n  web:\n    image: example/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"}}
	raw, digest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.CreateManagedTemplate(context.Background(), pfregistry.ManagedTemplate{TemplateID: "admission-compose", Name: "Admission compose", Source: "custom", Deployment: "compose", Revision: 1, SpecJSON: raw, SpecSHA256: digest, ServiceFamilyID: "admission-compose"}); err != nil {
		t.Fatal(err)
	}
	req := CreateRequest{RequestID: "admission-docker", TemplateID: "admission-compose", WorkspacePath: filepath.Join(home, "compose")}
	type result struct {
		created *CreateResult
		err     error
	}
	returned := make(chan result, 1)
	go func() {
		plan, err := m.PreflightInstall(context.Background(), req)
		if err != nil {
			returned <- result{err: err}
			return
		}
		reviewed := req
		reviewed.PlanDigest, reviewed.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
		v, err := m.Create(context.Background(), reviewed)
		req = reviewed
		returned <- result{v, err}
	}()
	var created *CreateResult
	select {
	case v := <-returned:
		if v.err != nil {
			t.Fatal(v.err)
		}
		created = v.created
	case <-time.After(time.Second):
		t.Fatal("admission probed Docker before receipt")
	}
	if !runningInsideContainer() {
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("background Docker check did not start")
		}
	}
	replay := make(chan result, 1)
	go func() { v, err := m.Create(context.Background(), req); replay <- result{v, err} }()
	select {
	case v := <-replay:
		if v.err != nil || v.created.Operation.OperationID != created.Operation.OperationID {
			t.Fatalf("replay: %+v", v)
		}
	case <-time.After(time.Second):
		t.Fatal("Docker check held request lock")
	}
	_, _ = m.Cancel(context.Background(), created.Operation.OperationID)
}
