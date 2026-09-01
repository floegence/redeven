package containerengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const maxContainerServiceConfigurationBytes = 256 * 1024

var (
	ErrContainerServiceNotFound          = errors.New("container service was not found")
	ErrContainerServiceUnavailable       = errors.New("container service is unavailable")
	ErrContainerServiceActionUnsupported = errors.New("container service action is unsupported")
	ErrContainerServiceConfigReadOnly    = errors.New("container service configuration is read-only")
	ErrContainerServiceConfigConflict    = errors.New("container service configuration changed externally")
	ErrContainerServiceConfigInvalid     = errors.New("container service configuration is invalid")
	ErrContainerServiceRecoveryRequired  = errors.New("container service recovery is required")
)

type ContainerServiceImplementation string

const (
	ContainerServiceDockerDesktop ContainerServiceImplementation = "docker_desktop"
	ContainerServiceDockerEngine  ContainerServiceImplementation = "docker_engine"
	ContainerServicePodmanMachine ContainerServiceImplementation = "podman_machine"
	ContainerServicePodmanLocal   ContainerServiceImplementation = "podman_local"
	ContainerServiceRemote        ContainerServiceImplementation = "remote"
	ContainerServiceUnavailable   ContainerServiceImplementation = "unavailable"
)

type ContainerServiceState string

const (
	ContainerServiceStateRunning      ContainerServiceState = "running"
	ContainerServiceStateStopped      ContainerServiceState = "stopped"
	ContainerServiceStateNotInstalled ContainerServiceState = "not_installed"
	ContainerServiceStatePermission   ContainerServiceState = "permission"
	ContainerServiceStateUnreachable  ContainerServiceState = "unreachable"
	ContainerServiceStateError        ContainerServiceState = "error"
)

type ContainerServiceConfigurationKind string

const (
	ContainerServiceConfigurationJSON ContainerServiceConfigurationKind = "json"
	ContainerServiceConfigurationTOML ContainerServiceConfigurationKind = "toml"
)

type ContainerServiceConfigurationAccessMode string

const (
	ContainerServiceConfigurationLocal       ContainerServiceConfigurationAccessMode = "local"
	ContainerServiceConfigurationUnavailable ContainerServiceConfigurationAccessMode = "unavailable"
)

type ContainerServiceConfigurationSourceID string

const (
	ContainerServiceConfigurationSourceEngine    ContainerServiceConfigurationSourceID = "engine"
	ContainerServiceConfigurationSourceDockerCLI ContainerServiceConfigurationSourceID = "docker_cli"
)

type ContainerServiceConfigurationSection string

const (
	ContainerServiceConfigurationSectionGeneral     ContainerServiceConfigurationSection = "general"
	ContainerServiceConfigurationSectionProxy       ContainerServiceConfigurationSection = "proxy"
	ContainerServiceConfigurationSectionCredentials ContainerServiceConfigurationSection = "credentials"
	ContainerServiceConfigurationSectionAdvanced    ContainerServiceConfigurationSection = "advanced"
)

type ContainerServiceConfigurationAccess struct {
	Mode    ContainerServiceConfigurationAccessMode `json:"mode"`
	Sources []ContainerServiceConfigurationSourceID `json:"sources,omitempty"`
}

type ContainerServiceGuidanceCode string

const (
	ContainerServiceGuidanceInstall           ContainerServiceGuidanceCode = "install"
	ContainerServiceGuidancePermission        ContainerServiceGuidanceCode = "permission"
	ContainerServiceGuidanceStartOfficial     ContainerServiceGuidanceCode = "start_official"
	ContainerServiceGuidanceCheckActive       ContainerServiceGuidanceCode = "check_active"
	ContainerServiceGuidanceDetectionFailed   ContainerServiceGuidanceCode = "detection_failed"
	ContainerServiceGuidanceSelectDocker      ContainerServiceGuidanceCode = "select_docker_context"
	ContainerServiceGuidanceExternallyManaged ContainerServiceGuidanceCode = "externally_managed"
	ContainerServiceGuidanceHostManager       ContainerServiceGuidanceCode = "host_manager"
	ContainerServiceGuidancePodmanDaemonless  ContainerServiceGuidanceCode = "podman_daemonless"
	ContainerServiceGuidancePodmanMachine     ContainerServiceGuidanceCode = "podman_machine_managed"
	ContainerServiceGuidanceRemoteHost        ContainerServiceGuidanceCode = "remote_host"
)

type ContainerServiceCapabilities struct {
	Start   bool `json:"start"`
	Stop    bool `json:"stop"`
	Restart bool `json:"restart"`
}

// ContainerService is a product-safe projection of one active local container
// implementation. Internal transport and configuration paths are intentionally
// excluded from JSON.
type ContainerService struct {
	ServiceID           string                              `json:"service_id"`
	Engine              Engine                              `json:"engine"`
	Name                string                              `json:"name"`
	Implementation      ContainerServiceImplementation      `json:"implementation"`
	State               ContainerServiceState               `json:"state"`
	Version             string                              `json:"version,omitempty"`
	Rootless            *bool                               `json:"rootless,omitempty"`
	Remote              bool                                `json:"remote"`
	GuidanceCode        ContainerServiceGuidanceCode        `json:"guidance_code,omitempty"`
	Capabilities        ContainerServiceCapabilities        `json:"capabilities"`
	ConfigurationAccess ContainerServiceConfigurationAccess `json:"configuration"`
	RestartRequired     bool                                `json:"restart_required,omitempty"`
	Generation          string                              `json:"generation,omitempty"`

	endpointID           EndpointID
	serviceUnit          string
	serviceUserUnit      bool
	machineName          string
	configurationSources []containerServiceConfigurationSourceDefinition
}

type ContainerServicesResponse struct {
	Services []ContainerService `json:"services"`
}

type ContainerServiceConfigurationSourceStatus string

const (
	ContainerServiceConfigurationSourceReady       ContainerServiceConfigurationSourceStatus = "ready"
	ContainerServiceConfigurationSourceMissing     ContainerServiceConfigurationSourceStatus = "missing"
	ContainerServiceConfigurationSourcePermission  ContainerServiceConfigurationSourceStatus = "permission"
	ContainerServiceConfigurationSourceInvalid     ContainerServiceConfigurationSourceStatus = "invalid"
	ContainerServiceConfigurationSourceUnsupported ContainerServiceConfigurationSourceStatus = "unsupported"
)

type ContainerServiceConfigurationSource struct {
	SourceID            ContainerServiceConfigurationSourceID     `json:"source_id"`
	DisplayPath         string                                    `json:"display_path"`
	Status              ContainerServiceConfigurationSourceStatus `json:"status"`
	Exists              bool                                      `json:"exists"`
	Format              ContainerServiceConfigurationKind         `json:"format"`
	Sections            []ContainerServiceConfigurationSection    `json:"sections"`
	ApplyModes          []ContainerServiceApplyMode               `json:"apply_modes"`
	Content             string                                    `json:"content,omitempty"`
	BaseRevision        string                                    `json:"base_revision,omitempty"`
	HTTPProxy           string                                    `json:"http_proxy,omitempty"`
	HTTPSProxy          string                                    `json:"https_proxy,omitempty"`
	NoProxy             string                                    `json:"no_proxy,omitempty"`
	ProtectedRegistries []string                                  `json:"protected_registries,omitempty"`
	ContextOptions      []string                                  `json:"context_options,omitempty"`
	ContextOverriddenBy string                                    `json:"context_overridden_by,omitempty"`
	RestartRequired     bool                                      `json:"restart_required,omitempty"`
}

type ContainerServiceConfiguration struct {
	ServiceID string                                `json:"service_id"`
	Sources   []ContainerServiceConfigurationSource `json:"sources"`
}

type ContainerServiceActionRequest struct {
	Engine           Engine `json:"engine"`
	ServiceID        string `json:"service_id"`
	ConfirmationName string `json:"confirmation_name,omitempty"`
}

type ContainerServiceConfigurationMode string

const (
	ContainerServiceConfigurationProxy    ContainerServiceConfigurationMode = "proxy"
	ContainerServiceConfigurationDocument ContainerServiceConfigurationMode = "document"
)

type ContainerServiceApplyMode string

const (
	ContainerServiceSave           ContainerServiceApplyMode = "save"
	ContainerServiceSaveAndRestart ContainerServiceApplyMode = "save_and_restart"
)

type ContainerServiceConfigurationUpdateRequest struct {
	Engine           Engine                                `json:"engine"`
	ServiceID        string                                `json:"service_id"`
	SourceID         ContainerServiceConfigurationSourceID `json:"source_id"`
	BaseRevision     string                                `json:"base_revision"`
	Mode             ContainerServiceConfigurationMode     `json:"mode"`
	ApplyMode        ContainerServiceApplyMode             `json:"apply_mode"`
	HTTPProxy        string                                `json:"http_proxy,omitempty"`
	HTTPSProxy       string                                `json:"https_proxy,omitempty"`
	NoProxy          string                                `json:"no_proxy,omitempty"`
	Content          string                                `json:"content,omitempty"`
	ConfirmationName string                                `json:"confirmation_name"`
}

type ContainerServiceActionResult struct {
	ServiceID       string                `json:"service_id"`
	State           ContainerServiceState `json:"state"`
	Revision        string                `json:"revision,omitempty"`
	RestartRequired bool                  `json:"restart_required,omitempty"`
}

// ContainerServiceController is the single host-control boundary for product
// discovery, lifecycle, configuration validation, and configuration updates.
type ContainerServiceController interface {
	ContainerServices(context.Context) ([]ContainerService, error)
	ContainerServiceConfiguration(context.Context, string) (ContainerServiceConfiguration, error)
	ContainerServiceAction(context.Context, Method, ContainerServiceActionRequest) (ContainerServiceActionResult, error)
	ValidateContainerServiceConfiguration(context.Context, ContainerServiceConfigurationUpdateRequest) error
	UpdateContainerServiceConfiguration(context.Context, ContainerServiceConfigurationUpdateRequest) (ContainerServiceActionResult, error)
}

func (a *Adapter) ContainerServices(ctx context.Context) (ContainerServicesResponse, error) {
	client, err := a.containerServiceController()
	if err != nil {
		return ContainerServicesResponse{}, err
	}
	items, err := client.ContainerServices(ctx)
	if err != nil {
		return ContainerServicesResponse{}, err
	}
	return ContainerServicesResponse{Services: items}, nil
}

func (a *Adapter) ContainerService(ctx context.Context, serviceID string) (ContainerService, error) {
	serviceID = strings.TrimSpace(serviceID)
	if !validContainerServiceID(serviceID) {
		return ContainerService{}, ErrContainerServiceNotFound
	}
	response, err := a.ContainerServices(ctx)
	if err != nil {
		return ContainerService{}, err
	}
	for _, service := range response.Services {
		if service.ServiceID == serviceID {
			return service, nil
		}
	}
	return ContainerService{}, ErrContainerServiceNotFound
}

func (a *Adapter) ContainerServiceConfiguration(ctx context.Context, serviceID string) (ContainerServiceConfiguration, error) {
	if !validContainerServiceID(serviceID) {
		return ContainerServiceConfiguration{}, ErrContainerServiceNotFound
	}
	client, err := a.containerServiceController()
	if err != nil {
		return ContainerServiceConfiguration{}, err
	}
	return client.ContainerServiceConfiguration(ctx, strings.TrimSpace(serviceID))
}

func (a *Adapter) ContainerServiceActionPreflight(ctx context.Context, method Method, req ContainerServiceActionRequest) (ResourcePlan, error) {
	if method != MethodContainerServicesStart && method != MethodContainerServicesStop && method != MethodContainerServicesRestart {
		return ResourcePlan{}, fmt.Errorf("%w: %q", ErrInvalidMethod, method)
	}
	service, err := a.ContainerService(ctx, req.ServiceID)
	if err != nil {
		return ResourcePlan{}, err
	}
	if req.Engine != service.Engine {
		return ResourcePlan{}, errors.New("container service engine does not match")
	}
	if (method == MethodContainerServicesStop || method == MethodContainerServicesRestart) && strings.TrimSpace(req.ConfirmationName) != service.Name {
		return ResourcePlan{}, errors.New("confirmation_name must match the container service name")
	}
	if !serviceSupportsMethod(service, method) {
		return ResourcePlan{}, ErrContainerServiceActionUnsupported
	}
	risk := RiskLevelMedium
	flags := []RiskFlag(nil)
	if method == MethodContainerServicesStop || method == MethodContainerServicesRestart {
		risk = RiskLevelHigh
		flags = []RiskFlag{{ID: "container_service_interruption", Severity: RiskSeverityHigh, Title: "Container service interruption", Detail: "Running containers and dependent Web Services may be interrupted.", AdminRequired: true}}
	}
	target := map[string]any{
		"engine": string(service.Engine), "resource_kind": "container_service", "service_id": service.ServiceID,
		"name": service.Name, "implementation": service.Implementation, "state": service.State,
	}
	return BuildResourcePlan(method, target, req, risk, flags, true, "Apply the reviewed lifecycle action to this container service")
}

func (a *Adapter) ContainerServiceConfigurationPreflight(ctx context.Context, req ContainerServiceConfigurationUpdateRequest) (ResourcePlan, error) {
	service, err := a.ContainerService(ctx, req.ServiceID)
	if err != nil {
		return ResourcePlan{}, err
	}
	if req.Engine != service.Engine || strings.TrimSpace(req.ConfirmationName) != service.Name {
		return ResourcePlan{}, errors.New("container service confirmation is invalid")
	}
	if service.ConfigurationAccess.Mode != ContainerServiceConfigurationLocal {
		return ResourcePlan{}, ErrContainerServiceConfigReadOnly
	}
	if err := validateContainerServiceConfigurationUpdate(req); err != nil {
		return ResourcePlan{}, err
	}
	current, err := a.ContainerServiceConfiguration(ctx, service.ServiceID)
	if err != nil {
		return ResourcePlan{}, err
	}
	currentSource, ok := containerServiceConfigurationSource(current, req.SourceID)
	if !ok || strings.TrimSpace(req.BaseRevision) != currentSource.BaseRevision {
		return ResourcePlan{}, ErrContainerServiceConfigConflict
	}
	client, err := a.containerServiceController()
	if err != nil {
		return ResourcePlan{}, err
	}
	if err := client.ValidateContainerServiceConfiguration(ctx, req); err != nil {
		return ResourcePlan{}, err
	}
	flags := []RiskFlag{{ID: "container_service_configuration", Severity: RiskSeverityHigh, Title: "Container service configuration", Detail: "Invalid settings can prevent the container service from starting.", AdminRequired: true}}
	if req.ApplyMode == ContainerServiceSaveAndRestart {
		flags = append(flags, RiskFlag{ID: "container_service_interruption", Severity: RiskSeverityHigh, Title: "Container service restart", Detail: "Running containers and dependent Web Services may be interrupted.", AdminRequired: true})
	}
	target := map[string]any{
		"engine": string(service.Engine), "resource_kind": "container_service", "service_id": service.ServiceID,
		"name": service.Name, "implementation": service.Implementation, "source_id": req.SourceID,
		"base_revision": currentSource.BaseRevision, "mode": req.Mode, "apply_mode": req.ApplyMode,
	}
	// The target intentionally excludes configuration content and proxy values.
	return BuildResourcePlan(MethodContainerServicesConfig, target, req, RiskLevelHigh, flags, true, "Validate and replace this container service configuration")
}

func (a *Adapter) ContainerServiceAction(ctx context.Context, method Method, req ContainerServiceActionRequest) (ContainerServiceActionResult, error) {
	if _, err := a.ContainerServiceActionPreflight(ctx, method, req); err != nil {
		return ContainerServiceActionResult{}, err
	}
	client, err := a.containerServiceController()
	if err != nil {
		return ContainerServiceActionResult{}, err
	}
	return client.ContainerServiceAction(ctx, method, req)
}

func (a *Adapter) UpdateContainerServiceConfiguration(ctx context.Context, req ContainerServiceConfigurationUpdateRequest) (ContainerServiceActionResult, error) {
	if _, err := a.ContainerServiceConfigurationPreflight(ctx, req); err != nil {
		return ContainerServiceActionResult{}, err
	}
	client, err := a.containerServiceController()
	if err != nil {
		return ContainerServiceActionResult{}, err
	}
	return client.UpdateContainerServiceConfiguration(ctx, req)
}

func (a *Adapter) containerServiceController() (ContainerServiceController, error) {
	client, ok := a.client.(ContainerServiceController)
	if !ok || interfaceIsNil(client) {
		return nil, ErrResourceCapabilityUnsupported
	}
	return client, nil
}

func serviceSupportsMethod(service ContainerService, method Method) bool {
	switch method {
	case MethodContainerServicesStart:
		return service.Capabilities.Start
	case MethodContainerServicesStop:
		return service.Capabilities.Stop
	case MethodContainerServicesRestart:
		return service.Capabilities.Restart
	default:
		return false
	}
}

func validateContainerServiceConfigurationUpdate(req ContainerServiceConfigurationUpdateRequest) error {
	if !req.Engine.Valid() || !validContainerServiceID(req.ServiceID) || !req.SourceID.valid() || strings.TrimSpace(req.BaseRevision) == "" {
		return errors.New("container service configuration target is invalid")
	}
	if req.ApplyMode != ContainerServiceSave && req.ApplyMode != ContainerServiceSaveAndRestart {
		return errors.New("container service apply mode is invalid")
	}
	switch req.Mode {
	case ContainerServiceConfigurationProxy:
		for _, value := range []string{req.HTTPProxy, req.HTTPSProxy, req.NoProxy} {
			if len(value) > 4096 || hasControl(value) {
				return errors.New("container service proxy value is invalid")
			}
		}
		if req.Content != "" {
			return errors.New("configuration content is not accepted in proxy mode")
		}
	case ContainerServiceConfigurationDocument:
		if len(req.Content) > maxContainerServiceConfigurationBytes || strings.IndexByte(req.Content, 0) >= 0 {
			return ErrContainerServiceConfigInvalid
		}
		if req.HTTPProxy != "" || req.HTTPSProxy != "" || req.NoProxy != "" {
			return errors.New("proxy fields are not accepted in document mode")
		}
	default:
		return errors.New("container service configuration mode is invalid")
	}
	return nil
}

func (id ContainerServiceConfigurationSourceID) valid() bool {
	return id == ContainerServiceConfigurationSourceEngine || id == ContainerServiceConfigurationSourceDockerCLI
}

func containerServiceConfigurationSource(configuration ContainerServiceConfiguration, sourceID ContainerServiceConfigurationSourceID) (ContainerServiceConfigurationSource, bool) {
	for _, source := range configuration.Sources {
		if source.SourceID == sourceID {
			return source, true
		}
	}
	return ContainerServiceConfigurationSource{}, false
}

func validContainerServiceID(value string) bool {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "container_service_") || len(value) != len("container_service_")+64 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "container_service_"))
	return err == nil
}

func containerServiceID(engine Engine, implementation ContainerServiceImplementation, identity string) string {
	value := strings.Join([]string{string(engine), string(implementation), strings.TrimSpace(identity)}, "\x00")
	digest := sha256.Sum256([]byte(value))
	return "container_service_" + hex.EncodeToString(digest[:])
}
