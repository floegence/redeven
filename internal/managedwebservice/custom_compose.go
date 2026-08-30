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

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"gopkg.in/yaml.v3"
)

type composeTemplateDriver struct {
	manager *Manager
	adapter *containerengine.Adapter
}

func (d *composeTemplateDriver) RebuildStoppedRuntime(ctx context.Context, service *pfregistry.ManagedService, _ TemplateSpec, _ string) (string, string, error) {
	runtimeID, artifact, err := d.Install(ctx, service, catalogPayload{}, func(string, int64) {})
	if err != nil {
		return "", "", err
	}
	service.RuntimeIdentity, service.ArtifactReference = runtimeID, artifact
	if err := d.adapter.CreateComposeDeployment(ctx, d.request(service)); err != nil {
		return "", "", serviceError("COMPOSE_CREATE_FAILED", "The stopped managed Compose runtime could not be created.", 502, true, err)
	}
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
	if _, err := d.verifyProject(ctx, service); err != nil {
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
	if err != nil || len(details.Containers) == 0 {
		return "", nil
	}
	digest := sha256.Sum256(raw)
	return d.identity(service, hex.EncodeToString(digest[:])), nil
}

func (d *composeTemplateDriver) Install(ctx context.Context, service *pfregistry.ManagedService, _ catalogPayload, progress func(string, int64)) (string, string, error) {
	if d.adapter == nil {
		return "", "", serviceError("DOCKER_UNAVAILABLE", "Docker Compose is not available in this Environment.", 409, true, nil)
	}
	spec, configuration, err := effectiveSpecFromService(service)
	if err != nil {
		return "", "", err
	}
	if spec.Kind != DeploymentCompose || spec.Compose == nil {
		return "", "", serviceError("TEMPLATE_SNAPSHOT_INVALID", "The service does not contain a Compose template snapshot.", 409, false, nil)
	}
	progress("pulling", 2)
	secrets, err := d.manager.serviceSecretDocument(service.ServiceID)
	if err != nil {
		return "", "", err
	}
	generated, pinned, secretVariables, err := d.generateCompose(ctx, service, spec, configuration, secrets)
	if err != nil {
		return "", "", err
	}
	progress("verifying", 3)
	request := d.request(service)
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
	return d.identity(service, hex.EncodeToString(digest[:])), artifact, nil
}

func (d *composeTemplateDriver) generateCompose(ctx context.Context, service *pfregistry.ManagedService, spec TemplateSpec, configuration serviceConfiguration, secrets serviceSecrets) ([]byte, []string, map[string]string, error) {
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
	for _, name := range names {
		entry, ok := services[name].(map[string]any)
		if !ok {
			return nil, nil, nil, serviceError("TEMPLATE_COMPOSE_INVALID", "A Compose service definition is invalid.", 400, false, nil)
		}
		image := strings.TrimSpace(fmt.Sprint(entry["image"]))
		pulled, err := pullManagedImage(ctx, d.adapter, image)
		if err != nil {
			return nil, nil, nil, err
		}
		pinnedImage, err := pinnedImageReference(image, pulled.Image.Digest)
		if err != nil {
			return nil, nil, nil, err
		}
		entry["image"] = pinnedImage
		pinned = append(pinned, pinnedImage)
		entry["labels"] = mergeComposeLabels(entry["labels"], map[string]string{managedServiceLabel: service.ServiceID})
		injectComposeSecrets(entry, name, configuration.SecretEnvironmentNames, secrets.Environment, secretVariables)
		if name == spec.Compose.MainService {
			ports, _ := entry["ports"].([]any)
			entry["ports"] = append(ports, map[string]any{"target": spec.Endpoint.ContainerPort, "published": service.RuntimePort, "host_ip": "127.0.0.1", "protocol": "tcp"})
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
	root := filepath.Join(d.manager.stateDir, "instances", service.ServiceID, "compose")
	return containerengine.ComposeDeploymentRequest{ConfigPath: filepath.Join(root, "compose.yaml"), EnvFilePath: filepath.Join(root, "template.env"), ProjectName: d.projectName(service)}
}

func (d *composeTemplateDriver) projectName(service *pfregistry.ManagedService) string {
	return "redeven_" + resourceNameSuffix(service.ServiceFamilyID)
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
	spec, _, err := effectiveSpecFromService(service)
	if err != nil {
		return containerengine.ComposeProjectDetails{}, err
	}
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
		if !ok || runtime.Privileged != expected.Privileged || runtime.ReadOnlyRoot != expected.ReadOnlyRoot || int64(runtime.PIDsLimit) != expected.PIDsLimit ||
			!composeNetworkModeMatches(runtime.NetworkMode, expected.NetworkMode) || !namespaceModeMatches(runtime.PIDMode, expected.PIDMode) ||
			!namespaceModeMatches(runtime.IPCMode, expected.IPCMode) || strings.TrimSpace(runtime.RestartPolicy) != normalizedRestartPolicy(expected.RestartPolicy) ||
			runtime.ShmSizeBytes != expected.ShmSizeBytes || strings.TrimSpace(runtime.User) != strings.TrimSpace(expected.User) ||
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

func composeNetworkModeMatches(actual, expected string) bool {
	actual, expected = strings.TrimSpace(actual), strings.TrimSpace(expected)
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

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func (d *composeTemplateDriver) Start(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	if err := d.verifyIdentity(service); err != nil {
		return "", err
	}
	if err := d.adapter.ApplyComposeDeployment(ctx, d.request(service)); err != nil {
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
	if _, err := d.verifyProject(ctx, service); err != nil {
		return err
	}
	if err := d.adapter.StopComposeDeployment(ctx, d.request(service)); err != nil {
		return serviceError("STOP_FAILED", "The exact managed Compose project could not be stopped.", 502, true, err)
	}
	return nil
}

func (d *composeTemplateDriver) Uninstall(ctx context.Context, service *pfregistry.ManagedService, deleteData bool) error {
	if strings.TrimSpace(service.RuntimeIdentity) != "" {
		if _, err := d.verifyProject(ctx, service); err != nil {
			return err
		}
		if err := d.adapter.RemoveComposeDeployment(ctx, d.request(service), deleteData); err != nil {
			return serviceError("COMPOSE_REMOVE_FAILED", "The exact managed Compose project could not be removed.", 502, true, err)
		}
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
