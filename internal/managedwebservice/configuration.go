package managedwebservice

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const serviceConfigurationSchemaVersion = 2

// serviceConfiguration is the only persisted instance override document. The
// template snapshot remains the immutable baseline; every lifecycle path must
// resolve this document through effectiveSpecFromService before acting.
type serviceConfiguration struct {
	SchemaVersion           int                                  `json:"schema_version"`
	Parameters              map[string]string                    `json:"parameters,omitempty"`
	AcceptedNoticeRevisions map[string]int64                     `json:"accepted_notice_revisions,omitempty"`
	Container               *containerSettingsOverride           `json:"container,omitempty"`
	Compose                 map[string]containerSettingsOverride `json:"compose,omitempty"`
	Host                    *hostSettingsOverride                `json:"host,omitempty"`
	SecretEnvironmentNames  []string                             `json:"secret_environment_names,omitempty"`
}

type containerSettingsOverride struct {
	Entrypoint    *string                `json:"entrypoint,omitempty"`
	Command       *[]string              `json:"command,omitempty"`
	Environment   *map[string]string     `json:"environment,omitempty"`
	Labels        *map[string]string     `json:"labels,omitempty"`
	RestartPolicy *string                `json:"restart_policy,omitempty"`
	NetworkMode   *string                `json:"network_mode,omitempty"`
	PIDMode       *string                `json:"pid_mode,omitempty"`
	IPCMode       *string                `json:"ipc_mode,omitempty"`
	Ports         *[]ContainerPortSpec   `json:"ports,omitempty"`
	Mounts        *[]ContainerMountSpec  `json:"mounts,omitempty"`
	CPUs          *float64               `json:"cpus,omitempty"`
	MemoryBytes   *int64                 `json:"memory_bytes,omitempty"`
	PIDsLimit     *int64                 `json:"pids_limit,omitempty"`
	ShmSizeBytes  *int64                 `json:"shm_size_bytes,omitempty"`
	CapAdd        *[]string              `json:"cap_add,omitempty"`
	CapDrop       *[]string              `json:"cap_drop,omitempty"`
	Devices       *[]ContainerDeviceSpec `json:"devices,omitempty"`
	Privileged    *bool                  `json:"privileged,omitempty"`
	ReadOnlyRoot  *bool                  `json:"read_only_root,omitempty"`
	SecurityOpts  *[]string              `json:"security_opts,omitempty"`
	User          *string                `json:"user,omitempty"`
}

type hostSettingsOverride struct {
	InstallScript   *string `json:"install_script,omitempty"`
	StartScript     *string `json:"start_script,omitempty"`
	StopScript      *string `json:"stop_script,omitempty"`
	UninstallScript *string `json:"uninstall_script,omitempty"`
}

type serviceSecrets struct {
	SchemaVersion int               `json:"schema_version"`
	Parameters    map[string]string `json:"parameters,omitempty"`
	Environment   map[string]string `json:"environment,omitempty"`
}

func newServiceConfiguration(parameters map[string]string, accepted map[string]int64) serviceConfiguration {
	return serviceConfiguration{SchemaVersion: serviceConfigurationSchemaVersion, Parameters: parameters, AcceptedNoticeRevisions: cloneNoticeRevisions(accepted)}
}

func decodeServiceConfiguration(raw string) (serviceConfiguration, error) {
	configuration := serviceConfiguration{}
	if err := decodeStrictJSON([]byte(strings.TrimSpace(raw)), &configuration); err != nil {
		return serviceConfiguration{}, serviceError("SERVICE_CONFIGURATION_INVALID", "The saved managed-service configuration is invalid.", 409, false, err)
	}
	if configuration.SchemaVersion != serviceConfigurationSchemaVersion {
		return serviceConfiguration{}, serviceError("SERVICE_CONFIGURATION_VERSION_UNSUPPORTED", "The saved managed-service configuration version is unsupported.", 409, false, nil)
	}
	if configuration.Parameters == nil {
		configuration.Parameters = map[string]string{}
	}
	slices.Sort(configuration.SecretEnvironmentNames)
	configuration.SecretEnvironmentNames = slices.Compact(configuration.SecretEnvironmentNames)
	return configuration, nil
}

func canonicalServiceConfiguration(configuration serviceConfiguration) (string, string, error) {
	configuration.SchemaVersion = serviceConfigurationSchemaVersion
	if len(configuration.Parameters) == 0 {
		configuration.Parameters = nil
	}
	if len(configuration.AcceptedNoticeRevisions) == 0 {
		configuration.AcceptedNoticeRevisions = nil
	}
	if len(configuration.Compose) == 0 {
		configuration.Compose = nil
	}
	slices.Sort(configuration.SecretEnvironmentNames)
	configuration.SecretEnvironmentNames = slices.Compact(configuration.SecretEnvironmentNames)
	raw, err := json.Marshal(configuration)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(raw)
	return string(raw), hex.EncodeToString(digest[:]), nil
}

func effectiveSpecFromService(service *pfregistry.ManagedService) (TemplateSpec, serviceConfiguration, error) {
	baseline, err := templateSpecFromService(service)
	if err != nil {
		return TemplateSpec{}, serviceConfiguration{}, err
	}
	configuration, err := decodeServiceConfiguration(service.ConfigurationJSON)
	if err != nil {
		return TemplateSpec{}, serviceConfiguration{}, err
	}
	encoded, digest, err := canonicalServiceConfiguration(configuration)
	if err != nil {
		return TemplateSpec{}, serviceConfiguration{}, err
	}
	if encoded != strings.TrimSpace(service.ConfigurationJSON) || digest != strings.TrimSpace(service.ConfigurationSHA256) {
		return TemplateSpec{}, serviceConfiguration{}, serviceError("SERVICE_CONFIGURATION_IDENTITY_MISMATCH", "The managed-service configuration identity has changed.", 409, false, nil)
	}
	if baseline.Container != nil {
		normalizeContainerTemplateDefaults(baseline.Container)
		if configuration.Container != nil {
			applyContainerOverride(baseline.Container, *configuration.Container)
		}
	}
	if baseline.Host != nil && configuration.Host != nil {
		applyHostOverride(baseline.Host, *configuration.Host)
	}
	if baseline.Compose != nil {
		if err := applyComposeOverridesToSpec(&baseline, configuration.Compose); err != nil {
			return TemplateSpec{}, serviceConfiguration{}, err
		}
	}
	if err := validateEffectiveSpec(baseline, service.TemplateSource); err != nil {
		return TemplateSpec{}, serviceConfiguration{}, err
	}
	return baseline, configuration, nil
}

func normalizeContainerTemplateDefaults(spec *ContainerTemplateSpec) {
	if spec == nil {
		return
	}
	if strings.TrimSpace(spec.RestartPolicy) == "" {
		spec.RestartPolicy = "no"
	}
	if strings.TrimSpace(spec.NetworkMode) == "" {
		spec.NetworkMode = "bridge"
	}
	if spec.RuntimeProfile == ContainerRuntimeProfileInteractiveDesktop {
		if spec.PIDsLimit == 0 {
			spec.PIDsLimit = 2048
		}
		if spec.ShmSizeBytes == 0 {
			spec.ShmSizeBytes = 1024 * 1024 * 1024
		}
		return
	}
	if spec.PIDsLimit == 0 {
		spec.PIDsLimit = 512
	}
	if len(spec.CapDrop) == 0 {
		spec.CapDrop = []string{"ALL"}
	}
	if len(spec.SecurityOpts) == 0 {
		spec.SecurityOpts = []string{"no-new-privileges:true"}
	}
	spec.ReadOnlyRoot = true
}

func applyContainerOverride(target *ContainerTemplateSpec, override containerSettingsOverride) {
	if override.Entrypoint != nil {
		if *override.Entrypoint == "" {
			target.Entrypoint = nil
		} else {
			target.Entrypoint = []string{*override.Entrypoint}
		}
	}
	if override.Command != nil {
		target.Command = append([]string(nil), (*override.Command)...)
	}
	if override.Environment != nil {
		target.Environment = cloneStringMap(*override.Environment)
	}
	if override.Labels != nil {
		target.Labels = cloneStringMap(*override.Labels)
	}
	if override.RestartPolicy != nil {
		target.RestartPolicy = *override.RestartPolicy
	}
	if override.NetworkMode != nil {
		target.NetworkMode = *override.NetworkMode
	}
	if override.PIDMode != nil {
		target.PIDMode = *override.PIDMode
	}
	if override.IPCMode != nil {
		target.IPCMode = *override.IPCMode
	}
	if override.Ports != nil {
		target.Ports = append([]ContainerPortSpec(nil), (*override.Ports)...)
	}
	if override.Mounts != nil {
		target.Mounts = append([]ContainerMountSpec(nil), (*override.Mounts)...)
	}
	if override.CPUs != nil {
		target.CPUs = *override.CPUs
	}
	if override.MemoryBytes != nil {
		target.MemoryBytes = *override.MemoryBytes
	}
	if override.PIDsLimit != nil {
		target.PIDsLimit = *override.PIDsLimit
	}
	if override.ShmSizeBytes != nil {
		target.ShmSizeBytes = *override.ShmSizeBytes
	}
	if override.CapAdd != nil {
		target.CapAdd = append([]string(nil), (*override.CapAdd)...)
	}
	if override.CapDrop != nil {
		target.CapDrop = append([]string(nil), (*override.CapDrop)...)
	}
	if override.Devices != nil {
		target.Devices = append([]ContainerDeviceSpec(nil), (*override.Devices)...)
	}
	if override.Privileged != nil {
		target.Privileged = *override.Privileged
	}
	if override.ReadOnlyRoot != nil {
		target.ReadOnlyRoot = *override.ReadOnlyRoot
	}
	if override.SecurityOpts != nil {
		target.SecurityOpts = append([]string(nil), (*override.SecurityOpts)...)
	}
	if override.User != nil {
		target.User = *override.User
	}
}

func applyHostOverride(target *HostTemplateSpec, override hostSettingsOverride) {
	if override.InstallScript != nil {
		target.InstallScript = *override.InstallScript
	}
	if override.StartScript != nil {
		target.StartScript = *override.StartScript
	}
	if override.StopScript != nil {
		target.StopScript = *override.StopScript
	}
	if override.UninstallScript != nil {
		target.UninstallScript = *override.UninstallScript
	}
}

func cloneStringMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}

func containerRuntimeSettingsFromSpec(spec ContainerTemplateSpec, secrets map[string]struct{}) ContainerRuntimeSettings {
	entrypoint := ""
	if len(spec.Entrypoint) > 0 {
		entrypoint = spec.Entrypoint[0]
	}
	environment := make([]EnvironmentSetting, 0, len(spec.Environment))
	keys := make([]string, 0, len(spec.Environment))
	for key := range spec.Environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		_, secret := secrets[key]
		value := spec.Environment[key]
		if secret {
			value = ""
		}
		environment = append(environment, EnvironmentSetting{Name: key, Value: value, Secret: secret, HasValue: secret})
	}
	return ContainerRuntimeSettings{
		Entrypoint: entrypoint, Command: append([]string(nil), spec.Command...), Environment: environment,
		Labels: cloneStringMap(spec.Labels), RestartPolicy: spec.RestartPolicy, NetworkMode: spec.NetworkMode,
		PIDMode: spec.PIDMode, IPCMode: spec.IPCMode, Ports: append([]ContainerPortSpec(nil), spec.Ports...),
		Mounts: append([]ContainerMountSpec(nil), spec.Mounts...), CPUs: spec.CPUs, MemoryBytes: spec.MemoryBytes,
		PIDsLimit: spec.PIDsLimit, ShmSizeBytes: spec.ShmSizeBytes, CapAdd: append([]string(nil), spec.CapAdd...),
		CapDrop: append([]string(nil), spec.CapDrop...), Devices: append([]ContainerDeviceSpec(nil), spec.Devices...),
		Privileged: spec.Privileged, ReadOnlyRoot: spec.ReadOnlyRoot, SecurityOpts: append([]string(nil), spec.SecurityOpts...), User: spec.User,
	}
}

func containerOverrideFromSettings(baseline ContainerTemplateSpec, desired ContainerRuntimeSettings) (containerSettingsOverride, map[string]string, []string, error) {
	plainEnvironment, secretValues, secretNames, err := normalizeEnvironmentSettings(desired.Environment)
	if err != nil {
		return containerSettingsOverride{}, nil, nil, err
	}
	desiredSpec := baseline
	desiredSpec.Entrypoint = nil
	if strings.TrimSpace(desired.Entrypoint) != "" {
		desiredSpec.Entrypoint = []string{strings.TrimSpace(desired.Entrypoint)}
	}
	desiredSpec.Command = append([]string(nil), desired.Command...)
	desiredSpec.Environment = plainEnvironment
	desiredSpec.Labels = cloneStringMap(desired.Labels)
	desiredSpec.RestartPolicy, desiredSpec.NetworkMode, desiredSpec.PIDMode, desiredSpec.IPCMode = desired.RestartPolicy, desired.NetworkMode, desired.PIDMode, desired.IPCMode
	desiredSpec.Ports, desiredSpec.Mounts = append([]ContainerPortSpec(nil), desired.Ports...), append([]ContainerMountSpec(nil), desired.Mounts...)
	desiredSpec.CPUs, desiredSpec.MemoryBytes, desiredSpec.PIDsLimit, desiredSpec.ShmSizeBytes = desired.CPUs, desired.MemoryBytes, desired.PIDsLimit, desired.ShmSizeBytes
	desiredSpec.CapAdd, desiredSpec.CapDrop, desiredSpec.Devices = append([]string(nil), desired.CapAdd...), append([]string(nil), desired.CapDrop...), append([]ContainerDeviceSpec(nil), desired.Devices...)
	desiredSpec.Privileged, desiredSpec.ReadOnlyRoot, desiredSpec.SecurityOpts, desiredSpec.User = desired.Privileged, desired.ReadOnlyRoot, append([]string(nil), desired.SecurityOpts...), desired.User
	if err := validateContainerRuntimeSettings(desiredSpec); err != nil {
		return containerSettingsOverride{}, nil, nil, err
	}
	return diffContainerSettings(baseline, desiredSpec), secretValues, secretNames, nil
}

func diffContainerSettings(baseline, desired ContainerTemplateSpec) containerSettingsOverride {
	result := containerSettingsOverride{}
	baselineEntry, desiredEntry := "", ""
	if len(baseline.Entrypoint) > 0 {
		baselineEntry = baseline.Entrypoint[0]
	}
	if len(desired.Entrypoint) > 0 {
		desiredEntry = desired.Entrypoint[0]
	}
	if baselineEntry != desiredEntry {
		result.Entrypoint = &desiredEntry
	}
	setJSONDiff(&result.Command, baseline.Command, desired.Command)
	setJSONDiff(&result.Environment, baseline.Environment, desired.Environment)
	setJSONDiff(&result.Labels, baseline.Labels, desired.Labels)
	if baseline.RestartPolicy != desired.RestartPolicy {
		result.RestartPolicy = &desired.RestartPolicy
	}
	if baseline.NetworkMode != desired.NetworkMode {
		result.NetworkMode = &desired.NetworkMode
	}
	if baseline.PIDMode != desired.PIDMode {
		result.PIDMode = &desired.PIDMode
	}
	if baseline.IPCMode != desired.IPCMode {
		result.IPCMode = &desired.IPCMode
	}
	setJSONDiff(&result.Ports, baseline.Ports, desired.Ports)
	setJSONDiff(&result.Mounts, baseline.Mounts, desired.Mounts)
	if baseline.CPUs != desired.CPUs {
		result.CPUs = &desired.CPUs
	}
	if baseline.MemoryBytes != desired.MemoryBytes {
		result.MemoryBytes = &desired.MemoryBytes
	}
	if baseline.PIDsLimit != desired.PIDsLimit {
		result.PIDsLimit = &desired.PIDsLimit
	}
	if baseline.ShmSizeBytes != desired.ShmSizeBytes {
		result.ShmSizeBytes = &desired.ShmSizeBytes
	}
	setJSONDiff(&result.CapAdd, baseline.CapAdd, desired.CapAdd)
	setJSONDiff(&result.CapDrop, baseline.CapDrop, desired.CapDrop)
	setJSONDiff(&result.Devices, baseline.Devices, desired.Devices)
	if baseline.Privileged != desired.Privileged {
		result.Privileged = &desired.Privileged
	}
	if baseline.ReadOnlyRoot != desired.ReadOnlyRoot {
		result.ReadOnlyRoot = &desired.ReadOnlyRoot
	}
	setJSONDiff(&result.SecurityOpts, baseline.SecurityOpts, desired.SecurityOpts)
	if baseline.User != desired.User {
		result.User = &desired.User
	}
	return result
}

func setJSONDiff[T any](target **T, baseline, desired T) {
	left, _ := json.Marshal(baseline)
	right, _ := json.Marshal(desired)
	if string(left) != string(right) {
		value := desired
		*target = &value
	}
}

func normalizeEnvironmentSettings(values []EnvironmentSetting) (map[string]string, map[string]string, []string, error) {
	plain, secrets := map[string]string{}, map[string]string{}
	var secretNames []string
	for _, item := range values {
		name := strings.TrimSpace(item.Name)
		if !templateParameterPattern.MatchString(name) {
			return nil, nil, nil, serviceError("ENVIRONMENT_NAME_INVALID", "Environment variable names must use uppercase letters, numbers, and underscores.", 400, false, nil)
		}
		if _, exists := plain[name]; exists {
			return nil, nil, nil, serviceError("ENVIRONMENT_DUPLICATE", "Environment variable names must be unique.", 400, false, nil)
		}
		if strings.ContainsRune(item.Value, '\x00') || len(item.Value) > 64*1024 {
			return nil, nil, nil, serviceError("ENVIRONMENT_VALUE_INVALID", "An environment variable value is invalid or too large.", 400, false, nil)
		}
		if item.Secret {
			secretNames = append(secretNames, name)
			plain[name] = ""
			if !item.Clear && item.Value != "" {
				secrets[name] = item.Value
			}
			continue
		}
		plain[name] = item.Value
	}
	sort.Strings(secretNames)
	return plain, secrets, secretNames, nil
}

func validateEffectiveSpec(spec TemplateSpec, source string) error {
	if spec.Container != nil {
		if err := validateContainerRuntimeSettings(*spec.Container); err != nil {
			return err
		}
		if source == "builtin" && hasHighRiskContainerSettings(*spec.Container) {
			return serviceError("BUILTIN_RUNTIME_POLICY_LOCKED", "Duplicate this built-in template before enabling high-risk container capabilities.", 409, false, nil)
		}
	}
	if spec.Compose != nil {
		services, err := composeBaselineSettings(spec)
		if err != nil {
			return err
		}
		for _, settings := range services {
			container := settingsToContainerSpec(settings)
			if err := validateContainerRuntimeSettings(container); err != nil {
				return err
			}
			if source == "builtin" && hasHighRiskContainerSettings(container) {
				return serviceError("BUILTIN_RUNTIME_POLICY_LOCKED", "Duplicate this built-in template before enabling high-risk container capabilities.", 409, false, nil)
			}
		}
	}
	return nil
}

func validateContainerRuntimeSettings(spec ContainerTemplateSpec) error {
	if len(spec.Entrypoint) > 1 || len(spec.Command) > 128 || len(spec.Environment) > 256 || len(spec.Labels) > 64 || len(spec.Ports) > 128 || len(spec.Mounts) > 128 || len(spec.Devices) > 128 {
		return serviceError("CONTAINER_CONFIGURATION_LIMIT", "The container configuration exceeds the supported limits.", 400, false, nil)
	}
	if spec.CPUs < 0 || spec.CPUs > 256 || spec.MemoryBytes < 0 || spec.PIDsLimit < 0 || spec.PIDsLimit > 1_000_000 || spec.ShmSizeBytes < 0 {
		return serviceError("CONTAINER_RESOURCE_INVALID", "One or more container resource limits are invalid.", 400, false, nil)
	}
	if !supportedRestartPolicy(spec.RestartPolicy) || !supportedNamespaceMode(spec.NetworkMode, true) || !supportedNamespaceMode(spec.PIDMode, false) || !supportedNamespaceMode(spec.IPCMode, false) {
		return serviceError("CONTAINER_RUNTIME_MODE_INVALID", "A container restart or namespace mode is invalid.", 400, false, nil)
	}
	for name, value := range spec.Environment {
		if !templateParameterPattern.MatchString(strings.TrimSpace(name)) || strings.ContainsRune(value, '\x00') {
			return serviceError("CONTAINER_ENVIRONMENT_INVALID", "Container environment variables must use valid names and values.", 400, false, nil)
		}
	}
	for key, value := range spec.Labels {
		key = strings.TrimSpace(key)
		if key == "" || len(key) > 128 || strings.HasPrefix(key, "-") || strings.ContainsAny(key, " \t\r\n") || len(value) > 1024 || strings.ContainsRune(value, '\x00') {
			return serviceError("CONTAINER_LABEL_INVALID", "One or more container labels are invalid.", 400, false, nil)
		}
	}
	seen := map[string]struct{}{}
	for _, mount := range spec.Mounts {
		mountType, source, target := strings.TrimSpace(mount.Type), strings.TrimSpace(mount.Source), strings.TrimSpace(mount.Target)
		if strings.TrimSpace(mount.ResourceID) == "" || !filepath.IsAbs(target) || strings.ContainsRune(target, '\x00') {
			return serviceError("CONTAINER_MOUNT_INVALID", "Every mount needs a stable resource ID and target path.", 400, false, nil)
		}
		switch mountType {
		case "workspace":
			if source != "" && (!filepath.IsAbs(source) || strings.ContainsRune(source, '\x00')) {
				return serviceError("CONTAINER_MOUNT_INVALID", "Workspace mounts require an absolute host path when explicitly set.", 400, false, nil)
			}
		case "bind":
			if source == "" || !filepath.IsAbs(source) || strings.ContainsRune(source, '\x00') {
				return serviceError("CONTAINER_MOUNT_INVALID", "Bind mounts require an absolute host path.", 400, false, nil)
			}
		case "volume":
			if source == "" || !composeVolumePattern.MatchString(source) {
				return serviceError("CONTAINER_MOUNT_INVALID", "Managed volumes require a valid stable name.", 400, false, nil)
			}
		case "tmpfs":
			if source != "" {
				return serviceError("CONTAINER_MOUNT_INVALID", "Tmpfs mounts cannot declare a host source.", 400, false, nil)
			}
		default:
			return serviceError("CONTAINER_MOUNT_INVALID", "The container mount type is invalid.", 400, false, nil)
		}
		if _, duplicate := seen[mount.ResourceID]; duplicate {
			return serviceError("CONTAINER_RESOURCE_DUPLICATE", "Container resource IDs must be unique.", 400, false, nil)
		}
		seen[mount.ResourceID] = struct{}{}
	}
	for _, port := range spec.Ports {
		protocol, hostIP := strings.ToLower(strings.TrimSpace(port.Protocol)), strings.TrimSpace(port.HostIP)
		if strings.TrimSpace(port.ResourceID) == "" || port.ContainerPort < 1 || port.ContainerPort > 65535 || port.HostPort < 0 || port.HostPort > 65535 ||
			(protocol != "" && protocol != "tcp" && protocol != "udp") || (hostIP != "" && net.ParseIP(hostIP) == nil) {
			return serviceError("CONTAINER_PORT_INVALID", "Every additional port needs a stable resource ID and valid port values.", 400, false, nil)
		}
		if _, duplicate := seen[port.ResourceID]; duplicate {
			return serviceError("CONTAINER_RESOURCE_DUPLICATE", "Container resource IDs must be unique.", 400, false, nil)
		}
		seen[port.ResourceID] = struct{}{}
	}
	for _, device := range spec.Devices {
		hostPath, containerPath, permissions := strings.TrimSpace(device.HostPath), strings.TrimSpace(device.ContainerPath), strings.TrimSpace(device.Permissions)
		if strings.TrimSpace(device.ResourceID) == "" || !filepath.IsAbs(hostPath) || strings.ContainsRune(hostPath, '\x00') ||
			(containerPath != "" && (!filepath.IsAbs(containerPath) || strings.ContainsRune(containerPath, '\x00'))) || !supportedDevicePermissions(permissions) {
			return serviceError("CONTAINER_DEVICE_INVALID", "Every device needs a stable resource ID and host path.", 400, false, nil)
		}
		if _, duplicate := seen[device.ResourceID]; duplicate {
			return serviceError("CONTAINER_RESOURCE_DUPLICATE", "Container resource IDs must be unique.", 400, false, nil)
		}
		seen[device.ResourceID] = struct{}{}
	}
	return nil
}

func supportedRestartPolicy(value string) bool {
	value = strings.TrimSpace(value)
	return value == "" || value == "no" || value == "always" || value == "unless-stopped" || value == "on-failure" || strings.HasPrefix(value, "on-failure:")
}

func supportedNamespaceMode(value string, network bool) bool {
	value = strings.TrimSpace(value)
	if value == "" || value == "private" || value == "host" {
		return true
	}
	if network && (value == "bridge" || value == "none" || value == "default") {
		return true
	}
	return strings.HasPrefix(value, "container:")
}

func supportedDevicePermissions(value string) bool {
	if value == "" {
		return true
	}
	seen := map[rune]bool{}
	for _, permission := range value {
		if permission != 'r' && permission != 'w' && permission != 'm' || seen[permission] {
			return false
		}
		seen[permission] = true
	}
	return true
}

func hasHighRiskContainerSettings(spec ContainerTemplateSpec) bool {
	if spec.Privileged || strings.EqualFold(spec.NetworkMode, "host") || strings.EqualFold(spec.PIDMode, "host") || strings.EqualFold(spec.IPCMode, "host") || len(spec.Devices) > 0 || len(spec.CapAdd) > 0 {
		return true
	}
	for _, mount := range spec.Mounts {
		if strings.Contains(strings.ToLower(mount.Source+" "+mount.Target), "docker.sock") {
			return true
		}
	}
	for _, port := range spec.Ports {
		if strings.TrimSpace(port.HostIP) != "" && strings.TrimSpace(port.HostIP) != "127.0.0.1" {
			return true
		}
	}
	return false
}

func configurationPlanDigest(serviceID string, revision int64, configurationJSON, secretDigest string) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("%s\n%d\n%s\n%s", strings.TrimSpace(serviceID), revision, configurationJSON, secretDigest)))
	return hex.EncodeToString(digest[:])
}
