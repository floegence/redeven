package managedwebservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/portforward"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestManagedForwardIDIsRouteSafe(t *testing.T) {
	t.Parallel()

	id, err := randomManagedForwardID()
	if err != nil {
		t.Fatal(err)
	}
	if !portforward.IsValidForwardID(id) {
		t.Fatalf("managed forward ID %q is not route safe", id)
	}
}

func newManagedServiceTestScope(t *testing.T) (*filesystemscope.Registry, string) {
	t.Helper()
	home := t.TempDir()
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	return scope, filepath.Join(home, ".redeven", "local-environment", "apps", "managed-web-services")
}

func TestCatalogUsesDedicatedManagedWorkspaceInsteadOfHome(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	manager, err := New(ManagerOptions{
		StateDir: filepath.Join(home, ".redeven", "local-environment"),
		Registry: registry,
		Scope:    scope,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()

	templates, err := manager.Catalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	hostTemplate := templateByID(templates, DeepSeekHarnessHostTemplateID)
	containerTemplate := templateByID(templates, DeepSeekHarnessContainerTemplateID)
	if hostTemplate == nil || containerTemplate == nil {
		t.Fatalf("built-in templates = %+v", templates)
	}
	canonicalHome, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(canonicalHome, "Redeven", "workspaces", "managed-services", DeepSeekHarnessTemplateID)
	if hostTemplate.DefaultWorkspacePath != want || containerTemplate.DefaultWorkspacePath != want {
		t.Fatalf("default workspaces = %q, %q; want %q", hostTemplate.DefaultWorkspacePath, containerTemplate.DefaultWorkspacePath, want)
	}
	if strings.Contains(filepath.Clean(strings.TrimPrefix(want, canonicalHome)), " ") {
		t.Fatalf("generated workspace suffix contains spaces: %q", want)
	}
	if hostTemplate.DefaultWorkspacePath == home {
		t.Fatal("managed service defaulted to the whole home directory")
	}
	info, err := os.Stat(want)
	if err != nil || !info.IsDir() {
		t.Fatalf("dedicated workspace was not prepared: info=%v err=%v", info, err)
	}
}

func TestCatalogMakesReleaseLockedHostRuntimeAvailableWithoutOnlineCatalog(t *testing.T) {
	t.Parallel()
	if (runtime.GOOS != "linux" && runtime.GOOS != "darwin") || (runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64") {
		t.Skip("native managed service is intentionally unavailable on this platform")
	}
	scope, stateDir := newManagedServiceTestScope(t)
	manager := &Manager{
		scope:     scope,
		stateDir:  stateDir,
		downloads: defaultPackageDownloadClient(),
	}
	templates, err := manager.Catalog(context.Background())
	hostTemplate := templateByID(templates, DeepSeekHarnessHostTemplateID)
	if err != nil || len(templates) != 4 || hostTemplate == nil || !hostTemplate.Available || hostTemplate.ReasonCode != "" {
		t.Fatalf("release-locked host availability = %+v, err=%v", templates, err)
	}
	if !hostTemplate.Duplicateable || hostTemplate.Spec == nil || hostTemplate.Spec.Host == nil || hostTemplate.Spec.Host.RuntimeBundle != deepSeekRuntimeBundleID {
		t.Fatalf("release-locked host template = %+v", hostTemplate)
	}
}

func TestCatalogKeepsPinnedDockerTemplateAvailable(t *testing.T) {
	t.Parallel()
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		t.Skip("the built-in Docker template supports amd64 and arm64")
	}
	if runningInsideContainer() {
		t.Skip("nested Docker is intentionally unavailable")
	}
	adapter, err := containerengine.NewAdapter(catalogDockerEngineClient{})
	if err != nil {
		t.Fatal(err)
	}
	scope, stateDir := newManagedServiceTestScope(t)
	manager := &Manager{
		scope:      scope,
		stateDir:   stateDir,
		containers: adapter,
		downloads:  defaultPackageDownloadClient(),
	}

	templates, err := manager.Catalog(context.Background())
	containerTemplate := templateByID(templates, DeepSeekHarnessContainerTemplateID)
	if err != nil || containerTemplate == nil || !containerTemplate.Available || containerTemplate.ReasonCode != "" {
		t.Fatalf("pinned Docker template = %+v, err=%v", containerTemplate, err)
	}
	if containerTemplate.Spec == nil || containerTemplate.Spec.Container == nil || !strings.Contains(containerTemplate.Spec.Container.Image, "@sha256:") {
		t.Fatalf("pinned Docker template spec = %+v", containerTemplate.Spec)
	}
}

func TestDockerInstallUsesPinnedCatalogWithoutOnlineCatalogLookup(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service := pfregistry.ManagedService{
		ServiceID: "mws_pinned_docker", TemplateID: DeepSeekHarnessContainerTemplateID,
		Deployment: string(DeploymentDocker), WorkspacePath: t.TempDir(), Version: DeepSeekHarnessVersion,
		DesiredState: "running", ObservedState: "installing", ForwardID: "pf_pinned_docker", RuntimePort: 3080,
	}
	op := pfregistry.ManagedOperation{
		OperationID: "mop_pinned_docker", ServiceID: service.ServiceID, RequestID: "request-pinned-docker",
		RequestFingerprint: "fingerprint", Action: string(ActionInstall), State: "running", Stage: "environment_check",
	}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}, op); err != nil {
		t.Fatal(err)
	}

	installErr := errors.New("stop after catalog capture")
	driver := &captureInstallCatalogDriver{installErr: installErr}
	manager := &Manager{registry: registry, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	if err := manager.runInstall(context.Background(), &service, &op, driver); !errors.Is(err, installErr) {
		t.Fatalf("runInstall() error = %v", err)
	}
	for _, platform := range []string{"linux-amd64", "linux-arm64"} {
		artifact, ok := driver.catalog.Docker[platform]
		if !ok || artifact.Image != auditedDockerImage || !dockerDigestPattern.MatchString(artifact.Digest) {
			t.Fatalf("captured Docker artifact %s = %+v", platform, artifact)
		}
	}
}

type catalogDockerEngineClient struct{}

type captureInstallCatalogDriver struct {
	catalog    catalogPayload
	installErr error
}

func (d *captureInstallCatalogDriver) Install(_ context.Context, _ *pfregistry.ManagedService, catalog catalogPayload, _ func(string, int64)) (string, string, error) {
	d.catalog = catalog
	return "", "", d.installErr
}

func (*captureInstallCatalogDriver) Start(context.Context, *pfregistry.ManagedService) (string, error) {
	return "", errors.New("unexpected start")
}

func (*captureInstallCatalogDriver) Stop(context.Context, *pfregistry.ManagedService) error {
	return errors.New("unexpected stop")
}

func (*captureInstallCatalogDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool) error {
	return errors.New("unexpected uninstall")
}

func (*captureInstallCatalogDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	return errors.New("unexpected cleanup")
}

func (*captureInstallCatalogDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

func (catalogDockerEngineClient) Status(_ context.Context, engine containerengine.Engine) (containerengine.EngineStatus, error) {
	return containerengine.EngineStatus{Engine: engine, Available: engine == containerengine.EngineDocker, Version: "test"}, nil
}

func (catalogDockerEngineClient) List(context.Context, containerengine.Engine, bool) ([]containerengine.EngineContainer, error) {
	return nil, errors.New("not implemented")
}

func (catalogDockerEngineClient) Inspect(context.Context, containerengine.Engine, string) (containerengine.EngineContainer, error) {
	return containerengine.EngineContainer{}, errors.New("not implemented")
}

func (catalogDockerEngineClient) Action(context.Context, containerengine.EngineActionRequest) (containerengine.EngineActionResult, error) {
	return containerengine.EngineActionResult{}, errors.New("not implemented")
}

func (catalogDockerEngineClient) TailLogs(context.Context, containerengine.EngineLogsRequest) (containerengine.EngineLogsResult, error) {
	return containerengine.EngineLogsResult{}, errors.New("not implemented")
}

func (catalogDockerEngineClient) PullImage(context.Context, containerengine.Engine, string) (containerengine.EngineImageResult, error) {
	return containerengine.EngineImageResult{}, errors.New("not implemented")
}

func templateByID(templates []Template, templateID string) *Template {
	for i := range templates {
		if templates[i].TemplateID == templateID {
			return &templates[i]
		}
	}
	return nil
}

func TestOperateIsIdempotentAndRejectsConcurrentLifecycleChanges(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service := pfregistry.ManagedService{ServiceID: "mws_one", TemplateID: DeepSeekHarnessTemplateID, Deployment: string(DeploymentNative), WorkspacePath: t.TempDir(), Version: DeepSeekHarnessVersion, DesiredState: "running", ObservedState: "running", ForwardID: "pf_one", RuntimePort: 3080}
	if err := registry.CreateManagedService(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}); err != nil {
		t.Fatal(err)
	}
	driver := &blockingStopDriver{started: make(chan struct{})}
	manager := &Manager{registry: registry, native: driver, cancelByOp: map[string]context.CancelFunc{}, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}

	op, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-stop-one", Action: ActionStop})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-driver.started:
	case <-time.After(3 * time.Second):
		t.Fatal("stop operation did not reach driver")
	}

	replayed, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-stop-one", Action: ActionStop})
	if err != nil || replayed.OperationID != op.OperationID {
		t.Fatalf("idempotent replay = %+v, err=%v", replayed, err)
	}
	if _, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-stop-one", Action: ActionRestart}); managedErrorCode(err) != "IDEMPOTENCY_CONFLICT" {
		t.Fatalf("request id payload conflict error = %v", err)
	}
	if _, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-stop-two", Action: ActionRestart}); managedErrorCode(err) != "OPERATION_CONFLICT" {
		t.Fatalf("concurrent operation error = %v", err)
	}

	events, unsubscribe, err := manager.Subscribe(op.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()
	if _, err := manager.Cancel(context.Background(), op.OperationID); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(3 * time.Second)
	for {
		select {
		case event := <-events:
			if event.State == "cancelled" {
				stored, err := manager.Operation(context.Background(), op.OperationID)
				if err != nil || stored.State != "cancelled" || stored.ErrorCode != "OPERATION_CANCELLED" {
					t.Fatalf("stored cancelled operation = %+v, err=%v", stored, err)
				}
				return
			}
		case <-deadline:
			t.Fatal("cancelled terminal event was not published")
		}
	}
}

func TestSubscribeReturnsTerminalSnapshotWithoutWaiting(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	op := pfregistry.ManagedOperation{OperationID: "mop_done", ServiceID: "mws_removed", RequestID: "request-done", RequestFingerprint: "fingerprint", Action: "uninstall", State: "succeeded", Stage: "completed", ProgressCurrent: 7, ProgressTotal: 7}
	if err := registry.CreateManagedOperation(context.Background(), op); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry, cancelByOp: map[string]context.CancelFunc{}, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	events, unsubscribe, err := manager.Subscribe(op.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()
	select {
	case snapshot := <-events:
		if snapshot.State != "succeeded" || snapshot.Stage != "completed" {
			t.Fatalf("terminal snapshot = %+v", snapshot)
		}
	case <-time.After(time.Second):
		t.Fatal("terminal snapshot was not delivered")
	}
}

func TestInterruptedInstallIsCleanedAndWaitsForRetry(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service := pfregistry.ManagedService{ServiceID: "mws_interrupted", TemplateID: DeepSeekHarnessTemplateID, Deployment: string(DeploymentNative), WorkspacePath: t.TempDir(), Version: DeepSeekHarnessVersion, DesiredState: "running", ObservedState: "installing", ForwardID: "pf_interrupted", RuntimeIdentity: "native:mws_interrupted:nonce:99", RuntimePort: 3080}
	op := pfregistry.ManagedOperation{OperationID: "mop_interrupted", ServiceID: service.ServiceID, RequestID: "request-interrupted", RequestFingerprint: "fingerprint", Action: string(ActionInstall), State: "running", Stage: "downloading"}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}, op); err != nil {
		t.Fatal(err)
	}

	manager := &Manager{registry: registry, native: &recoveryDriver{}, cancelByOp: map[string]context.CancelFunc{}, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	views, err := manager.List(context.Background())
	if err != nil || len(views) != 1 || views[0].ActiveOperation == nil || views[0].ActiveOperation.OperationID != op.OperationID {
		t.Fatalf("active operation view = %+v, err=%v", views, err)
	}
	if err := registry.MarkManagedOperationsInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	manager.Start(context.Background())

	updated, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if updated == nil || updated.DesiredState != "stopped" || updated.ObservedState != "error" || updated.LastErrorCode != "OPERATION_INTERRUPTED" || updated.RuntimeIdentity != "" {
		t.Fatalf("interrupted service = %+v", updated)
	}
	driver := manager.native.(*recoveryDriver)
	if driver.cleanupCalls != 1 || driver.startCalls != 0 {
		t.Fatalf("recovery calls: cleanup=%d start=%d", driver.cleanupCalls, driver.startCalls)
	}
}

func TestNativeIdentityParsingAndCredentialRedaction(t *testing.T) {
	t.Parallel()
	if got := nativePIDFromIdentity("native:mws_one:proc_nonce:4242"); got != 4242 {
		t.Fatalf("native PID = %d, want 4242", got)
	}
	for _, invalid := range []string{"", "native:mws_one:4242", "docker:mws_one:proc_nonce:4242", "native:mws_one:proc_nonce:not-a-pid"} {
		if got := nativePIDFromIdentity(invalid); got != 0 {
			t.Fatalf("nativePIDFromIdentity(%q) = %d, want 0", invalid, got)
		}
	}
	redacted := strings.Join([]string{
		redactLogLine("Authorization: Bearer credential-one"),
		redactLogLine(`{"api_key":"credential-two","model":"demo"}`),
		redactLogLine("access-token:credential-three secret = credential-four"),
	}, "\n")
	for _, secret := range []string{"credential-one", "credential-two", "credential-three", "credential-four"} {
		if strings.Contains(redacted, secret) {
			t.Fatalf("redacted log still contains %q: %s", secret, redacted)
		}
	}
}

func TestNativeStopRejectsMismatchedProcessIdentity(t *testing.T) {
	t.Parallel()
	driver := &nativeDriver{processes: map[string]nativeProcess{"mws_one": {identity: "native:mws_one:nonce:123"}}}
	err := driver.Stop(context.Background(), &pfregistry.ManagedService{ServiceID: "mws_one", RuntimeIdentity: "native:mws_one:other:123"})
	if managedErrorCode(err) != "RUNTIME_IDENTITY_MISMATCH" {
		t.Fatalf("identity mismatch error = %v", err)
	}
}

type blockingStopDriver struct {
	once    sync.Once
	started chan struct{}
}

type recoveryDriver struct {
	cleanupCalls int
	startCalls   int
}

func (d *recoveryDriver) Install(context.Context, *pfregistry.ManagedService, catalogPayload, func(string, int64)) (string, string, error) {
	return "", "", errors.New("unexpected install")
}
func (d *recoveryDriver) Start(context.Context, *pfregistry.ManagedService) (string, error) {
	d.startCalls++
	return "", errors.New("unexpected start")
}
func (d *recoveryDriver) Stop(context.Context, *pfregistry.ManagedService) error { return nil }
func (d *recoveryDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool) error {
	return errors.New("unexpected uninstall")
}
func (d *recoveryDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	d.cleanupCalls++
	return nil
}
func (d *recoveryDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

func (d *blockingStopDriver) Install(context.Context, *pfregistry.ManagedService, catalogPayload, func(string, int64)) (string, string, error) {
	return "", "", errors.New("unexpected install")
}
func (d *blockingStopDriver) Start(context.Context, *pfregistry.ManagedService) (string, error) {
	return "", errors.New("unexpected start")
}
func (d *blockingStopDriver) Stop(ctx context.Context, _ *pfregistry.ManagedService) error {
	d.once.Do(func() { close(d.started) })
	<-ctx.Done()
	return ctx.Err()
}
func (d *blockingStopDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool) error {
	return errors.New("unexpected uninstall")
}
func (d *blockingStopDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	return nil
}
func (d *blockingStopDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

func managedErrorCode(err error) string {
	code, _, _, _ := ErrorDetails(err)
	return code
}
