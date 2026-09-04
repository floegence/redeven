package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"path/filepath"
	"sort"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"gopkg.in/yaml.v3"
)

func (m *Manager) Settings(ctx context.Context, serviceID string) (*ServiceSettingsView, error) {
	service, forward, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	resolved, err := m.resolveCurrentRuntime(ctx, service)
	if err != nil {
		return nil, err
	}
	resolved.applyTo(service)
	spec, configuration := resolved.Spec, resolved.Configuration
	secrets, err := m.serviceSecretDocument(service.ServiceID)
	if err != nil {
		return nil, err
	}
	secretNames := make(map[string]struct{}, len(configuration.SecretEnvironmentNames))
	for _, name := range configuration.SecretEnvironmentNames {
		secretNames[name] = struct{}{}
	}
	view := &ServiceSettingsView{
		ServiceID: service.ServiceID, Name: forward.Name, Description: forward.Description, AccessMode: forward.AccessMode,
		Deployment: resolved.Template.Deployment, TemplateSource: resolved.Template.Source, ObservedState: service.ObservedState,
		ConfigurationRevision: service.ConfigurationRevision, ConfigurationSHA256: service.ConfigurationSHA256,
		Parameters: cloneStringMap(configuration.Parameters),
	}
	if spec.Container != nil {
		runtime := containerRuntimeSettingsFromSpec(*spec.Container, secretNames)
		markConfiguredSecrets(runtime.Environment, secrets.Environment)
		view.Runtime.Container = &runtime
	}
	if spec.Host != nil {
		view.Runtime.Host = &HostRuntimeSettings{InstallScript: spec.Host.InstallScript, StartScript: spec.Host.StartScript, StopScript: spec.Host.StopScript, UninstallScript: spec.Host.UninstallScript}
	}
	if spec.Compose != nil {
		settings, err := composeRuntimeSettings(spec, configuration, secretNames, secrets.Environment)
		if err != nil {
			return nil, err
		}
		view.Runtime.Compose = settings
	}
	view.Locked = lockedSettings(resolved.Template.Source, spec)
	return view, nil
}

func markConfiguredSecrets(settings []EnvironmentSetting, values map[string]string) {
	for index := range settings {
		if settings[index].Secret {
			_, settings[index].HasValue = values[settings[index].Name]
			settings[index].Value = ""
		}
	}
}

func (m *Manager) UpdateSettings(ctx context.Context, serviceID string, patch ServiceMetadataPatch) (*ServiceSettingsView, error) {
	service, forward, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(patch.Name)
	if !templateNamePattern.MatchString(name) {
		return nil, serviceError("SERVICE_NAME_INVALID", "Service name must contain 1 to 80 printable characters.", 400, false, nil)
	}
	if len(patch.Description) > 4000 || strings.ContainsRune(patch.Description, '\x00') {
		return nil, serviceError("SERVICE_DESCRIPTION_INVALID", "Service description is too large or invalid.", 400, false, nil)
	}
	mode := strings.TrimSpace(patch.AccessMode)
	if mode != pfregistry.AccessModeUnifiedProxy && mode != pfregistry.AccessModeDesktopLoopback {
		return nil, serviceError("ACCESS_MODE_INVALID", "The Web Service access mode is invalid.", 400, false, nil)
	}
	resolved, err := m.resolveCurrentRuntime(ctx, service)
	if err != nil {
		return nil, err
	}
	spec := resolved.Spec
	if mode == pfregistry.AccessModeDesktopLoopback && spec.Endpoint.Scheme != "http" {
		return nil, serviceError("ACCESS_MODE_UNAVAILABLE", "Desktop local compatibility requires an HTTP service.", 409, false, nil)
	}
	description := strings.TrimSpace(patch.Description)
	if err := m.registry.UpdateForward(ctx, forward.ForwardID, pfregistry.UpdateForwardPatch{Name: &name, Description: &description, AccessMode: &mode}); err != nil {
		return nil, err
	}
	return m.Settings(ctx, service.ServiceID)
}

func (m *Manager) serviceAndForward(ctx context.Context, serviceID string) (*pfregistry.ManagedService, *pfregistry.Forward, error) {
	service, err := m.registry.GetManagedService(ctx, strings.TrimSpace(serviceID))
	if err != nil {
		return nil, nil, err
	}
	if service == nil {
		return nil, nil, serviceError("SERVICE_NOT_FOUND", "The managed Web Service was not found.", 404, false, nil)
	}
	forward, err := m.registry.GetForward(ctx, service.ForwardID)
	if err != nil {
		return nil, nil, err
	}
	if forward == nil {
		return nil, nil, serviceError("FORWARD_NOT_FOUND", "The managed Web Service forward was not found.", 409, false, nil)
	}
	return service, forward, nil
}

type reconfigureCandidate struct {
	Configuration serviceConfiguration
	JSON          string
	SHA256        string
	Secrets       serviceSecrets
	Spec          TemplateSpec
	Plan          ReconfigurePlan
}

func (m *Manager) PreflightReconfigure(ctx context.Context, serviceID string, draft ReconfigureDraft) (*ReconfigurePlan, error) {
	service, _, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	candidate, err := m.buildReconfigureCandidate(ctx, service, draft)
	if err != nil {
		return nil, err
	}
	return &candidate.Plan, nil
}

func (m *Manager) buildReconfigureCandidate(ctx context.Context, service *pfregistry.ManagedService, draft ReconfigureDraft) (reconfigureCandidate, error) {
	if draft.ConfigurationRevision != service.ConfigurationRevision {
		return reconfigureCandidate{}, serviceError("CONFIGURATION_REVISION_CONFLICT", "Service settings changed after this drawer was opened. Reload the latest settings.", 409, true, nil)
	}
	resolved, err := m.resolveCurrentRuntime(ctx, service)
	if err != nil {
		return reconfigureCandidate{}, err
	}
	baseline := cloneTemplateSpec(resolved.BaseSpec)
	if baseline.Container != nil {
		normalizeContainerTemplateDefaults(baseline.Container)
	}
	current, err := decodeServiceConfiguration(service.ConfigurationJSON)
	if err != nil {
		return reconfigureCandidate{}, err
	}
	configuration := current
	configuration.Parameters = cloneStringMap(draft.Parameters)
	secretDocument, err := m.serviceSecretDocument(service.ServiceID)
	if err != nil {
		return reconfigureCandidate{}, err
	}
	if secretDocument.Environment == nil {
		secretDocument.Environment = map[string]string{}
	}
	changed := []string{}
	switch resolved.Template.Deployment {
	case DeploymentContainer:
		if baseline.Container == nil || draft.Runtime.Container == nil {
			return reconfigureCandidate{}, serviceError("CONTAINER_CONFIGURATION_REQUIRED", "Container settings are required for this service.", 400, false, nil)
		}
		override, newSecretValues, secretNames, err := containerOverrideFromSettings(*baseline.Container, *draft.Runtime.Container)
		if err != nil {
			return reconfigureCandidate{}, err
		}
		if err := validateManagedAnchors(*baseline.Container, *draft.Runtime.Container); err != nil {
			return reconfigureCandidate{}, err
		}
		configuration.Container = &override
		configuration.SecretEnvironmentNames = secretNames
		secretDocument.Environment = mergeSecretEnvironment(secretDocument.Environment, draft.Runtime.Container.Environment, newSecretValues)
		changed = append(changed, changedContainerSections(current.Container, &override)...)
	case DeploymentHost:
		if baseline.Host == nil || draft.Runtime.Host == nil {
			return reconfigureCandidate{}, serviceError("HOST_CONFIGURATION_REQUIRED", "Host lifecycle settings are required for this service.", 400, false, nil)
		}
		if resolved.Template.Source == "builtin" {
			return reconfigureCandidate{}, serviceError("BUILTIN_LIFECYCLE_LOCKED", "Duplicate this built-in template before editing lifecycle scripts.", 409, false, nil)
		}
		override := diffHostSettings(*baseline.Host, *draft.Runtime.Host)
		configuration.Host = &override
		changed = append(changed, "lifecycle")
	case DeploymentCompose:
		compose, secretValues, secretNames, err := composeOverridesFromSettings(baseline, draft.Runtime.Compose, secretDocument.Environment)
		if err != nil {
			return reconfigureCandidate{}, err
		}
		configuration.Compose = compose
		configuration.SecretEnvironmentNames = secretNames
		secretDocument.Environment = secretValues
		changed = append(changed, "compose")
	default:
		return reconfigureCandidate{}, serviceError("RECONFIGURE_UNSUPPORTED", "This deployment cannot be reconfigured.", 409, false, nil)
	}
	encoded, digest, err := canonicalServiceConfiguration(configuration)
	if err != nil {
		return reconfigureCandidate{}, err
	}
	spec, err := applyServiceConfiguration(cloneTemplateSpec(baseline), configuration, resolved.Template.Source)
	if err != nil {
		return reconfigureCandidate{}, err
	}
	secretRaw, err := json.Marshal(secretDocument)
	if err != nil {
		return reconfigureCandidate{}, err
	}
	secretHash := sha256.Sum256(secretRaw)
	risks := reconfigureRisks(baseline, spec, resolved.Template.Source)
	if resolved.Template.Source == "builtin" {
		for _, risk := range risks {
			if risk.RequiresAdmin {
				return reconfigureCandidate{}, serviceError("BUILTIN_RUNTIME_POLICY_LOCKED", "Duplicate this built-in template before enabling high-risk runtime capabilities.", 409, false, nil)
			}
		}
	}
	if len(changed) == 0 && encoded != service.ConfigurationJSON {
		changed = append(changed, "parameters")
	}
	sort.Strings(changed)
	runtimePlanDigest := ""
	if spec.Container != nil && m.containers != nil {
		driver := &containerTemplateDriver{manager: m, adapter: m.containers}
		mounts, err := driver.containerMountsForPreflight(ctx, service, spec.Container.Mounts)
		if err != nil {
			return reconfigureCandidate{}, err
		}
		environment := make([]string, 0, len(spec.Container.Environment))
		for name := range spec.Container.Environment {
			environment = append(environment, name+"=<redacted>")
		}
		sort.Strings(environment)
		resourcePlan, err := m.containers.CreatePreflight(containerCreateRequest(service, spec, spec.Container.Image, mounts, environment))
		if err != nil {
			return reconfigureCandidate{}, serviceError("CONTAINER_RESOURCE_PLAN_INVALID", "The container engine rejected the proposed runtime configuration.", 400, false, err)
		}
		runtimePlanDigest = resourcePlan.PlanDigest
	}
	plan := ReconfigurePlan{ConfigurationRevision: service.ConfigurationRevision, PlanDigest: configurationPlanDigest(service.ServiceID, service.ConfigurationRevision, encoded, hex.EncodeToString(secretHash[:])+"\n"+runtimePlanDigest), ChangedSections: changed, Risks: risks, RequiresRebuild: true}
	return reconfigureCandidate{Configuration: configuration, JSON: encoded, SHA256: digest, Secrets: secretDocument, Spec: spec, Plan: plan}, nil
}

func mergeSecretEnvironment(existing map[string]string, settings []EnvironmentSetting, replacements map[string]string) map[string]string {
	result := cloneStringMap(existing)
	if result == nil {
		result = map[string]string{}
	}
	allowed := map[string]struct{}{}
	for _, setting := range settings {
		if !setting.Secret {
			delete(result, setting.Name)
			continue
		}
		allowed[setting.Name] = struct{}{}
		if setting.Clear {
			delete(result, setting.Name)
			continue
		}
		if value, ok := replacements[setting.Name]; ok {
			result[setting.Name] = value
		}
	}
	for name := range result {
		if _, ok := allowed[name]; !ok {
			delete(result, name)
		}
	}
	return result
}

func validateManagedAnchors(baseline ContainerTemplateSpec, desired ContainerRuntimeSettings) error {
	for key := range desired.Labels {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(key)), "io.redeven.") {
			return serviceError("RESERVED_LABEL_LOCKED", "Redeven-reserved container labels cannot be changed.", 409, false, nil)
		}
	}
	baselineMounts := map[string]ContainerMountSpec{}
	for _, mount := range baseline.Mounts {
		if mount.Type == "volume" {
			baselineMounts[mount.ResourceID] = mount
		}
	}
	desiredMounts := map[string]ContainerMountSpec{}
	for _, mount := range desired.Mounts {
		desiredMounts[mount.ResourceID] = mount
	}
	for resourceID, anchor := range baselineMounts {
		candidate, ok := desiredMounts[resourceID]
		if !ok || candidate.Type != anchor.Type || candidate.Target != anchor.Target || candidate.Source != anchor.Source {
			return serviceError("MANAGED_DATA_ANCHOR_LOCKED", "Redeven-managed data volumes cannot be removed or retargeted.", 409, false, nil)
		}
	}
	return nil
}

func diffHostSettings(baseline HostTemplateSpec, desired HostRuntimeSettings) hostSettingsOverride {
	result := hostSettingsOverride{}
	if baseline.InstallScript != desired.InstallScript {
		result.InstallScript = &desired.InstallScript
	}
	if baseline.StartScript != desired.StartScript {
		result.StartScript = &desired.StartScript
	}
	if baseline.StopScript != desired.StopScript {
		result.StopScript = &desired.StopScript
	}
	if baseline.UninstallScript != desired.UninstallScript {
		result.UninstallScript = &desired.UninstallScript
	}
	return result
}

func changedContainerSections(old, next *containerSettingsOverride) []string {
	left, _ := json.Marshal(old)
	right, _ := json.Marshal(next)
	if string(left) == string(right) {
		return nil
	}
	return []string{"runtime"}
}

func reconfigureRisks(baseline, spec TemplateSpec, source string) []RiskNotice {
	var risks []RiskNotice
	add := func(id, title, description string) {
		for _, item := range risks {
			if item.ID == id {
				return
			}
		}
		risks = append(risks, RiskNotice{ID: id, Title: title, Description: description, RequiresAdmin: true})
	}
	collect := func(original, settings ContainerTemplateSpec) {
		if settings.Privileged && !original.Privileged {
			add("privileged", "Privileged container", "The container receives broad host-level capabilities.")
		}
		if (strings.EqualFold(settings.NetworkMode, "host") && !strings.EqualFold(original.NetworkMode, "host")) ||
			(strings.EqualFold(settings.PIDMode, "host") && !strings.EqualFold(original.PIDMode, "host")) ||
			(strings.EqualFold(settings.IPCMode, "host") && !strings.EqualFold(original.IPCMode, "host")) {
			add("host-namespace", "Host namespace access", "The container shares a host namespace.")
		}
		if containsNewDevices(original.Devices, settings.Devices) {
			add("devices", "Host device access", "The container can access selected host devices.")
		}
		if containsNewStrings(original.CapAdd, settings.CapAdd) {
			add("capabilities", "Additional Linux capabilities", "The container receives capabilities beyond the default policy.")
		}
		for _, mount := range settings.Mounts {
			if (mount.Type == "bind" || strings.Contains(strings.ToLower(mount.Source+" "+mount.Target), "docker.sock")) && !containsMount(original.Mounts, mount) {
				add("sensitive-mount", "Host path access", "The container can read or modify a selected host path.")
			}
		}
		for _, port := range settings.Ports {
			if host := strings.TrimSpace(port.HostIP); (host == "" || host == "0.0.0.0" || host == "::" || (net.ParseIP(host) != nil && !net.ParseIP(host).IsLoopback())) && !containsPort(original.Ports, port) {
				add("external-port", "External port exposure", "This port bypasses the Redeven authorization proxy and may be reachable from the network.")
			}
		}
		if original.ReadOnlyRoot && !settings.ReadOnlyRoot || containsNewStrings(settings.CapDrop, original.CapDrop) || containsNewStrings(settings.SecurityOpts, original.SecurityOpts) {
			add("weakened-security", "Weakened container isolation", "The proposed settings remove an existing container isolation control.")
		}
	}
	if baseline.Container != nil && spec.Container != nil {
		original := *baseline.Container
		normalizeContainerTemplateDefaults(&original)
		collect(original, *spec.Container)
	}
	if baseline.Compose != nil && spec.Compose != nil {
		originals, originalErr := composeBaselineSettings(baseline)
		services, serviceErr := composeBaselineSettings(spec)
		if originalErr == nil && serviceErr == nil {
			for name, service := range services {
				if original, ok := originals[name]; ok {
					collect(settingsToContainerSpec(original), settingsToContainerSpec(service))
				}
			}
		}
	}
	if source == "builtin" {
		for index := range risks {
			risks[index].Description += " Duplicate this built-in template before enabling it."
		}
	}
	sort.Slice(risks, func(i, j int) bool { return risks[i].ID < risks[j].ID })
	return risks
}

func containsNewStrings(original, candidate []string) bool {
	known := make(map[string]struct{}, len(original))
	for _, value := range original {
		known[strings.ToLower(strings.TrimSpace(value))] = struct{}{}
	}
	for _, value := range candidate {
		if _, ok := known[strings.ToLower(strings.TrimSpace(value))]; !ok {
			return true
		}
	}
	return false
}

func containsNewDevices(original, candidate []ContainerDeviceSpec) bool {
	for _, value := range candidate {
		found := false
		for _, existing := range original {
			if value.HostPath == existing.HostPath && value.ContainerPath == existing.ContainerPath && value.Permissions == existing.Permissions {
				found = true
				break
			}
		}
		if !found {
			return true
		}
	}
	return false
}

func containsMount(original []ContainerMountSpec, candidate ContainerMountSpec) bool {
	for _, value := range original {
		if value.Type == candidate.Type && value.Source == candidate.Source && value.Target == candidate.Target && value.ReadOnly == candidate.ReadOnly {
			return true
		}
	}
	return false
}

func containsPort(original []ContainerPortSpec, candidate ContainerPortSpec) bool {
	for _, value := range original {
		if value.HostIP == candidate.HostIP && value.HostPort == candidate.HostPort && value.ContainerPort == candidate.ContainerPort && defaultString(value.Protocol, "tcp") == defaultString(candidate.Protocol, "tcp") {
			return true
		}
	}
	return false
}

func lockedSettings(templateSource string, spec TemplateSpec) []LockedSetting {
	locked := []LockedSetting{{Path: "runtime.image", Reason: "The reviewed image and digest are owned by the template."}, {Path: "network.primary_web_port", Reason: "The primary Web port is bound to 127.0.0.1 and owned by Redeven."}, {Path: "runtime.identity", Reason: "Container and Compose identities are owned by Redeven."}}
	if templateSource == "builtin" {
		locked = append(locked, LockedSetting{Path: "security.high_risk", Reason: "Built-in security boundaries are reviewed and locked.", Duplicate: true})
	}
	if spec.Host != nil && templateSource == "builtin" {
		locked = append(locked, LockedSetting{Path: "lifecycle.scripts", Reason: "Built-in lifecycle scripts are release-locked.", Duplicate: true})
	}
	return locked
}

func applyComposeOverridesToSpec(spec *TemplateSpec, overrides map[string]containerSettingsOverride) error {
	if spec == nil || spec.Compose == nil {
		return serviceError("COMPOSE_CONFIGURATION_REQUIRED", "Compose settings are unavailable.", 409, false, nil)
	}
	var document map[string]any
	if err := yaml.Unmarshal([]byte(spec.Compose.YAML), &document); err != nil {
		return serviceError("COMPOSE_CONFIGURATION_CONFLICT", "The saved Compose template is invalid.", 409, false, err)
	}
	services, ok := document["services"].(map[string]any)
	if !ok {
		return serviceError("COMPOSE_CONFIGURATION_CONFLICT", "The saved Compose template has no services.", 409, false, nil)
	}
	baseline, err := composeBaselineSettings(*spec)
	if err != nil {
		return err
	}
	for name := range overrides {
		if _, exists := baseline[name]; !exists {
			return serviceError("COMPOSE_CONFIGURATION_CONFLICT", "A saved Compose override references a service that no longer exists.", 409, false, nil)
		}
	}
	for name, current := range baseline {
		raw, rawExists := services[name].(map[string]any)
		if !rawExists {
			return serviceError("COMPOSE_CONFIGURATION_CONFLICT", "A saved Compose service is invalid.", 409, false, nil)
		}
		container := settingsToContainerSpec(current)
		if override, exists := overrides[name]; exists {
			applyContainerOverride(&container, override)
		}
		writeComposeContainerSettings(raw, container)
		ensureComposeVolumeDefinitions(document, container.Mounts)
	}
	encoded, err := yaml.Marshal(document)
	if err != nil {
		return err
	}
	spec.Compose.YAML = string(encoded)
	return nil
}

func ensureComposeVolumeDefinitions(document map[string]any, mounts []ContainerMountSpec) {
	volumes, _ := document["volumes"].(map[string]any)
	for _, mount := range mounts {
		if mount.Type != "volume" || strings.TrimSpace(mount.Source) == "" {
			continue
		}
		if volumes == nil {
			volumes = map[string]any{}
		}
		if _, exists := volumes[mount.Source]; !exists {
			volumes[mount.Source] = map[string]any{}
		}
	}
	if len(volumes) > 0 {
		document["volumes"] = volumes
	}
}

func writeComposeContainerSettings(entry map[string]any, settings ContainerTemplateSpec) {
	setComposeValue(entry, "entrypoint", composeEntrypointValue(settings.Entrypoint))
	setComposeValue(entry, "command", settings.Command)
	setComposeValue(entry, "environment", settings.Environment)
	setComposeValue(entry, "labels", settings.Labels)
	setComposeValue(entry, "restart", settings.RestartPolicy)
	setComposeValue(entry, "network_mode", settings.NetworkMode)
	setComposeValue(entry, "pid", settings.PIDMode)
	setComposeValue(entry, "ipc", settings.IPCMode)
	setComposeValue(entry, "ports", composePortValues(settings.Ports))
	setComposeValue(entry, "volumes", composeMountValues(settings.Mounts))
	setComposeValue(entry, "tmpfs", composeTmpfsValues(settings.Mounts))
	setComposeValue(entry, "devices", composeDeviceValues(settings.Devices))
	setComposeValue(entry, "cpus", settings.CPUs)
	setComposeValue(entry, "mem_limit", settings.MemoryBytes)
	setComposeValue(entry, "shm_size", settings.ShmSizeBytes)
	setComposeValue(entry, "cap_add", settings.CapAdd)
	entry["cap_drop"] = settings.CapDrop
	entry["security_opt"] = settings.SecurityOpts
	setComposeValue(entry, "privileged", settings.Privileged)
	entry["read_only"] = settings.ReadOnlyRoot
	entry["pids_limit"] = settings.PIDsLimit
	setComposeValue(entry, "user", settings.User)
}

func setComposeValue(entry map[string]any, key string, value any) {
	raw, _ := json.Marshal(value)
	if string(raw) == "null" || string(raw) == "\"\"" || string(raw) == "[]" || string(raw) == "{}" || string(raw) == "0" || string(raw) == "false" {
		delete(entry, key)
		return
	}
	entry[key] = value
}

func composeEntrypointValue(values []string) any {
	if len(values) == 0 {
		return nil
	}
	if len(values) == 1 {
		return values[0]
	}
	return values
}

func composePortValues(values []ContainerPortSpec) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		protocol := strings.TrimSpace(value.Protocol)
		if protocol == "" {
			protocol = "tcp"
		}
		item := map[string]any{"target": value.ContainerPort, "protocol": protocol}
		if value.HostPort > 0 {
			item["published"] = value.HostPort
		}
		if host := strings.TrimSpace(value.HostIP); host != "" {
			item["host_ip"] = host
		}
		result = append(result, item)
	}
	return result
}

func composeMountValues(values []ContainerMountSpec) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		if value.Type == "tmpfs" {
			continue
		}
		typeName := value.Type
		source := value.Source
		if typeName == "workspace" {
			typeName, source = "bind", "${REDEVEN_WORKSPACE}"
		}
		item := map[string]any{"type": typeName, "source": source, "target": value.Target, "read_only": value.ReadOnly}
		result = append(result, item)
	}
	return result
}

func composeTmpfsValues(values []ContainerMountSpec) []map[string]any {
	result := []map[string]any{}
	for _, value := range values {
		if value.Type != "tmpfs" {
			continue
		}
		item := map[string]any{"target": value.Target}
		if len(value.TmpfsOptions) > 0 {
			item["options"] = strings.Join(value.TmpfsOptions, ",")
		}
		result = append(result, item)
	}
	return result
}

func composeDeviceValues(values []ContainerDeviceSpec) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		item := value.HostPath
		if value.ContainerPath != "" {
			item += ":" + value.ContainerPath
		}
		if value.Permissions != "" {
			item += ":" + value.Permissions
		}
		result = append(result, item)
	}
	return result
}

func composeRuntimeSettings(spec TemplateSpec, _ serviceConfiguration, secretNames map[string]struct{}, secretValues map[string]string) (map[string]ContainerRuntimeSettings, error) {
	baseline, err := composeBaselineSettings(spec)
	if err != nil {
		return nil, err
	}
	for name, settings := range baseline {
		localNames := map[string]struct{}{}
		localValues := map[string]string{}
		prefix := name + "."
		for qualified := range secretNames {
			if key, ok := strings.CutPrefix(qualified, prefix); ok {
				localNames[key] = struct{}{}
			}
		}
		for qualified, value := range secretValues {
			if key, ok := strings.CutPrefix(qualified, prefix); ok {
				localValues[key] = value
			}
		}
		container := settingsToContainerSpec(settings)
		settings = containerRuntimeSettingsFromSpec(container, localNames)
		markConfiguredSecrets(settings.Environment, localValues)
		baseline[name] = settings
	}
	return baseline, nil
}

func composeBaselineSettings(spec TemplateSpec) (map[string]ContainerRuntimeSettings, error) {
	if spec.Compose == nil {
		return nil, serviceError("COMPOSE_CONFIGURATION_REQUIRED", "Compose settings are unavailable.", 409, false, nil)
	}
	var document struct {
		Services map[string]map[string]any `yaml:"services"`
	}
	if err := yaml.Unmarshal([]byte(spec.Compose.YAML), &document); err != nil {
		return nil, err
	}
	result := map[string]ContainerRuntimeSettings{}
	for name, raw := range document.Services {
		readOnlyRoot := true
		if _, exists := raw["read_only"]; exists {
			readOnlyRoot = boolValue(raw["read_only"])
		}
		pidsLimit := int64(512)
		if _, exists := raw["pids_limit"]; exists {
			pidsLimit = intValue(raw["pids_limit"])
		}
		capDrop := []string{"ALL"}
		if _, exists := raw["cap_drop"]; exists {
			capDrop = stringSliceValue(raw["cap_drop"])
		}
		securityOptions := []string{"no-new-privileges:true"}
		if _, exists := raw["security_opt"]; exists {
			securityOptions = stringSliceValue(raw["security_opt"])
		}
		settings := ContainerRuntimeSettings{
			Entrypoint: stringValue(raw["entrypoint"]), Command: stringSliceValue(raw["command"]), Environment: environmentSettingsValue(raw["environment"]),
			Labels: stringMapValue(raw["labels"]), RestartPolicy: stringValue(raw["restart"]), NetworkMode: stringValue(raw["network_mode"]),
			PIDMode: stringValue(raw["pid"]), IPCMode: stringValue(raw["ipc"]), Ports: composePortsValue(name, raw["ports"]),
			Mounts: composeMountsValue(name, raw["volumes"], raw["tmpfs"]), CPUs: floatValue(raw["cpus"]), MemoryBytes: intValue(raw["mem_limit"]),
			PIDsLimit: pidsLimit, ShmSizeBytes: intValue(raw["shm_size"]), CapAdd: stringSliceValue(raw["cap_add"]),
			CapDrop: capDrop, Devices: composeDevicesValue(name, raw["devices"]), Privileged: boolValue(raw["privileged"]),
			ReadOnlyRoot: readOnlyRoot, SecurityOpts: securityOptions, User: stringValue(raw["user"]),
		}
		result[name] = settings
	}
	return result, nil
}

func composeOverridesFromSettings(spec TemplateSpec, desired map[string]ContainerRuntimeSettings, existingSecrets map[string]string) (map[string]containerSettingsOverride, map[string]string, []string, error) {
	baseline, err := composeBaselineSettings(spec)
	if err != nil {
		return nil, nil, nil, err
	}
	if len(desired) != len(baseline) {
		return nil, nil, nil, serviceError("COMPOSE_TOPOLOGY_LOCKED", "Compose services cannot be added or removed from instance settings.", 409, false, nil)
	}
	result := map[string]containerSettingsOverride{}
	secrets := map[string]string{}
	secretSet := map[string]struct{}{}
	for name, base := range baseline {
		value, ok := desired[name]
		if !ok {
			return nil, nil, nil, serviceError("COMPOSE_TOPOLOGY_LOCKED", "Compose services cannot be renamed from instance settings.", 409, false, nil)
		}
		baselineContainer := settingsToContainerSpec(base)
		if err := validateManagedAnchors(baselineContainer, value); err != nil {
			return nil, nil, nil, err
		}
		override, values, names, err := containerOverrideFromSettings(baselineContainer, value)
		if err != nil {
			return nil, nil, nil, err
		}
		result[name] = override
		localExisting := map[string]string{}
		prefix := name + "."
		for qualified, secret := range existingSecrets {
			if key, ok := strings.CutPrefix(qualified, prefix); ok {
				localExisting[key] = secret
			}
		}
		for key, secret := range mergeSecretEnvironment(localExisting, value.Environment, values) {
			secrets[prefix+key] = secret
		}
		for _, key := range names {
			secretSet[name+"."+key] = struct{}{}
		}
	}
	secretNames := make([]string, 0, len(secretSet))
	for name := range secretSet {
		secretNames = append(secretNames, name)
	}
	sort.Strings(secretNames)
	return result, secrets, secretNames, nil
}

func settingsToContainerSpec(settings ContainerRuntimeSettings) ContainerTemplateSpec {
	environment := map[string]string{}
	for _, item := range settings.Environment {
		environment[item.Name] = item.Value
	}
	entrypoint := []string{}
	if settings.Entrypoint != "" {
		entrypoint = []string{settings.Entrypoint}
	}
	return ContainerTemplateSpec{Entrypoint: entrypoint, Command: settings.Command, Environment: environment, Labels: settings.Labels, RestartPolicy: settings.RestartPolicy, NetworkMode: settings.NetworkMode, PIDMode: settings.PIDMode, IPCMode: settings.IPCMode, Ports: settings.Ports, Mounts: settings.Mounts, CPUs: settings.CPUs, MemoryBytes: settings.MemoryBytes, PIDsLimit: settings.PIDsLimit, ShmSizeBytes: settings.ShmSizeBytes, CapAdd: settings.CapAdd, CapDrop: settings.CapDrop, Devices: settings.Devices, Privileged: settings.Privileged, ReadOnlyRoot: settings.ReadOnlyRoot, SecurityOpts: settings.SecurityOpts, User: settings.User}
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
func boolValue(value any) bool { result, _ := value.(bool); return result }
func floatValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	}
	var result float64
	_, _ = fmt.Sscan(fmt.Sprint(value), &result)
	return result
}
func intValue(value any) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	}
	var result int64
	_, _ = fmt.Sscan(fmt.Sprint(value), &result)
	return result
}
func stringMapValue(value any) map[string]string {
	result := map[string]string{}
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			result[key] = fmt.Sprint(item)
		}
	case []any:
		for _, item := range typed {
			key, val, ok := strings.Cut(fmt.Sprint(item), "=")
			if ok {
				result[strings.TrimSpace(key)] = val
			}
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}
func stringSliceValue(value any) []string {
	switch typed := value.(type) {
	case string:
		return strings.Fields(typed)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, fmt.Sprint(item))
		}
		return result
	}
	return nil
}
func environmentSettingsValue(value any) []EnvironmentSetting {
	result := []EnvironmentSetting{}
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			result = append(result, EnvironmentSetting{Name: key, Value: fmt.Sprint(typed[key])})
		}
	case []any:
		for _, item := range typed {
			key, val, ok := strings.Cut(fmt.Sprint(item), "=")
			if ok {
				result = append(result, EnvironmentSetting{Name: key, Value: val})
			}
		}
	}
	return result
}

func composeResourceID(serviceName, kind string, index int, identity string) string {
	digest := sha256.Sum256([]byte(serviceName + "\n" + kind + "\n" + fmt.Sprint(index) + "\n" + identity))
	return "compose-" + kind + "-" + hex.EncodeToString(digest[:6])
}

func composePortsValue(serviceName string, value any) []ContainerPortSpec {
	items, _ := value.([]any)
	result := make([]ContainerPortSpec, 0, len(items))
	for index, raw := range items {
		port := ContainerPortSpec{}
		if item, ok := raw.(map[string]any); ok {
			port = ContainerPortSpec{ContainerPort: int(intValue(item["target"])), HostPort: int(intValue(item["published"])), HostIP: stringValue(item["host_ip"]), Protocol: stringValue(item["protocol"])}
		} else if parsed, ok := parseComposePortShortSyntax(fmt.Sprint(raw)); ok {
			port = parsed
		} else {
			continue
		}
		if port.Protocol == "" {
			port.Protocol = "tcp"
		}
		port.ResourceID = composeResourceID(serviceName, "port", index, fmt.Sprintf("%s:%d:%d/%s", port.HostIP, port.HostPort, port.ContainerPort, port.Protocol))
		result = append(result, port)
	}
	return result
}

func parseComposePortShortSyntax(raw string) (ContainerPortSpec, bool) {
	raw = strings.TrimSpace(raw)
	protocol := "tcp"
	if value, suffix, ok := strings.Cut(raw, "/"); ok {
		raw, protocol = value, strings.TrimSpace(suffix)
	}
	parts := strings.Split(raw, ":")
	result := ContainerPortSpec{Protocol: protocol}
	switch len(parts) {
	case 1:
		result.ContainerPort = int(intValue(parts[0]))
	case 2:
		result.HostPort, result.ContainerPort = int(intValue(parts[0])), int(intValue(parts[1]))
	case 3:
		result.HostIP, result.HostPort, result.ContainerPort = strings.TrimSpace(parts[0]), int(intValue(parts[1])), int(intValue(parts[2]))
	default:
		return ContainerPortSpec{}, false
	}
	return result, result.ContainerPort > 0
}

func composeMountsValue(serviceName string, volumes, tmpfs any) []ContainerMountSpec {
	result := []ContainerMountSpec{}
	if items, ok := volumes.([]any); ok {
		for index, raw := range items {
			typeName, source, target := "", "", ""
			readOnly := false
			if item, ok := raw.(map[string]any); ok {
				typeName, source, target = stringValue(item["type"]), stringValue(item["source"]), stringValue(item["target"])
				readOnly = boolValue(item["read_only"])
			} else {
				parts := strings.Split(fmt.Sprint(raw), ":")
				if len(parts) < 2 || len(parts) > 3 {
					continue
				}
				source, target = strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
				if len(parts) == 3 {
					readOnly = strings.Contains(strings.ToLower(parts[2]), "ro")
				}
				if source == "${REDEVEN_WORKSPACE}" || filepath.IsAbs(source) {
					typeName = "bind"
				} else {
					typeName = "volume"
				}
			}
			if typeName == "bind" && source == "${REDEVEN_WORKSPACE}" {
				typeName = "workspace"
			}
			mount := ContainerMountSpec{Type: typeName, Source: source, Target: target, ReadOnly: readOnly}
			mount.ResourceID = composeResourceID(serviceName, "mount", index, typeName+":"+source+":"+target)
			result = append(result, mount)
		}
	}
	if items, ok := tmpfs.([]any); ok {
		for index, raw := range items {
			target := ""
			options := []string{}
			if item, ok := raw.(map[string]any); ok {
				target = stringValue(item["target"])
				if rawOptions := stringValue(item["options"]); rawOptions != "" {
					options = strings.Split(rawOptions, ",")
				}
			} else {
				target = stringValue(raw)
			}
			mount := ContainerMountSpec{Type: "tmpfs", Target: target, TmpfsOptions: options}
			mount.ResourceID = composeResourceID(serviceName, "tmpfs", index, target)
			result = append(result, mount)
		}
	}
	return result
}

func composeDevicesValue(serviceName string, value any) []ContainerDeviceSpec {
	items, _ := value.([]any)
	result := make([]ContainerDeviceSpec, 0, len(items))
	for index, raw := range items {
		parts := strings.Split(fmt.Sprint(raw), ":")
		if len(parts) == 0 {
			continue
		}
		item := ContainerDeviceSpec{HostPath: parts[0]}
		if len(parts) > 1 {
			item.ContainerPath = parts[1]
		}
		if len(parts) > 2 {
			item.Permissions = parts[2]
		}
		item.ResourceID = composeResourceID(serviceName, "device", index, strings.Join(parts, ":"))
		result = append(result, item)
	}
	return result
}
