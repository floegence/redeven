package containerengine

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/floegence/redeven/internal/processenv"
	toml "github.com/pelletier/go-toml/v2"
)

type CommandEnvironmentRunner interface {
	RunEnv(ctx context.Context, env []string, name string, args ...string) ([]byte, error)
}

type containerServiceConfigurationSourceDefinition struct {
	sourceID        ContainerServiceConfigurationSourceID
	path            string
	displayPath     string
	kind            ContainerServiceConfigurationKind
	sections        []ContainerServiceConfigurationSection
	supportsRestart bool
	clientProxy     bool
}

func (c *CLIClient) ContainerServices(ctx context.Context) ([]ContainerService, error) {
	services := make([]ContainerService, 2)
	done := make(chan struct{}, 2)
	go func() {
		services[0] = c.discoverDockerService(ctx)
		done <- struct{}{}
	}()
	go func() {
		services[1] = c.discoverPodmanService(ctx)
		done <- struct{}{}
	}()
	for range services {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-done:
		}
	}
	return services, nil
}

func (c *CLIClient) discoverDockerService(ctx context.Context) ContainerService {
	base := ContainerService{
		Engine: EngineDocker, Name: "Docker", Implementation: ContainerServiceUnavailable,
		ConfigurationAccess: unavailableContainerServiceConfiguration(),
	}
	endpoints, err := c.listDockerContexts(ctx)
	if err != nil {
		base.State = containerServiceStateFromError(err)
		base.ServiceID = containerServiceID(EngineDocker, base.Implementation, "local")
		base.GuidanceCode = containerServiceGuidance(base.State)
		return base
	}
	endpoint := activeEndpoint(endpoints)
	if endpoint == nil {
		base.State = ContainerServiceStateStopped
		base.ServiceID = containerServiceID(EngineDocker, base.Implementation, "local")
		base.GuidanceCode = ContainerServiceGuidanceSelectDocker
		return base
	}
	if endpoint.Remote {
		return ContainerService{
			ServiceID: containerServiceID(EngineDocker, ContainerServiceRemote, string(endpoint.EndpointID)), Engine: EngineDocker,
			Name: "Remote Docker", Implementation: ContainerServiceRemote, State: c.endpointServiceState(ctx, *endpoint),
			Remote: true, GuidanceCode: ContainerServiceGuidanceRemoteHost, endpointID: endpoint.EndpointID,
			ConfigurationAccess: unavailableContainerServiceConfiguration(),
		}
	}
	bound, _, bindErr := c.BindEndpoint(ctx, EngineDocker, endpoint.EndpointID)
	status, statusErr := EngineStatus{Engine: EngineDocker}, bindErr
	if bindErr == nil {
		status, statusErr = c.Status(bound, EngineDocker)
	}
	if desktopState, ok := c.dockerDesktopState(ctx); ok {
		state := desktopState
		if statusErr == nil && status.Available {
			state = ContainerServiceStateRunning
		}
		return ContainerService{
			ServiceID: containerServiceID(EngineDocker, ContainerServiceDockerDesktop, "local"), Engine: EngineDocker,
			Name: "Docker Desktop", Implementation: ContainerServiceDockerDesktop, State: state, Version: status.Version,
			Capabilities:        ContainerServiceCapabilities{Start: true, Stop: true, Restart: true},
			ConfigurationAccess: localContainerServiceConfiguration(ContainerServiceConfigurationSourceEngine, ContainerServiceConfigurationSourceClientProxy),
			endpointID:          endpoint.EndpointID,
			Generation:          serviceGeneration(status.Version, state),
			configurationSources: []containerServiceConfigurationSourceDefinition{
				c.dockerEngineConfigurationSource(true),
				c.dockerClientProxyConfigurationSource(),
			},
		}
	}
	service := ContainerService{
		ServiceID: containerServiceID(EngineDocker, ContainerServiceDockerEngine, "local"), Engine: EngineDocker,
		Name: "Docker Engine", Implementation: ContainerServiceDockerEngine, State: containerServiceStateFromStatus(status, statusErr),
		Version: status.Version, endpointID: endpoint.EndpointID,
		ConfigurationAccess: unavailableContainerServiceConfiguration(),
	}
	service.Generation = serviceGeneration(service.Version, service.State)
	service.serviceUnit, service.serviceUserUnit = c.detectDockerSystemdUnit(ctx)
	service.Capabilities.Start = service.serviceUnit != ""
	service.Capabilities.Stop = service.serviceUnit != ""
	service.Capabilities.Restart = service.serviceUnit != ""
	engineSource := c.dockerEngineConfigurationSource(false)
	if service.serviceUserUnit {
		engineSource = c.dockerRootlessEngineConfigurationSource()
	}
	clientSource := c.dockerClientProxyConfigurationSource()
	if engineSource.path != "" {
		service.configurationSources = append(service.configurationSources, engineSource)
	}
	if clientSource.path != "" {
		service.configurationSources = append(service.configurationSources, clientSource)
	}
	if len(service.configurationSources) > 0 {
		ids := make([]ContainerServiceConfigurationSourceID, 0, len(service.configurationSources))
		for _, source := range service.configurationSources {
			ids = append(ids, source.sourceID)
		}
		service.ConfigurationAccess = localContainerServiceConfiguration(ids...)
	} else {
		service.GuidanceCode = ContainerServiceGuidanceExternallyManaged
	}
	if service.serviceUnit == "" && service.GuidanceCode == "" {
		service.GuidanceCode = ContainerServiceGuidanceHostManager
	}
	return service
}

func (c *CLIClient) discoverPodmanService(ctx context.Context) ContainerService {
	base := ContainerService{
		Engine: EnginePodman, Name: "Podman", Implementation: ContainerServiceUnavailable,
		ConfigurationAccess: unavailableContainerServiceConfiguration(),
	}
	endpoints, err := c.listPodmanConnections(ctx)
	if err != nil {
		base.State = containerServiceStateFromError(err)
		base.ServiceID = containerServiceID(EnginePodman, base.Implementation, "local")
		base.GuidanceCode = containerServiceGuidance(base.State)
		return base
	}
	endpoint := activeEndpoint(endpoints)
	if endpoint == nil {
		base.State = ContainerServiceStateStopped
		base.ServiceID = containerServiceID(EnginePodman, base.Implementation, "local")
		base.GuidanceCode = ContainerServiceGuidanceStartOfficial
		return base
	}
	bound, _, bindErr := c.BindEndpoint(ctx, EnginePodman, endpoint.EndpointID)
	status, statusErr := EngineStatus{Engine: EnginePodman}, bindErr
	var rootless *bool
	if bindErr == nil {
		status, statusErr = c.Status(bound, EnginePodman)
		if statusErr == nil {
			if metadata, metadataErr := c.EndpointMetadata(bound, *endpoint); metadataErr == nil {
				rootless = metadata.Rootless
			}
		}
	}
	if !endpoint.Remote {
		service := ContainerService{
			ServiceID: containerServiceID(EnginePodman, ContainerServicePodmanLocal, "local"), Engine: EnginePodman,
			Name: "Local Podman", Implementation: ContainerServicePodmanLocal, State: containerServiceStateFromStatus(status, statusErr),
			Version: status.Version, Rootless: rootless, endpointID: endpoint.EndpointID,
			ConfigurationAccess: unavailableContainerServiceConfiguration(), GuidanceCode: ContainerServiceGuidancePodmanDaemonless,
			Generation: serviceGeneration(status.Version, containerServiceStateFromStatus(status, statusErr)),
		}
		source := c.podmanEngineConfigurationSource()
		if source.path != "" {
			service.configurationSources = []containerServiceConfigurationSourceDefinition{source}
			service.ConfigurationAccess = localContainerServiceConfiguration(ContainerServiceConfigurationSourceEngine)
		}
		return service
	}
	machine, matched := c.podmanMachineForConnection(ctx, endpoint.Address)
	if !matched {
		return ContainerService{
			ServiceID: containerServiceID(EnginePodman, ContainerServiceRemote, string(endpoint.EndpointID)), Engine: EnginePodman,
			Name: "Remote Podman", Implementation: ContainerServiceRemote, State: containerServiceStateFromStatus(status, statusErr),
			Version: status.Version, Rootless: rootless, Remote: true, GuidanceCode: ContainerServiceGuidanceRemoteHost, endpointID: endpoint.EndpointID,
			ConfigurationAccess: unavailableContainerServiceConfiguration(),
			Generation:          serviceGeneration(status.Version, containerServiceStateFromStatus(status, statusErr)),
		}
	}
	state := containerServiceStateFromStatus(status, statusErr)
	if !machine.Running && statusErr != nil {
		state = ContainerServiceStateStopped
	}
	return ContainerService{
		ServiceID: containerServiceID(EnginePodman, ContainerServicePodmanMachine, machine.Name), Engine: EnginePodman,
		Name: "Podman Machine " + machine.Name, Implementation: ContainerServicePodmanMachine, State: state, Version: status.Version, Rootless: rootless,
		Capabilities:        ContainerServiceCapabilities{Start: true, Stop: true, Restart: true},
		ConfigurationAccess: unavailableContainerServiceConfiguration(),
		GuidanceCode:        ContainerServiceGuidancePodmanMachine, endpointID: endpoint.EndpointID, machineName: machine.Name,
		Generation: serviceGeneration(status.Version, state),
	}
}

func localContainerServiceConfiguration(sources ...ContainerServiceConfigurationSourceID) ContainerServiceConfigurationAccess {
	return ContainerServiceConfigurationAccess{Mode: ContainerServiceConfigurationLocal, Sources: sources}
}

func unavailableContainerServiceConfiguration() ContainerServiceConfigurationAccess {
	return ContainerServiceConfigurationAccess{Mode: ContainerServiceConfigurationUnavailable}
}

func (c *CLIClient) dockerEngineConfigurationSource(desktop bool) containerServiceConfigurationSourceDefinition {
	path := c.dockerEngineConfigPath(false)
	sections := []ContainerServiceConfigurationSection{ContainerServiceConfigurationSectionProxy, ContainerServiceConfigurationSectionAdvanced}
	if desktop {
		path = filepath.Join(c.userHomeDirectory(), ".docker", "daemon.json")
		sections = []ContainerServiceConfigurationSection{ContainerServiceConfigurationSectionAdvanced}
	}
	return containerServiceConfigurationSourceDefinition{
		sourceID: ContainerServiceConfigurationSourceEngine, path: path,
		displayPath: displayContainerServiceConfigPath(path, c.userHomeDirectory()),
		kind:        ContainerServiceConfigurationJSON, sections: sections, supportsRestart: true,
	}
}

func (c *CLIClient) dockerRootlessEngineConfigurationSource() containerServiceConfigurationSourceDefinition {
	path := filepath.Join(c.userConfigDirectory(), "docker", "daemon.json")
	return containerServiceConfigurationSourceDefinition{
		sourceID: ContainerServiceConfigurationSourceEngine, path: path,
		displayPath:     displayContainerServiceConfigPath(path, c.userHomeDirectory()),
		kind:            ContainerServiceConfigurationJSON,
		sections:        []ContainerServiceConfigurationSection{ContainerServiceConfigurationSectionProxy, ContainerServiceConfigurationSectionAdvanced},
		supportsRestart: true,
	}
}

func (c *CLIClient) dockerClientProxyConfigurationSource() containerServiceConfigurationSourceDefinition {
	path := filepath.Join(c.userHomeDirectory(), ".docker", "config.json")
	return containerServiceConfigurationSourceDefinition{
		sourceID: ContainerServiceConfigurationSourceClientProxy, path: path,
		displayPath: displayContainerServiceConfigPath(path, c.userHomeDirectory()),
		kind:        ContainerServiceConfigurationJSON,
		sections:    []ContainerServiceConfigurationSection{ContainerServiceConfigurationSectionProxy},
		clientProxy: true,
	}
}

func (c *CLIClient) podmanEngineConfigurationSource() containerServiceConfigurationSourceDefinition {
	path := c.podmanConfigPath()
	return containerServiceConfigurationSourceDefinition{
		sourceID: ContainerServiceConfigurationSourceEngine, path: path,
		displayPath: displayContainerServiceConfigPath(path, c.userHomeDirectory()),
		kind:        ContainerServiceConfigurationTOML,
		sections:    []ContainerServiceConfigurationSection{ContainerServiceConfigurationSectionProxy, ContainerServiceConfigurationSectionAdvanced},
	}
}

func displayContainerServiceConfigPath(path, home string) string {
	path, home = filepath.Clean(strings.TrimSpace(path)), filepath.Clean(strings.TrimSpace(home))
	if path == "." || path == "" {
		return ""
	}
	if home != "." && home != "" {
		if relative, err := filepath.Rel(home, path); err == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return "~" + string(filepath.Separator) + relative
		}
	}
	return path
}

func activeEndpoint(items []EngineEndpoint) *EngineEndpoint {
	for index := range items {
		if items[index].Default {
			item := items[index]
			return &item
		}
	}
	return nil
}

func (c *CLIClient) endpointServiceState(ctx context.Context, endpoint EngineEndpoint) ContainerServiceState {
	bound, _, err := c.BindEndpoint(ctx, endpoint.Engine, endpoint.EndpointID)
	if err != nil {
		return containerServiceStateFromError(err)
	}
	status, err := c.Status(bound, endpoint.Engine)
	return containerServiceStateFromStatus(status, err)
}

func containerServiceStateFromStatus(status EngineStatus, err error) ContainerServiceState {
	if err == nil && status.Available {
		return ContainerServiceStateRunning
	}
	return containerServiceStateFromError(err)
}

func containerServiceStateFromError(err error) ContainerServiceState {
	switch {
	case errors.Is(err, ErrCLIUnavailable):
		return ContainerServiceStateNotInstalled
	case errors.Is(err, ErrDaemonStopped), errors.Is(err, ErrEngineUnavailable):
		return ContainerServiceStateStopped
	case errors.Is(err, ErrPermissionDenied):
		return ContainerServiceStatePermission
	case errors.Is(err, ErrBackendUnreachable), errors.Is(err, ErrEngineTimeout), errors.Is(err, context.DeadlineExceeded):
		return ContainerServiceStateUnreachable
	default:
		return ContainerServiceStateError
	}
}

func containerServiceGuidance(state ContainerServiceState) ContainerServiceGuidanceCode {
	switch state {
	case ContainerServiceStateNotInstalled:
		return ContainerServiceGuidanceInstall
	case ContainerServiceStatePermission:
		return ContainerServiceGuidancePermission
	case ContainerServiceStateStopped:
		return ContainerServiceGuidanceStartOfficial
	case ContainerServiceStateUnreachable:
		return ContainerServiceGuidanceCheckActive
	default:
		return ContainerServiceGuidanceDetectionFailed
	}
}

func serviceGeneration(version string, state ContainerServiceState) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(version) + "\x00" + string(state)))
	return "sha256:" + hex.EncodeToString(digest[:])
}

func (c *CLIClient) dockerDesktopState(ctx context.Context) (ContainerServiceState, bool) {
	raw, err := c.runHostCommand(ctx, "docker", "desktop", "status", "--format", "json")
	if err != nil {
		return "", false
	}
	value := strings.ToLower(strings.TrimSpace(string(raw)))
	if strings.Contains(value, "stopped") || strings.Contains(value, "not running") {
		return ContainerServiceStateStopped, true
	}
	if strings.Contains(value, "running") {
		return ContainerServiceStateRunning, true
	}
	return ContainerServiceStateError, true
}

func (c *CLIClient) detectDockerSystemdUnit(ctx context.Context) (string, bool) {
	if c.operatingSystem() != "linux" {
		return "", false
	}
	if raw, err := c.runHostCommand(ctx, "systemctl", "--user", "show", "--property=LoadState", "--value", "docker.service"); err == nil && strings.TrimSpace(string(raw)) == "loaded" {
		return "docker.service", true
	}
	if c.effectiveUserID() == 0 {
		if raw, err := c.runHostCommand(ctx, "systemctl", "show", "--property=LoadState", "--value", "docker.service"); err == nil && strings.TrimSpace(string(raw)) == "loaded" {
			return "docker.service", false
		}
	}
	return "", false
}

func (c *CLIClient) dockerEngineConfigPath(userUnit bool) string {
	if userUnit {
		return filepath.Join(c.userConfigDirectory(), "docker", "daemon.json")
	}
	return "/etc/docker/daemon.json"
}

func (c *CLIClient) podmanConfigPath() string {
	return filepath.Join(c.userConfigDirectory(), "containers", "containers.conf")
}

type podmanMachineMatch struct {
	Name    string
	Running bool
}

func (c *CLIClient) podmanMachineForConnection(ctx context.Context, connectionAddress string) (podmanMachineMatch, bool) {
	raw, err := c.runHostCommand(ctx, "podman", "machine", "list", "--format", "json")
	if err != nil {
		return podmanMachineMatch{}, false
	}
	var rows []struct {
		Name        string `json:"Name"`
		MachineName string `json:"MachineName"`
		Running     bool   `json:"Running"`
		LastUp      string `json:"LastUp"`
		Starting    bool   `json:"Starting"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return podmanMachineMatch{}, false
	}
	for _, row := range rows {
		name := strings.TrimSpace(row.Name)
		if name == "" {
			name = strings.TrimSpace(row.MachineName)
		}
		if invalidEndpointName(name) {
			continue
		}
		inspectRaw, inspectErr := c.runHostCommand(ctx, "podman", "machine", "inspect", "--format", "json", name)
		if inspectErr != nil {
			continue
		}
		if podmanMachineInspectMatches(inspectRaw, connectionAddress) {
			return podmanMachineMatch{Name: name, Running: row.Running || row.Starting}, true
		}
	}
	return podmanMachineMatch{}, false
}

func podmanMachineInspectMatches(raw []byte, connectionAddress string) bool {
	connection, err := url.Parse(strings.TrimSpace(connectionAddress))
	if err != nil || connection.Scheme == "" {
		return false
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return false
	}
	candidates := collectStringLeaves(value)
	port := connection.Port()
	path := strings.TrimSpace(connection.Path)
	pathMatched := path == ""
	portMatched := port == ""
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == connectionAddress {
			return true
		}
		pathMatched = pathMatched || strings.Contains(candidate, path)
		portMatched = portMatched || candidate == port
	}
	return pathMatched && portMatched
}

func collectStringLeaves(value any) []string {
	var result []string
	var walk func(any)
	walk = func(item any) {
		switch current := item.(type) {
		case string:
			result = append(result, current)
		case float64:
			result = append(result, strconv.FormatFloat(current, 'f', -1, 64))
		case []any:
			for _, child := range current {
				walk(child)
			}
		case map[string]any:
			for _, child := range current {
				walk(child)
			}
		}
	}
	walk(value)
	return result
}

func (c *CLIClient) ContainerServiceConfiguration(ctx context.Context, serviceID string) (ContainerServiceConfiguration, error) {
	service, err := c.resolveContainerService(ctx, serviceID)
	if err != nil {
		return ContainerServiceConfiguration{}, err
	}
	if service.ConfigurationAccess.Mode != ContainerServiceConfigurationLocal || len(service.configurationSources) == 0 {
		return ContainerServiceConfiguration{}, ErrContainerServiceConfigReadOnly
	}
	result := ContainerServiceConfiguration{ServiceID: service.ServiceID, Sources: make([]ContainerServiceConfigurationSource, 0, len(service.configurationSources))}
	for _, definition := range service.configurationSources {
		result.Sources = append(result.Sources, c.containerServiceConfigurationSource(service, definition))
	}
	return result, nil
}

func (c *CLIClient) containerServiceConfigurationSource(service ContainerService, definition containerServiceConfigurationSourceDefinition) ContainerServiceConfigurationSource {
	result := ContainerServiceConfigurationSource{
		SourceID: definition.sourceID, DisplayPath: definition.displayPath, Format: definition.kind,
		Sections:   append([]ContainerServiceConfigurationSection(nil), definition.sections...),
		ApplyModes: []ContainerServiceApplyMode{ContainerServiceSave},
	}
	if definition.supportsRestart && service.Capabilities.Restart {
		result.ApplyModes = append(result.ApplyModes, ContainerServiceSaveAndRestart)
	}
	if definition.path == "" || !safeConfigPath(definition.path) {
		result.Status = ContainerServiceConfigurationSourceUnsupported
		return result
	}
	if info, err := os.Lstat(definition.path); err == nil {
		result.Exists = true
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			result.Status = ContainerServiceConfigurationSourceUnsupported
			return result
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		if errors.Is(err, fs.ErrPermission) {
			result.Status = ContainerServiceConfigurationSourcePermission
		} else {
			result.Status = ContainerServiceConfigurationSourceUnsupported
		}
		return result
	}
	raw, revision, err := readContainerServiceConfiguration(definition.path, definition.kind)
	if err != nil {
		if errors.Is(err, ErrPermissionDenied) {
			result.Status = ContainerServiceConfigurationSourcePermission
		} else {
			result.Status = ContainerServiceConfigurationSourceUnsupported
		}
		return result
	}
	result.BaseRevision = revision
	if !validContainerServiceConfigurationSyntax(definition.kind, raw) {
		result.Status = ContainerServiceConfigurationSourceInvalid
	} else if result.Exists {
		result.Status = ContainerServiceConfigurationSourceReady
	} else {
		result.Status = ContainerServiceConfigurationSourceMissing
	}
	if definition.clientProxy {
		result.HTTPProxy, result.HTTPSProxy, result.NoProxy = extractDockerCLIProxy(raw)
	} else {
		result.Content = string(raw)
		result.HTTPProxy, result.HTTPSProxy, result.NoProxy = extractContainerServiceProxy(definition.kind, raw)
	}
	return result
}

func resolveContainerServiceConfigurationSource(service ContainerService, sourceID ContainerServiceConfigurationSourceID) (containerServiceConfigurationSourceDefinition, error) {
	for _, source := range service.configurationSources {
		if source.sourceID == sourceID {
			return source, nil
		}
	}
	return containerServiceConfigurationSourceDefinition{}, ErrContainerServiceConfigReadOnly
}

func candidateContainerServiceConfiguration(definition containerServiceConfigurationSourceDefinition, current []byte, req ContainerServiceConfigurationUpdateRequest) ([]byte, error) {
	allowedApplyMode := req.ApplyMode == ContainerServiceSave || (req.ApplyMode == ContainerServiceSaveAndRestart && definition.supportsRestart)
	if !allowedApplyMode {
		return nil, ErrContainerServiceActionUnsupported
	}
	if definition.clientProxy {
		if req.Mode != ContainerServiceConfigurationProxy || req.ApplyMode != ContainerServiceSave {
			return nil, ErrContainerServiceActionUnsupported
		}
		candidate, err := mergeDockerCLIProxy(current, req.HTTPProxy, req.HTTPSProxy, req.NoProxy)
		if err != nil {
			return nil, ErrContainerServiceConfigInvalid
		}
		return candidate, nil
	}
	switch req.Mode {
	case ContainerServiceConfigurationProxy:
		if !slices.Contains(definition.sections, ContainerServiceConfigurationSectionProxy) {
			return nil, ErrContainerServiceActionUnsupported
		}
		candidate, err := mergeContainerServiceProxy(definition.kind, current, req.HTTPProxy, req.HTTPSProxy, req.NoProxy)
		if err != nil {
			return nil, ErrContainerServiceConfigInvalid
		}
		return candidate, nil
	case ContainerServiceConfigurationDocument:
		if !slices.Contains(definition.sections, ContainerServiceConfigurationSectionAdvanced) {
			return nil, ErrContainerServiceActionUnsupported
		}
		return []byte(req.Content), nil
	default:
		return nil, ErrContainerServiceConfigInvalid
	}
}

func (c *CLIClient) ContainerServiceAction(ctx context.Context, method Method, req ContainerServiceActionRequest) (ContainerServiceActionResult, error) {
	service, err := c.resolveContainerService(ctx, req.ServiceID)
	if err != nil {
		return ContainerServiceActionResult{}, err
	}
	if !serviceSupportsMethod(service, method) {
		return ContainerServiceActionResult{}, ErrContainerServiceActionUnsupported
	}
	if err := c.runContainerServiceAction(ctx, service, method); err != nil {
		return ContainerServiceActionResult{}, err
	}
	updated, err := c.resolveContainerService(ctx, req.ServiceID)
	if err != nil {
		return ContainerServiceActionResult{}, err
	}
	return ContainerServiceActionResult{ServiceID: updated.ServiceID, State: updated.State}, nil
}

func (c *CLIClient) UpdateContainerServiceConfiguration(ctx context.Context, req ContainerServiceConfigurationUpdateRequest) (ContainerServiceActionResult, error) {
	service, err := c.resolveContainerService(ctx, req.ServiceID)
	if err != nil {
		return ContainerServiceActionResult{}, err
	}
	definition, err := resolveContainerServiceConfigurationSource(service, req.SourceID)
	if err != nil {
		return ContainerServiceActionResult{}, err
	}
	current, currentRevision, err := readContainerServiceConfiguration(definition.path, definition.kind)
	if err != nil {
		return ContainerServiceActionResult{}, err
	}
	if currentRevision != strings.TrimSpace(req.BaseRevision) {
		return ContainerServiceActionResult{}, ErrContainerServiceConfigConflict
	}
	candidate, err := candidateContainerServiceConfiguration(definition, current, req)
	if err != nil {
		return ContainerServiceActionResult{}, err
	}
	if len(candidate) > maxContainerServiceConfigurationBytes {
		return ContainerServiceActionResult{}, ErrContainerServiceConfigInvalid
	}
	if err := c.validateContainerServiceCandidate(ctx, service, definition, candidate); err != nil {
		return ContainerServiceActionResult{}, ErrContainerServiceConfigInvalid
	}
	if err := writeContainerServiceConfiguration(definition.path, current, candidate); err != nil {
		return ContainerServiceActionResult{}, err
	}
	revision := configurationRevision(candidate, true)
	if req.ApplyMode == ContainerServiceSave {
		return ContainerServiceActionResult{ServiceID: service.ServiceID, State: service.State, Revision: revision, RestartRequired: definition.supportsRestart}, nil
	}
	if !definition.supportsRestart || !service.Capabilities.Restart {
		return ContainerServiceActionResult{}, ErrContainerServiceActionUnsupported
	}
	if err := c.runContainerServiceAction(ctx, service, MethodContainerServicesRestart); err != nil {
		rollbackErr := writeContainerServiceConfiguration(definition.path, candidate, current)
		restartErr := c.runContainerServiceAction(ctx, service, MethodContainerServicesRestart)
		if rollbackErr != nil || restartErr != nil {
			return ContainerServiceActionResult{}, ErrContainerServiceRecoveryRequired
		}
		return ContainerServiceActionResult{}, err
	}
	return ContainerServiceActionResult{ServiceID: service.ServiceID, State: ContainerServiceStateRunning, Revision: revision}, nil
}

func (c *CLIClient) ValidateContainerServiceConfiguration(ctx context.Context, req ContainerServiceConfigurationUpdateRequest) error {
	service, err := c.resolveContainerService(ctx, req.ServiceID)
	if err != nil {
		return err
	}
	definition, err := resolveContainerServiceConfigurationSource(service, req.SourceID)
	if err != nil {
		return err
	}
	current, currentRevision, err := readContainerServiceConfiguration(definition.path, definition.kind)
	if err != nil {
		return err
	}
	if currentRevision != strings.TrimSpace(req.BaseRevision) {
		return ErrContainerServiceConfigConflict
	}
	candidate, err := candidateContainerServiceConfiguration(definition, current, req)
	if err != nil {
		return err
	}
	if len(candidate) > maxContainerServiceConfigurationBytes {
		return ErrContainerServiceConfigInvalid
	}
	if err := c.validateContainerServiceCandidate(ctx, service, definition, candidate); err != nil {
		return ErrContainerServiceConfigInvalid
	}
	return nil
}

func (c *CLIClient) resolveContainerService(ctx context.Context, serviceID string) (ContainerService, error) {
	services, err := c.ContainerServices(ctx)
	if err != nil {
		return ContainerService{}, err
	}
	for _, service := range services {
		if service.ServiceID == strings.TrimSpace(serviceID) {
			return service, nil
		}
	}
	return ContainerService{}, ErrContainerServiceNotFound
}

func (c *CLIClient) runContainerServiceAction(ctx context.Context, service ContainerService, method Method) error {
	switch service.Implementation {
	case ContainerServiceDockerDesktop:
		action := strings.TrimPrefix(string(method), "container.services.")
		_, err := c.runHostCommand(ctx, "docker", "desktop", action)
		return err
	case ContainerServiceDockerEngine:
		if service.serviceUnit == "" {
			return ErrContainerServiceActionUnsupported
		}
		action := strings.TrimPrefix(string(method), "container.services.")
		args := []string{"--no-ask-password", action, service.serviceUnit}
		if service.serviceUserUnit {
			args = append([]string{"--user"}, args...)
		}
		_, err := c.runHostCommand(ctx, "systemctl", args...)
		return err
	case ContainerServicePodmanMachine:
		if invalidEndpointName(service.machineName) {
			return ErrContainerServiceActionUnsupported
		}
		switch method {
		case MethodContainerServicesStart:
			_, err := c.runHostCommand(ctx, "podman", "machine", "start", service.machineName)
			return err
		case MethodContainerServicesStop:
			_, err := c.runHostCommand(ctx, "podman", "machine", "stop", service.machineName)
			return err
		case MethodContainerServicesRestart:
			if _, err := c.runHostCommand(ctx, "podman", "machine", "stop", service.machineName); err != nil {
				return err
			}
			_, err := c.runHostCommand(ctx, "podman", "machine", "start", service.machineName)
			return err
		}
	}
	return ErrContainerServiceActionUnsupported
}

func (c *CLIClient) validateContainerServiceCandidate(ctx context.Context, service ContainerService, definition containerServiceConfigurationSourceDefinition, candidate []byte) error {
	if definition.clientProxy {
		var document map[string]json.RawMessage
		if err := json.Unmarshal(candidate, &document); err != nil || document == nil {
			return ErrContainerServiceConfigInvalid
		}
		return nil
	}
	if definition.kind == ContainerServiceConfigurationJSON {
		var document map[string]any
		if err := json.Unmarshal(candidate, &document); err != nil || document == nil {
			return ErrContainerServiceConfigInvalid
		}
		if service.Implementation == ContainerServiceDockerDesktop {
			return nil
		}
	}
	temporary, err := os.CreateTemp("", "redeven-container-service-*")
	if err != nil {
		return ErrContainerServiceConfigInvalid
	}
	path := temporary.Name()
	defer func() { _ = os.Remove(path) }()
	if _, err := temporary.Write(candidate); err != nil {
		_ = temporary.Close()
		return ErrContainerServiceConfigInvalid
	}
	if err := temporary.Close(); err != nil {
		return ErrContainerServiceConfigInvalid
	}
	switch definition.kind {
	case ContainerServiceConfigurationJSON:
		_, err = c.runHostCommand(ctx, "dockerd", "--validate", "--config-file", path)
	case ContainerServiceConfigurationTOML:
		var document map[string]any
		if err := toml.Unmarshal(candidate, &document); err != nil {
			return ErrContainerServiceConfigInvalid
		}
		env := append(processenv.Current(), "CONTAINERS_CONF="+path)
		_, err = c.runHostCommandEnv(ctx, env, "podman", "info", "--format", "json")
	default:
		return ErrContainerServiceConfigInvalid
	}
	return err
}

func readContainerServiceConfiguration(path string, kind ContainerServiceConfigurationKind) ([]byte, string, error) {
	if path == "" || !safeConfigPath(path) {
		return nil, "", ErrContainerServiceConfigReadOnly
	}
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		initial := []byte("{}\n")
		if kind == ContainerServiceConfigurationTOML {
			initial = []byte("")
		}
		return initial, configurationRevision(initial, false), nil
	}
	if err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return nil, "", ErrPermissionDenied
		}
		return nil, "", ErrContainerServiceConfigReadOnly
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > maxContainerServiceConfigurationBytes {
		return nil, "", ErrContainerServiceConfigReadOnly
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return nil, "", ErrPermissionDenied
		}
		return nil, "", ErrContainerServiceConfigReadOnly
	}
	return raw, configurationRevision(raw, true), nil
}

func writeContainerServiceConfiguration(path string, expected, candidate []byte) error {
	current, _, err := readContainerServiceConfiguration(path, configKindFromPath(path))
	if err != nil {
		return err
	}
	if !bytes.Equal(current, expected) {
		return ErrContainerServiceConfigConflict
	}
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return ErrPermissionDenied
		}
		return ErrContainerServiceConfigReadOnly
	}
	temporary, err := os.CreateTemp(directory, ".redeven-container-service-*")
	if err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return ErrPermissionDenied
		}
		return ErrContainerServiceConfigReadOnly
	}
	temporaryPath := temporary.Name()
	cleanup := func() { _ = os.Remove(temporaryPath) }
	defer cleanup()
	mode := fs.FileMode(0o600)
	if info, statErr := os.Stat(path); statErr == nil {
		mode = info.Mode().Perm()
	}
	if err := temporary.Chmod(mode); err != nil {
		_ = temporary.Close()
		return ErrContainerServiceConfigReadOnly
	}
	if _, err := temporary.Write(candidate); err != nil {
		_ = temporary.Close()
		return ErrContainerServiceConfigReadOnly
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return ErrContainerServiceConfigReadOnly
	}
	if err := temporary.Close(); err != nil {
		return ErrContainerServiceConfigReadOnly
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return ErrPermissionDenied
		}
		return ErrContainerServiceConfigReadOnly
	}
	return nil
}

func safeConfigPath(path string) bool {
	path = filepath.Clean(strings.TrimSpace(path))
	if !filepath.IsAbs(path) || path == string(filepath.Separator) {
		return false
	}
	if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return false
	} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return false
	}
	for current := filepath.Dir(path); ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err == nil {
			return info.Mode()&os.ModeSymlink == 0
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return false
		}
		parent := filepath.Dir(current)
		if parent == current {
			return false
		}
	}
}

func configKindFromPath(path string) ContainerServiceConfigurationKind {
	if strings.HasSuffix(strings.ToLower(path), ".json") {
		return ContainerServiceConfigurationJSON
	}
	return ContainerServiceConfigurationTOML
}

func configurationRevision(raw []byte, exists bool) string {
	prefix := byte(0)
	if exists {
		prefix = 1
	}
	digest := sha256.Sum256(append([]byte{prefix}, raw...))
	return "sha256:" + hex.EncodeToString(digest[:])
}

func extractContainerServiceProxy(kind ContainerServiceConfigurationKind, raw []byte) (string, string, string) {
	switch kind {
	case ContainerServiceConfigurationJSON:
		var document struct {
			Proxies map[string]string `json:"proxies"`
		}
		if json.Unmarshal(raw, &document) == nil {
			return document.Proxies["http-proxy"], document.Proxies["https-proxy"], document.Proxies["no-proxy"]
		}
	case ContainerServiceConfigurationTOML:
		var document map[string]any
		if toml.Unmarshal(raw, &document) == nil {
			return proxyValuesFromEnvironment(tomlEngineEnvironment(document))
		}
	}
	return "", "", ""
}

func validContainerServiceConfigurationSyntax(kind ContainerServiceConfigurationKind, raw []byte) bool {
	switch kind {
	case ContainerServiceConfigurationJSON:
		var document map[string]json.RawMessage
		return json.Unmarshal(raw, &document) == nil && document != nil
	case ContainerServiceConfigurationTOML:
		var document map[string]any
		return toml.Unmarshal(raw, &document) == nil
	default:
		return false
	}
}

func extractDockerCLIProxy(raw []byte) (string, string, string) {
	var document struct {
		Proxies map[string]struct {
			HTTPProxy  string `json:"httpProxy"`
			HTTPSProxy string `json:"httpsProxy"`
			NoProxy    string `json:"noProxy"`
		} `json:"proxies"`
	}
	if json.Unmarshal(raw, &document) != nil {
		return "", "", ""
	}
	proxy := document.Proxies["default"]
	return proxy.HTTPProxy, proxy.HTTPSProxy, proxy.NoProxy
}

func mergeDockerCLIProxy(raw []byte, httpProxy, httpsProxy, noProxy string) ([]byte, error) {
	document := map[string]json.RawMessage{}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &document); err != nil {
			return nil, err
		}
	}
	proxies := map[string]json.RawMessage{}
	if existing := document["proxies"]; len(existing) > 0 {
		if err := json.Unmarshal(existing, &proxies); err != nil {
			return nil, err
		}
	}
	defaults := map[string]json.RawMessage{}
	if existing := proxies["default"]; len(existing) > 0 {
		if err := json.Unmarshal(existing, &defaults); err != nil {
			return nil, err
		}
	}
	setOrDeleteRawJSONString(defaults, "httpProxy", httpProxy)
	setOrDeleteRawJSONString(defaults, "httpsProxy", httpsProxy)
	setOrDeleteRawJSONString(defaults, "noProxy", noProxy)
	if len(defaults) == 0 {
		delete(proxies, "default")
	} else {
		encoded, err := json.Marshal(defaults)
		if err != nil {
			return nil, err
		}
		proxies["default"] = encoded
	}
	if len(proxies) == 0 {
		delete(document, "proxies")
	} else {
		encoded, err := json.Marshal(proxies)
		if err != nil {
			return nil, err
		}
		document["proxies"] = encoded
	}
	out, err := json.MarshalIndent(document, "", "  ")
	return append(out, '\n'), err
}

func setOrDeleteRawJSONString(document map[string]json.RawMessage, key, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		delete(document, key)
		return
	}
	encoded, _ := json.Marshal(value)
	document[key] = encoded
}

func mergeContainerServiceProxy(kind ContainerServiceConfigurationKind, raw []byte, httpProxy, httpsProxy, noProxy string) ([]byte, error) {
	switch kind {
	case ContainerServiceConfigurationJSON:
		document := map[string]any{}
		if len(bytes.TrimSpace(raw)) > 0 {
			if err := json.Unmarshal(raw, &document); err != nil {
				return nil, err
			}
		}
		proxies, _ := document["proxies"].(map[string]any)
		if proxies == nil {
			proxies = map[string]any{}
		}
		setOrDeleteMapString(proxies, "http-proxy", httpProxy)
		setOrDeleteMapString(proxies, "https-proxy", httpsProxy)
		setOrDeleteMapString(proxies, "no-proxy", noProxy)
		if len(proxies) == 0 {
			delete(document, "proxies")
		} else {
			document["proxies"] = proxies
		}
		out, err := json.MarshalIndent(document, "", "  ")
		return append(out, '\n'), err
	case ContainerServiceConfigurationTOML:
		document := map[string]any{}
		if len(bytes.TrimSpace(raw)) > 0 {
			if err := toml.Unmarshal(raw, &document); err != nil {
				return nil, err
			}
		}
		engine, _ := document["engine"].(map[string]any)
		if engine == nil {
			engine = map[string]any{}
		}
		env := withoutProxyEnvironment(tomlEnvironmentStrings(engine["env"]))
		for _, pair := range [][2]string{{"HTTP_PROXY", httpProxy}, {"HTTPS_PROXY", httpsProxy}, {"NO_PROXY", noProxy}} {
			if strings.TrimSpace(pair[1]) != "" {
				env = append(env, pair[0]+"="+strings.TrimSpace(pair[1]))
			}
		}
		if len(env) == 0 {
			delete(engine, "env")
		} else {
			engine["env"] = env
		}
		if len(engine) == 0 {
			delete(document, "engine")
		} else {
			document["engine"] = engine
		}
		return toml.Marshal(document)
	default:
		return nil, ErrContainerServiceConfigInvalid
	}
}

func setOrDeleteMapString(target map[string]any, key, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		delete(target, key)
		return
	}
	target[key] = value
}

func tomlEngineEnvironment(document map[string]any) []string {
	engine, _ := document["engine"].(map[string]any)
	return tomlEnvironmentStrings(engine["env"])
}

func tomlEnvironmentStrings(value any) []string {
	var result []string
	switch values := value.(type) {
	case []string:
		result = append(result, values...)
	case []any:
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
	}
	return result
}

func proxyValuesFromEnvironment(values []string) (string, string, string) {
	proxies := map[string]string{}
	for _, value := range values {
		key, current, found := strings.Cut(value, "=")
		if found {
			proxies[strings.ToUpper(strings.TrimSpace(key))] = current
		}
	}
	return proxies["HTTP_PROXY"], proxies["HTTPS_PROXY"], proxies["NO_PROXY"]
}

func withoutProxyEnvironment(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		key, _, _ := strings.Cut(value, "=")
		switch strings.ToUpper(strings.TrimSpace(key)) {
		case "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY":
			continue
		}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func (c *CLIClient) runHostCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	return c.runHostCommandEnv(ctx, nil, name, args...)
}

func (c *CLIClient) runHostCommandEnv(ctx context.Context, env []string, name string, args ...string) ([]byte, error) {
	runner := c.Runner
	if runner == nil {
		runner = execRunner{}
	}
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = defaultCommandTimeout
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var out []byte
	var err error
	if len(env) > 0 {
		envRunner, ok := runner.(CommandEnvironmentRunner)
		if !ok {
			return nil, ErrResourceCapabilityUnsupported
		}
		out, err = envRunner.RunEnv(runCtx, env, name, args...)
	} else {
		out, err = runner.Run(runCtx, name, args...)
	}
	if runCtx.Err() != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrEngineTimeout
	}
	if isCommandNotFound(err) {
		return nil, fmt.Errorf("%w: %s", ErrCLIUnavailable, name)
	}
	if len(out) > maxCommandOutputBytes {
		return nil, ErrCommandOutputLimit
	}
	return out, err
}

func (c *CLIClient) operatingSystem() string {
	if value := strings.TrimSpace(c.GOOS); value != "" {
		return value
	}
	return runtime.GOOS
}

func (c *CLIClient) effectiveUserID() int {
	if c.EffectiveUserID != nil {
		return c.EffectiveUserID()
	}
	return os.Geteuid()
}

func (c *CLIClient) userConfigDirectory() string {
	if c.UserConfigDir != nil {
		if value, err := c.UserConfigDir(); err == nil && strings.TrimSpace(value) != "" {
			return filepath.Clean(value)
		}
	}
	if value := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); value != "" && filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".config")
	}
	return ""
}

func (c *CLIClient) userHomeDirectory() string {
	if c.UserHomeDir != nil {
		if value, err := c.UserHomeDir(); err == nil && strings.TrimSpace(value) != "" {
			return filepath.Clean(value)
		}
	}
	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		return filepath.Clean(home)
	}
	return ""
}
