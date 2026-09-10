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

	"golang.org/x/sync/singleflight"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const operationProgressTotal = 7

type ManagerOptions struct {
	Logger     *slog.Logger
	StateDir   string
	Registry   *pfregistry.Registry
	Scope      *filesystemscope.Registry
	Containers *containerengine.Adapter
	Catalog    *BuiltinCatalog
}

type Manager struct {
	log               *slog.Logger
	stateDir          string
	registry          *pfregistry.Registry
	scope             *filesystemscope.Registry
	containers        *containerengine.Adapter
	catalog           *BuiltinCatalog
	downloads         *packageDownloadClient
	packageDownloader *verifiedPackageDownloader
	host              deploymentDriver
	container         deploymentDriver
	compose           deploymentDriver
	healthCheck       func(context.Context, *pfregistry.ManagedService) error

	templateSourceMu     sync.RWMutex
	templateSources      map[string]cachedTemplateSource
	templateSourceUses   map[string]int
	templateSourceClient *http.Client
	requestMu            sync.Mutex
	releaseMu            sync.Mutex
	releaseItems         map[string]cachedReleaseCandidate
	releaseViews         map[string]ReleaseCandidateResult
	releaseCursors       map[string]cachedReleaseCursor
	updatePlans          map[string]cachedUpdatePlan
	releaseCancel        context.CancelFunc
	releaseClient        *http.Client
	mu                   sync.Mutex
	workers              sync.WaitGroup
	cancelByOp           map[string]context.CancelFunc
	listeners            map[string]map[uint64]chan pfregistry.ManagedOperation
	reporters            map[string]*operationReporter
	nextListener         uint64
	managementCtx        context.Context
	managementCancel     context.CancelFunc
	maintenanceCancel    context.CancelFunc
	openFlights          singleflight.Group
	installPlans         map[string]cachedInstallPlan
	closed               bool
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
	catalog := opts.Catalog
	if catalog == nil {
		var err error
		catalog, err = LoadBuiltinCatalog()
		if err != nil {
			return nil, err
		}
	}
	m := &Manager{log: logger, stateDir: root, registry: opts.Registry, scope: opts.Scope, containers: opts.Containers, catalog: catalog, downloads: defaultPackageDownloadClient(), releaseItems: map[string]cachedReleaseCandidate{}, releaseViews: map[string]ReleaseCandidateResult{}, releaseCursors: map[string]cachedReleaseCursor{}, updatePlans: map[string]cachedUpdatePlan{}, cancelByOp: map[string]context.CancelFunc{}, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}, reporters: map[string]*operationReporter{}}
	releaseBase := m.downloads.packageHTTPClient()
	if releaseBase != nil {
		copy := *releaseBase
		copy.Timeout = 45 * time.Second
		copy.Transport = newReleaseMetadataTransport(copy.Transport)
		copy.CheckRedirect = releaseMetadataRedirectPolicy
		m.releaseClient = &copy
	}
	m.managementCtx, m.managementCancel = context.WithCancel(context.Background())
	m.packageDownloader = &verifiedPackageDownloader{client: m.downloads.packageHTTPClient()}
	m.host = &hostScriptDriver{manager: m, processes: map[string]hostProcess{}}
	m.container = &containerTemplateDriver{manager: m, adapter: opts.Containers}
	m.compose = &composeTemplateDriver{manager: m, adapter: opts.Containers}
	if err := m.registry.MarkManagedOperationsInterrupted(context.Background()); err != nil {
		return nil, err
	}
	if err := m.cleanupTemplateSourceOrphans(context.Background()); err != nil {
		return nil, err
	}
	_ = os.RemoveAll(filepath.Join(root, ".staging"))
	return m, nil
}

func (m *Manager) releaseHTTPClient() *http.Client {
	return m.releaseClient
}

func (m *Manager) Start(ctx context.Context) {
	m.startReleaseDiscovery()
	m.startOutputMaintenance(ctx)
	services, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		m.log.Error("list managed services for recovery", "cause", safeManagedFailureCause(err))
		return
	}
	for _, service := range services {
		latest, latestErr := m.registry.GetLatestManagedOperation(ctx, service.ServiceID)
		if latestErr != nil {
			m.log.Error("read managed Web Service recovery operation", "service_id", service.ServiceID, "cause", safeManagedFailureCause(latestErr))
			continue
		}
		if pendingUninstall(&service) || (!activeManagement(service) && !configurationOnlyRecovery(&service, latest)) {
			continue
		}
		if latest != nil && latest.State == "interrupted" {
			m.reconcileInterruptedService(&service, *latest)
			continue
		}
		running, observationErr := m.observe(ctx, &service)
		if observationErr != nil || running || service.DesiredState != "running" || service.LastErrorCode != "" || (latest != nil && latest.State == "failed") {
			continue
		}
		requestID := "runtime-recovery-" + service.ServiceID + "-" + fmt.Sprint(time.Now().UnixMilli())
		_, _ = m.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: requestID, Action: ActionStart})
	}
}

func (m *Manager) Close() error {
	m.mu.Lock()
	m.closed = true
	if m.managementCancel != nil {
		m.managementCancel()
	}
	if m.maintenanceCancel != nil {
		m.maintenanceCancel()
	}
	cancels := make([]context.CancelFunc, 0, len(m.cancelByOp))
	for _, cancel := range m.cancelByOp {
		cancels = append(cancels, cancel)
	}
	m.mu.Unlock()
	m.releaseMu.Lock()
	releaseCancel := m.releaseCancel
	m.releaseCancel = nil
	m.releaseMu.Unlock()
	if releaseCancel != nil {
		releaseCancel()
	}
	for _, cancel := range cancels {
		cancel()
	}
	m.workers.Wait()

	return nil
}

func (m *Manager) Catalog(ctx context.Context) ([]Template, error) {
	items, err := m.builtInCatalog(ctx)
	if err != nil {
		return nil, err
	}
	if m.registry != nil {
		sources, err := m.registry.ListManagedTemplateSources(ctx)
		if err != nil {
			return nil, err
		}
		for _, source := range sources {
			item, _, readErr := m.readSourceTemplate(ctx, source)
			if readErr != nil {
				code, reason, _, _ := ErrorDetails(readErr)
				item = &Template{TemplateID: source.TemplateID, Source: "git", GitSource: &source, SourceSHA256: source.SHA256, ServiceFamilyID: sourceIdentity(source.RepositoryID, source.DocumentFamilyID), Name: source.Name, Description: source.Description, DefaultLocale: source.DefaultLocale, Revision: source.Revision, Deployment: Deployment(source.Deployment), ReasonCode: code, Reason: reason, Deployments: []DeploymentAvailability{}}
			}
			items = append(items, *item)
		}
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

func (m *Manager) defaultWorkspacePath(templateID string) (string, error) {
	templateID = strings.TrimSpace(templateID)
	if !managedWorkspaceIdentityPattern.MatchString(templateID) {
		return "", serviceError("TEMPLATE_IDENTITY_INVALID", "The service template identity is invalid.", 409, false, nil)
	}
	pathContext := m.scope.PathContext()
	var selectedRoot string
	for _, root := range pathContext.Roots {
		if root.Kind == filesystemscope.RootKindHome && !root.Hidden && root.Permissions.Write {
			selectedRoot = root.PathAbs
			break
		}
	}
	if selectedRoot == "" {
		for _, root := range pathContext.Roots {
			if root.ID == pathContext.DefaultRootID && !root.Hidden && root.Permissions.Write {
				selectedRoot = root.PathAbs
				break
			}
		}
	}
	if selectedRoot == "" {
		for _, root := range pathContext.Roots {
			if !root.Hidden && root.Permissions.Write {
				selectedRoot = root.PathAbs
				break
			}
		}
	}
	if selectedRoot == "" {
		return "", serviceError("WORKSPACE_UNAVAILABLE", "The Environment does not expose a writable root for managed-service workspaces.", 409, false, nil)
	}
	return filepath.Join(selectedRoot, "Redeven", "workspaces", "managed-services", templateID), nil
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
	status, err := m.containers.Status(probeCtx, containerengine.StatusRequest{Engine: containerengine.EngineDocker})
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
	forwards, err := m.registry.ListForwards(ctx)
	if err != nil {
		return nil, err
	}
	forwardByID := make(map[string]pfregistry.Forward, len(forwards))
	for _, forward := range forwards {
		forwardByID[forward.ForwardID] = forward
	}
	out := make([]ServiceView, 0, len(services))
	for _, service := range services {
		forward, ok := forwardByID[service.ForwardID]
		if !ok && activeManagement(service) {
			return nil, serviceError("FORWARD_NOT_FOUND", "The managed Web Service route is unavailable.", 409, false, nil)
		}
		active, err := m.registry.GetActiveManagedOperation(ctx, service.ServiceID)
		if err != nil {
			return nil, err
		}
		facts, observationErr := m.inspectService(ctx, &service, false)
		if active == nil {
			_, observationErr = m.applyObservation(ctx, &service, facts, observationErr)
		}
		var lastFailure *ServiceFailure
		var latestFailure *pfregistry.ManagedOperation
		if service.LastErrorCode != "" {
			latestFailure, err = m.registry.GetLatestManagedOperationFailure(ctx, service.ServiceID)
			if err != nil {
				return nil, err
			}
			lastFailure = serviceFailureView(service, latestFailure)
		}
		name, description := m.serviceDisplayMetadata(ctx, service)
		binding, _ := decodeRuntimeBinding(&service)
		resolved, _ := m.resolveCurrentRuntime(ctx, &service)
		currentTemplate, templateErr := m.Template(ctx, service.TemplateID)
		deployment := Deployment("")
		templateSource := ""
		if binding != nil {
			deployment = binding.Deployment
		}
		if templateErr == nil {
			templateSource = currentTemplate.Source
		}
		if resolved != nil {
			deployment = resolved.Template.Deployment
			templateSource = resolved.Template.Source
		}
		view := ServiceView{
			ManagedService:     service,
			Name:               name,
			Description:        description,
			TemplateSource:     templateSource,
			Deployment:         deployment,
			ActiveOperation:    active,
			LastFailure:        lastFailure,
			AccessMode:         forward.AccessMode,
			ContainerResources: containerResourceLinks(service, deployment),
			Actions:            serviceActionCapabilities(service, resolved, active, latestFailure),
		}
		view.Facts = facts
		view.Status, view.PrimaryAction, view.ProblemCode = servicePresentation(service, view.Facts, active, latestFailure)
		if active == nil && activeManagement(service) && facts.Presence == "absent" && !pendingUninstall(&service) {
			unfinished, err := m.registry.GetUnresolvedManagedUninstall(ctx, service.ServiceID)
			if err != nil {
				return nil, err
			}
			if unfinished != nil {
				view.Status, view.PrimaryAction = "uninstall_pending", "inspect"
			}
		}
		if view.PrimaryAction == "start" && !view.Actions.Start.Available {
			view.PrimaryAction = "inspect"
			view.ProblemCode = "CURRENT_TEMPLATE_INVALID"
		}
		view.PendingChanges = resolved != nil && service.RuntimeSpecSHA256 != "" && service.RuntimeSpecSHA256 != resolved.RuntimeSpecSHA256
		view.Opening.State = "unavailable"
		if service.ObservedState == "running" {
			view.Opening.State = "ready"
			if deployment == DeploymentHost {
				if driver, ok := m.host.(*hostScriptDriver); ok {
					if state, err := driver.readRunState(&service); err != nil {
						view.Opening.State, view.Opening.ErrorCode = "unavailable", "HOST_OPEN_TARGET_UNAVAILABLE"
					} else if state.OpenErrorCode != "" {
						view.Opening.State, view.Opening.ErrorCode = "error", state.OpenErrorCode
					}
				}
			} else if _, err := readServiceOpening(m.staticOpeningPath(&service), &service, service.RuntimeIdentity, "SERVICE"); err != nil {
				view.Opening.State = "unavailable"
				view.Opening.ErrorCode, _, _, _ = ErrorDetails(err)
			}
		}
		if observationErr != nil {
			view.Opening.ErrorCode, _, _, _ = ErrorDetails(observationErr)
		}
		if active == nil && service.ObservedState == "running" {
			if err := m.checkOpeningEndpoint(ctx, &service); err != nil {
				view.Opening.State = "unavailable"
				view.Opening.ErrorCode, _, _, _ = ErrorDetails(err)
			}
		}
		identity, identityErr := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
		if identityErr != nil {
			return nil, serviceError("RELEASE_IDENTITY_INVALID", "The managed Web Service release identity is invalid.", 409, false, identityErr)
		}
		view.ReleaseStatus = ReleaseStatus{SchemaVersion: 2, CurrentRelease: identity, CheckStatus: "pending"}
		if m.catalog != nil {
			if definition, ok := m.catalog.definition(service.TemplateID); ok {
				icon := definition.Icon
				view.Icon, view.Localizations = &icon, cloneLocalizations(definition.Localizations)
			}
		}
		if templateErr == nil {
			view.DefaultLocale = currentTemplate.DefaultLocale
			view.Icon, view.Localizations = currentTemplate.Icon, currentTemplate.Localizations
			view.ReleaseStatus.RecommendedRelease = currentTemplate.RecommendedRelease
		}
		if releaseView, ok := m.releaseView("service:" + service.ServiceID); ok {
			view.ReleaseStatus.CheckStatus = releaseView.CheckStatus
			view.ReleaseStatus.CheckedAtUnixMs = releaseView.CheckedAtUnixMs
			view.ReleaseStatus.NextCheckAtUnixMs = releaseView.NextCheckAtUnixMs
			view.ReleaseStatus.LastErrorCode = releaseView.LastErrorCode
			if releaseView.LatestStableRelease != nil {
				value := releaseIdentityFromCandidate(*releaseView.LatestStableRelease)
				view.ReleaseStatus.LatestStableRelease = &value
				view.ReleaseStatus.LatestStableRelation = releaseRelation(identity, value)
			}
			if releaseView.LatestPreviewRelease != nil {
				value := releaseIdentityFromCandidate(*releaseView.LatestPreviewRelease)
				view.ReleaseStatus.LatestPreviewRelease = &value
				view.ReleaseStatus.LatestPreviewRelation = releaseRelation(identity, value)
			}
		} else if persisted, persistedErr := m.registry.GetManagedReleaseCheck(ctx, service.ServiceID); persistedErr != nil {
			return nil, persistedErr
		} else if persisted != nil {
			summary, summaryErr := decodeReleaseCheckSummary(persisted)
			if summaryErr != nil {
				return nil, serviceError("RELEASE_CHECK_INVALID", "The saved release check summary is invalid.", 409, false, summaryErr)
			}
			view.ReleaseStatus.LatestStableRelease = summary.LatestStableRelease
			view.ReleaseStatus.LatestPreviewRelease = summary.LatestPreviewRelease
			if summary.LatestStableRelease != nil {
				view.ReleaseStatus.LatestStableRelation = releaseRelation(identity, *summary.LatestStableRelease)
			}
			if summary.LatestPreviewRelease != nil {
				view.ReleaseStatus.LatestPreviewRelation = releaseRelation(identity, *summary.LatestPreviewRelease)
			}
			view.ReleaseStatus.CheckedAtUnixMs = persisted.CheckedAtUnixMs
			view.ReleaseStatus.NextCheckAtUnixMs = persisted.NextCheckAtUnixMs
			view.ReleaseStatus.LastErrorCode = persisted.LastErrorCode
			if persisted.Stale {
				view.ReleaseStatus.CheckStatus = "stale"
			} else {
				view.ReleaseStatus.CheckStatus = "fresh"
			}
		}
		out = append(out, view)
	}
	return out, nil
}

func releaseIdentityFromCandidate(candidate ReleaseCandidate) ReleaseIdentity {
	return ReleaseIdentity{SchemaVersion: 1, Kind: candidate.SourceKind, Source: candidate.Source, Registry: candidate.Registry, Version: candidate.Version, Tag: candidate.Tag, Digest: candidate.Digest, Integrity: candidate.Integrity, Platform: candidate.Platform, Trust: candidate.Trust}
}

func (m *Manager) serviceDisplayMetadata(ctx context.Context, service pfregistry.ManagedService) (string, string) {
	if m.catalog != nil {
		if definition, ok := m.catalog.definition(service.TemplateID); ok {
			if localized, exists := definition.Localizations["en-US"]; exists {
				return localized.Name, localized.Description
			}
		}
	}
	if record, err := m.registry.GetManagedTemplate(ctx, service.TemplateID); err == nil && record != nil {
		return record.Name, record.Description
	}
	return service.TemplateID, ""
}

func serviceActionCapabilities(service pfregistry.ManagedService, runtime *resolvedRuntime, active, _ *pfregistry.ManagedOperation) ServiceActions {
	no := func(code string) ActionCapability { return ActionCapability{ReasonCode: code} }
	yes := ActionCapability{Available: true}
	actions := ServiceActions{Inspect: yes, Uninstall: yes, Detach: yes, Open: no("SERVICE_NOT_RUNNING"), Start: no("SERVICE_STATE_UNAVAILABLE"), Stop: no("SERVICE_STATE_UNAVAILABLE"), Restart: no("SERVICE_STATE_UNAVAILABLE"), Retry: no("REVIEW_REQUIRED"), RestoreManagement: no("RECOVERY_NOT_REQUIRED"), Recover: yes}
	if active != nil {
		busy := no("OPERATION_ACTIVE")
		actions.Uninstall, actions.Detach, actions.Recover, actions.Start, actions.Stop, actions.Restart, actions.Open, actions.RestoreManagement = busy, busy, busy, busy, busy, busy, busy, busy
		return actions
	}
	if !activeManagement(service) {
		actions.Detach = no("SERVICE_NOT_ACTIVE")
		actions.Open = no("SERVICE_NOT_ACTIVE")
		actions.RestoreManagement = yes
		return actions
	}
	if service.ObservedState == "running" {
		actions.Open = yes
	}
	if service.ObservedState == "running" || service.ObservedState == "stopped" || service.ObservedState == "missing" {
		actions.Stop = yes
	}
	if pendingUninstall(&service) {
		return actions
	}
	if runtime != nil && service.ObservedState == "stopped" {
		actions.Start = yes
	}
	if runtime != nil && (service.ObservedState == "running" || service.ObservedState == "stopped") {
		actions.Restart = yes
	}
	if service.ObservedState == "unknown" && parseHostIdentity(service.RuntimeIdentity).version == "v2" {
		actions.RestoreManagement = yes
	}
	return actions
}

func servicePresentation(service pfregistry.ManagedService, facts ServiceFacts, active, _ *pfregistry.ManagedOperation) (string, string, string) {
	if !activeManagement(service) {
		return service.ManagementState, "inspect", ""
	}
	if active != nil {
		return active.Stage, "inspect", ""
	}
	if pendingUninstall(&service) {
		return "uninstall_pending", "inspect", facts.ProblemCode
	}
	if facts.Ownership == "conflict" {
		return "confirmation_required", "inspect", facts.ProblemCode
	}
	if facts.Presence == "unknown" {
		return "inspection_unavailable", "inspect", facts.ProblemCode
	}
	if facts.Presence == "absent" {
		return "recovery_required", "recover", "INSTANCE_MISSING"
	}
	if facts.Runtime == "running" {
		return "running", "stop", ""
	}
	if facts.Runtime == "stopped" {
		return "stopped", "start", ""
	}
	return "transition", "inspect", facts.ProblemCode
}

func (m *Manager) Create(ctx context.Context, req CreateRequest) (*CreateResult, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	parameterJSON, _ := json.Marshal(req.Parameters)
	noticeJSON, _ := json.Marshal(req.AcceptedNoticeRevisions)
	fingerprint := requestFingerprint("install", req.TemplateID, string(req.Deployment), strings.TrimSpace(req.WorkspacePath), strings.TrimSpace(req.AccessMode), strings.TrimSpace(req.TargetReleaseID), string(parameterJSON), string(noticeJSON))
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
	template, err := m.Template(ctx, strings.TrimSpace(req.TemplateID))
	if err != nil {
		return nil, err
	}
	if !template.Available {
		return nil, serviceError(template.ReasonCode, template.Reason, 409, true, nil)
	}
	if err := validateAcceptedNotices(*template, req.AcceptedNoticeRevisions); err != nil {
		return nil, err
	}
	existingServices, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		return nil, err
	}
	if err := validateServiceFamilyAvailability(existingServices, *template); err != nil {
		return nil, err
	}
	if template.Spec == nil {
		return nil, serviceError("TEMPLATE_UNAVAILABLE", "The template deployment definition is unavailable.", 409, true, nil)
	}
	accessMode := strings.TrimSpace(req.AccessMode)
	if accessMode == "" {
		accessMode = defaultAccessMode(template.DefaultAccessMode)
	}
	if accessMode != pfregistry.AccessModeUnifiedProxy && accessMode != pfregistry.AccessModeDesktopLoopback {
		return nil, serviceError("ACCESS_MODE_INVALID", "The Web Service access mode is invalid.", 400, false, nil)
	}
	if accessMode == pfregistry.AccessModeDesktopLoopback && template.Spec.Endpoint.Scheme != "http" {
		return nil, serviceError("ACCESS_MODE_UNAVAILABLE", "Desktop local compatibility requires an HTTP service.", 409, false, nil)
	}
	if req.Deployment != "" && req.Deployment != template.Deployment {
		return nil, serviceError("DEPLOYMENT_INVALID", "The requested deployment type does not match the selected template.", 400, false, nil)
	}
	serviceID, err := randomID("mws")
	if err != nil {
		return nil, err
	}
	if req.PlanDigest != "" {
		plan, err := m.reviewedInstall(req, *template)
		if err != nil {
			return nil, err
		}
		serviceID = plan.ServiceID
	}
	defaultWorkspace, err := m.defaultWorkspacePath(template.TemplateID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.WorkspacePath) == "" || filepath.Clean(req.WorkspacePath) == filepath.Clean(defaultWorkspace) {
		req.WorkspacePath = filepath.Join(defaultWorkspace, strings.TrimPrefix(serviceID, "mws_"))
	}
	resolved, workspaceOwnership, err := m.resolveInstallWorkspace(strings.TrimSpace(req.WorkspacePath))
	if err != nil {
		return nil, err
	}
	if template.Deployment == DeploymentContainer || template.Deployment == DeploymentCompose {
		if ok, code, reason := m.dockerAvailability(ctx); !ok {
			return nil, serviceError(code, reason, 409, true, nil)
		}
	}
	configuration, secretValues, err := resolveTemplateInputs(*template.Spec, req.Parameters, req.AcceptedNoticeRevisions)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.TargetReleaseID) == "" {
		if err := m.ensureDefaultReleaseAvailable(ctx, *template, secretValues); err != nil {
			return nil, err
		}
	}
	var selectedRelease *cachedReleaseCandidate
	if strings.TrimSpace(req.TargetReleaseID) != "" {
		selectedRelease, err = m.resolveReleaseCandidate(ctx, "template:"+template.TemplateID, req.TargetReleaseID, secretValues, nil, template.Source)
		if err != nil {
			return nil, err
		}
		updated := releaseCandidateTemplate(*template, *selectedRelease)
		template = &updated
	}
	configurationJSON, configurationHash, err := canonicalServiceConfiguration(configuration)
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
	forwardID, err := randomManagedForwardID()
	if err != nil {
		return nil, err
	}
	operationID, err := randomID("mop")
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	releaseIdentity := defaultReleaseIdentity(*template)
	if selectedRelease != nil {
		releaseIdentity = selectedRelease.Identity
	}
	releaseJSON, releaseHash, err := canonicalReleaseIdentity(releaseIdentity)
	if err != nil {
		return nil, err
	}
	bindingJSON, bindingHash, err := newRuntimeBinding(serviceID, template.ServiceFamilyID, template.Deployment)
	if err != nil {
		return nil, err
	}
	service := pfregistry.ManagedService{ServiceID: serviceID, TemplateID: template.TemplateID, WorkspacePath: resolved.RealAbs, WorkspaceOwnership: workspaceOwnership, ConfigurationJSON: configurationJSON, ConfigurationRevision: 1, ConfigurationSHA256: configurationHash, ReleaseIdentityJSON: releaseJSON, ReleaseIdentitySHA256: releaseHash, RuntimeBindingJSON: bindingJSON, RuntimeBindingSHA256: bindingHash, DesiredState: "running", ObservedState: "installing", ForwardID: forwardID, RuntimeManifestJSON: "{}", RuntimePort: port, CreatedAtUnixMs: now, UpdatedAtUnixMs: now}
	forward := pfregistry.Forward{ForwardID: forwardID, TargetURL: fmt.Sprintf("%s://127.0.0.1:%d", template.Spec.Endpoint.Scheme, port), Name: template.Name, Description: "Managed by Redeven", HealthPath: template.Spec.Endpoint.HealthPath, AccessMode: accessMode, CreatedAtUnixMs: now, UpdatedAtUnixMs: now}
	op := pfregistry.ManagedOperation{OperationID: operationID, ServiceID: serviceID, RequestID: strings.TrimSpace(req.RequestID), RequestFingerprint: fingerprint, Action: string(ActionInstall), State: "pending", Stage: "environment_check", ProgressTotal: operationProgressTotal, ProgressDetail: &pfregistry.ManagedOperationProgressDetail{SchemaVersion: pfregistry.ManagedOperationProgressDetailSchemaVersion, StageStartedAtUnixMs: now, UpdatedAtUnixMs: now}, CreatedAtUnixMs: now, UpdatedAtUnixMs: now}
	if err := m.writeServiceSecrets(serviceID, secretValues); err != nil {
		return nil, serviceError("SERVICE_SECRETS_WRITE_FAILED", "The managed-service secret parameters could not be stored securely.", 500, false, err)
	}
	if err := m.registry.CreateManagedServiceWithOperation(ctx, service, forward, op); err != nil {
		_ = os.Remove(m.serviceSecretPath(serviceID))
		return nil, err
	}
	m.launch(service, op, operationInputs{})
	return &CreateResult{Service: service, Operation: op}, nil
}

// ensureDefaultReleaseAvailable prevents a stale catalog recommendation from
// becoming an implicit installation choice. Explicit candidate selections are
// revalidated separately by resolveReleaseCandidate.
func (m *Manager) ensureDefaultReleaseAvailable(ctx context.Context, template Template, parameters map[string]string) error {
	if template.Source != "builtin" || template.Spec == nil || template.RecommendedRelease == nil {
		return nil
	}
	recommended := template.RecommendedRelease
	switch recommended.Kind {
	case "oci":
		if template.Spec.Container == nil || strings.TrimSpace(recommended.Tag) == "" || strings.TrimSpace(recommended.Digest) == "" {
			return serviceError("RECOMMENDED_RELEASE_UNAVAILABLE", "The recommended release is not verifiable. Refresh the version list and select an available release.", 409, true, nil)
		}
		items, err := m.verifyOCIReleaseTags(ctx, *template.Spec, []string{recommended.Tag})
		if err != nil {
			return err
		}
		if len(items) != 1 || !items[0].Compatible || items[0].PlatformDigest != recommended.Digest {
			return serviceError("RECOMMENDED_RELEASE_UNAVAILABLE", "The recommended release is no longer available at its Registry source. Refresh the version list and select an available release.", 409, true, nil)
		}
	case "npm":
		if template.Spec.Host == nil || template.Spec.Host.NPM == nil {
			return serviceError("RECOMMENDED_RELEASE_UNAVAILABLE", "The recommended release is not verifiable. Refresh the version list and select an available release.", 409, true, nil)
		}
		items, err := m.discoverNPMCandidates(ctx, *template.Spec, parameters, nil, template.Source)
		if err != nil {
			return err
		}
		for _, item := range items {
			if sameReleaseIdentity(item.Identity, *recommended) && item.Candidate.Selectable {
				return nil
			}
		}
		return serviceError("RECOMMENDED_RELEASE_UNAVAILABLE", "The recommended release is no longer available at its package Registry. Refresh the version list and select an available release.", 409, true, nil)
	}
	return nil
}

func defaultReleaseIdentity(template Template) ReleaseIdentity {
	trust := "template_declared"
	if template.Source == "builtin" {
		trust = "catalog_reviewed_source"
	}
	identity := ReleaseIdentity{SchemaVersion: 1, Kind: "none", Trust: trust}
	if template.Spec == nil {
		return identity
	}
	if template.Spec.Host != nil && template.Spec.Host.NPM != nil {
		identity.Kind = "npm"
		identity.Source = template.Spec.Host.NPM.PackageName
		identity.Registry = normalizedRegistryURL(template.Spec.Host.NPM.RegistryURL)
		identity.Version = template.Spec.Host.NPM.Version
		identity.Platform = currentPlatformKey()
		return identity
	}
	if template.Spec.Container != nil {
		image := strings.TrimSpace(template.Spec.Container.Image)
		identity.Kind, identity.Source, identity.ArtifactReference, identity.Platform = "oci", releaseImageRepository(image), image, "linux/"+runtime.GOARCH
		if before, digest, ok := strings.Cut(image, "@"); ok {
			identity.Digest = digest
			identity.Tag = releaseImageTag(before)
		}
	}
	return identity
}

func recommendedReleaseForTemplate(template Template) *ReleaseIdentity {
	identity := defaultReleaseIdentity(template)
	if identity.Kind == "none" {
		return nil
	}
	return &identity
}

func releaseImageRepository(reference string) string {
	reference = strings.TrimSpace(reference)
	if before, _, ok := strings.Cut(reference, "@"); ok {
		reference = before
	}
	lastSlash, lastColon := strings.LastIndex(reference, "/"), strings.LastIndex(reference, ":")
	if lastColon > lastSlash {
		reference = reference[:lastColon]
	}
	return strings.TrimSpace(reference)
}

func releaseImageTag(reference string) string {
	lastSlash, lastColon := strings.LastIndex(reference, "/"), strings.LastIndex(reference, ":")
	if lastColon > lastSlash {
		return strings.TrimSpace(reference[lastColon+1:])
	}
	return ""
}

func validateServiceFamilyAvailability(existingServices []pfregistry.ManagedService, template Template) error {
	for _, existing := range existingServices {
		if !activeManagement(existing) {
			continue
		}
		binding, err := decodeRuntimeBinding(&existing)
		if err != nil {
			return err
		}
		if binding.ServiceFamilyID == template.ServiceFamilyID {
			return serviceError("INSTANCE_ALREADY_EXISTS", "This service template family already has an instance in the Environment.", 409, false, nil)
		}
	}
	return nil
}

func retryActionForFailure(failure *pfregistry.ManagedOperation) (OperationAction, error) {
	if failure == nil {
		return "", serviceError("NO_RETRYABLE_FAILURE", "The managed Web Service has no failed operation to retry.", 409, false, nil)
	}
	switch OperationAction(failure.Action) {
	case ActionInstall, ActionRetryInstall:
		return ActionRetryInstall, nil
	case ActionStart, ActionStop, ActionRestart, ActionUninstall:
		return OperationAction(failure.Action), nil
	case ActionUpdate:
		return "", serviceError("RESELECT_RELEASE_REQUIRED", "Select the target release again before updating.", 409, false, nil)
	case ActionReconfigure:
		return "", serviceError("REFLIGHT_REQUIRED", "Run configuration preflight again before applying settings.", 409, false, nil)
	default:
		return "", serviceError("NO_RETRYABLE_FAILURE", "The latest failed operation cannot be retried.", 409, false, nil)
	}
}

func (m *Manager) Operate(ctx context.Context, serviceID string, req OperationRequest) (*pfregistry.ManagedOperation, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}

	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	noticeJSON, _ := json.Marshal(req.AcceptedNoticeRevisions)
	reconfigureJSON, _ := json.Marshal(req.Reconfigure)
	fingerprint := requestFingerprint("operate", strings.TrimSpace(serviceID), string(req.Action), fmt.Sprint(req.DeleteData), fmt.Sprint(req.DeleteWorkspace), strings.TrimSpace(req.UpdatePlanID), string(noticeJSON), string(reconfigureJSON), req.PlanDigest, fmt.Sprint(req.SkipHooks))
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
	if active, err := m.registry.HasActiveManagedOperation(ctx, service.ServiceID); err != nil {
		return nil, err
	} else if active {
		return nil, serviceError("OPERATION_CONFLICT", "Another operation is already running for this service.", 409, true, nil)
	}
	retryOfOperationID := ""
	if req.Action == ActionRetry {
		failure, failureErr := m.registry.GetLatestManagedOperationFailure(ctx, service.ServiceID)
		if failureErr != nil {
			return nil, failureErr
		}
		resolved, resolveErr := retryActionForFailure(failure)
		if resolveErr != nil {
			return nil, resolveErr
		}
		req.Action = resolved
		retryOfOperationID = failure.OperationID
		req.DeleteData = failure.DeleteData
		req.DeleteWorkspace = failure.DeleteWorkspace
	}
	switch req.Action {
	case ActionStart, ActionStop, ActionRestart, ActionRetryInstall, ActionUpdate, ActionReconfigure, ActionUninstall, ActionDetach, ActionRestore, ActionRecover:
	default:
		return nil, serviceError("ACTION_INVALID", "The managed Web Service action is invalid.", 400, false, nil)
	}
	if req.DeleteData && req.Action != ActionUninstall {
		return nil, serviceError("REQUEST_INVALID", "delete_data is valid only for uninstall.", 400, false, nil)
	}
	if req.DeleteWorkspace && req.Action != ActionUninstall {
		return nil, serviceError("REQUEST_INVALID", "delete_workspace is valid only for uninstall.", 400, false, nil)
	}
	if (req.DeleteData || req.DeleteWorkspace) && !req.Administrator {
		return nil, serviceError("ADMIN_REQUIRED", "Administrator permission is required to delete managed service data.", 403, false, nil)
	}
	if (req.Action == ActionDetach || req.SkipHooks) && !req.Administrator {
		return nil, serviceError("ADMIN_REQUIRED", "Administrator permission is required for this recovery action.", 403, false, nil)
	}
	if !activeManagement(*service) && req.Action != ActionRestore && req.Action != ActionRecover && req.Action != ActionUninstall && req.Action != ActionReconfigure {
		return nil, serviceError("SERVICE_NOT_ACTIVE", "Restore management before changing the service lifecycle.", 409, false, nil)
	}
	if pendingUninstall(service) && req.Action != ActionUninstall && req.Action != ActionDetach && req.Action != ActionRecover && req.Action != ActionStop {
		return nil, serviceError("UNINSTALL_PENDING", "Review the unfinished uninstall before changing the service.", 409, true, nil)
	}
	var managementPlan *ManagementPlan
	if requiresManagementPlan(req) {
		managementPlan, err = m.managementPlan(ctx, service, ManagementPlanRequest{RetainResourceIDs: req.RetainResourceIDs, Action: req.Action, DeleteData: req.DeleteData, DeleteWorkspace: req.DeleteWorkspace, SkipHooks: req.SkipHooks})
		if err != nil {
			return nil, err
		}
		if err := validateManagementPlan(managementPlan, req); err != nil {
			return nil, err
		}
	}
	if req.Action == ActionStart || req.Action == ActionRestart {
		facts, inspectErr := m.inspectService(ctx, service, false)
		if inspectErr != nil {
			return nil, inspectErr
		}
		if facts.Presence == "absent" {
			return nil, serviceError("RECOVERY_REQUIRED", "The runtime instance no longer exists. Review recovery before recreating it.", 409, true, nil)
		}
	}
	var reconfigure *reconfigureCandidate
	if req.Action == ActionReconfigure {
		if req.Reconfigure == nil {
			return nil, serviceError("RECONFIGURE_REQUEST_REQUIRED", "Reconfigure settings are required.", 400, false, nil)
		}
		if activeManagement(*service) && (service.DesiredState != "stopped" || (service.ObservedState != "stopped" && service.ObservedState != "missing")) {
			return nil, serviceError("RECONFIGURE_REQUIRES_STOPPED", "Stop the service before applying runtime settings.", 409, true, nil)
		}
		candidate, candidateErr := m.buildReconfigureCandidate(ctx, service, req.Reconfigure.Draft)
		if candidateErr != nil {
			return nil, candidateErr
		}
		if validationErr := validateReconfigureAuthorization(candidate, *req.Reconfigure); validationErr != nil {
			return nil, validationErr
		}
		reconfigure = &candidate
	}
	var releaseCandidate *cachedReleaseCandidate
	var updatePlan *cachedUpdatePlan
	if req.Action == ActionUpdate {
		updatePlan, err = m.resolveUpdatePlan(ctx, service, req.UpdatePlanID)
		if err != nil {
			return nil, err
		}
		if err := validateAcceptedNotices(Template{Notices: updatePlan.Release.Notices}, req.AcceptedNoticeRevisions); err != nil {
			return nil, err
		}
		releaseCandidate = &updatePlan.Release
	}
	m.mu.Lock()
	active, err := m.registry.HasActiveManagedOperation(ctx, service.ServiceID)
	if err == nil && !active && !m.closed {
		operationID, idErr := randomID("mop")
		if idErr != nil {
			err = idErr
		} else {
			now := time.Now().UnixMilli()
			op := pfregistry.ManagedOperation{OperationID: operationID, ServiceID: service.ServiceID, RequestID: strings.TrimSpace(req.RequestID), RequestFingerprint: fingerprint, RetryOfOperationID: retryOfOperationID, Action: string(req.Action), DeleteData: req.DeleteData, DeleteWorkspace: req.DeleteWorkspace, State: "pending", Stage: initialStage(req.Action), ProgressTotal: operationProgressTotal, ProgressDetail: &pfregistry.ManagedOperationProgressDetail{SchemaVersion: pfregistry.ManagedOperationProgressDetailSchemaVersion, StageStartedAtUnixMs: now, UpdatedAtUnixMs: now}, CreatedAtUnixMs: now, UpdatedAtUnixMs: now}
			if err = m.registry.CreateManagedOperation(ctx, op); err == nil {
				if updatePlan != nil {
					m.consumeUpdatePlan(req.UpdatePlanID)
				}
				m.mu.Unlock()
				m.launch(*service, op, operationInputs{DeleteData: req.DeleteData, DeleteWorkspace: req.DeleteWorkspace, ManagementPlan: managementPlan, SkipHooks: req.SkipHooks, AcceptedNoticeRevisions: cloneNoticeRevisions(req.AcceptedNoticeRevisions), Reconfigure: reconfigure, Release: releaseCandidate})
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

func validateReconfigureAuthorization(candidate reconfigureCandidate, request ReconfigureRequest) error {
	if candidate.Plan.PlanDigest != strings.TrimSpace(request.PlanDigest) {
		return serviceError("RESOURCE_PLAN_STALE", "Service settings changed after preflight. Run preflight again.", 409, true, nil)
	}
	accepted := map[string]struct{}{}
	for _, id := range request.AcceptedRiskIDs {
		accepted[strings.TrimSpace(id)] = struct{}{}
	}
	for _, risk := range candidate.Plan.Risks {
		if _, ok := accepted[risk.ID]; !ok {
			return serviceError("RISK_ACKNOWLEDGEMENT_REQUIRED", "Accept every current runtime risk before applying these settings.", 409, false, nil)
		}
		if risk.RequiresAdmin && !request.Administrator {
			return serviceError("ADMIN_REQUIRED", "Administrator permission is required for high-risk runtime settings.", 403, false, nil)
		}
	}
	return nil
}

func initialStage(action OperationAction) string {
	if action == ActionUninstall {
		return "stopping"
	}
	if action == ActionStop {
		return "stopping"
	}
	if action == ActionUpdate {
		return "update_preparing"
	}
	if action == ActionReconfigure {
		return "reconfigure_preflight"
	}
	return "environment_check"
}

type operationInputs struct {
	ManagementPlan          *ManagementPlan
	SkipHooks               bool
	DeleteData              bool
	DeleteWorkspace         bool
	AcceptedNoticeRevisions map[string]int64
	Reconfigure             *reconfigureCandidate
	Release                 *cachedReleaseCandidate
}

func (m *Manager) launch(service pfregistry.ManagedService, op pfregistry.ManagedOperation, inputs operationInputs) {
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
	go m.run(ctx, service, op, inputs)
}

func (m *Manager) run(ctx context.Context, service pfregistry.ManagedService, op pfregistry.ManagedOperation, inputs operationInputs) {
	defer m.workers.Done()
	reporter := newOperationReporter(m, &op, &service)
	ctx = withOperationReporter(ctx, reporter)
	m.mu.Lock()
	if m.reporters == nil {
		m.reporters = map[string]*operationReporter{}
	}
	m.reporters[op.OperationID] = reporter
	m.mu.Unlock()
	defer func() {
		reporter.Close()
		m.mu.Lock()
		delete(m.cancelByOp, op.OperationID)
		delete(m.reporters, op.OperationID)
		m.mu.Unlock()
	}()
	op.State = "running"
	m.saveAndPublish(&op)
	var resolved *resolvedRuntime
	var err error
	var driver deploymentDriver
	if inputs.ManagementPlan != nil {
		current, readErr := m.registry.GetManagedService(ctx, service.ServiceID)
		if readErr != nil {
			err = readErr
		} else if current == nil {
			err = serviceError("SERVICE_NOT_FOUND", "The service record was removed before execution.", 404, false, nil)
		} else {
			var fresh *ManagementPlan
			fresh, err = m.managementPlan(ctx, current, inputs.ManagementPlan.Request)
			if err == nil {
				err = validateManagementPlan(fresh, OperationRequest{PlanDigest: inputs.ManagementPlan.PlanDigest})
			}
			if err == nil {
				service = *current
			}
		}
	}
	if err != nil {
		code, message, _, _ := ErrorDetails(err)
		m.fail(&service, &op, code, message, err)
		return
	}
	if OperationAction(op.Action) == ActionDetach {
		err = m.registry.ArchiveManagedService(ctx, service, "detached")
		if err == nil {
			service.ManagementState = "detached"
			service.ForwardID = ""
		}
	} else {
		binding, bindingErr := decodeRuntimeBinding(&service)
		err = bindingErr
		if err == nil {
			driver = m.driver(binding.Deployment)
		}
		restoresExisting := op.Action == "recover" && inputs.ManagementPlan != nil && inputs.ManagementPlan.Path == "restore_management"
		needsTemplate := op.Action != "stop" && op.Action != "uninstall" && op.Action != "restore" && op.Action != "reconfigure" && !restoresExisting
		if err == nil && needsTemplate {
			resolved, err = m.resolveCurrentRuntime(ctx, &service)
			if err == nil {
				resolved.applyTo(&service)
				err = m.prepareOperationWorkspace(&service, &op)
			}
		}
	}
	if err != nil {
		code, message, _, _ := ErrorDetails(err)
		m.fail(&service, &op, code, message, err)
		return
	}
	ctx = context.WithValue(ctx, skipManagementHooksKey{}, inputs.SkipHooks)
	err = nil
	switch OperationAction(op.Action) {
	case ActionInstall, ActionRetryInstall:
		err = m.runInstall(ctx, &service, &op, driver, resolved)
	case ActionStart:
		err = m.runStart(ctx, &service, &op, driver, resolved)
	case ActionStop:
		err = m.runStop(ctx, &service, &op, driver)
	case ActionRestart:
		if err = m.runStop(ctx, &service, &op, driver); err == nil {
			err = m.runStart(ctx, &service, &op, driver, resolved)
		}
	case ActionUpdate:
		if inputs.Release == nil {
			err = serviceError("UPDATE_PLAN_REQUIRED", "Create and review an update plan before updating this managed Web Service.", 409, false, nil)
			break
		}
		switch resolved.Template.Deployment {
		case DeploymentHost:
			err = m.runHostReleaseUpdate(ctx, &service, &op, inputs.AcceptedNoticeRevisions, *inputs.Release, driver)
		case DeploymentContainer:
			if updateDriver, ok := driver.(containerUpdateDriver); ok {
				err = m.runContainerReleaseUpdate(ctx, &service, &op, inputs.AcceptedNoticeRevisions, *inputs.Release, updateDriver)
			} else {
				err = serviceError("UPDATE_UNSUPPORTED", "This single-container service does not support transactional release replacement.", 409, false, nil)
			}
		case DeploymentCompose:
			err = serviceError("UPDATE_UNSUPPORTED", "Compose services do not expose a single application release to update.", 409, false, nil)
		default:
			err = serviceError("UPDATE_UNSUPPORTED", "This managed Web Service deployment cannot be updated in place.", 409, false, nil)
		}
	case ActionReconfigure:
		if inputs.Reconfigure == nil {
			err = serviceError("RECONFIGURE_REQUEST_REQUIRED", "Reconfigure settings are required.", 400, false, nil)
		} else {
			err = m.runReconfigure(ctx, &service, &op, driver, *inputs.Reconfigure)
		}
	case ActionDetach:
	case ActionRestore:
		err = m.restoreArchivedManagement(ctx, &service)
	case ActionRecover:
		if inputs.ManagementPlan != nil && inputs.ManagementPlan.Path == "restore_management" {
			err = m.restoreArchivedManagement(ctx, &service)
		} else {
			err = m.restoreArchivedManagement(ctx, &service)
			if err == nil {
				blank := ""
				service.RuntimeIdentity = ""
				service.RuntimeManifestJSON = "{}"
				err = m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &blank, RuntimeManifestJSON: &service.RuntimeManifestJSON})
			}
			if err == nil {
				err = m.runInstall(ctx, &service, &op, driver, resolved)
			}
		}
	case ActionUninstall:
		err = m.runManagementUninstall(ctx, &service, &op, driver, inputs.ManagementPlan)
	}
	reporter.Close()
	if err != nil && m.isClosing() {
		op.State, op.Stage = "interrupted", "interrupted"
		op.ErrorCode, op.ErrorMessage = "OPERATION_INTERRUPTED", "The Runtime stopped before the operation completed."
		op.FinishedAtUnixMs = time.Now().UnixMilli()
		m.finalizeAndPublish(&op, pfregistry.ManagedServicePatch{})
		return
	}
	if err != nil {
		if OperationAction(op.Action) == ActionUpdate {
			m.finishUpdateFailure(&service, &op, err)
			return
		}
		if OperationAction(op.Action) == ActionReconfigure {
			m.finishReconfigureFailure(&service, &op, err)
			return
		}
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
			desired, observed := "stopped", "error"
			switch OperationAction(op.Action) {
			case ActionStop:
				observed = service.ObservedState
			case ActionStart, ActionRestart:
				observed = "stopped"
			case ActionUninstall:
				desired, observed = service.DesiredState, service.ObservedState
			}
			m.finalizeAndPublish(&op, pfregistry.ManagedServicePatch{DesiredState: &desired, ObservedState: &observed, LastErrorCode: &op.ErrorCode, LastErrorMessage: &op.ErrorMessage})
			return
		}
		code, message, _, _ := ErrorDetails(err)
		m.fail(&service, &op, code, message, err)
		return
	}
	if OperationAction(op.Action) == ActionUninstall {
		if op.ProgressDetail != nil {
			op.ProgressDetail.Output = nil
			op.ProgressDetail.OutputTruncated = false
		}
		op.State = "succeeded"
		op.Stage = "completed"
		op.ProgressCurrent = operationProgressTotal
		op.FinishedAtUnixMs = time.Now().UnixMilli()
		m.saveAndPublish(&op)
		return
	}
	op.State = "succeeded"
	op.Stage = "completed"
	op.ProgressCurrent = operationProgressTotal
	op.FinishedAtUnixMs = time.Now().UnixMilli()
	blank := ""
	m.finalizeAndPublish(&op, pfregistry.ManagedServicePatch{LastErrorCode: &blank, LastErrorMessage: &blank})
	if OperationAction(op.Action) == ActionInstall || OperationAction(op.Action) == ActionRetryInstall || OperationAction(op.Action) == ActionUpdate {
		m.scheduleReleaseCheck(service.ServiceID)
	}
}

func (m *Manager) runInstall(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver, resolved *resolvedRuntime) error {
	m.progress(op, "environment_check", 1)
	if err := m.ensureInstallWorkspace(ctx, service); err != nil {
		return err
	}
	stage := map[Deployment]string{DeploymentHost: "installing", DeploymentContainer: "pulling", DeploymentCompose: "pulling"}[resolved.Template.Deployment]
	m.progress(op, stage, 2)
	runtimeID, artifact, err := driver.Install(ctx, service, m.operationProgress(op))
	if err != nil {
		return err
	}
	service.RuntimeIdentity, service.ArtifactReference = runtimeID, artifact
	patch := pfregistry.ManagedServicePatch{RuntimeIdentity: &runtimeID, ArtifactReference: &artifact}
	if service.ReleaseIdentityJSON != "" && service.ReleaseIdentitySHA256 != "" {
		patch.ReleaseIdentityJSON, patch.ReleaseIdentitySHA256 = &service.ReleaseIdentityJSON, &service.ReleaseIdentitySHA256
	}
	if err := m.registry.UpdateManagedService(ctx, service.ServiceID, patch); err != nil {
		return err
	}
	m.progress(op, "starting", 5)
	service.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
	runtimeID, err = m.startRuntime(ctx, service, driver)
	if err != nil {
		return err
	}
	service.RuntimeIdentity = runtimeID
	if err = m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &runtimeID}); err != nil {
		return err
	}
	m.progress(op, "health_check", 6)
	if err := m.waitHealthy(ctx, service); err != nil {
		if m.isClosing() {
			return context.Canceled
		}
		_ = driver.Stop(context.Background(), service)
		return serviceError("HEALTH_CHECK_FAILED", "The managed Web Service did not become healthy on its loopback port.", 502, true, err)
	}
	running, blank := "running", ""
	service.DesiredState, service.ObservedState = running, running
	return m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &running, ObservedState: &running, RuntimeSpecSHA256: &resolved.RuntimeSpecSHA256, LastErrorCode: &blank, LastErrorMessage: &blank})
}

func (m *Manager) runStart(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver, resolved *resolvedRuntime) error {
	running := "running"
	service.DesiredState = running
	if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &running}); err != nil {
		return err
	}
	if observer, ok := driver.(runtimeObserver); ok {
		alive, err := observer.Observe(ctx, service)
		if err != nil {
			return err
		}
		if alive {
			service.ObservedState = running
			return m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &running, ObservedState: &running})
		}
	}
	if service.RuntimeSpecSHA256 != resolved.RuntimeSpecSHA256 {
		stage := map[Deployment]string{DeploymentHost: "installing", DeploymentContainer: "pulling", DeploymentCompose: "pulling"}[resolved.Template.Deployment]
		m.progress(op, stage, 2)
		if service.RuntimeIdentity != "" {
			if err := driver.Stop(ctx, service); err != nil {
				return err
			}
		}
		runtimeID, artifact, err := driver.Install(ctx, service, m.operationProgress(op))
		if err != nil {
			return err
		}
		service.RuntimeIdentity, service.ArtifactReference = runtimeID, artifact
		if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &runtimeID, ArtifactReference: &artifact}); err != nil {
			return err
		}
	}
	m.progress(op, "starting", 5)
	service.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
	runtimeID, err := m.startRuntime(ctx, service, driver)
	if err != nil {
		return err
	}
	service.RuntimeIdentity = runtimeID
	if err = m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &runtimeID}); err != nil {
		return err
	}
	m.progress(op, "health_check", 6)
	if err := m.waitHealthy(ctx, service); err != nil {
		if m.isClosing() {
			return context.Canceled
		}
		_ = driver.Stop(context.Background(), service)
		return serviceError("HEALTH_CHECK_FAILED", "The managed Web Service did not become healthy on its loopback port.", 502, true, err)
	}
	blank := ""
	service.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
	return m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &running, RuntimeSpecSHA256: &resolved.RuntimeSpecSHA256, LastErrorCode: &blank, LastErrorMessage: &blank})
}

func (m *Manager) prepareOperationWorkspace(service *pfregistry.ManagedService, op *pfregistry.ManagedOperation) error {
	if service == nil || op == nil {
		return serviceError("WORKSPACE_UNAVAILABLE", "The saved workspace directory is unavailable.", 409, false, nil)
	}
	action := OperationAction(op.Action)
	switch action {
	case ActionStart, ActionRestart:
		mode := workspaceVerifyExisting
		if strings.TrimSpace(op.RetryOfOperationID) != "" {
			mode = workspaceCreateIfMissing
		}
		_, err := m.prepareWorkspace(service.WorkspacePath, mode)
		return err
	case ActionUpdate, ActionReconfigure:
		_, err := m.prepareWorkspace(service.WorkspacePath, workspaceVerifyExisting)
		return err
	default:
		return nil
	}
}

func (m *Manager) runStop(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver) error {
	stopped, desired := "stopped", "stopped"
	if OperationAction(op.Action) == ActionRestart {
		desired = "running"
	}
	service.DesiredState = desired
	if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &desired}); err != nil {
		return err
	}
	m.progress(op, "stopping", 5)
	if err := driver.Stop(ctx, service); err != nil {
		return err
	}
	service.ObservedState = stopped
	blank := ""
	return m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &stopped, LastErrorCode: &blank, LastErrorMessage: &blank})
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

func (m *Manager) finishUpdateFailure(service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, err error) {
	cause, rollbackErr := err, error(nil)
	var updateErr *updateExecutionError
	if errors.As(err, &updateErr) {
		cause, rollbackErr = updateErr.Cause, updateErr.RollbackErr
	}
	if errors.Is(cause, context.Canceled) {
		message := "The update was cancelled and the previous runtime was restored."
		op.State, op.Stage, op.ErrorCode, op.ErrorMessage = "cancelled", "cancelled", "OPERATION_CANCELLED", message
	} else {
		op.State, op.Stage = "failed", "failed"
		op.ErrorCode, op.ErrorMessage, _, _ = ErrorDetails(cause)
	}
	if rollbackErr != nil {
		op.State, op.Stage = "failed", "failed"
		op.ErrorCode, op.ErrorMessage = "UPDATE_ROLLBACK_FAILED", "The update failed and Redeven could not restore the previous verified runtime."
		observed := "unknown"
		op.FinishedAtUnixMs = time.Now().UnixMilli()
		m.finalizeAndPublish(op, pfregistry.ManagedServicePatch{ObservedState: &observed, LastErrorCode: &op.ErrorCode, LastErrorMessage: &op.ErrorMessage})
		m.log.Error("roll back managed Web Service update", "service_id", service.ServiceID, "operation_id", op.OperationID, "cause", safeManagedFailureCause(rollbackErr))
		return
	}
	op.FinishedAtUnixMs = time.Now().UnixMilli()
	m.finalizeAndPublish(op, pfregistry.ManagedServicePatch{})
}

func (m *Manager) finishReconfigureFailure(service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, err error) {
	cause, rollbackErr := err, error(nil)
	var executionErr *reconfigureExecutionError
	if errors.As(err, &executionErr) {
		cause, rollbackErr = executionErr.Cause, executionErr.RollbackErr
	}
	if errors.Is(cause, context.Canceled) {
		op.State, op.Stage = "cancelled", "cancelled"
		op.ErrorCode, op.ErrorMessage = "OPERATION_CANCELLED", "The configuration change was cancelled and the previous stopped Runtime was restored."
	} else {
		op.State, op.Stage = "failed", "failed"
		op.ErrorCode, op.ErrorMessage, _, _ = ErrorDetails(cause)
	}
	if rollbackErr != nil {
		op.State, op.Stage = "failed", "failed"
		op.ErrorCode, op.ErrorMessage = "RECONFIGURE_ROLLBACK_FAILED", "The configuration change failed and Redeven could not restore the previous stopped Runtime."
		observed := "unknown"
		op.FinishedAtUnixMs = time.Now().UnixMilli()
		m.finalizeAndPublish(op, pfregistry.ManagedServicePatch{ObservedState: &observed, LastErrorCode: &op.ErrorCode, LastErrorMessage: &op.ErrorMessage})
		m.log.Error("roll back managed Web Service reconfiguration", "service_id", service.ServiceID, "operation_id", op.OperationID, "cause", safeManagedFailureCause(rollbackErr))
		return
	}
	op.FinishedAtUnixMs = time.Now().UnixMilli()
	m.finalizeAndPublish(op, pfregistry.ManagedServicePatch{})
}

func (m *Manager) reconcileInterruptedService(service *pfregistry.ManagedService, operation pfregistry.ManagedOperation) {
	if operation.Action == "uninstall" || pendingUninstall(service) || (!activeManagement(*service) && !configurationOnlyRecovery(service, &operation)) {
		_, _ = m.observe(context.Background(), service)
		return
	}
	binding, bindingErr := decodeRuntimeBinding(service)
	if bindingErr != nil {
		code, message, _, _ := ErrorDetails(bindingErr)
		observed := "unknown"
		_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &observed, LastErrorCode: &code, LastErrorMessage: &message})
		return
	}
	driver := m.driver(binding.Deployment)
	if driver == nil {
		code, message := "DEPLOYMENT_INVALID", "The interrupted managed Web Service has an invalid deployment type."
		observed := "unknown"
		_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &observed, LastErrorCode: &code, LastErrorMessage: &message})
		return
	}
	if OperationAction(operation.Action) == ActionUpdate {
		if binding.Deployment == DeploymentHost {
			if strings.TrimSpace(service.RuntimeManifestJSON) == "" || strings.TrimSpace(service.RuntimeManifestJSON) == "{}" {
				// Host template metadata updates commit atomically and do not write a
				// Runtime journal, so there is no process transition to recover.
				return
			}
			if err := m.recoverInterruptedHostUpdate(service, &operation, driver); err != nil {
				code, message := "UPDATE_RECOVERY_FAILED", "The interrupted Host update could not restore or finalize a verified Runtime."
				observed := "unknown"
				_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &observed, LastErrorCode: &code, LastErrorMessage: &message})
				m.log.Error("recover interrupted managed Web Service Host update", "service_id", service.ServiceID, "operation_id", operation.OperationID, "cause", safeManagedFailureCause(err))
			}
			return
		}
		updateDriver, ok := driver.(containerUpdateDriver)
		if !ok {
			code, message := "UPDATE_UNSUPPORTED", "The interrupted update deployment cannot be recovered."
			observed := "unknown"
			_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &observed, LastErrorCode: &code, LastErrorMessage: &message})
			return
		}
		if err := m.recoverInterruptedContainerUpdate(service, &operation, updateDriver); err != nil {
			code, message := "UPDATE_RECOVERY_FAILED", "The interrupted update could not restore or finalize a verified runtime."
			observed := "unknown"
			_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &observed, LastErrorCode: &code, LastErrorMessage: &message})
			m.log.Error("recover interrupted managed Web Service update", "service_id", service.ServiceID, "operation_id", operation.OperationID, "cause", safeManagedFailureCause(err))
		}
		return
	}
	if OperationAction(operation.Action) == ActionReconfigure {
		if err := m.recoverInterruptedReconfigure(service, &operation, driver); err != nil {
			code, message := "RECONFIGURE_RECOVERY_FAILED", "The interrupted configuration change could not restore or finalize a verified stopped Runtime."
			observed := "unknown"
			_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{ObservedState: &observed, LastErrorCode: &code, LastErrorMessage: &message})
			m.log.Error("recover interrupted managed Web Service reconfiguration", "service_id", service.ServiceID, "operation_id", operation.OperationID, "cause", safeManagedFailureCause(err))
		}
		return
	}
	_, _ = m.observe(context.Background(), service)
	code, message := "OPERATION_INTERRUPTED", "The Runtime stopped before the operation completed. Review the current service state before retrying."
	_ = m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{LastErrorCode: &code, LastErrorMessage: &message})
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
	if cause != nil && m.log != nil {
		m.log.Error("managed Web Service operation failed", "service_id", service.ServiceID, "operation_id", op.OperationID, "action", op.Action, "error_code", code, "cause", safeManagedFailureCause(cause))
	}
	op.State = "failed"
	op.Stage = "failed"
	op.ErrorCode = code
	op.ErrorMessage = message
	op.FinishedAtUnixMs = time.Now().UnixMilli()
	_, _ = m.observe(context.Background(), service)
	m.finalizeAndPublish(op, pfregistry.ManagedServicePatch{LastErrorCode: &code, LastErrorMessage: &message})
}

func safeManagedFailureCause(cause error) string {
	if cause == nil {
		return ""
	}
	var managedErr *Error
	if errors.As(cause, &managedErr) && managedErr.Cause != nil {
		cause = managedErr.Cause
	}
	switch {
	case errors.Is(cause, os.ErrNotExist):
		return "managed file not found"
	case errors.Is(cause, os.ErrPermission):
		return "managed file permission denied"
	case errors.Is(cause, context.Canceled):
		return "operation canceled"
	case errors.Is(cause, context.DeadlineExceeded):
		return "operation timed out"
	case func() bool { var pathErr *os.PathError; return errors.As(cause, &pathErr) }():
		return "managed file operation failed"
	case func() bool { var networkErr net.Error; return errors.As(cause, &networkErr) }():
		return "network operation failed"
	default:
		return fmt.Sprintf("%T", cause)
	}
}

type operationProgress func(stage string, current int64, transfer ...pfregistry.ManagedOperationTransferProgress)

func discardOperationProgress(string, int64, ...pfregistry.ManagedOperationTransferProgress) {}

func (m *Manager) operationProgress(op *pfregistry.ManagedOperation) operationProgress {
	return func(stage string, current int64, transfer ...pfregistry.ManagedOperationTransferProgress) {
		m.progress(op, stage, current, transfer...)
	}
}

func (m *Manager) progress(op *pfregistry.ManagedOperation, stage string, current int64, transfer ...pfregistry.ManagedOperationTransferProgress) {
	m.mu.Lock()
	reporter := m.reporters[op.OperationID]
	m.mu.Unlock()
	if reporter != nil {
		reporter.Progress(stage, current, transfer...)
		return
	}
	now := time.Now().UnixMilli()
	if op.ProgressDetail == nil {
		op.ProgressDetail = &pfregistry.ManagedOperationProgressDetail{SchemaVersion: pfregistry.ManagedOperationProgressDetailSchemaVersion}
	} else if op.ProgressDetail.SchemaVersion == 0 {
		op.ProgressDetail.SchemaVersion = pfregistry.ManagedOperationProgressDetailSchemaVersion
	}
	if op.Stage != stage || op.ProgressDetail.StageStartedAtUnixMs == 0 {
		op.ProgressDetail.StageStartedAtUnixMs = now
	}
	op.Stage = stage
	op.ProgressCurrent = current
	op.ProgressDetail.UpdatedAtUnixMs = now
	if len(transfer) > 0 {
		value := transfer[len(transfer)-1]
		op.ProgressDetail.Transfer = &value
	} else if stage != "pulling" {
		op.ProgressDetail.Transfer = nil
	}
	m.saveAndPublish(op)
}
func (m *Manager) saveAndPublish(op *pfregistry.ManagedOperation) {
	if err := m.registry.UpdateManagedOperation(context.Background(), *op); err != nil {
		if m.log != nil {
			m.log.Error("persist managed Web Service operation progress", "service_id", op.ServiceID, "operation_id", op.OperationID, "cause", safeManagedFailureCause(err))
		}
		return
	}
	refreshed, err := m.registry.GetManagedOperation(context.Background(), op.OperationID)
	if err != nil && m.log != nil {
		m.log.Error("reload managed Web Service operation progress", "service_id", op.ServiceID, "operation_id", op.OperationID, "cause", safeManagedFailureCause(err))
	}
	if refreshed != nil {
		*op = *refreshed
	}
	m.publish(*op)
}

func (m *Manager) finalizeAndPublish(op *pfregistry.ManagedOperation, patch pfregistry.ManagedServicePatch) {
	if err := m.registry.FinalizeManagedOperation(context.Background(), *op, patch); err != nil {
		if m.log != nil {
			m.log.Error("finalize managed Web Service operation", "service_id", op.ServiceID, "operation_id", op.OperationID, "cause", safeManagedFailureCause(err))
		}
		return
	}
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
	resolved, err := m.resolveCurrentRuntime(ctx, service)
	if err != nil {
		return nil, err
	}
	resolved.applyTo(service)
	driver := m.driver(resolved.Template.Deployment)
	if driver == nil {
		return nil, serviceError("DEPLOYMENT_INVALID", "The saved deployment type is invalid.", 409, false, nil)
	}
	return driver.Logs(ctx, service, tail)
}

type deploymentDriver interface {
	Install(context.Context, *pfregistry.ManagedService, operationProgress) (string, string, error)
	Start(context.Context, *pfregistry.ManagedService) (string, error)
	Stop(context.Context, *pfregistry.ManagedService) error
	Uninstall(context.Context, *pfregistry.ManagedService, bool, operationProgress) error
	CleanupPartial(context.Context, *pfregistry.ManagedService) error
	Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error)
}

func (m *Manager) driver(deployment Deployment) deploymentDriver {
	switch deployment {
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
	if m.healthCheck != nil {
		return m.healthCheck(ctx, service)
	}
	endpoint := WebEndpointSpec{Scheme: "http", HealthPath: "/", StartupTimeout: 45}
	if resolved, err := m.resolveCurrentRuntime(ctx, service); err == nil {
		endpoint = resolved.Spec.Endpoint
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
	return randomIDWithSeparator(prefix, "_")
}

func randomManagedForwardID() (string, error) {
	return randomIDWithSeparator("pf", "-")
}

func randomIDWithSeparator(prefix string, separator string) (string, error) {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + separator + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)), nil
}
