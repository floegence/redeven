package containers

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
)

var ErrEndpointNotFound = errors.New("container engine endpoint was not found")

type EngineEndpoint struct {
	EndpointID    EndpointID `json:"endpoint_id"`
	Engine        Engine     `json:"engine"`
	DisplayName   string     `json:"display_name"`
	Default       bool       `json:"default"`
	Remote        bool       `json:"remote"`
	Available     bool       `json:"available"`
	EngineVersion string     `json:"engine_version,omitempty"`
	Rootless      *bool      `json:"rootless,omitempty"`
}

type EndpointListRequest struct {
	Engine Engine `json:"engine"`
}

type EndpointListResponse struct {
	Engine    Engine           `json:"engine"`
	Endpoints []EngineEndpoint `json:"endpoints"`
}

type EndpointStatusRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id"`
}

type ComposeProject struct {
	ProjectID      string `json:"project_id"`
	Name           string `json:"name"`
	Status         string `json:"status"`
	ServiceCount   int    `json:"service_count"`
	ContainerCount int    `json:"container_count"`
	RunningCount   int    `json:"running_count"`
}

type ComposeProjectContainer struct {
	ContainerID string         `json:"container_id"`
	Name        string         `json:"name,omitempty"`
	Service     string         `json:"service,omitempty"`
	State       ContainerState `json:"state"`
	Health      string         `json:"health,omitempty"`
}

type ComposeProjectDetails struct {
	ComposeProject
	Containers []ComposeProjectContainer `json:"containers"`
}

type ComposeProjectRequest struct {
	Engine           Engine     `json:"engine"`
	EndpointID       EndpointID `json:"endpoint_id"`
	ProjectID        string     `json:"project_id"`
	ConfirmationName string     `json:"confirmation_name,omitempty"`
}

type ComposeProjectListRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id"`
}

type PodRecord struct {
	PodID           string         `json:"pod_id"`
	Name            string         `json:"name"`
	Status          string         `json:"status"`
	InfraID         string         `json:"infra_id,omitempty"`
	ContainerCount  int            `json:"container_count"`
	RunningCount    int            `json:"running_count"`
	CreatedAtUnixMs int64          `json:"created_at_unix_ms,omitempty"`
	Ports           []PortSummary  `json:"ports,omitempty"`
	Containers      []PodContainer `json:"containers,omitempty"`
}

type PodContainer struct {
	ContainerID string         `json:"container_id"`
	Name        string         `json:"name,omitempty"`
	State       ContainerState `json:"state"`
	Infra       bool           `json:"infra"`
}

type PodListRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id"`
}

type PodRequest struct {
	Engine           Engine     `json:"engine"`
	EndpointID       EndpointID `json:"endpoint_id"`
	PodID            string     `json:"pod_id"`
	ConfirmationName string     `json:"confirmation_name,omitempty"`
}

type PodCreateRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id"`
	Name       string     `json:"name"`
}

type WorkspaceActionResponse struct {
	Accepted   bool       `json:"accepted"`
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id"`
	Method     Method     `json:"method"`
	Identity   string     `json:"identity"`
}

type endpointBinder interface {
	BindEndpoint(context.Context, Engine, EndpointID) (context.Context, EngineEndpoint, error)
}

type engineWorkspaceClient interface {
	ListEndpoints(context.Context, Engine) ([]EngineEndpoint, error)
	ListComposeProjects(context.Context) ([]ComposeProject, error)
	InspectComposeProject(context.Context, string) (ComposeProjectDetails, error)
	ComposeProjectAction(context.Context, Method, string) error
	ListPods(context.Context) ([]PodRecord, error)
	InspectPod(context.Context, string) (PodRecord, error)
	CreatePod(context.Context, PodCreateRequest) (PodRecord, error)
	PodAction(context.Context, Method, string) error
}

type endpointMetadataClient interface {
	EndpointMetadata(context.Context, EngineEndpoint) (EngineEndpoint, error)
}

func (a *Adapter) BindEndpoint(ctx context.Context, engine Engine, endpointID EndpointID) (context.Context, EngineEndpoint, error) {
	if err := validateEngine(engine); err != nil {
		return nil, EngineEndpoint{}, err
	}
	binder, ok := a.client.(endpointBinder)
	if !ok || interfaceIsNil(binder) {
		if strings.TrimSpace(string(endpointID)) == "" {
			return ctx, EngineEndpoint{Engine: engine, DisplayName: string(engine), Default: true}, nil
		}
		return nil, EngineEndpoint{}, ErrResourceCapabilityUnsupported
	}
	return binder.BindEndpoint(ctx, engine, endpointID)
}

func (a *Adapter) ListEndpoints(ctx context.Context, req EndpointListRequest) (EndpointListResponse, error) {
	if err := validateEngine(req.Engine); err != nil {
		return EndpointListResponse{}, err
	}
	client, err := a.workspaceClient()
	if err != nil {
		return EndpointListResponse{}, err
	}
	items, err := client.ListEndpoints(ctx, req.Engine)
	if err != nil {
		return EndpointListResponse{}, err
	}
	return EndpointListResponse{Engine: req.Engine, Endpoints: items}, nil
}

func (a *Adapter) EndpointStatus(ctx context.Context, req EndpointStatusRequest) (EngineEndpoint, error) {
	bound, endpoint, err := a.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return EngineEndpoint{}, err
	}
	status, err := a.client.Status(bound, req.Engine)
	endpoint.Available = err == nil && status.Available
	endpoint.EngineVersion = strings.TrimSpace(status.Version)
	if err != nil {
		return endpoint, err
	}
	if metadata, ok := a.client.(endpointMetadataClient); ok && !interfaceIsNil(metadata) {
		endpoint, err = metadata.EndpointMetadata(bound, endpoint)
		if err != nil {
			return endpoint, err
		}
	}
	return endpoint, nil
}

func (a *Adapter) ListComposeProjects(ctx context.Context, req ComposeProjectListRequest) ([]ComposeProject, error) {
	if req.Engine != EngineDocker {
		return nil, ErrResourceCapabilityUnsupported
	}
	bound, _, err := a.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return nil, err
	}
	client, err := a.workspaceClient()
	if err != nil {
		return nil, err
	}
	return client.ListComposeProjects(bound)
}

func (a *Adapter) InspectComposeProject(ctx context.Context, req ComposeProjectRequest) (ComposeProjectDetails, error) {
	if req.Engine != EngineDocker || invalidWorkspaceIdentity(req.ProjectID) {
		return ComposeProjectDetails{}, errors.New("compose project identity is invalid")
	}
	bound, _, err := a.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return ComposeProjectDetails{}, err
	}
	client, err := a.workspaceClient()
	if err != nil {
		return ComposeProjectDetails{}, err
	}
	return client.InspectComposeProject(bound, strings.TrimSpace(req.ProjectID))
}

func (a *Adapter) ComposeProjectPreflight(ctx context.Context, method Method, req ComposeProjectRequest) (ResourcePlan, error) {
	if !composeAction(method) {
		return ResourcePlan{}, fmt.Errorf("%w: %q", ErrInvalidMethod, method)
	}
	project, err := a.InspectComposeProject(ctx, req)
	if err != nil {
		return ResourcePlan{}, err
	}
	if method == MethodComposeProjectsDown && strings.TrimSpace(req.ConfirmationName) != project.Name {
		return ResourcePlan{}, errors.New("confirmation_name must match the Compose project name")
	}
	risk := RiskLevelMedium
	flags := []RiskFlag(nil)
	if method == MethodComposeProjectsDown {
		risk = RiskLevelHigh
		flags = []RiskFlag{{ID: "compose_project_down", Severity: RiskSeverityHigh, Title: "Compose project removal", Detail: "The project containers and networks will be removed. Volumes are retained."}}
	}
	target := map[string]any{"engine": string(req.Engine), "endpoint_id": req.EndpointID, "resource_kind": "compose_project", "project_id": project.ProjectID, "name": project.Name, "container_count": project.ContainerCount}
	return BuildResourcePlan(method, target, req, risk, flags, false, "Apply the reviewed action to this Compose project")
}

func (a *Adapter) ComposeProjectAction(ctx context.Context, method Method, req ComposeProjectRequest) (WorkspaceActionResponse, error) {
	if _, err := a.ComposeProjectPreflight(ctx, method, req); err != nil {
		return WorkspaceActionResponse{}, err
	}
	bound, _, err := a.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return WorkspaceActionResponse{}, err
	}
	client, err := a.workspaceClient()
	if err != nil {
		return WorkspaceActionResponse{}, err
	}
	if err := client.ComposeProjectAction(bound, method, strings.TrimSpace(req.ProjectID)); err != nil {
		return WorkspaceActionResponse{}, err
	}
	return WorkspaceActionResponse{Accepted: true, Engine: req.Engine, EndpointID: req.EndpointID, Method: method, Identity: strings.TrimSpace(req.ProjectID)}, nil
}

func (a *Adapter) ListPods(ctx context.Context, req PodListRequest) ([]PodRecord, error) {
	if req.Engine != EnginePodman {
		return nil, ErrResourceCapabilityUnsupported
	}
	bound, _, err := a.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return nil, err
	}
	client, err := a.workspaceClient()
	if err != nil {
		return nil, err
	}
	return client.ListPods(bound)
}

func (a *Adapter) InspectPod(ctx context.Context, req PodRequest) (PodRecord, error) {
	if req.Engine != EnginePodman || invalidWorkspaceIdentity(req.PodID) {
		return PodRecord{}, errors.New("Pod identity is invalid")
	}
	bound, _, err := a.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return PodRecord{}, err
	}
	client, err := a.workspaceClient()
	if err != nil {
		return PodRecord{}, err
	}
	return client.InspectPod(bound, strings.TrimSpace(req.PodID))
}

func (a *Adapter) CreatePodPreflight(ctx context.Context, req PodCreateRequest) (ResourcePlan, error) {
	if req.Engine != EnginePodman || !containerNamePattern.MatchString(strings.TrimSpace(req.Name)) || !req.EndpointID.Valid() {
		return ResourcePlan{}, errors.New("Pod create request is invalid")
	}
	if _, _, err := a.BindEndpoint(ctx, req.Engine, req.EndpointID); err != nil {
		return ResourcePlan{}, err
	}
	target := map[string]any{"engine": string(req.Engine), "endpoint_id": req.EndpointID, "resource_kind": "pod", "name": strings.TrimSpace(req.Name)}
	return BuildResourcePlan(MethodPodsCreate, target, req, RiskLevelLow, nil, false, "Create the Pod with the reviewed name")
}

func (a *Adapter) CreatePod(ctx context.Context, req PodCreateRequest) (PodRecord, error) {
	if _, err := a.CreatePodPreflight(ctx, req); err != nil {
		return PodRecord{}, err
	}
	bound, _, err := a.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return PodRecord{}, err
	}
	client, err := a.workspaceClient()
	if err != nil {
		return PodRecord{}, err
	}
	return client.CreatePod(bound, req)
}

func (a *Adapter) PodActionPreflight(ctx context.Context, method Method, req PodRequest) (ResourcePlan, error) {
	if !podAction(method) {
		return ResourcePlan{}, fmt.Errorf("%w: %q", ErrInvalidMethod, method)
	}
	pod, err := a.InspectPod(ctx, req)
	if err != nil {
		return ResourcePlan{}, err
	}
	if method == MethodPodsRemove && strings.TrimSpace(req.ConfirmationName) != pod.Name {
		return ResourcePlan{}, errors.New("confirmation_name must match the Pod name")
	}
	risk := RiskLevelMedium
	flags := []RiskFlag(nil)
	if method == MethodPodsRemove {
		risk = RiskLevelHigh
		flags = []RiskFlag{{ID: "pod_remove", Severity: RiskSeverityHigh, Title: "Pod removal", Detail: "The Pod and its member containers will be removed."}}
	}
	target := map[string]any{"engine": string(req.Engine), "endpoint_id": req.EndpointID, "resource_kind": "pod", "pod_id": pod.PodID, "name": pod.Name, "container_count": pod.ContainerCount}
	return BuildResourcePlan(method, target, req, risk, flags, false, "Apply the reviewed action to this Pod")
}

func (a *Adapter) PodAction(ctx context.Context, method Method, req PodRequest) (WorkspaceActionResponse, error) {
	if _, err := a.PodActionPreflight(ctx, method, req); err != nil {
		return WorkspaceActionResponse{}, err
	}
	bound, _, err := a.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return WorkspaceActionResponse{}, err
	}
	client, err := a.workspaceClient()
	if err != nil {
		return WorkspaceActionResponse{}, err
	}
	if err := client.PodAction(bound, method, strings.TrimSpace(req.PodID)); err != nil {
		return WorkspaceActionResponse{}, err
	}
	return WorkspaceActionResponse{Accepted: true, Engine: req.Engine, EndpointID: req.EndpointID, Method: method, Identity: strings.TrimSpace(req.PodID)}, nil
}

func (a *Adapter) workspaceClient() (engineWorkspaceClient, error) {
	client, ok := a.client.(engineWorkspaceClient)
	if !ok || interfaceIsNil(client) {
		return nil, ErrResourceCapabilityUnsupported
	}
	return client, nil
}

func interfaceIsNil(value any) bool {
	if value == nil {
		return true
	}
	ref := reflect.ValueOf(value)
	return ref.Kind() == reflect.Pointer && ref.IsNil()
}

func invalidWorkspaceIdentity(value string) bool {
	value = strings.TrimSpace(value)
	return value == "" || len(value) > 256 || strings.HasPrefix(value, "-") || hasControl(value)
}

func composeAction(method Method) bool {
	return method == MethodComposeProjectsStart || method == MethodComposeProjectsStop || method == MethodComposeProjectsRestart || method == MethodComposeProjectsDown
}

func podAction(method Method) bool {
	return method == MethodPodsStart || method == MethodPodsStop || method == MethodPodsRestart || method == MethodPodsRemove
}
