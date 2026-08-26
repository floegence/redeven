package managedwebservice

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const operationProgressTotal = 7

type ManagerOptions struct {
	Logger     *slog.Logger
	StateDir   string
	Registry   *pfregistry.Registry
	Scope      *filesystemscope.Registry
	Containers *containers.Adapter
}

type Manager struct {
	log        *slog.Logger
	stateDir   string
	registry   *pfregistry.Registry
	scope      *filesystemscope.Registry
	containers *containers.Adapter
	catalog    *catalogClient
	native     deploymentDriver
	docker     deploymentDriver
	host       deploymentDriver
	container  deploymentDriver
	compose    deploymentDriver

	requestMu    sync.Mutex
	mu           sync.Mutex
	workers      sync.WaitGroup
	cancelByOp   map[string]context.CancelFunc
	listeners    map[string]map[uint64]chan pfregistry.ManagedOperation
	nextListener uint64
	closed       bool
}

func New(opts ManagerOptions) (*Manager, error) {
	if opts.Registry == nil {
		return nil, errors.New("managed web service registry is required")
	}
	if opts.Scope == nil {
		return nil, errors.New("filesystem scope is required")
	}
	stateDir := strings.TrimSpace(opts.StateDir)
	if stateDir == "" {
		return nil, errors.New("state directory is required")
	}
	root := filepath.Join(stateDir, "apps", "managed-web-services")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	m := &Manager{log: logger, stateDir: root, registry: opts.Registry, scope: opts.Scope, containers: opts.Containers, catalog: defaultCatalogClient(), cancelByOp: map[string]context.CancelFunc{}, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	m.native = &nativeDriver{log: logger, stateDir: root, client: m.catalog.packageHTTPClient()}
	m.docker = &dockerDriver{adapter: opts.Containers, stateDir: root}
	m.host = &hostScriptDriver{manager: m, processes: map[string]nativeProcess{}}
	m.container = &containerTemplateDriver{manager: m, adapter: opts.Containers}
	m.compose = &composeTemplateDriver{manager: m, adapter: opts.Containers}
	if err := m.registry.MarkManagedOperationsInterrupted(context.Background()); err != nil {
		return nil, err
	}
	_ = os.RemoveAll(filepath.Join(root, ".staging"))
	return m, nil
}

func (m *Manager) Start(ctx context.Context) {
	services, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		m.log.Error("list managed services for recovery", "error", err)
		return
	}
	for _, service := range services {
		latest, latestErr := m.registry.GetLatestManagedOperation(ctx, service.ServiceID)
		if latestErr != nil {
			m.log.Error("read managed Web Service recovery operation", "service_id", service.ServiceID, "error", latestErr)
			continue
		}
		if latest != nil && latest.State == "interrupted" {
			m.reconcileInterruptedService(&service, *latest)
			continue
		}
		if service.DesiredState != "running" {
			continue
		}
		requestID := "runtime-recovery-" + service.ServiceID + "-" + fmt.Sprint(time.Now().UnixMilli())
		_, _ = m.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: requestID, Action: ActionStart})
	}
}

func (m *Manager) Close() error {
	m.mu.Lock()
	m.closed = true
	cancels := make([]context.CancelFunc, 0, len(m.cancelByOp))
	for _, cancel := range m.cancelByOp {
		cancels = append(cancels, cancel)
	}
	m.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	m.workers.Wait()
	services, _ := m.registry.ListManagedServices(context.Background())
	for i := range services {
		if services[i].ObservedState == "running" {
			driver := m.driver(Deployment(services[i].Deployment))
			if driver == nil {
				m.log.Warn("skip invalid managed Web Service deployment during runtime shutdown", "service_id", services[i].ServiceID, "deployment", services[i].Deployment)
				continue
			}
			if err := driver.Stop(context.Background(), &services[i]); err != nil {
				m.log.Warn("stop managed Web Service during runtime shutdown", "service_id", services[i].ServiceID, "error", err)
				continue
			}
			stopped := "stopped"
			_ = m.registry.UpdateManagedService(context.Background(), services[i].ServiceID, pfregistry.ManagedServicePatch{ObservedState: &stopped})
		}
	}
	return nil
}

func (m *Manager) Catalog(ctx context.Context) ([]Template, error) {
	nativeAvailable := (runtime.GOOS == "linux" || runtime.GOOS == "darwin") && (runtime.GOARCH == "amd64" || runtime.GOARCH == "arm64")
	nativeReasonCode, nativeReason := "", ""
	if !nativeAvailable {
		nativeReasonCode, nativeReason = "PLATFORM_UNSUPPORTED", "Direct installation supports Linux and macOS on x64 or arm64."
	}
	dockerAvailable, dockerReasonCode, dockerReason := m.dockerAvailability(ctx)
	catalogCtx, cancelCatalog := context.WithTimeout(ctx, 4*time.Second)
	payload, catalogErr := m.catalog.resolve(catalogCtx)
	cancelCatalog()
	if catalogErr != nil {
		code, _, _, _ := ErrorDetails(catalogErr)
		reasonCode, reason := "CATALOG_UNAVAILABLE", "The audited managed-service catalog is not currently available."
		if code == "CATALOG_TRUST_UNAVAILABLE" {
			reasonCode, reason = code, "This build has no audited managed-service catalog trust anchor."
		}
		if nativeAvailable {
			nativeAvailable, nativeReasonCode, nativeReason = false, reasonCode, reason
		}
		if dockerAvailable {
			dockerAvailable, dockerReasonCode, dockerReason = false, reasonCode, reason
		}
	} else {
		if nativeAvailable {
			artifact, ok := payload.Platforms[currentPlatformKey()]
			if !ok || validateNativeArtifact(artifact, m.catalog.packageHTTPClient(), m.catalog.packageOrigin) != nil {
				nativeAvailable, nativeReasonCode, nativeReason = false, "CATALOG_UNAVAILABLE", "The audited catalog does not include a usable native package for this Environment."
			}
		}
		if dockerAvailable {
			artifact, ok := payload.Docker["linux-"+runtime.GOARCH]
			if !ok || artifact.Image != auditedDockerImage || !dockerDigestPattern.MatchString(strings.TrimSpace(artifact.Digest)) {
				dockerAvailable, dockerReasonCode, dockerReason = false, "CATALOG_UNAVAILABLE", "The audited catalog does not include a usable Docker image for this Environment."
			}
		}
	}
	workspaceRoots := m.workspaceRoots()
	hostSpec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http", Path: "/", HealthPath: "/", StartupTimeout: 45}, Host: &HostTemplateSpec{StartScript: `exec "$REDEVEN_INSTALL_EXECUTABLE" web --host "$REDEVEN_SERVICE_HOST" --port "$REDEVEN_SERVICE_PORT"`}}
	containerSpec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Endpoint: WebEndpointSpec{Scheme: "http", ContainerPort: 3080, Path: "/", HealthPath: "/", StartupTimeout: 45}, Container: &ContainerTemplateSpec{Image: auditedDockerImage, Environment: map[string]string{"DSH_DESKTOP_ENABLED": "0", "DSH_HOME": "/home/node/.dsh", "HOME": "/workspace"}, Mounts: []ContainerMountSpec{{Type: "volume", Source: "data", Target: "/home/node/.dsh"}, {Type: "workspace", Target: "/workspace"}, {Type: "tmpfs", Target: "/tmp"}}, User: "1000:1000", ReadOnlyRoot: true, PIDsLimit: 512}}
	if catalogErr == nil {
		if artifact, ok := payload.Platforms[currentPlatformKey()]; ok {
			hostSpec.Host.Artifact = &HostArtifactSpec{DownloadURL: artifact.DownloadURL, SizeBytes: artifact.SizeBytes, SHA256: artifact.SHA256, ExecutableRelPath: artifact.ExecutableRelPath}
		}
		if artifact, ok := payload.Docker["linux-"+runtime.GOARCH]; ok {
			containerSpec.Container.Image = artifact.Image + "@" + artifact.Digest
		}
	}
	items := []Template{
		{TemplateID: DeepSeekHarnessHostTemplateID, Name: "DeepSeek Harness · Host", Description: "Run DeepSeek Harness directly in the current Environment.", Version: DeepSeekHarnessVersion, DeveloperPreview: true, DiskBytes: 2 * 1024 * 1024 * 1024, DataLocation: filepath.Join(m.stateDir, DeepSeekHarnessTemplateID, "data"), SourceURL: "https://github.com/deepseek-ai/deepseek-harness", Source: "builtin", Deployment: DeploymentNative, Revision: 1, Duplicateable: completeBuiltInDuplicateSpec(hostSpec), ServiceFamilyID: DeepSeekHarnessTemplateID, Available: nativeAvailable, ReasonCode: nativeReasonCode, Reason: nativeReason, Deployments: []DeploymentAvailability{{Deployment: DeploymentNative, Available: nativeAvailable, ReasonCode: nativeReasonCode, Reason: nativeReason}}, WorkspaceRoots: workspaceRoots, Spec: &hostSpec},
		{TemplateID: DeepSeekHarnessContainerTemplateID, Name: "DeepSeek Harness · Container", Description: "Run the reviewed community DeepSeek Harness image in Docker.", Version: DeepSeekHarnessVersion, DeveloperPreview: true, DiskBytes: 2 * 1024 * 1024 * 1024, DataLocation: filepath.Join(m.stateDir, DeepSeekHarnessTemplateID, "data"), SourceURL: "https://github.com/deepseek-ai/deepseek-harness", DockerSourceURL: "https://github.com/runzhliu/deepseek-harness-docker", Source: "builtin", Deployment: DeploymentDocker, ContainerMode: "single", Revision: 1, Duplicateable: completeBuiltInDuplicateSpec(containerSpec), ServiceFamilyID: DeepSeekHarnessTemplateID, Available: dockerAvailable, ReasonCode: dockerReasonCode, Reason: dockerReason, Deployments: []DeploymentAvailability{{Deployment: DeploymentDocker, Available: dockerAvailable, ReasonCode: dockerReasonCode, Reason: dockerReason}}, WorkspaceRoots: workspaceRoots, Spec: &containerSpec},
	}
	if m.registry != nil {
		custom, err := m.registry.ListManagedTemplates(ctx)
		if err != nil {
			return nil, err
		}
		for _, record := range custom {
			item, err := m.templateFromRecord(ctx, record)
			if err != nil {
				return nil, err
			}
			items = append(items, *item)
		}
	}
	sortTemplates(items)
	return items, nil
}

func (m *Manager) workspaceRoots() []WorkspaceRoot {
	pathContext := m.scope.PathContext()
	workspaceRoots := make([]WorkspaceRoot, 0, len(pathContext.Roots))
	for _, root := range pathContext.Roots {
		if root.Hidden || !root.Permissions.Write {
			continue
		}
		workspaceRoots = append(workspaceRoots, WorkspaceRoot{ID: root.ID, Label: root.Label, Path: root.PathAbs})
	}
	return workspaceRoots
}

func (m *Manager) dockerAvailability(ctx context.Context) (bool, string, string) {
	if m.containers == nil {
		return false, "DOCKER_UNAVAILABLE", "Docker is not available in this Environment."
	}
	if runningInsideContainer() {
		return false, "NESTED_DOCKER_UNSUPPORTED", "Docker deployment is disabled because this Environment is already running inside a container."
	}
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	status, err := m.containers.Status(probeCtx, containers.StatusRequest{Engine: containers.EngineDocker})
	if err != nil || !status.Available {
		return false, "DOCKER_UNAVAILABLE", "Docker is not available or its daemon cannot be reached."
	}
	return true, "", ""
}

func runningInsideContainer() bool {
	for _, path := range []string{"/.dockerenv", "/run/.containerenv"} {
		if _, err := os.Stat(path); err == nil {
			return true
		}
	}
	return false
}

func (m *Manager) List(ctx context.Context) ([]ServiceView, error) {
	services, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ServiceView, 0, len(services))
	for _, service := range services {
		active, err := m.registry.GetActiveManagedOperation(ctx, service.ServiceID)
		if err != nil {
			return nil, err
		}
		name, description := m.serviceDisplayMetadata(ctx, service)
		out = append(out, ServiceView{ManagedService: service, Name: name, Description: description, ActiveOperation: active})
	}
	return out, nil
}

func (m *Manager) serviceDisplayMetadata(ctx context.Context, service pfregistry.ManagedService) (string, string) {
	switch service.TemplateID {
	case DeepSeekHarnessTemplateID, DeepSeekHarnessHostTemplateID:
		return "DeepSeek Harness · Host", "Run DeepSeek Harness directly in the current Environment."
	case DeepSeekHarnessContainerTemplateID:
		return "DeepSeek Harness · Container", "Run the reviewed community DeepSeek Harness image in Docker."
	}
	if record, err := m.registry.GetManagedTemplate(ctx, service.TemplateID); err == nil && record != nil {
		return record.Name, record.Description
	}
	return service.TemplateID, ""
}

func (m *Manager) Create(ctx context.Context, req CreateRequest) (*CreateResult, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	parameterJSON, _ := json.Marshal(req.Parameters)
	fingerprint := requestFingerprint("install", req.TemplateID, string(req.Deployment), strings.TrimSpace(req.WorkspacePath), string(parameterJSON))
	if existing, err := m.registry.GetManagedOperationByRequestID(ctx, req.RequestID); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.RequestFingerprint != fingerprint {
			return nil, serviceError("IDEMPOTENCY_CONFLICT", "request_id was already used for a different managed Web Service request.", 409, false, nil)
		}
		service, err := m.registry.GetManagedService(ctx, existing.ServiceID)
		if err != nil {
			return nil, err
		}
		if service == nil {
			return nil, serviceError("SERVICE_NOT_FOUND", "The managed Web Service no longer exists.", 404, false, nil)
		}
		return &CreateResult{Service: *service, Operation: *existing}, nil
	}
	templateID := strings.TrimSpace(req.TemplateID)
	if templateID == DeepSeekHarnessTemplateID {
		if req.Deployment == DeploymentDocker {
			templateID = DeepSeekHarnessContainerTemplateID
		} else {
			templateID = DeepSeekHarnessHostTemplateID
		}
	}
	template, err := m.Template(ctx, templateID)
	if err != nil {
		return nil, err
	}
	if !template.Available {
		return nil, serviceError(template.ReasonCode, template.Reason, 409, true, nil)
	}
	existingServices, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		return nil, err
	}
	for _, existing := range existingServices {
		if existing.ServiceFamilyID == template.ServiceFamilyID {
			return nil, serviceError("INSTANCE_ALREADY_EXISTS", "This service template family already has an instance in the Environment.", 409, false, nil)
		}
	}
	if template.Spec == nil {
		return nil, serviceError("TEMPLATE_UNAVAILABLE", "The template deployment definition is unavailable.", 409, true, nil)
	}
	if req.Deployment != "" && req.TemplateID != DeepSeekHarnessTemplateID && req.Deployment != template.Deployment {
		return nil, serviceError("DEPLOYMENT_INVALID", "The requested deployment type does not match the selected template.", 400, false, nil)
	}
	resolved, err := m.scope.Resolve(strings.TrimSpace(req.WorkspacePath), filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true, ForWrite: true})
	if err != nil {
		return nil, serviceError("WORKSPACE_UNAVAILABLE", "The workspace directory is not writable or is outside this Environment's allowed roots.", 400, false, err)
	}
	if template.Deployment == DeploymentDocker || template.Deployment == DeploymentContainer || template.Deployment == DeploymentCompose {
		if ok, code, reason := m.dockerAvailability(ctx); !ok {
			return nil, serviceError(code, reason, 409, true, nil)
		}
	}
	configuration, secretValues, err := resolveTemplateInputs(*template.Spec, req.Parameters)
	if err != nil {
		return nil, err
	}
	configurationJSON, err := json.Marshal(configuration)
	if err != nil {
		return nil, err
	}
	port := template.Spec.Endpoint.FixedHostPort
	if port == 0 {
		port, err = reserveLoopbackPort()
	}
	if err != nil {
		return nil, serviceError("PORT_UNAVAILABLE", "No loopback port is available for this managed Web Service.", 503, true, err)
	}
	serviceID, err := randomID("mws")
	if err != nil {
		return nil, err
	}
	forwardID, err := randomID("pf")
	if err != nil {
		return nil, err
	}
	operationID, err := randomID("mop")
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	snapshotJSON, snapshotHash, err := canonicalTemplateSpec(*template.Spec)
	if err != nil {
		return nil, err
	}
	service := pfregistry.ManagedService{ServiceID: serviceID, TemplateID: template.TemplateID, TemplateSource: template.Source, TemplateRevision: template.Revision, TemplateSnapshotJSON: snapshotJSON, TemplateSnapshotSHA256: snapshotHash, ServiceFamilyID: template.ServiceFamilyID, Deployment: string(template.Deployment), WorkspacePath: resolved.RealAbs, ConfigurationJSON: string(configurationJSON), Version: template.Version, DesiredState: "running", ObservedState: "installing", ForwardID: forwardID, RuntimeManifestJSON: "{}", RuntimePort: port, CreatedAtUnixMs: now, UpdatedAtUnixMs: now}
	forward := pfregistry.Forward{ForwardID: forwardID, TargetURL: fmt.Sprintf("%s://127.0.0.1:%d", template.Spec.Endpoint.Scheme, port), Name: template.Name, Description: "Managed by Redeven", HealthPath: template.Spec.Endpoint.HealthPath, CreatedAtUnixMs: now, UpdatedAtUnixMs: now}
	op := pfregistry.ManagedOperation{OperationID: operationID, ServiceID: serviceID, RequestID: strings.TrimSpace(req.RequestID), RequestFingerprint: fingerprint, Action: string(ActionInstall), State: "pending", Stage: "environment_check", ProgressTotal: operationProgressTotal, CreatedAtUnixMs: now, UpdatedAtUnixMs: now}
	if err := m.writeServiceSecrets(serviceID, secretValues); err != nil {
		return nil, serviceError("SERVICE_SECRETS_WRITE_FAILED", "The managed-service secret parameters could not be stored securely.", 500, false, err)
	}
	if err := m.registry.CreateManagedServiceWithOperation(ctx, service, forward, op); err != nil {
		_ = os.Remove(m.serviceSecretPath(serviceID))
		return nil, err
	}
	m.launch(service, op, false)
	return &CreateResult{Service: service, Operation: op}, nil
}

func (m *Manager) Operate(ctx context.Context, serviceID string, req OperationRequest) (*pfregistry.ManagedOperation, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	fingerprint := requestFingerprint("operate", strings.TrimSpace(serviceID), string(req.Action), fmt.Sprint(req.DeleteData))
	if existing, err := m.registry.GetManagedOperationByRequestID(ctx, req.RequestID); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.RequestFingerprint != fingerprint {
			return nil, serviceError("IDEMPOTENCY_CONFLICT", "request_id was already used for a different managed Web Service request.", 409, false, nil)
		}
		return existing, nil
	}
	service, err := m.registry.GetManagedService(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	if service == nil {
		return nil, serviceError("SERVICE_NOT_FOUND", "The managed Web Service was not found.", 404, false, nil)
	}
	switch req.Action {
	case ActionStart, ActionStop, ActionRestart, ActionRetryInstall, ActionUninstall:
	default:
		return nil, serviceError("ACTION_INVALID", "The managed Web Service action is invalid.", 400, false, nil)
	}
	if req.DeleteData && req.Action != ActionUninstall {
		return nil, serviceError("REQUEST_INVALID", "delete_data is valid only for uninstall.", 400, false, nil)
	}
	m.mu.Lock()
	active, err := m.registry.HasActiveManagedOperation(ctx, service.ServiceID)
	if err == nil && !active && !m.closed {
		operationID, idErr := randomID("mop")
		if idErr != nil {
			err = idErr
		} else {
			now := time.Now().UnixMilli()
			op := pfregistry.ManagedOperation{OperationID: operationID, ServiceID: service.ServiceID, RequestID: strings.TrimSpace(req.RequestID), RequestFingerprint: fingerprint, Action: string(req.Action), DeleteData: req.DeleteData, State: "pending", Stage: initialStage(req.Action), ProgressTotal: operationProgressTotal, CreatedAtUnixMs: now, UpdatedAtUnixMs: now}
			if err = m.registry.CreateManagedOperation(ctx, op); err == nil {
				m.mu.Unlock()
				m.launch(*service, op, req.DeleteData)
				return &op, nil
			}
		}
	}
	m.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return nil, serviceError("OPERATION_CONFLICT", "Another operation is already running for this managed Web Service.", 409, true, nil)
}

func initialStage(action OperationAction) string {
	if action == ActionUninstall {
		return "stopping"
	}
	if action == ActionStop {
		return "stopping"
	}
	return "environment_check"
}

func (m *Manager) launch(service pfregistry.ManagedService, op pfregistry.ManagedOperation, deleteData bool) {
	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		cancel()
		return
	}
	m.workers.Add(1)
	m.cancelByOp[op.OperationID] = cancel
	m.mu.Unlock()
	go m.run(ctx, service, op, deleteData)
}

func (m *Manager) run(ctx context.Context, service pfregistry.ManagedService, op pfregistry.ManagedOperation, deleteData bool) {
	defer m.workers.Done()
	defer func() { m.mu.Lock(); delete(m.cancelByOp, op.OperationID); m.mu.Unlock() }()
	op.State = "running"
	m.saveAndPublish(&op)
	driver := m.driver(Deployment(service.Deployment))
	if driver == nil {
		m.fail(&service, &op, "DEPLOYMENT_INVALID", "The saved deployment type is invalid.", nil)
		return
	}
	var err error
	switch OperationAction(op.Action) {
	case ActionInstall, ActionRetryInstall:
		err = m.runInstall(ctx, &service, &op, driver)
	case ActionStart:
		err = m.runStart(ctx, &service, &op, driver)
	case ActionStop:
		err = m.runStop(ctx, &service, &op, driver)
	case ActionRestart:
		if err = m.runStop(ctx, &service, &op, driver); err == nil {
			err = m.runStart(ctx, &service, &op, driver)
		}
	case ActionUninstall:
		err = m.runUninstall(ctx, &service, &op, driver, deleteData)
	}
	if err != nil {
		if errors.Is(err, context.Canceled) {
			op.State = "cancelled"
			op.Stage = "cancelled"
			op.ErrorCode = "OPERATION_CANCELLED"
			op.ErrorMessage = "The operation was cancelled."
			op.FinishedAtUnixMs = time.Now().UnixMilli()
			cleanupErr := m.cleanupCancelledOperation(&service, &op, driver)
			if cleanupErr != nil {
				op.ErrorCode = "CANCEL_CLEANUP_FAILED"
				op.ErrorMessage = "The operation was cancelled, but its verified runtime resource could not be cleaned up."
			}
			m.saveAndPublish(&op)
			desired, observed := "stopped", "error"
			switch OperationAction(op.Action) {
			case ActionStop:
				observed = service.ObservedState
			case ActionStart, ActionRestart:
				observed = "stopped"
			case ActionUninstall:
				desired, observed = service.DesiredState, service.ObservedState
			}
			_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &desired, ObservedState: &observed, LastErrorCode: &op.ErrorCode, LastErrorMessage: &op.ErrorMessage})
			return
		}
		code, message, _, _ := ErrorDetails(err)
		m.fail(&service, &op, code, message, err)
		return
	}
	if OperationAction(op.Action) == ActionUninstall {
		op.State = "succeeded"
		op.Stage = "completed"
		op.ProgressCurrent = operationProgressTotal
		op.FinishedAtUnixMs = time.Now().UnixMilli()
		m.publish(op)
		return
	}
	op.State = "succeeded"
	op.Stage = "completed"
	op.ProgressCurrent = operationProgressTotal
	op.FinishedAtUnixMs = time.Now().UnixMilli()
	m.saveAndPublish(&op)
}

func (m *Manager) runInstall(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver) error {
	m.progress(op, "environment_check", 1)
	payload := catalogPayload{}
	var err error
	if service.TemplateSource == "builtin" || service.Deployment == string(DeploymentNative) || service.Deployment == string(DeploymentDocker) {
		payload, err = m.catalog.resolve(ctx)
		if err != nil {
			return err
		}
	}
	stage := map[Deployment]string{DeploymentNative: "downloading", DeploymentDocker: "pulling", DeploymentHost: "installing", DeploymentContainer: "pulling", DeploymentCompose: "pulling"}[Deployment(service.Deployment)]
	m.progress(op, stage, 2)
	runtimeID, artifact, err := driver.Install(ctx, service, payload, func(stage string, current int64) { m.progress(op, stage, current) })
	if err != nil {
		return err
	}
	service.RuntimeIdentity, service.ArtifactReference = runtimeID, artifact
	if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &runtimeID, ArtifactReference: &artifact}); err != nil {
		return err
	}
	m.progress(op, "starting", 5)
	runtimeID, err = driver.Start(ctx, service)
	if err != nil {
		return err
	}
	service.RuntimeIdentity = runtimeID
	if err = m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &runtimeID}); err != nil {
		return err
	}
	m.progress(op, "health_check", 6)
	if err := m.waitHealthy(ctx, service); err != nil {
		_ = driver.Stop(context.Background(), service)
		return serviceError("HEALTH_CHECK_FAILED", "The managed Web Service did not become healthy on its loopback port.", 502, true, err)
	}
	running, blank := "running", ""
	service.DesiredState, service.ObservedState = running, running
	return m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &running, ObservedState: &running, LastErrorCode: &blank, LastErrorMessage: &blank})
}

func (m *Manager) runStart(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver) error {
	running := "running"
	if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &running}); err != nil {
		return err
	}
	m.progress(op, "starting", 5)
	runtimeID, err := driver.Start(ctx, service)
	if err != nil {
		return err
	}
	service.RuntimeIdentity = runtimeID
	if err = m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &runtimeID}); err != nil {
		return err
	}
	m.progress(op, "health_check", 6)
	if err := m.waitHealthy(ctx, service); err != nil {
		_ = driver.Stop(context.Background(), service)
		return serviceError("HEALTH_CHECK_FAILED", "The managed Web Service did not become healthy on its loopback port.", 502, true, err)
	}
	blank := ""
	return m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &running, LastErrorCode: &blank, LastErrorMessage: &blank})
}

func (m *Manager) runStop(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver) error {
	stopped := "stopped"
	if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &stopped}); err != nil {
		return err
	}
	m.progress(op, "stopping", 5)
	if err := driver.Stop(ctx, service); err != nil {
		return err
	}
	service.ObservedState = stopped
	return m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &stopped})
}

func (m *Manager) runUninstall(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver, deleteData bool) error {
	m.progress(op, "stopping", 2)
	if err := driver.Stop(ctx, service); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	m.progress(op, "uninstalling", 5)
	// Once destructive removal starts, finish it and its database transaction.
	// Cancelling between those effects would leave an unverifiable half-uninstall.
	if err := driver.Uninstall(context.Background(), service, deleteData); err != nil {
		return err
	}
	if err := os.Remove(m.serviceSecretPath(service.ServiceID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	op.State = "succeeded"
	op.Stage = "completed"
	op.ProgressCurrent = operationProgressTotal
	op.FinishedAtUnixMs = time.Now().UnixMilli()
	// The external resources are already gone, so persist their removal even if
	// the request was cancelled immediately after the driver returned.
	if err := m.registry.CompleteManagedServiceUninstall(context.Background(), service.ServiceID, *op); err != nil {
		return err
	}
	return nil
}

func (m *Manager) cleanupCancelledOperation(service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver) error {
	switch OperationAction(op.Action) {
	case ActionInstall, ActionRetryInstall:
		if err := driver.CleanupPartial(context.Background(), service); err != nil {
			return err
		}
		blank := ""
		service.RuntimeIdentity = blank
		return m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &blank})
	case ActionStart, ActionRestart:
		return driver.Stop(context.Background(), service)
	case ActionStop, ActionUninstall:
		return nil
	default:
		return nil
	}
}

func (m *Manager) reconcileInterruptedService(service *pfregistry.ManagedService, operation pfregistry.ManagedOperation) {
	driver := m.driver(Deployment(service.Deployment))
	if driver == nil {
		code, message := "DEPLOYMENT_INVALID", "The interrupted managed Web Service has an invalid deployment type."
		desired, observed := "stopped", "error"
		_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &desired, ObservedState: &observed, LastErrorCode: &code, LastErrorMessage: &message})
		return
	}
	var err error
	switch OperationAction(operation.Action) {
	case ActionInstall, ActionRetryInstall:
		err = driver.CleanupPartial(context.Background(), service)
	case ActionStart, ActionStop, ActionRestart, ActionUninstall:
		err = driver.Stop(context.Background(), service)
	}
	code, message := "OPERATION_INTERRUPTED", "The Runtime stopped before the operation completed. Retry the operation when ready."
	patch := pfregistry.ManagedServicePatch{}
	if err == nil && (OperationAction(operation.Action) == ActionInstall || OperationAction(operation.Action) == ActionRetryInstall) {
		blank := ""
		service.RuntimeIdentity = blank
		patch.RuntimeIdentity = &blank
	}
	if err != nil {
		code, message = "INTERRUPTED_CLEANUP_FAILED", "The interrupted operation could not clean up its verified runtime resource."
		m.log.Warn("clean up interrupted managed Web Service operation", "service_id", service.ServiceID, "operation_id", operation.OperationID, "error", err)
	}
	desired, observed := "stopped", "error"
	patch.DesiredState, patch.ObservedState, patch.LastErrorCode, patch.LastErrorMessage = &desired, &observed, &code, &message
	if updateErr := m.registry.UpdateManagedService(context.Background(), service.ServiceID, patch); updateErr != nil {
		m.log.Error("persist interrupted managed Web Service recovery", "service_id", service.ServiceID, "error", updateErr)
	}
}

func (m *Manager) fail(service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, code, message string, cause error) {
	if code == "" {
		code = "MANAGED_WEB_SERVICE_FAILED"
	}
	if message == "" && cause != nil {
		message = cause.Error()
	}
	if message == "" {
		message = "The managed Web Service operation failed."
	}
	op.State = "failed"
	op.Stage = "failed"
	op.ErrorCode = code
	op.ErrorMessage = message
	op.FinishedAtUnixMs = time.Now().UnixMilli()
	m.saveAndPublish(op)
	errorState, stopped := "error", "stopped"
	_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &stopped, ObservedState: &errorState, LastErrorCode: &code, LastErrorMessage: &message})
}

func (m *Manager) progress(op *pfregistry.ManagedOperation, stage string, current int64) {
	op.Stage = stage
	op.ProgressCurrent = current
	m.saveAndPublish(op)
}
func (m *Manager) saveAndPublish(op *pfregistry.ManagedOperation) {
	_ = m.registry.UpdateManagedOperation(context.Background(), *op)
	refreshed, _ := m.registry.GetManagedOperation(context.Background(), op.OperationID)
	if refreshed != nil {
		*op = *refreshed
	}
	m.publish(*op)
}
func (m *Manager) publish(op pfregistry.ManagedOperation) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ch := range m.listeners[op.OperationID] {
		select {
		case ch <- op:
		default:
		}
	}
}

func (m *Manager) Cancel(ctx context.Context, operationID string) (*pfregistry.ManagedOperation, error) {
	op, err := m.registry.GetManagedOperation(ctx, operationID)
	if err != nil {
		return nil, err
	}
	if op == nil {
		return nil, serviceError("OPERATION_NOT_FOUND", "The managed Web Service operation was not found.", 404, false, nil)
	}
	if op.State != "pending" && op.State != "running" && op.State != "cancelling" {
		return op, nil
	}
	op.CancelRequested, op.State = true, "cancelling"
	if err := m.registry.UpdateManagedOperation(ctx, *op); err != nil {
		return nil, err
	}
	m.mu.Lock()
	cancel := m.cancelByOp[operationID]
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	m.publish(*op)
	return op, nil
}

func (m *Manager) Operation(ctx context.Context, operationID string) (*pfregistry.ManagedOperation, error) {
	op, err := m.registry.GetManagedOperation(ctx, operationID)
	if err != nil {
		return nil, err
	}
	if op == nil {
		return nil, serviceError("OPERATION_NOT_FOUND", "The managed Web Service operation was not found.", 404, false, nil)
	}
	return op, nil
}

func (m *Manager) Subscribe(operationID string) (<-chan pfregistry.ManagedOperation, func(), error) {
	ch := make(chan pfregistry.ManagedOperation, 8)
	m.mu.Lock()
	m.nextListener++
	id := m.nextListener
	if m.listeners[operationID] == nil {
		m.listeners[operationID] = map[uint64]chan pfregistry.ManagedOperation{}
	}
	m.listeners[operationID][id] = ch
	m.mu.Unlock()
	unsubscribe := func() {
		m.mu.Lock()
		if listeners := m.listeners[operationID]; listeners != nil {
			delete(listeners, id)
			if len(listeners) == 0 {
				delete(m.listeners, operationID)
			}
		}
		m.mu.Unlock()
	}
	op, err := m.registry.GetManagedOperation(context.Background(), operationID)
	if err != nil {
		unsubscribe()
		return nil, nil, err
	}
	if op == nil {
		unsubscribe()
		return nil, nil, serviceError("OPERATION_NOT_FOUND", "The managed Web Service operation was not found.", 404, false, nil)
	}
	ch <- *op
	return ch, unsubscribe, nil
}

func (m *Manager) Logs(ctx context.Context, serviceID string, tail int) (*LogResult, error) {
	service, err := m.registry.GetManagedService(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	if service == nil {
		return nil, serviceError("SERVICE_NOT_FOUND", "The managed Web Service was not found.", 404, false, nil)
	}
	if tail <= 0 || tail > 1000 {
		tail = 200
	}
	driver := m.driver(Deployment(service.Deployment))
	if driver == nil {
		return nil, serviceError("DEPLOYMENT_INVALID", "The saved deployment type is invalid.", 409, false, nil)
	}
	return driver.Logs(ctx, service, tail)
}

type deploymentDriver interface {
	Install(context.Context, *pfregistry.ManagedService, catalogPayload, func(string, int64)) (string, string, error)
	Start(context.Context, *pfregistry.ManagedService) (string, error)
	Stop(context.Context, *pfregistry.ManagedService) error
	Uninstall(context.Context, *pfregistry.ManagedService, bool) error
	CleanupPartial(context.Context, *pfregistry.ManagedService) error
	Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error)
}

func (m *Manager) driver(deployment Deployment) deploymentDriver {
	switch deployment {
	case DeploymentNative:
		return m.native
	case DeploymentDocker:
		return m.docker
	case DeploymentHost:
		return m.host
	case DeploymentContainer:
		return m.container
	case DeploymentCompose:
		return m.compose
	default:
		return nil
	}
}

func reserveLoopbackPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}
func (m *Manager) waitHealthy(ctx context.Context, service *pfregistry.ManagedService) error {
	endpoint := WebEndpointSpec{Scheme: "http", HealthPath: "/", StartupTimeout: 45}
	if spec, err := templateSpecFromService(service); err == nil {
		endpoint = spec.Endpoint
	}
	if endpoint.Scheme == "" {
		endpoint.Scheme = "http"
	}
	if endpoint.HealthProtocol != "" {
		endpoint.Scheme = endpoint.HealthProtocol
	}
	if endpoint.HealthPath == "" {
		endpoint.HealthPath = "/"
	}
	if endpoint.StartupTimeout <= 0 {
		endpoint.StartupTimeout = 45
	}
	deadline := time.Now().Add(time.Duration(endpoint.StartupTimeout) * time.Second)
	client := &http.Client{Timeout: 2 * time.Second}
	target := fmt.Sprintf("%s://127.0.0.1:%d%s", endpoint.Scheme, service.RuntimePort, endpoint.HealthPath)
	for time.Now().Before(deadline) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if resp, err := client.Do(req); err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 500 {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(350 * time.Millisecond):
		}
	}
	return errors.New("health check timed out")
}
func validateRequestID(value string) error {
	value = strings.TrimSpace(value)
	if len(value) < 8 || len(value) > 160 || strings.ContainsAny(value, "\x00\r\n") {
		return serviceError("REQUEST_ID_INVALID", "request_id must be an opaque value between 8 and 160 characters.", 400, false, nil)
	}
	return nil
}

func requestFingerprint(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = hash.Write([]byte(part))
		_, _ = hash.Write([]byte{0})
	}
	return fmt.Sprintf("%x", hash.Sum(nil))
}
func randomID(prefix string) (string, error) {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + "_" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)), nil
}
