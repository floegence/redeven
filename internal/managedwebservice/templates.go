package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"gopkg.in/yaml.v3"
)

const templateSpecSchemaVersion = 1

var (
	templateNamePattern             = regexp.MustCompile(`^[^\x00-\x1f\x7f]{1,80}$`)
	templateParameterPattern        = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)
	managedWorkspaceIdentityPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)
	composeServicePattern           = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$`)
	composeVolumePattern            = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)
)

func (m *Manager) Template(ctx context.Context, templateID string) (*Template, error) {
	templateID = strings.TrimSpace(templateID)
	if !isBuiltInTemplateID(templateID) {
		if m.registry == nil {
			return nil, serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, nil)
		}
		record, err := m.registry.GetManagedTemplate(ctx, templateID)
		if err != nil {
			return nil, err
		}
		if record == nil {
			return nil, serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, nil)
		}
		return m.templateFromRecord(ctx, *record)
	}
	items, err := m.Catalog(ctx)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].TemplateID == templateID {
			return &items[i], nil
		}
	}
	return nil, serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, nil)
}

func (m *Manager) ValidateTemplate(_ context.Context, req TemplateWriteRequest) error {
	return validateTemplateWriteRequest(req)
}

func (m *Manager) CreateTemplate(ctx context.Context, req TemplateWriteRequest) (*Template, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	if err := validateTemplateWriteRequest(req); err != nil {
		return nil, err
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	specJSON, specHash, err := canonicalTemplateSpec(req.Spec)
	if err != nil {
		return nil, err
	}
	fingerprint := requestFingerprint("template-create", strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), strings.TrimSpace(req.Version), specHash)
	if existing, err := m.registry.GetManagedTemplateRequest(ctx, req.RequestID); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.RequestFingerprint != fingerprint {
			return nil, serviceError("IDEMPOTENCY_CONFLICT", "request_id was already used for a different template request.", 409, false, nil)
		}
		return m.Template(ctx, existing.TemplateID)
	}
	templateID, err := randomID("tmpl")
	if err != nil {
		return nil, err
	}
	familyID, err := randomID("family")
	if err != nil {
		return nil, err
	}
	if _, err := m.prepareDefaultWorkspace(templateID); err != nil {
		return nil, err
	}
	record := pfregistry.ManagedTemplate{
		TemplateID: templateID, Name: strings.TrimSpace(req.Name), Description: strings.TrimSpace(req.Description), Source: "custom",
		Deployment: string(req.Spec.Kind), Version: strings.TrimSpace(req.Version), Revision: 1, SpecJSON: specJSON, SpecSHA256: specHash, ServiceFamilyID: familyID,
	}
	request := pfregistry.ManagedTemplateRequest{RequestID: strings.TrimSpace(req.RequestID), RequestFingerprint: fingerprint, TemplateID: templateID, Action: "create"}
	if err := m.registry.CreateManagedTemplateWithRequest(ctx, record, request); err != nil {
		return nil, templateRegistryError(err)
	}
	return m.templateFromRecord(ctx, record)
}

func (m *Manager) UpdateTemplate(ctx context.Context, templateID string, req TemplateWriteRequest) (*Template, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	if err := validateTemplateWriteRequest(req); err != nil {
		return nil, err
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	record, err := m.registry.GetManagedTemplate(ctx, templateID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		if isBuiltInTemplateID(templateID) {
			return nil, serviceError("BUILTIN_TEMPLATE_IMMUTABLE", "Built-in templates cannot be edited. Duplicate the template first.", 409, false, nil)
		}
		return nil, serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, nil)
	}
	specJSON, specHash, err := canonicalTemplateSpec(req.Spec)
	if err != nil {
		return nil, err
	}
	record.Name, record.Description, record.Version = strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), strings.TrimSpace(req.Version)
	record.Deployment, record.SpecJSON, record.SpecSHA256 = string(req.Spec.Kind), specJSON, specHash
	record.Revision++
	if err := m.registry.UpdateManagedTemplate(ctx, *record); err != nil {
		return nil, templateRegistryError(err)
	}
	return m.templateFromRecord(ctx, *record)
}

func (m *Manager) DeleteTemplate(ctx context.Context, templateID string) error {
	if isBuiltInTemplateID(templateID) {
		return serviceError("BUILTIN_TEMPLATE_IMMUTABLE", "Built-in templates cannot be deleted.", 409, false, nil)
	}
	if err := m.registry.DeleteManagedTemplate(ctx, templateID); err != nil {
		return templateRegistryError(err)
	}
	return nil
}

func (m *Manager) DuplicateTemplate(ctx context.Context, templateID string, req TemplateDuplicateRequest) (*Template, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if !templateNamePattern.MatchString(name) {
		return nil, serviceError("TEMPLATE_NAME_INVALID", "Template name must contain 1 to 80 printable characters.", 400, false, nil)
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	source, err := m.Template(ctx, templateID)
	if err != nil {
		return nil, err
	}
	if source.Spec == nil {
		return nil, serviceError("TEMPLATE_UNAVAILABLE", "This template cannot be duplicated until its exact deployment definition is available.", 409, true, nil)
	}
	if !source.Duplicateable {
		return nil, serviceError("TEMPLATE_DUPLICATION_UNAVAILABLE", "This built-in template cannot be duplicated because its runtime safety contract is managed by Redeven.", 409, false, nil)
	}
	spec := *source.Spec
	spec.Kind = duplicateKind(source.Deployment, spec.Kind)
	if source.Source == "builtin" && !completeBuiltInDuplicateSpec(spec) {
		return nil, serviceError("TEMPLATE_UNAVAILABLE", "This built-in template cannot be duplicated until its exact audited deployment definition is available.", 409, true, nil)
	}
	specJSON, specHash, err := canonicalTemplateSpec(spec)
	if err != nil {
		return nil, err
	}
	fingerprint := requestFingerprint("template-duplicate", source.TemplateID, fmt.Sprint(source.Revision), name, specHash)
	if existing, err := m.registry.GetManagedTemplateRequest(ctx, req.RequestID); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.RequestFingerprint != fingerprint {
			return nil, serviceError("IDEMPOTENCY_CONFLICT", "request_id was already used for a different template request.", 409, false, nil)
		}
		return m.Template(ctx, existing.TemplateID)
	}
	copyID, err := randomID("tmpl")
	if err != nil {
		return nil, err
	}
	familyID, err := randomID("family")
	if err != nil {
		return nil, err
	}
	if _, err := m.prepareDefaultWorkspace(templateID); err != nil {
		return nil, err
	}
	record := pfregistry.ManagedTemplate{
		TemplateID: copyID, Name: name, Description: source.Description, Source: "custom", Deployment: string(spec.Kind), Version: source.Version,
		Revision: 1, SpecJSON: specJSON, SpecSHA256: specHash, DerivedFromTemplateID: source.TemplateID, DerivedFromRevision: source.Revision, ServiceFamilyID: familyID,
	}
	request := pfregistry.ManagedTemplateRequest{RequestID: strings.TrimSpace(req.RequestID), RequestFingerprint: fingerprint, TemplateID: copyID, Action: "duplicate"}
	if err := m.registry.CreateManagedTemplateWithRequest(ctx, record, request); err != nil {
		return nil, templateRegistryError(err)
	}
	return m.templateFromRecord(ctx, record)
}

func completeBuiltInDuplicateSpec(spec TemplateSpec) bool {
	switch spec.Kind {
	case DeploymentHost:
		return spec.Host != nil && (spec.Host.Artifact != nil || spec.Host.RuntimeBundle == deepSeekRuntimeBundleID)
	case DeploymentContainer:
		return spec.Container != nil && strings.Contains(spec.Container.Image, "@sha256:")
	default:
		return false
	}
}

func duplicateKind(deployment, specKind Deployment) Deployment {
	switch deployment {
	case DeploymentNative:
		return DeploymentHost
	case DeploymentDocker:
		return DeploymentContainer
	default:
		return specKind
	}
}

func (m *Manager) templateFromRecord(ctx context.Context, record pfregistry.ManagedTemplate) (*Template, error) {
	spec, err := verifiedTemplateSpec(record.SpecJSON, record.SpecSHA256)
	if errors.Is(err, errTemplateSpecIdentityMismatch) {
		return nil, serviceError("TEMPLATE_IDENTITY_MISMATCH", "The saved template definition identity has changed.", 409, false, err)
	}
	if err != nil {
		return nil, serviceError("TEMPLATE_SPEC_INVALID", "The saved template definition is invalid or no longer satisfies the template policy.", 409, false, err)
	}
	available, code, reason := m.customTemplateAvailability(ctx, spec.Kind)
	defaultWorkspacePath, err := m.prepareDefaultWorkspace(record.TemplateID)
	if err != nil {
		return nil, err
	}
	effectiveSpec, err := effectiveTemplateSpec(spec)
	if err != nil {
		return nil, err
	}
	return &Template{
		TemplateID: record.TemplateID, Name: record.Name, Description: record.Description, Version: record.Version, Source: "custom", Deployment: spec.Kind,
		ContainerMode: containerMode(spec.Kind), Revision: record.Revision, Editable: true, Duplicateable: true, DerivedFromTemplateID: record.DerivedFromTemplateID,
		DerivedFromRevision: record.DerivedFromRevision, ServiceFamilyID: record.ServiceFamilyID, Available: available, ReasonCode: code, Reason: reason,
		Deployments: []DeploymentAvailability{{Deployment: spec.Kind, Available: available, ReasonCode: code, Reason: reason}}, DefaultWorkspacePath: defaultWorkspacePath, WorkspaceRoots: m.workspaceRoots(), Spec: &spec, EffectiveSpec: &effectiveSpec,
		HostLifecyclePlan: hostLifecyclePlan(spec.Kind, spec),
		DefaultAccessMode: pfregistry.AccessModeUnifiedProxy,
	}, nil
}

func (m *Manager) customTemplateAvailability(ctx context.Context, kind Deployment) (bool, string, string) {
	switch kind {
	case DeploymentHost:
		if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
			return false, "PLATFORM_UNSUPPORTED", "Host templates support Linux and macOS."
		}
		return true, "", ""
	case DeploymentContainer:
		return m.dockerAvailability(ctx)
	case DeploymentCompose:
		if ok, code, reason := m.dockerAvailability(ctx); !ok {
			return ok, code, reason
		}
		if m.containers == nil || !m.containers.SupportsComposeDeployment() {
			return false, "COMPOSE_UNAVAILABLE", "Docker Compose is not available in this Environment."
		}
		return true, "", ""
	default:
		return false, "DEPLOYMENT_INVALID", "The template deployment type is invalid."
	}
}

func containerMode(kind Deployment) string {
	if kind == DeploymentCompose {
		return "compose"
	}
	if kind == DeploymentContainer || kind == DeploymentDocker {
		return "single"
	}
	return ""
}

func validateTemplateWriteRequest(req TemplateWriteRequest) error {
	if !templateNamePattern.MatchString(strings.TrimSpace(req.Name)) {
		return serviceError("TEMPLATE_NAME_INVALID", "Template name must contain 1 to 80 printable characters.", 400, false, nil)
	}
	if len(req.Description) > 1000 || len(req.Version) > 80 {
		return serviceError("TEMPLATE_METADATA_INVALID", "Template description or version is too long.", 400, false, nil)
	}
	if req.Spec.Container != nil && req.Spec.Container.RuntimeProfile == ContainerRuntimeProfileInteractiveDesktop && !reviewedInteractiveDesktopImage(req.Spec.Container.Image) {
		return serviceError("TEMPLATE_RUNTIME_PROFILE_RESERVED", "The interactive desktop runtime profile is reserved for reviewed Redeven templates.", 400, false, nil)
	}
	return validateTemplateSpec(req.Spec)
}

func reviewedInteractiveDesktopImage(reference string) bool {
	reference = strings.TrimSpace(reference)
	for _, templateID := range []string{WebtopUbuntuKDETemplateID, WebtopDebianXFCETemplateID} {
		for _, platform := range []string{"linux-amd64", "linux-arm64"} {
			artifact, ok := auditedWebtopArtifact(templateID, platform)
			if ok && reference == artifact.Image+"@"+artifact.Digest {
				return true
			}
		}
	}
	return false
}

func validateTemplateSpec(spec TemplateSpec) error {
	if spec.SchemaVersion != templateSpecSchemaVersion {
		return serviceError("TEMPLATE_SCHEMA_UNSUPPORTED", "The template schema version is not supported.", 400, false, nil)
	}
	if spec.Endpoint.Scheme != "http" && spec.Endpoint.Scheme != "https" {
		return serviceError("TEMPLATE_ENDPOINT_INVALID", "Template endpoint scheme must be http or https.", 400, false, nil)
	}
	for _, value := range []string{spec.Endpoint.Path, spec.Endpoint.HealthPath} {
		if value != "" && (!strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\x00\r\n")) {
			return serviceError("TEMPLATE_ENDPOINT_INVALID", "Template endpoint paths must begin with /.", 400, false, nil)
		}
	}
	if spec.Endpoint.StartupTimeout < 0 || spec.Endpoint.StartupTimeout > 600 {
		return serviceError("TEMPLATE_ENDPOINT_INVALID", "Template startup timeout must be between 0 and 600 seconds.", 400, false, nil)
	}
	if len(spec.Parameters) > 64 {
		return serviceError("TEMPLATE_PARAMETERS_INVALID", "A template can define at most 64 parameters.", 400, false, nil)
	}
	seen := map[string]struct{}{}
	for _, parameter := range spec.Parameters {
		if !templateParameterPattern.MatchString(parameter.Name) || len(parameter.Label) > 80 || len(parameter.Description) > 300 {
			return serviceError("TEMPLATE_PARAMETERS_INVALID", "A template parameter is invalid.", 400, false, nil)
		}
		if _, ok := seen[parameter.Name]; ok {
			return serviceError("TEMPLATE_PARAMETERS_INVALID", "Template parameter names must be unique.", 400, false, nil)
		}
		seen[parameter.Name] = struct{}{}
		if parameter.Type != "text" && parameter.Type != "number" && parameter.Type != "boolean" && parameter.Type != "secret" && parameter.Type != "path" {
			return serviceError("TEMPLATE_PARAMETERS_INVALID", "Template parameter type is invalid.", 400, false, nil)
		}
		if parameter.Type == "secret" && parameter.Default != "" {
			return serviceError("TEMPLATE_SECRET_DEFAULT_FORBIDDEN", "Secret template parameters cannot have default values.", 400, false, nil)
		}
	}
	switch spec.Kind {
	case DeploymentHost:
		if spec.Host == nil || strings.TrimSpace(spec.Host.StartScript) == "" {
			return serviceError("TEMPLATE_HOST_INVALID", "Host templates require a foreground start script.", 400, false, nil)
		}
		for _, script := range []string{spec.Host.InstallScript, spec.Host.StartScript, spec.Host.StopScript, spec.Host.UninstallScript} {
			if len(script) > 128*1024 || strings.ContainsRune(script, '\x00') {
				return serviceError("TEMPLATE_HOST_INVALID", "A host lifecycle script is too large or invalid.", 400, false, nil)
			}
		}
		if spec.Host.RuntimeBundle != "" && (spec.Host.RuntimeBundle != deepSeekRuntimeBundleID || spec.Host.Artifact != nil) {
			return serviceError("TEMPLATE_RUNTIME_BUNDLE_INVALID", "The host template runtime bundle is not supported or conflicts with a package artifact.", 400, false, nil)
		}
	case DeploymentContainer:
		if spec.Container == nil || !validImageReference(spec.Container.Image) || spec.Endpoint.ContainerPort < 1 || spec.Endpoint.ContainerPort > 65535 {
			return serviceError("TEMPLATE_CONTAINER_INVALID", "Single-container templates require an image and a valid container Web port.", 400, false, nil)
		}
		if len(spec.Container.Entrypoint) > 1 || len(spec.Container.Command) > 128 || len(spec.Container.Environment) > 256 || len(spec.Container.Mounts) > 128 {
			return serviceError("TEMPLATE_CONTAINER_INVALID", "The single-container command or resource definition exceeds its limit.", 400, false, nil)
		}
		for key, value := range spec.Container.Environment {
			if !templateParameterPattern.MatchString(key) || strings.ContainsAny(value, "\x00\r\n") {
				return serviceError("TEMPLATE_CONTAINER_INVALID", "A container environment variable is invalid.", 400, false, nil)
			}
		}
		for _, mount := range spec.Container.Mounts {
			if (mount.Type != "workspace" && mount.Type != "bind" && mount.Type != "volume" && mount.Type != "tmpfs") || !filepath.IsAbs(mount.Target) ||
				(mount.Type == "bind" && !filepath.IsAbs(mount.Source)) ||
				strings.Contains(strings.ToLower(mount.Target), "docker.sock") || strings.Contains(strings.ToLower(mount.Source), "docker.sock") {
				return serviceError("TEMPLATE_MOUNT_REJECTED", "Container mounts must use absolute targets and cannot expose the container engine socket.", 400, false, nil)
			}
		}
		switch spec.Container.RuntimeProfile {
		case "", ContainerRuntimeProfileRestricted:
		case ContainerRuntimeProfileInteractiveDesktop:
			if spec.Container.ReadOnlyRoot || spec.Container.PIDsLimit != 2048 || strings.TrimSpace(spec.Container.User) != "" || len(spec.Container.Entrypoint) != 0 || !strings.Contains(spec.Container.Image, "@sha256:") {
				return serviceError("TEMPLATE_RUNTIME_PROFILE_INVALID", "Interactive desktop templates must use the reviewed writable-root, root-entrypoint, digest-pinned runtime contract.", 400, false, nil)
			}
		default:
			return serviceError("TEMPLATE_RUNTIME_PROFILE_INVALID", "The container runtime profile is not supported.", 400, false, nil)
		}
	case DeploymentCompose:
		if spec.Compose == nil || !composeServicePattern.MatchString(spec.Compose.MainService) || spec.Endpoint.ContainerPort < 1 || spec.Endpoint.ContainerPort > 65535 {
			return serviceError("TEMPLATE_COMPOSE_INVALID", "Compose templates require an entry service and a valid container Web port.", 400, false, nil)
		}
		if err := validateComposeYAML(spec.Compose.YAML, spec.Compose.MainService); err != nil {
			return err
		}
	default:
		return serviceError("DEPLOYMENT_INVALID", "Choose a host, single-container, or Compose template.", 400, false, nil)
	}
	return nil
}

func validImageReference(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && len(value) <= 512 && !strings.ContainsAny(value, "\x00\r\n\t ")
}

func validateComposeYAML(raw, mainService string) error {
	if len(raw) == 0 || len(raw) > 512*1024 || strings.ContainsRune(raw, '\x00') {
		return serviceError("TEMPLATE_COMPOSE_INVALID", "Compose YAML is empty or exceeds the 512 KiB limit.", 400, false, nil)
	}
	var document map[string]any
	if err := yaml.Unmarshal([]byte(raw), &document); err != nil {
		return serviceError("TEMPLATE_COMPOSE_INVALID", "Compose YAML could not be parsed.", 400, false, err)
	}
	for _, forbidden := range []string{"include", "secrets", "configs"} {
		if _, ok := document[forbidden]; ok {
			return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "Compose include, secrets, and configs are not supported in managed templates.", 400, false, nil)
		}
	}
	if volumes, ok := document["volumes"].(map[string]any); ok {
		for _, rawVolume := range volumes {
			if rawVolume == nil {
				continue
			}
			volume, ok := rawVolume.(map[string]any)
			if !ok || len(volume) != 0 {
				return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "Managed Compose volumes cannot be external, named, or configured with host driver options.", 400, false, nil)
			}
		}
	}
	if networks, ok := document["networks"].(map[string]any); ok {
		for _, rawNetwork := range networks {
			if network, ok := rawNetwork.(map[string]any); ok && (truthyYAML(network["external"]) || yamlString(network, "name") != "") {
				return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "External or explicitly named Compose networks are not supported in managed templates.", 400, false, nil)
			}
		}
	}
	services, ok := document["services"].(map[string]any)
	if !ok || len(services) == 0 {
		return serviceError("TEMPLATE_COMPOSE_INVALID", "Compose YAML must define services.", 400, false, nil)
	}
	if _, ok := services[mainService]; !ok {
		return serviceError("TEMPLATE_COMPOSE_INVALID", "The Compose entry service does not exist.", 400, false, nil)
	}
	for name, rawService := range services {
		if !composeServicePattern.MatchString(name) {
			return serviceError("TEMPLATE_COMPOSE_INVALID", "A Compose service name is invalid.", 400, false, nil)
		}
		service, ok := rawService.(map[string]any)
		if !ok || !validImageReference(fmt.Sprint(service["image"])) {
			return serviceError("TEMPLATE_COMPOSE_INVALID", "Every Compose service must use a published image.", 400, false, nil)
		}
		for _, forbidden := range []string{
			"build", "ports", "devices", "extends", "container_name", "cap_add", "device_cgroup_rules", "volumes_from",
			"env_file", "label_file", "develop", "use_api_socket", "credential_spec", "uts", "userns_mode", "cgroup",
			"cgroup_parent", "runtime", "profiles", "scale", "deploy",
		} {
			if _, ok := service[forbidden]; ok {
				return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "The Compose service requests a host-level or externally managed capability that Redeven does not allow.", 400, false, nil)
			}
		}
		networkMode := yamlString(service, "network_mode")
		if truthyYAML(service["privileged"]) || (networkMode != "" && networkMode != "bridge" && networkMode != "default" && networkMode != "none") || strings.EqualFold(fmt.Sprint(service["pid"]), "host") || strings.EqualFold(fmt.Sprint(service["ipc"]), "host") {
			return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "Privileged or host namespace Compose services are not allowed.", 400, false, nil)
		}
		if strings.Contains(strings.ToLower(fmt.Sprint(service["volumes"])), "docker.sock") {
			return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "Compose services cannot mount the container engine socket.", 400, false, nil)
		}
		if err := validateComposeMounts(service["volumes"]); err != nil {
			return err
		}
	}
	return nil
}

func validateComposeMounts(raw any) error {
	items, ok := raw.([]any)
	if raw == nil {
		return nil
	}
	if !ok {
		return serviceError("TEMPLATE_COMPOSE_INVALID", "Compose service volumes must be a list.", 400, false, nil)
	}
	for _, item := range items {
		switch value := item.(type) {
		case string:
			source := strings.TrimSpace(strings.SplitN(value, ":", 2)[0])
			if source == "" || source == "${REDEVEN_WORKSPACE}" || composeVolumePattern.MatchString(source) {
				continue
			}
			return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "Compose bind mounts may use only ${REDEVEN_WORKSPACE}; other host paths are not allowed.", 400, false, nil)
		case map[string]any:
			mountType := strings.ToLower(strings.TrimSpace(fmt.Sprint(value["type"])))
			source := strings.TrimSpace(fmt.Sprint(value["source"]))
			if mountType == "bind" && source != "${REDEVEN_WORKSPACE}" {
				return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "Compose bind mounts may use only ${REDEVEN_WORKSPACE}; other host paths are not allowed.", 400, false, nil)
			}
			if mountType == "volume" && source != "" && !composeVolumePattern.MatchString(source) {
				return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "Compose volume mounts must use a project-owned named volume.", 400, false, nil)
			}
			if mountType != "bind" && mountType != "volume" && mountType != "tmpfs" {
				return serviceError("TEMPLATE_COMPOSE_POLICY_REJECTED", "Compose mounts must be project volumes, managed workspace binds, or tmpfs mounts.", 400, false, nil)
			}
		default:
			return serviceError("TEMPLATE_COMPOSE_INVALID", "A Compose service volume definition is invalid.", 400, false, nil)
		}
	}
	return nil
}

func truthyYAML(value any) bool {
	flag, _ := value.(bool)
	return flag
}

func yamlString(value map[string]any, key string) string {
	raw, ok := value[key]
	if !ok || raw == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(raw))
}

func canonicalTemplateSpec(spec TemplateSpec) (string, string, error) {
	raw, err := json.Marshal(spec)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(raw)
	return string(raw), hex.EncodeToString(digest[:]), nil
}

func effectiveTemplateSpec(spec TemplateSpec) (TemplateSpec, error) {
	raw, err := json.Marshal(spec)
	if err != nil {
		return TemplateSpec{}, err
	}
	effective := TemplateSpec{}
	if err := decodeStrictJSON(raw, &effective); err != nil {
		return TemplateSpec{}, err
	}
	if effective.Container != nil {
		normalizeContainerTemplateDefaults(effective.Container)
	}
	return effective, nil
}

var errTemplateSpecIdentityMismatch = errors.New("template spec document identity mismatch")

func verifiedTemplateSpec(raw, expectedDigest string) (TemplateSpec, error) {
	digest := sha256.Sum256([]byte(raw))
	if hex.EncodeToString(digest[:]) != strings.TrimSpace(expectedDigest) {
		return TemplateSpec{}, errTemplateSpecIdentityMismatch
	}
	spec := TemplateSpec{}
	if err := decodeStrictJSON([]byte(raw), &spec); err != nil {
		return TemplateSpec{}, err
	}
	if err := validateTemplateSpec(spec); err != nil {
		return TemplateSpec{}, err
	}
	return spec, nil
}

func templateRegistryError(err error) error {
	switch {
	case errors.Is(err, pfregistry.ErrManagedTemplateNameConflict):
		return serviceError("TEMPLATE_NAME_CONFLICT", "A template with this name already exists in the Environment.", 409, false, err)
	case errors.Is(err, pfregistry.ErrManagedTemplateInUse):
		return serviceError("TEMPLATE_IN_USE", "Uninstall the managed service before deleting its template.", 409, false, err)
	case errors.Is(err, pfregistry.ErrManagedTemplateNotFound):
		return serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, err)
	default:
		return err
	}
}

func isBuiltInTemplateID(templateID string) bool {
	_, ok := builtInTemplateDefinitionByID(templateID)
	return ok
}

func sortTemplates(items []Template) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Source != items[j].Source {
			return items[i].Source == "builtin"
		}
		if items[i].Source == "builtin" && items[i].SortOrder != items[j].SortOrder {
			return items[i].SortOrder < items[j].SortOrder
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
}

func resolveTemplateInputs(spec TemplateSpec, supplied map[string]string, acceptedNotices map[string]int64) (serviceConfiguration, map[string]string, error) {
	definitions := make(map[string]TemplateParameter, len(spec.Parameters))
	for _, parameter := range spec.Parameters {
		definitions[parameter.Name] = parameter
	}
	for name := range supplied {
		if _, ok := definitions[name]; !ok {
			return serviceConfiguration{}, nil, serviceError("TEMPLATE_PARAMETER_UNKNOWN", "The deployment contains a parameter that is not defined by the template.", 400, false, nil)
		}
	}
	plain := map[string]string{}
	secrets := map[string]string{}
	for _, parameter := range spec.Parameters {
		value, present := supplied[parameter.Name]
		if !present {
			value = parameter.Default
		}
		if parameter.Required && strings.TrimSpace(value) == "" {
			return serviceConfiguration{}, nil, serviceError("TEMPLATE_PARAMETER_REQUIRED", "A required template parameter is missing.", 400, false, nil)
		}
		if strings.ContainsRune(value, '\x00') || len(value) > 64*1024 {
			return serviceConfiguration{}, nil, serviceError("TEMPLATE_PARAMETER_INVALID", "A template parameter value is invalid or too large.", 400, false, nil)
		}
		if (spec.Kind == DeploymentContainer || spec.Kind == DeploymentCompose) && strings.ContainsAny(value, "\r\n") {
			return serviceConfiguration{}, nil, serviceError("TEMPLATE_PARAMETER_INVALID", "Container template parameters cannot contain line breaks.", 400, false, nil)
		}
		if parameter.Type == "secret" {
			if value != "" {
				secrets[parameter.Name] = value
			}
		} else {
			plain[parameter.Name] = value
		}
	}
	return newServiceConfiguration(plain, acceptedNotices), secrets, nil
}

func validateAcceptedNotices(template Template, accepted map[string]int64) error {
	known := make(map[string]TemplateNotice, len(template.Notices))
	for _, notice := range template.Notices {
		known[notice.ID] = notice
		value, present := accepted[notice.ID]
		if notice.AcknowledgementRequired && !present {
			return serviceError("NOTICE_ACKNOWLEDGEMENT_REQUIRED", "Accept the current safety notice before installing or updating this service.", 409, false, nil)
		}
		if present && value != notice.Revision {
			return serviceError("NOTICE_ACKNOWLEDGEMENT_STALE", "The accepted safety notice revision does not match the current template.", 409, false, nil)
		}
	}
	for id := range accepted {
		if _, ok := known[id]; !ok {
			return serviceError("NOTICE_ACKNOWLEDGEMENT_UNKNOWN", "The request contains an unknown safety notice acknowledgement.", 400, false, nil)
		}
	}
	return nil
}

func cloneNoticeRevisions(values map[string]int64) map[string]int64 {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]int64, len(values))
	for id, revision := range values {
		cloned[id] = revision
	}
	return cloned
}

func (m *Manager) serviceSecretPath(serviceID string) string {
	return filepath.Join(m.stateDir, "secrets", strings.TrimSpace(serviceID)+".json")
}

func (m *Manager) writeServiceSecrets(serviceID string, values map[string]string) error {
	return m.writeServiceSecretDocument(serviceID, serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion, Parameters: values})
}

func (m *Manager) writeServiceSecretDocument(serviceID string, values serviceSecrets) error {
	if len(values.Parameters) == 0 && len(values.Environment) == 0 {
		if err := os.Remove(m.serviceSecretPath(serviceID)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	values.SchemaVersion = serviceConfigurationSchemaVersion
	raw, err := json.Marshal(values)
	if err != nil {
		return err
	}
	path := m.serviceSecretPath(serviceID)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func (m *Manager) serviceParameters(service *pfregistry.ManagedService) (map[string]string, error) {
	values := map[string]string{}
	if service != nil && strings.TrimSpace(service.ConfigurationJSON) != "" {
		configuration, err := decodeServiceConfiguration(service.ConfigurationJSON)
		if err != nil {
			return nil, err
		}
		for name, value := range configuration.Parameters {
			values[name] = value
		}
	}
	if service == nil {
		return values, nil
	}
	raw, err := os.ReadFile(m.serviceSecretPath(service.ServiceID))
	if errors.Is(err, os.ErrNotExist) {
		return values, nil
	}
	if err != nil {
		return nil, err
	}
	secrets := serviceSecrets{}
	if err := decodeStrictJSON(raw, &secrets); err != nil {
		return nil, serviceError("SERVICE_SECRETS_INVALID", "The managed-service secret file is invalid.", 409, false, err)
	}
	if secrets.SchemaVersion != serviceConfigurationSchemaVersion {
		return nil, serviceError("SERVICE_SECRETS_VERSION_UNSUPPORTED", "The managed-service secret file version is unsupported.", 409, false, nil)
	}
	for name, value := range secrets.Parameters {
		values[name] = value
	}
	return values, nil
}

func (m *Manager) serviceSecretDocument(serviceID string) (serviceSecrets, error) {
	raw, err := os.ReadFile(m.serviceSecretPath(serviceID))
	if errors.Is(err, os.ErrNotExist) {
		return serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion}, nil
	}
	if err != nil {
		return serviceSecrets{}, err
	}
	values := serviceSecrets{}
	if err := decodeStrictJSON(raw, &values); err != nil {
		return serviceSecrets{}, serviceError("SERVICE_SECRETS_INVALID", "The managed-service secret file is invalid.", 409, false, err)
	}
	if values.SchemaVersion != serviceConfigurationSchemaVersion {
		return serviceSecrets{}, serviceError("SERVICE_SECRETS_VERSION_UNSUPPORTED", "The managed-service secret file version is unsupported.", 409, false, nil)
	}
	return values, nil
}

func templateSpecFromService(service *pfregistry.ManagedService) (TemplateSpec, error) {
	if service == nil || strings.TrimSpace(service.TemplateSnapshotJSON) == "" || service.TemplateSnapshotJSON == "{}" {
		return TemplateSpec{}, serviceError("TEMPLATE_SNAPSHOT_MISSING", "The managed service has no usable template snapshot.", 409, false, nil)
	}
	spec, err := verifiedTemplateSpec(service.TemplateSnapshotJSON, service.TemplateSnapshotSHA256)
	if errors.Is(err, errTemplateSpecIdentityMismatch) {
		return TemplateSpec{}, serviceError("TEMPLATE_SNAPSHOT_IDENTITY_MISMATCH", "The managed service template snapshot identity has changed.", 409, false, err)
	}
	if err != nil {
		return TemplateSpec{}, serviceError("TEMPLATE_SNAPSHOT_INVALID", "The managed service template snapshot is invalid or no longer satisfies the runtime policy.", 409, false, err)
	}
	return spec, nil
}
