package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"gopkg.in/yaml.v3"
)

type composeTemplateDriver struct {
	manager *Manager
	adapter *containerengine.Adapter
}

func (d *composeTemplateDriver) RebuildStoppedRuntime(ctx context.Context, service *pfregistry.ManagedService, _ TemplateSpec, _ string) (string, string, error) {
	runtimeID, artifact, err := d.Install(ctx, service, func(string, int64, ...pfregistry.ManagedOperationTransferProgress) {})
	if err != nil {
		return "", "", err
	}
	service.RuntimeIdentity, service.ArtifactReference = runtimeID, artifact
	if _, err := d.verifyProject(ctx, service); err != nil {
		_ = d.adapter.RemoveComposeDeployment(context.Background(), d.request(service), false)
		return "", "", err
	}
	return runtimeID, artifact, nil
}

func (d *composeTemplateDriver) RemoveRuntime(ctx context.Context, service *pfregistry.ManagedService) error {
	if strings.TrimSpace(service.RuntimeIdentity) == "" {
		return nil
	}
	expectedImages, err := d.expectedImages(service)
	if err != nil {
		return err
	}
	if _, err := d.verifyOwnedProject(ctx, service, expectedImages); err != nil {
		return err
	}
	return d.adapter.RemoveComposeDeployment(ctx, d.request(service), false)
}

func (d *composeTemplateDriver) VerifyRuntime(ctx context.Context, service *pfregistry.ManagedService, _ TemplateSpec) error {
	_, err := d.verifyProject(ctx, service)
	return err
}

func (d *composeTemplateDriver) FindReconfiguredRuntime(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	request := d.request(service)
	raw, err := os.ReadFile(request.ConfigPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	details, err := d.adapter.InspectComposeDeployment(ctx, request)
	if err != nil {
		return "", err
	}
	if len(details.Containers) == 0 {
		return "", nil
	}
	digest := sha256.Sum256(raw)
	return d.identity(service, hex.EncodeToString(digest[:])), nil
}

func (d *composeTemplateDriver) Install(ctx context.Context, service *pfregistry.ManagedService, progress operationProgress) (string, string, error) {
	if d.adapter == nil {
		return "", "", serviceError("DOCKER_UNAVAILABLE", "Docker Compose is not available in this Environment.", 409, true, nil)
	}
	if strings.TrimSpace(service.RuntimeIdentity) != "" {
		if err := d.RemoveRuntime(ctx, service); err != nil {
			return "", "", err
		}
		service.RuntimeIdentity = ""
	}
	resolved, err := d.manager.resolveCurrentRuntime(ctx, service)
	if err != nil {
		return "", "", err
	}
	resolved.applyTo(service)
	spec, configuration := resolved.Spec, resolved.Configuration
	if spec.Kind != DeploymentCompose || spec.Compose == nil {
		return "", "", serviceError("CURRENT_TEMPLATE_INVALID", "The current template is not a Compose deployment.", 409, false, nil)
	}
	progress("pulling", 2)
	secrets, err := d.manager.serviceSecretDocument(service.ServiceID)
	if err != nil {
		return "", "", err
	}
	generated, pinned, secretVariables, err := d.generateCompose(ctx, service, spec, configuration, secrets, progress)
	if err != nil {
		return "", "", err
	}
	progress("verifying", 3)
	request := d.request(service)
	var planned struct {
		Networks map[string]struct {
			Name   string            `yaml:"name"`
			Labels map[string]string `yaml:"labels"`
		} `yaml:"networks"`
	}
	if err := yaml.Unmarshal(generated, &planned); err != nil {
		return "", "", err
	}
	networks, err := d.adapter.ListNetworks(ctx, containerengine.EngineDocker)
	if err != nil {
		return "", "", err
	}
	for _, network := range networks {
		for _, wanted := range planned.Networks {
			if network.Name == wanted.Name {
				return "", "", serviceError("DATA_NAME_CONFLICT", "An existing network occupies the planned instance name. Review it before installation.", 409, false, nil)
			}
		}
	}
	if err := writePrivateFile(request.ConfigPath, generated); err != nil {
		return "", "", err
	}
	parameters, err := d.manager.serviceParameters(service)
	if err != nil {
		return "", "", err
	}
	if err := writePrivateFile(request.EnvFilePath, composeEnvironment(service.WorkspacePath, parameters, secretVariables)); err != nil {
		return "", "", err
	}
	if err := d.adapter.ValidateComposeDeployment(ctx, request); err != nil {
		return "", "", serviceError("COMPOSE_INVALID", "Docker Compose rejected the generated template deployment.", 400, false, err)
	}
	progress("installing", 4)
	digest := sha256.Sum256(generated)
	artifact := "compose-sha256:" + hex.EncodeToString(digest[:]) + ":" + strings.Join(pinned, ",")
	runtimeID := d.identity(service, hex.EncodeToString(digest[:]))
	details, err := d.adapter.InspectComposeDeployment(ctx, request)
	if err != nil {
		return "", "", err
	}
	if len(details.Containers) > 0 {
		return "", "", serviceError("COMPOSE_IDENTITY_MISMATCH", "The Compose instance already has containers. Review them before recreating the instance.", 409, false, nil)
	}
	// The configuration digest includes this allocation's random ownership label.
	// Persist it before creating containers so a lost engine response is recoverable.
	service.RuntimeIdentity, service.ArtifactReference = runtimeID, artifact
	if err := d.manager.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &runtimeID, ArtifactReference: &artifact}); err != nil {
		return "", "", err
	}
	for _, network := range planned.Networks {
		if err := d.manager.registry.PutManagedServiceResource(ctx, pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: "@allocation/network/" + network.Name, Kind: "runtime", EngineIdentity: network.Name, StableIdentity: network.Labels[managedServiceLabel+".generation"], Ownership: "owned", CreatedAtUnixMs: time.Now().UnixMilli()}); err != nil {
			return "", "", err
		}
	}
	if err := d.adapter.CreateComposeDeployment(ctx, request); err != nil {
		return "", "", serviceError("COMPOSE_CREATE_FAILED", "The Compose creation result needs to be inspected before continuing.", 502, true, err)
	}
	if _, err := d.verifyProject(ctx, service); err != nil {
		return "", "", err
	}
	return runtimeID, artifact, nil
}

func (d *composeTemplateDriver) generateCompose(ctx context.Context, service *pfregistry.ManagedService, spec TemplateSpec, configuration serviceConfiguration, secrets serviceSecrets, progress operationProgress) ([]byte, []string, map[string]string, error) {
	var document map[string]any
	if err := yaml.Unmarshal([]byte(spec.Compose.YAML), &document); err != nil {
		return nil, nil, nil, serviceError("TEMPLATE_COMPOSE_INVALID", "Compose YAML could not be parsed.", 400, false, err)
	}
	services, ok := document["services"].(map[string]any)
	if !ok {
		return nil, nil, nil, serviceError("TEMPLATE_COMPOSE_INVALID", "Compose YAML must define services.", 400, false, nil)
	}
	names := make([]string, 0, len(services))
	for name := range services {
		names = append(names, name)
	}
	sort.Strings(names)
	pinned := make([]string, 0, len(names))
	secretVariables := map[string]string{}
	generation, err := randomID("mra")
	if err != nil {
		return nil, nil, nil, err
	}
	for _, name := range names {
		entry, ok := services[name].(map[string]any)
		if !ok {
			return nil, nil, nil, serviceError("TEMPLATE_COMPOSE_INVALID", "A Compose service definition is invalid.", 400, false, nil)
		}
		image := strings.TrimSpace(fmt.Sprint(entry["image"]))
		pulled, err := pullManagedImage(ctx, d.adapter, image, int64(len(pinned)+1), int64(len(names)), progress)
		if err != nil {
			return nil, nil, nil, err
		}
		pinnedImage, err := pinnedImageReference(image, pulled.Image.Digest)
		if err != nil {
			return nil, nil, nil, err
		}
		entry["image"] = pinnedImage
		pinned = append(pinned, pinnedImage)
		entry["labels"] = mergeComposeLabels(entry["labels"], map[string]string{managedServiceLabel: service.ServiceID, managedServiceLabel + ".generation": generation})
		injectComposeSecrets(entry, name, configuration.SecretEnvironmentNames, secrets.Environment, secretVariables)
		if name == spec.Compose.MainService {
			ports, _ := entry["ports"].([]any)
			entry["ports"] = append(ports, map[string]any{"target": spec.Endpoint.ContainerPort, "published": service.RuntimePort, "host_ip": "127.0.0.1", "protocol": "tcp"})
		}
	}
	// Compose data volumes use the same persisted, instance-owned resources as
	// single-container templates. Mark them external in generated YAML so Compose
	// never deletes data as a side effect of removing runtime resources.
	if volumes, ok := document["volumes"].(map[string]any); ok {
		names := make([]string, 0, len(volumes))
		for name := range volumes {
			names = append(names, name)
		}
		sort.Strings(names)
		containerDriver := &containerTemplateDriver{manager: d.manager, adapter: d.adapter}
		for _, name := range names {
			mounts, err := containerDriver.containerMounts(ctx, service, []ContainerMountSpec{{Type: "volume", ResourceID: name, Target: "/data"}}, true)
			if err != nil {
				return nil, nil, nil, err
			}
			volumes[name] = map[string]any{"external": true, "name": mounts[0].Source}
		}
	}
	if _, ok := document["networks"]; !ok {
		document["networks"] = map[string]any{"default": map[string]any{}}
	}
	if networks, ok := document["networks"].(map[string]any); ok {
		for name, raw := range networks {
			network, _ := raw.(map[string]any)
			if network == nil {
				network = map[string]any{}
			}
			network["labels"] = mergeComposeLabels(network["labels"], map[string]string{managedServiceLabel: service.ServiceID, managedServiceLabel + ".generation": generation})
			network["name"] = d.projectName(service) + "_" + name
			networks[name] = network
		}
	}
	document["name"] = d.projectName(service)
	generated, err := yaml.Marshal(document)
	if err != nil {
		return nil, nil, nil, err
	}
	return generated, pinned, secretVariables, nil
}

func injectComposeSecrets(entry map[string]any, serviceName string, names []string, values, output map[string]string) {
	environment := stringMapValue(entry["environment"])
	if environment == nil {
		environment = map[string]string{}
	}
	prefix := serviceName + "."
	for _, qualified := range names {
		name, ok := strings.CutPrefix(qualified, prefix)
		if !ok {
			continue
		}
		digest := sha256.Sum256([]byte(qualified))
		variable := "REDEVEN_SECRET_" + strings.ToUpper(hex.EncodeToString(digest[:8]))
		environment[name] = "${" + variable + "}"
		if value, exists := values[qualified]; exists {
			output[variable] = value
		}
	}
	entry["environment"] = environment
}

func mergeComposeLabels(raw any, required map[string]string) map[string]string {
	result := map[string]string{}
	switch labels := raw.(type) {
	case map[string]any:
		for key, value := range labels {
			result[key] = fmt.Sprint(value)
		}
	case []any:
		for _, rawLabel := range labels {
			key, value, ok := strings.Cut(fmt.Sprint(rawLabel), "=")
			if ok {
				result[strings.TrimSpace(key)] = value
			}
		}
	}
	for key, value := range required {
		result[key] = value
	}
	return result
}

func composeEnvironment(workspace string, parameters, secrets map[string]string) []byte {
	values := make(map[string]string, len(parameters)+len(secrets)+1)
	values["REDEVEN_WORKSPACE"] = workspace
	for key, value := range parameters {
		values[key] = value
	}
	for key, value := range secrets {
		values[key] = value
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteByte('=')
		builder.WriteString(strconv.Quote(values[key]))
		builder.WriteByte('\n')
	}
	return []byte(builder.String())
}

func writePrivateFile(path string, contents []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, contents, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func (d *composeTemplateDriver) request(service *pfregistry.ManagedService) containerengine.ComposeDeploymentRequest {
	binding, err := decodeRuntimeBinding(service)
	if err != nil || binding.Compose == nil {
		return containerengine.ComposeDeploymentRequest{}
	}
	root := d.manager.resolveBindingPath(binding.Compose.ConfigRoot)
	return containerengine.ComposeDeploymentRequest{ConfigPath: filepath.Join(root, "compose.yaml"), EnvFilePath: filepath.Join(root, "template.env"), ProjectName: d.projectName(service)}
}

func (d *composeTemplateDriver) projectName(service *pfregistry.ManagedService) string {
	binding, err := decodeRuntimeBinding(service)
	if err != nil || binding.Compose == nil {
		return ""
	}
	return binding.Compose.ProjectName
}

func (d *composeTemplateDriver) identity(service *pfregistry.ManagedService, digest string) string {
	return "compose:" + service.ServiceID + ":" + d.projectName(service) + ":" + digest
}

func (d *composeTemplateDriver) verifyIdentity(service *pfregistry.ManagedService) error {
	parts := strings.Split(strings.TrimSpace(service.RuntimeIdentity), ":")
	if len(parts) != 4 || parts[0] != "compose" || parts[1] != service.ServiceID || parts[2] != d.projectName(service) || len(parts[3]) != 64 {
		return serviceError("RUNTIME_IDENTITY_MISMATCH", "The managed Compose project identity does not match the saved instance.", 409, false, nil)
	}
	raw, err := os.ReadFile(d.request(service).ConfigPath)
	if err != nil {
		return serviceError("COMPOSE_IDENTITY_MISSING", "The exact managed Compose configuration is missing.", 409, false, err)
	}
	digest := sha256.Sum256(raw)
	digestHex := hex.EncodeToString(digest[:])
	if digestHex != parts[3] || !strings.HasPrefix(service.ArtifactReference, "compose-sha256:"+digestHex+":") {
		return serviceError("RUNTIME_IDENTITY_MISMATCH", "The managed Compose configuration identity has changed.", 409, false, nil)
	}
	return nil
}

func (d *composeTemplateDriver) verifyProject(ctx context.Context, service *pfregistry.ManagedService) (containerengine.ComposeProjectDetails, error) {
	resolved, err := d.manager.resolveCurrentRuntime(ctx, service)
	if err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
	resolved.applyTo(service)
	spec := resolved.Spec
	expectedImages, err := d.expectedImages(service)
	if err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
	details, err := d.verifyOwnedProject(ctx, service, expectedImages)
	if err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
	if len(details.Containers) != len(expectedImages) {
		return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISMATCH", "The managed Compose project is missing an expected service.", 409, false, nil)
	}
	expectedRuntime, err := composeBaselineSettings(spec)
	if err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
	var applied struct {
		Networks map[string]struct {
			Name string `yaml:"name"`
		} `yaml:"networks"`
		Services map[string]struct {
			Networks any `yaml:"networks"`
		} `yaml:"services"`
	}
	config, err := os.ReadFile(d.request(service).ConfigPath)
	if err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
	if err := yaml.Unmarshal(config, &applied); err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
	for _, child := range details.Containers {
		expectedImage := expectedImages[child.Service]
		inspected, err := d.adapter.Inspect(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: child.ContainerID})
		if err != nil {
			return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISSING", "A managed Compose container could not be inspected.", 409, false, err)
		}
		container := inspected.Container
		if container.ContainerID != child.ContainerID || container.Image.Reference != expectedImage || !container.Image.DigestPinned {
			return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISMATCH", "A managed Compose container image identity has changed.", 409, false, nil)
		}
		runtime := container.Runtime
		expected, ok := expectedRuntime[child.Service]
		resources, resourceErr := d.manager.registry.ListManagedServiceResources(ctx, service.ServiceID)
		if resourceErr != nil {
			return containerengine.ComposeProjectDetails{}, resourceErr
		}
		for index := range expected.Mounts {
			if expected.Mounts[index].Type != "volume" {
				continue
			}
			for _, resource := range resources {
				if resource.Kind == "volume" && resource.ResourceID == expected.Mounts[index].Source {
					expected.Mounts[index].Source = resource.EngineIdentity
					break
				}
			}
		}
		shmSize := expected.ShmSizeBytes
		if shmSize == 0 {
			shmSize = 64 * 1024 * 1024
		}
		allocatedNetworks := []string{}
		attach := applied.Services[child.Service].Networks
		names := []string{}
		switch value := attach.(type) {
		case map[string]any:
			for name := range value {
				names = append(names, name)
			}
		case []any:
			for _, name := range value {
				names = append(names, fmt.Sprint(name))
			}
		default:
			names = append(names, "default")
		}
		for _, name := range names {
			if declaration, ok := applied.Networks[name]; ok {
				allocatedNetworks = append(allocatedNetworks, declaration.Name)
			}
		}
		if !ok || runtime.Privileged != expected.Privileged || runtime.ReadOnlyRoot != expected.ReadOnlyRoot || int64(runtime.PIDsLimit) != expected.PIDsLimit ||
			!composeNetworkModeMatches(runtime.NetworkMode, expected.NetworkMode, allocatedNetworks...) || !namespaceModeMatches(runtime.PIDMode, expected.PIDMode) ||
			!namespaceModeMatches(runtime.IPCMode, expected.IPCMode) || strings.TrimSpace(runtime.RestartPolicy) != normalizedRestartPolicy(expected.RestartPolicy) ||
			runtime.ShmSizeBytes != shmSize || strings.TrimSpace(runtime.User) != strings.TrimSpace(expected.User) ||
			!sameStrings(runtime.CapAdd, expected.CapAdd) || !sameStrings(runtime.CapDrop, expected.CapDrop) || !sameStrings(runtime.SecurityOpts, expected.SecurityOpts) {
			return containerengine.ComposeProjectDetails{}, serviceError("CONTAINER_CONFIGURATION_MISMATCH", "A managed Compose container no longer matches its effective runtime configuration.", 409, false, nil)
		}
		if !composePortsMatch(container.Ports, expected.Ports, child.Service == spec.Compose.MainService, service.RuntimePort, spec.Endpoint.ContainerPort) {
			return containerengine.ComposeProjectDetails{}, serviceError("CONTAINER_NETWORK_MISMATCH", "A managed Compose container no longer matches its effective published-port configuration.", 409, false, nil)
		}
		if !composeMountsMatch(container.Mounts, expected.Mounts, d.projectName(service)) {
			return containerengine.ComposeProjectDetails{}, serviceError("CONTAINER_MOUNT_MISMATCH", "A managed Compose container no longer matches its effective mount configuration.", 409, false, nil)
		}
		if !composeDevicesMatch(container.Devices, expected.Devices) {
			return containerengine.ComposeProjectDetails{}, serviceError("CONTAINER_DEVICE_MISMATCH", "A managed Compose container no longer matches its effective device configuration.", 409, false, nil)
		}
	}
	return details, nil
}

func composeMountsMatch(actual []containerengine.MountSummary, expected []ContainerMountSpec, projectName string) bool {
	if len(actual) != len(expected) {
		return false
	}
	matched := make([]bool, len(actual))
	for _, want := range expected {
		found := false
		for index, got := range actual {
			if matched[index] || got.Target != want.Target || got.ReadOnly != want.ReadOnly || got.ContainerSocket {
				continue
			}
			if !composeMountIdentityMatches(got, want, projectName) {
				continue
			}
			matched[index], found = true, true
			break
		}
		if !found {
			return false
		}
	}
	return true
}

func composeMountIdentityMatches(actual containerengine.MountSummary, expected ContainerMountSpec, projectName string) bool {
	switch expected.Type {
	case "bind":
		return actual.Type == containerengine.MountTypeBind && mountSourceMatches(containerengine.ContainerMount{Type: containerengine.MountTypeBind, Source: expected.Source}, actual)
	case "volume":
		return actual.Type == containerengine.MountTypeVolume && (actual.Source == expected.Source || actual.Source == projectName+"_"+expected.Source)
	case "tmpfs":
		return actual.Type == containerengine.MountTypeTmpfs
	default:
		return false
	}
}

func composeDevicesMatch(actual []containerengine.DeviceSummary, expected []ContainerDeviceSpec) bool {
	if len(actual) != len(expected) {
		return false
	}
	matched := make([]bool, len(actual))
	for _, want := range expected {
		containerPath := strings.TrimSpace(want.ContainerPath)
		if containerPath == "" {
			containerPath = strings.TrimSpace(want.HostPath)
		}
		permissions := strings.TrimSpace(want.Permissions)
		if permissions == "" {
			permissions = "rwm"
		}
		found := false
		for index, got := range actual {
			if !matched[index] && got.HostPath == want.HostPath && got.ContainerPath == containerPath && got.Permissions == permissions {
				matched[index], found = true, true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func normalizedRestartPolicy(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "no"
	}
	return value
}

func composeNetworkModeMatches(actual, expected string, allocated ...string) bool {
	actual, expected = strings.TrimSpace(actual), strings.TrimSpace(expected)
	if expected == "" {
		for _, name := range allocated {
			if name != "" && actual == name {
				return true
			}
		}
	}
	if expected == "" || expected == "bridge" {
		return actual == "" || actual == "bridge" || actual == "default"
	}
	return actual == expected
}

func sameStrings(left, right []string) bool {
	left, right = append([]string(nil), left...), append([]string(nil), right...)
	sort.Strings(left)
	sort.Strings(right)
	return strings.Join(left, "\x00") == strings.Join(right, "\x00")
}

func composePortsMatch(actual []containerengine.PortSummary, additional []ContainerPortSpec, main bool, runtimePort, containerPort int) bool {
	expected := append([]ContainerPortSpec(nil), additional...)
	if main {
		expected = append(expected, ContainerPortSpec{ContainerPort: containerPort, HostPort: runtimePort, HostIP: "127.0.0.1", Protocol: "tcp"})
	}
	matched := make([]bool, len(actual))
	for _, want := range expected {
		found := false
		for index, got := range actual {
			if matched[index] || got.Port != want.ContainerPort || (want.HostPort > 0 && got.HostPort != want.HostPort) {
				continue
			}
			if host := strings.TrimSpace(want.HostIP); host != "" && strings.TrimSpace(got.HostIP) != host {
				continue
			}
			matched[index], found = true, true
			break
		}
		if !found {
			return false
		}
	}
	for _, used := range matched {
		if !used {
			return false
		}
	}
	return true
}

func (d *composeTemplateDriver) verifyOwnedProject(ctx context.Context, service *pfregistry.ManagedService, expectedImages map[string]string) (containerengine.ComposeProjectDetails, error) {
	if err := d.verifyIdentity(service); err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
	details, err := d.adapter.InspectComposeDeployment(ctx, d.request(service))
	if err != nil {
		return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISSING", "The exact managed Compose project could not be inspected.", 409, false, err)
	}
	if details.Name != d.projectName(service) {
		return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISMATCH", "The exact managed Compose project identity has changed.", 409, false, nil)
	}
	seen := make(map[string]struct{}, len(details.Containers))
	raw, err := os.ReadFile(d.request(service).ConfigPath)
	if err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
	var document struct {
		Services map[string]struct {
			Labels map[string]string `yaml:"labels"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal(raw, &document); err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
	for _, child := range details.Containers {
		_, known := expectedImages[child.Service]
		if !known {
			return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISMATCH", "The managed Compose project contains an unexpected service.", 409, false, nil)
		}
		if _, duplicate := seen[child.Service]; duplicate {
			return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISMATCH", "The managed Compose project contains an unexpected service replica.", 409, false, nil)
		}
		seen[child.Service] = struct{}{}
		matches, err := d.adapter.ContainerMatchesLabel(ctx, containerengine.ContainerLabelMatchRequest{Engine: containerengine.EngineDocker, ContainerID: child.ContainerID, Key: managedServiceLabel, Value: service.ServiceID})
		if err != nil || !matches {
			return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISMATCH", "A managed Compose container no longer has the exact service identity.", 409, false, err)
		}
		if generation := document.Services[child.Service].Labels[managedServiceLabel+".generation"]; generation != "" {
			matches, err := d.adapter.ContainerMatchesLabel(ctx, containerengine.ContainerLabelMatchRequest{Engine: containerengine.EngineDocker, ContainerID: child.ContainerID, Key: managedServiceLabel + ".generation", Value: generation})
			if err != nil || !matches {
				return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISMATCH", "A Compose container belongs to another allocation.", 409, false, err)
			}
		}
		inspected, err := d.adapter.Inspect(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: child.ContainerID})
		if err != nil {
			return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISSING", "A managed Compose container could not be inspected.", 409, false, err)
		}
		if inspected.Container.ContainerID != child.ContainerID {
			return containerengine.ComposeProjectDetails{}, serviceError("COMPOSE_IDENTITY_MISMATCH", "A managed Compose container image identity has changed.", 409, false, nil)
		}
	}
	return details, nil
}

func (d *composeTemplateDriver) expectedImages(service *pfregistry.ManagedService) (map[string]string, error) {
	raw, err := os.ReadFile(d.request(service).ConfigPath)
	if err != nil {
		return nil, err
	}
	var document map[string]any
	if err := yaml.Unmarshal(raw, &document); err != nil {
		return nil, serviceError("COMPOSE_IDENTITY_MISMATCH", "The managed Compose configuration is invalid.", 409, false, err)
	}
	services, ok := document["services"].(map[string]any)
	if !ok || len(services) == 0 {
		return nil, serviceError("COMPOSE_IDENTITY_MISMATCH", "The managed Compose configuration has no services.", 409, false, nil)
	}
	images := make(map[string]string, len(services))
	for name, rawService := range services {
		entry, ok := rawService.(map[string]any)
		if !ok {
			return nil, serviceError("COMPOSE_IDENTITY_MISMATCH", "The managed Compose configuration contains an invalid service.", 409, false, nil)
		}
		image := strings.TrimSpace(fmt.Sprint(entry["image"]))
		if !strings.Contains(image, "@sha256:") {
			return nil, serviceError("COMPOSE_IDENTITY_MISMATCH", "A managed Compose image is not pinned by digest.", 409, false, nil)
		}
		images[name] = image
	}
	return images, nil
}

func (d *composeTemplateDriver) Start(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	if _, err := d.verifyProject(ctx, service); err != nil {
		return "", err
	}
	if err := d.adapter.StartComposeDeployment(ctx, d.request(service)); err != nil {
		return "", serviceError("START_FAILED", "The managed Compose project could not be started.", 502, true, err)
	}
	if _, err := d.verifyProject(ctx, service); err != nil {
		return "", err
	}
	return service.RuntimeIdentity, nil
}

func (d *composeTemplateDriver) Stop(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil || strings.TrimSpace(service.RuntimeIdentity) == "" {
		return nil
	}
	expectedImages, err := d.expectedImages(service)
	if err != nil {
		return err
	}
	details, err := d.verifyOwnedProject(ctx, service, expectedImages)
	if err != nil {
		return err
	}
	if len(details.Containers) == 0 {
		return nil
	}
	if err := d.adapter.StopComposeDeployment(ctx, d.request(service)); err != nil {
		return serviceError("STOP_FAILED", "The exact managed Compose project could not be stopped.", 502, true, err)
	}
	return nil
}

func (d *composeTemplateDriver) Uninstall(ctx context.Context, service *pfregistry.ManagedService, deleteData bool, progress operationProgress) error {
	if strings.TrimSpace(service.RuntimeIdentity) != "" {
		expectedImages, err := d.expectedImages(service)
		if err != nil {
			return err
		}
		details, err := d.verifyOwnedProject(ctx, service, expectedImages)
		if err != nil {
			return err
		}
		progress("stopping", 2)
		if pendingUninstall(service) {
			for _, child := range details.Containers {
				if _, err := d.verifyOwnedProject(ctx, service, expectedImages); err != nil {
					return err
				}
				if child.State == containerengine.ContainerStateRunning || child.State == containerengine.ContainerStateRestarting || child.State == containerengine.ContainerStatePaused {
					result, err := d.adapter.Stop(ctx, containerengine.ContainerActionRequest{Engine: containerengine.EngineDocker, ContainerID: child.ContainerID, TimeoutSec: 10})
					if err != nil || !result.Completed {
						return serviceError("STOP_FAILED", "A verified Compose container could not be stopped.", 502, true, err)
					}
				}
				result, err := d.adapter.Remove(ctx, containerengine.ContainerActionRequest{Engine: containerengine.EngineDocker, ContainerID: child.ContainerID})
				if !errors.Is(err, containerengine.ErrContainerNotFound) && (err != nil || !result.Completed) {
					return serviceError("CONTAINER_REMOVE_FAILED", "A verified Compose container could not be removed.", 502, true, err)
				}
			}
			return nil
		}
		if len(details.Containers) > 0 {
			if err := d.adapter.StopComposeDeployment(ctx, d.request(service)); err != nil {
				return serviceError("STOP_FAILED", "The exact managed Compose project could not be stopped.", 502, true, err)
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			progress("uninstalling", 5)
			if err := d.adapter.RemoveComposeDeployment(ctx, d.request(service), deleteData); err != nil {
				return serviceError("COMPOSE_REMOVE_FAILED", "The exact managed Compose project could not be removed.", 502, true, err)
			}
		} else {
			progress("uninstalling", 5)
		}
	} else {
		progress("uninstalling", 5)
	}
	if pendingUninstall(service) {
		return nil
	}
	return os.RemoveAll(filepath.Dir(d.request(service).ConfigPath))
}

func (d *composeTemplateDriver) CleanupPartial(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil {
		return nil
	}
	if strings.TrimSpace(service.RuntimeIdentity) != "" {
		expectedImages, err := d.expectedImages(service)
		if err != nil {
			return err
		}
		if _, err := d.verifyOwnedProject(ctx, service, expectedImages); err == nil {
			if err := d.adapter.RemoveComposeDeployment(ctx, d.request(service), false); err != nil {
				return err
			}
		} else {
			code, _, _, _ := ErrorDetails(err)
			if code != "COMPOSE_IDENTITY_MISSING" {
				return err
			}
		}
	}
	return os.RemoveAll(filepath.Dir(d.request(service).ConfigPath))
}

func (d *composeTemplateDriver) Logs(ctx context.Context, service *pfregistry.ManagedService, tail int) (*LogResult, error) {
	if _, err := d.verifyProject(ctx, service); err != nil {
		return nil, err
	}
	lines, err := d.adapter.TailComposeDeploymentLogs(ctx, d.request(service), tail)
	if err != nil {
		return nil, err
	}
	for index := range lines {
		lines[index] = redactLogLine(lines[index])
	}
	return &LogResult{Lines: lines}, nil
}
